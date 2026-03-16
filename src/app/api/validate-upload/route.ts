import { NextResponse } from 'next/server'
import { UPLOAD_LIMITS, ACCEPTED_MIME_TYPES } from '@/lib/upload-config'

// Sanitize a filename: strip path traversal characters, limit length
function sanitizeFilename(name: string): string {
  // Remove any directory traversal components
  const base = name
    .replace(/[/\\]/g, '')        // remove slashes
    .replace(/\.\./g, '')         // remove double dots
    .replace(/[\x00-\x1f\x7f]/g, '') // remove control characters
    .trim()

  // Limit to 255 characters
  if (base.length > 255) {
    const ext = base.lastIndexOf('.')
    if (ext > 0) {
      return base.slice(0, 251 - (base.length - ext)) + base.slice(ext)
    }
    return base.slice(0, 255)
  }

  return base
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      filename,
      mimeType,
      sizeBytes,
    }: { filename: string; mimeType: string; sizeBytes: number } = body

    if (!filename || !mimeType || typeof sizeBytes !== 'number') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Size check
    if (sizeBytes > UPLOAD_LIMITS.maxSizeBytes) {
      return NextResponse.json(
        { error: `File too large (max ${UPLOAD_LIMITS.maxSizeLabel})` },
        { status: 422 }
      )
    }

    // MIME type check
    if (!ACCEPTED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: 'File type not supported' },
        { status: 422 }
      )
    }

    // Sanitize and validate filename
    const sanitized = sanitizeFilename(filename)
    if (!sanitized) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 422 })
    }

    return NextResponse.json({ ok: true, sanitizedFilename: sanitized })
  } catch (error) {
    console.error('Validate upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
