import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_ENV = 'ENCRYPTION_KEY' // 64-char hex = 32 bytes

function getKey(): Buffer {
  const hex = process.env[KEY_ENV]
  if (!hex || hex.length !== 64) {
    throw new Error(`${KEY_ENV} must be a 64-character hex string (32 bytes)`)
  }
  return Buffer.from(hex, 'hex')
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Store: iv(12) + tag(16) + ciphertext, all as hex, colon-separated
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
}

export function decrypt(stored: string): string {
  const key = getKey()
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted format')
  const [ivHex, tagHex, dataHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const data = Buffer.from(dataHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(data) + decipher.final('utf8')
}

// Safe versions that return null on failure (for reading old/unencrypted data)
export function tryDecrypt(stored: string | null | undefined): string | null {
  if (!stored) return null
  try {
    // If it looks encrypted (contains colons and is long), decrypt
    if (stored.includes(':') && stored.length > 80) {
      return decrypt(stored)
    }
    // Otherwise return as-is (plaintext from before encryption was added)
    return stored
  } catch {
    return null
  }
}
