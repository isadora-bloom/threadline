/**
 * Charley ↔ NamUs (and Doe Network) sibling linker
 *
 * Charley Project records carry raw_data.namus_number — the registry literally
 * tells us which NamUs case it is describing. This script reads that field,
 * resolves the corresponding NamUs record by external_id, and writes a high-
 * confidence record_siblings row with link_type='explicit_id'.
 *
 * For Charley records that lack a namus_number, fall back to a fuzzy match
 * by normalized (person_name, state, year-of-date_missing). Stricter than the
 * data-quality dupe heuristic because adding the year cuts down name-collision
 * noise dramatically. Match confidence is lower (0.6) and link_type marks it
 * as fuzzy.
 *
 * Idempotent. Pairs are stored ordered (a.id < b.id) and UNIQUE.
 *
 * Usage: npx tsx scripts/link-charley-namus.ts [--limit 5000] [--dry-run]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 5000
const DRY_RUN = args.includes('--dry-run')

interface ImportRow {
  id: string
  source_id: string | null
  external_id: string
  person_name: string | null
  state: string | null
  date_missing: string | null
  raw_data: Record<string, unknown> | null
}

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function normalizeNamusNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Charley stores values like "MP12345", "MP 12345", "12345", "MP12345 / UP67890"
  // We split on common separators and return all candidate forms.
  const trimmed = String(raw).trim().toUpperCase().replace(/\s+/g, '')
  if (!trimmed) return null
  // If it already starts with MP/UP, return as-is. Otherwise NamUs missing
  // person numbers are MP-prefixed and unidentified are UP-prefixed.
  if (/^(MP|UP)\d+/.test(trimmed)) {
    const m = trimmed.match(/^(MP|UP)\d+/)
    return m ? m[0] : trimmed
  }
  if (/^\d+$/.test(trimmed)) {
    // Could be either MP or UP. Most Charley references are missing-persons
    // so default to MP. The lookup below tries both.
    return `MP${trimmed}`
  }
  return null
}

function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null
  const cleaned = name.toLowerCase().trim().replace(/\s+/g, ' ')
  if (!cleaned || cleaned === 'unknown' || cleaned === 'unidentified') return null
  return cleaned
}

function yearOf(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const y = new Date(dateStr).getUTCFullYear()
  return Number.isFinite(y) ? y : null
}

async function fetchSourceId(slug: string): Promise<string | null> {
  const { data } = await supabase.from('import_sources').select('id').eq('slug', slug).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

async function fetchAllFromSource(sourceId: string): Promise<ImportRow[]> {
  const PAGE = 1000
  const rows: ImportRow[] = []
  for (let from = 0; ; from += PAGE) {
    if (rows.length >= LIMIT) break
    const take = Math.min(PAGE, LIMIT - rows.length)
    const { data, error } = await supabase
      .from('import_records')
      .select('id, source_id, external_id, person_name, state, date_missing, raw_data')
      .eq('source_id', sourceId)
      .range(from, from + take - 1)
    if (error) { console.error('Fetch failed:', error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...(data as ImportRow[]))
    if (data.length < take) break
  }
  return rows
}

async function findByExternalId(externalId: string): Promise<ImportRow | null> {
  const { data } = await supabase
    .from('import_records')
    .select('id, source_id, external_id, person_name, state, date_missing, raw_data')
    .eq('external_id', externalId)
    .limit(1)
    .maybeSingle()
  return (data as ImportRow | null) ?? null
}

async function alreadyLinked(a: string, b: string): Promise<boolean> {
  const [lo, hi] = orderedPair(a, b)
  const { data } = await supabase
    .from('record_siblings')
    .select('id')
    .eq('record_a_id', lo)
    .eq('record_b_id', hi)
    .maybeSingle()
  return !!data
}

async function insertLink(a: string, b: string, linkType: 'explicit_id' | 'fuzzy_name_state_year', confidence: number): Promise<boolean> {
  const [lo, hi] = orderedPair(a, b)
  const { error } = await supabase
    .from('record_siblings')
    .insert({ record_a_id: lo, record_b_id: hi, link_type: linkType, confidence } as never)
  if (error) {
    if (error.code === '23505') return false // duplicate, fine
    console.error(`  Insert failed (${a} <-> ${b}): ${error.message}`)
    return false
  }
  return true
}

async function main() {
  console.log('=== Charley ↔ NamUs sibling linker ===')

  const charleyId = await fetchSourceId('charley_project')
  if (!charleyId) {
    console.error('No charley_project source found')
    process.exit(1)
  }
  const namusMissingId = await fetchSourceId('namus_missing')
  const namusUidId = await fetchSourceId('namus_unidentified')

  const charleyRecords = await fetchAllFromSource(charleyId)
  console.log(`Charley records: ${charleyRecords.length}`)

  let explicit = 0
  let fuzzy = 0
  let noMatch = 0
  const fuzzyCandidates: ImportRow[] = []

  // Pass 1: explicit linking via raw_data.namus_number
  for (const c of charleyRecords) {
    const numField = c.raw_data && (c.raw_data as Record<string, unknown>).namus_number
    const candidates: string[] = []
    if (typeof numField === 'string') {
      const norm = normalizeNamusNumber(numField)
      if (norm) {
        candidates.push(norm)
        // If we defaulted to MP, also try UP.
        if (norm.startsWith('MP')) candidates.push(`UP${norm.slice(2)}`)
        if (norm.startsWith('UP')) candidates.push(`MP${norm.slice(2)}`)
      }
    }

    let matched = false
    for (const ext of candidates) {
      const namus = await findByExternalId(ext)
      if (!namus || namus.id === c.id) continue
      // Restrict to NamUs sources to avoid cross-Doe weirdness.
      if (namus.source_id !== namusMissingId && namus.source_id !== namusUidId) continue
      if (DRY_RUN) {
        console.log(`  [dry] ${c.external_id} (${c.person_name}) -> ${namus.external_id} (${namus.person_name})`)
        explicit++
        matched = true
        break
      }
      const inserted = await insertLink(c.id, namus.id, 'explicit_id', 0.95)
      if (inserted) explicit++
      matched = true
      break
    }

    if (!matched) fuzzyCandidates.push(c)
  }

  console.log(`Explicit links written: ${explicit}`)
  console.log(`Charley records without explicit namus_number: ${fuzzyCandidates.length}`)

  // Pass 2: fuzzy fallback by (name, state, year)
  // Pull NamUs missing as in-memory index for fast lookup.
  if (!namusMissingId) {
    console.log('No namus_missing source — skipping fuzzy pass.')
    console.log('\n=== Done ===')
    console.log(`Explicit: ${explicit}, fuzzy: ${fuzzy}, no-match: ${noMatch}`)
    return
  }

  const namusRecords = await fetchAllFromSource(namusMissingId)
  console.log(`NamUs missing records loaded for fuzzy pass: ${namusRecords.length}`)
  type NamusKey = string
  const namusByKey = new Map<NamusKey, ImportRow[]>()
  for (const n of namusRecords) {
    const name = normalizeName(n.person_name)
    const state = (n.state ?? '').toLowerCase().trim()
    const year = yearOf(n.date_missing)
    if (!name || !state || !year) continue
    const key = `${name}|${state}|${year}`
    if (!namusByKey.has(key)) namusByKey.set(key, [])
    namusByKey.get(key)!.push(n)
  }

  for (const c of fuzzyCandidates) {
    const name = normalizeName(c.person_name)
    const state = (c.state ?? '').toLowerCase().trim()
    const year = yearOf(c.date_missing)
    if (!name || !state || !year) { noMatch++; continue }
    const key = `${name}|${state}|${year}`
    const candidates = namusByKey.get(key) ?? []
    if (candidates.length === 0) { noMatch++; continue }
    // If multiple matches, the (name,state,year) tuple is ambiguous — skip
    // rather than pick wrong.
    if (candidates.length > 1) { noMatch++; continue }
    const n = candidates[0]
    if (DRY_RUN) {
      console.log(`  [dry-fuzzy] ${c.external_id} (${c.person_name}) -> ${n.external_id} (${n.person_name})`)
      fuzzy++
      continue
    }
    if (await alreadyLinked(c.id, n.id)) continue
    const inserted = await insertLink(c.id, n.id, 'fuzzy_name_state_year', 0.6)
    if (inserted) fuzzy++
  }

  console.log('\n=== Done ===')
  console.log(`Explicit links: ${explicit}`)
  console.log(`Fuzzy links: ${fuzzy}`)
  console.log(`No match: ${noMatch}`)
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
