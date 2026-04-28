/**
 * NamUs photo URL fetcher
 *
 * Calls the NamUs case-detail API for every NamUs record that has not had
 * its photos resolved (photos_fetched_at IS NULL) and stores the resulting
 * source URLs on import_records.photo_urls. We do not download the images
 * themselves — the UI proxies them on demand. This keeps the
 * Threadline footprint small while still putting faces on profiles.
 *
 * Rate-limited to 1 request per second per the NamUs scraper convention.
 *
 * Usage: npx tsx scripts/scrape-namus-photos.ts [--limit 500] [--type missing|unidentified] [--force]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const NAMUS_BASE = 'https://www.namus.gov'
const DELAY_MS = 1000
const HEADERS = {
  'User-Agent': 'Threadline Case Intelligence Platform - public interest research (threadline.app)',
  'Accept': 'application/json',
}

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 500
const typeIdx = args.indexOf('--type')
const TYPE_FILTER = typeIdx !== -1 ? args[typeIdx + 1] : null
const FORCE = args.includes('--force')

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

interface Row {
  id: string
  external_id: string
  record_type: string
  source: { slug: string } | null
}

async function fetchTargets(): Promise<Row[]> {
  const PAGE = 1000
  const rows: Row[] = []
  for (let from = 0; from < LIMIT; from += PAGE) {
    const take = Math.min(PAGE, LIMIT - from)
    let q = supabase
      .from('import_records')
      .select('id, external_id, record_type, source:import_sources(slug)')
      .in('record_type', TYPE_FILTER === 'missing'
        ? ['missing_person']
        : TYPE_FILTER === 'unidentified'
          ? ['unidentified_remains']
          : ['missing_person', 'unidentified_remains'])
      .range(from, from + take - 1)
    if (!FORCE) q = q.is('photos_fetched_at', null)

    const { data, error } = await q
    if (error) { console.error('Fetch failed:', error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...(data as Row[]))
    if (data.length < take) break
  }
  // NamUs records only — Charley/Doe Network sources have their own URL conventions handled elsewhere.
  return rows.filter(r => r.source?.slug?.startsWith('namus_'))
}

function caseSetForRecordType(recordType: string): 'MissingPersons' | 'UnidentifiedPersons' | null {
  if (recordType === 'missing_person') return 'MissingPersons'
  if (recordType === 'unidentified_remains') return 'UnidentifiedPersons'
  return null
}

function caseNumberFromExternalId(extId: string): number | null {
  const m = extId.match(/^(?:MP|UP)(\d+)$/i)
  if (!m) return null
  const n = parseInt(m[1])
  return Number.isFinite(n) ? n : null
}

async function fetchCaseDetail(caseSet: string, caseNumber: number): Promise<Record<string, unknown> | null> {
  const url = `${NAMUS_BASE}/api/CaseSets/NamUs/${caseSet}/Cases/${caseNumber}`
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    return await res.json() as Record<string, unknown>
  } catch {
    return null
  }
}

interface RawImage {
  files?: Array<{ name?: string; data?: { name?: string } }>
  filePath?: string
  caseImageInfoId?: number
  id?: number
  isPrimary?: boolean
}

function extractImageUrls(detail: Record<string, unknown>, caseSet: string, caseNumber: number): string[] {
  // The NamUs API response carries images under `images` (or sometimes
  // `caseImages`). Each entry is an object with an id field; the public
  // URL pattern resolves the original-size file.
  const images: RawImage[] = (
    (detail.images as RawImage[] | undefined)
    ?? (detail.caseImages as RawImage[] | undefined)
    ?? []
  )
  const urls: string[] = []
  for (const img of images) {
    const imgId = img.caseImageInfoId ?? img.id
    if (!imgId) continue
    urls.push(`${NAMUS_BASE}/api/CaseSets/NamUs/${caseSet}/Cases/${caseNumber}/Images/${imgId}/Original`)
  }
  return urls
}

async function main() {
  console.log('=== NamUs photo URL fetcher ===')
  console.log(`Limit: ${LIMIT}, type: ${TYPE_FILTER ?? 'both'}, force: ${FORCE}`)

  const targets = await fetchTargets()
  console.log(`Targets: ${targets.length}`)

  let scanned = 0
  let withPhotos = 0
  let updated = 0
  let failed = 0

  for (const row of targets) {
    scanned++
    const caseSet = caseSetForRecordType(row.record_type)
    const caseNumber = caseNumberFromExternalId(row.external_id)
    if (!caseSet || !caseNumber) { failed++; continue }

    const detail = await fetchCaseDetail(caseSet, caseNumber)
    if (!detail) {
      // Mark as fetched anyway so we do not retry endlessly.
      await supabase
        .from('import_records')
        .update({ photos_fetched_at: new Date().toISOString() } as never)
        .eq('id', row.id)
      failed++
      await sleep(DELAY_MS)
      continue
    }

    const urls = extractImageUrls(detail, caseSet, caseNumber)
    const { error } = await supabase
      .from('import_records')
      .update({
        photo_urls: urls,
        photos_fetched_at: new Date().toISOString(),
      } as never)
      .eq('id', row.id)
    if (error) {
      console.error(`  Update failed for ${row.external_id}: ${error.message}`)
      failed++
    } else {
      updated++
      if (urls.length > 0) withPhotos++
    }

    if (scanned % 25 === 0) console.log(`  ...${scanned} scanned, ${withPhotos} with photos`)
    await sleep(DELAY_MS)
  }

  console.log('\n=== Done ===')
  console.log(`Scanned: ${scanned}`)
  console.log(`Updated: ${updated}`)
  console.log(`With photos: ${withPhotos}`)
  console.log(`Failed: ${failed}`)
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
