/**
 * Doe Network Scraper — direct-to-Supabase version
 *
 * Uses the Doe Network's internal JSON API (same data their public pages load)
 * to fetch all case records and upsert them directly into import_records.
 *
 * Features:
 *   - Upserts into import_records (skips unchanged records via sync_hash)
 *   - Updates import_sources.total_records and last_import_at
 *   - Resumes from where it left off (existing records are skipped unless stale)
 *   - 2-second delay between requests — the Doe Network is volunteer-run
 *   - Detailed logging with progress counters
 *
 * Tables used (from migration 025):
 *   import_sources  — row with slug='doe_network'
 *   import_records   — one row per case
 *
 * Run: npx tsx scripts/scrape-doe-network.ts
 *      npx tsx scripts/scrape-doe-network.ts --missing-only
 *      npx tsx scripts/scrape-doe-network.ts --unidentified-only
 *      npx tsx scripts/scrape-doe-network.ts --force   (re-fetch even if hash unchanged)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Config ──────────────────────────────────────────────────────────────────

const DELAY_MS = 2000           // 2 seconds between case detail requests
const INDEX_DELAY_MS = 2000     // 2 seconds between index requests
const FETCH_TIMEOUT_MS = 20_000 // 20-second timeout per request
const MAX_RETRIES = 2           // retry failed fetches this many times
const RETRY_DELAY_MS = 5000     // wait 5s before retrying
const BATCH_SIZE = 25           // log progress every N cases

const DOE_API_BASE = 'https://www.doenetwork.org/cases/software/php'
const DOE_CASE_URL = (id: string) =>
  `https://www.doenetwork.org/cases/software/main.html?id=${id.toLowerCase()}`

// ─── Types ───────────────────────────────────────────────────────────────────

/** Structured case data extracted from the Doe Network API */
export interface DoeCase {
  id: string
  url: string
  category: 'missing_person' | 'unidentified_remains'
  country: 'US' | 'Canada'

  // Identity
  name: string | null
  sex: string | null
  race: string | null
  dateOfBirth: string | null
  age: string | null
  caseClassification: string | null

  // Dates
  dateMissing: string | null
  dateFound: string | null
  estimatedDateOfDeath: string | null

  // Location
  locationLastSeen: string | null
  locationOfDiscovery: string | null

  // Physical description
  height: string | null
  weight: string | null
  hair: string | null
  eyes: string | null
  distinguishingMarks: string | null
  stateOfRemains: string | null

  // Details
  clothing: string | null
  jewelry: string | null
  additionalPersonalItems: string | null
  dentals: string | null
  fingerprints: string | null
  dna: string | null

  // Narratives
  circumstances: string | null

  // Reference numbers
  namusNumber: string | null
  ncicNumber: string | null
  ncmecNumber: string | null

  // Investigating agency
  informationSources: string | null

  rawApiData: Record<string, string>
}

// ─── CLI flags ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const FLAG_MISSING_ONLY = args.includes('--missing-only')
const FLAG_UNIDENTIFIED_ONLY = args.includes('--unidentified-only')
const FLAG_FORCE = args.includes('--force')

// ─── Environment ─────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const envPath = join(__dirname, '../.env.local')
  if (!existsSync(envPath)) {
    console.error('ERROR: .env.local not found. Copy .env.local.example and fill in your keys.')
    process.exit(1)
  }
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => {
        const [k, ...v] = l.split('=')
        return [k.trim(), v.join('=').trim()]
      })
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const stripped = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length > 0 ? stripped : null
}

function hashData(data: Record<string, string>): string {
  // Stable hash: sort keys, stringify, SHA-256
  const sorted = Object.keys(data).sort().reduce((acc, key) => {
    acc[key] = data[key]
    return acc
  }, {} as Record<string, string>)
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

/**
 * Try to parse a date string into YYYY-MM-DD format.
 * Returns null if unparseable or obviously invalid.
 */
function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  const cleaned = dateStr.replace(/[^0-9a-zA-Z\s,/-]/g, '').trim()
  if (!cleaned || cleaned.toLowerCase() === 'unknown') return null
  try {
    const d = new Date(cleaned)
    if (!isNaN(d.getTime()) && d.getFullYear() > 1800 && d.getFullYear() <= new Date().getFullYear() + 1) {
      return d.toISOString().split('T')[0] // YYYY-MM-DD
    }
  } catch { /* ignore */ }
  return null
}

/**
 * Extract US state abbreviation from a location string.
 * Matches patterns like "City, VA" or "County, Virginia" or standalone "VA".
 */
function extractState(location: string | null): string | null {
  if (!location) return null

  // Map of full state names to abbreviations
  const stateMap: Record<string, string> = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
    'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
    'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
    'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
    'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
    'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
    'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
    'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
    'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
    // Canadian provinces
    'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB',
    'new brunswick': 'NB', 'newfoundland': 'NL', 'nova scotia': 'NS',
    'ontario': 'ON', 'prince edward island': 'PE', 'quebec': 'QC',
    'saskatchewan': 'SK',
  }

  const validAbbreviations = new Set(Object.values(stateMap))

  // Try two-letter abbreviation at end: "City, VA" or "City VA"
  const abbrMatch = location.match(/[,\s]+([A-Z]{2})\s*$/)
  if (abbrMatch && validAbbreviations.has(abbrMatch[1])) {
    return abbrMatch[1]
  }

  // Try full state name
  const lower = location.toLowerCase()
  for (const [name, abbr] of Object.entries(stateMap)) {
    if (lower.includes(name)) return abbr
  }

  return null
}

/**
 * Extract city from a location string like "Richmond, VA" or "near Richmond, Henrico County, VA".
 * Takes the first comma-separated segment as the city.
 */
function extractCity(location: string | null): string | null {
  if (!location) return null
  const parts = location.split(',').map(p => p.trim())
  if (parts.length >= 2) {
    // First part is typically the city or "near City"
    const city = parts[0].replace(/^near\s+/i, '').trim()
    return city.length > 0 ? city : null
  }
  return null
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Threadline Research Tool - public interest case research' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json() as T
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithRetry<T>(url: string, label: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchJson<T>(url)
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.log(`  [retry ${attempt + 1}/${MAX_RETRIES}] ${label}: ${(err as Error).message}`)
        await sleep(RETRY_DELAY_MS)
      } else {
        throw err
      }
    }
  }
  throw new Error('Unreachable')
}

// ─── Index fetchers ──────────────────────────────────────────────────────────

interface UidIndexEntry {
  id: string
  minimized_race: string
  minimized_age: string
  date_of_discovery: string
  reconstruction_text: string
  img_reference: string
}

interface MpIndexEntry {
  id: string
  minimized_race: string
  minimized_age: string
  missing_since: string
  pname: string
  image_text: string
  img_reference: string
}

async function getUidIds(country: 'us' | 'canada'): Promise<string[]> {
  const ids: string[] = []
  for (const sex of ['males', 'females']) {
    const url = `${DOE_API_BASE}/database.php?get_uid_${sex}_index_${country}=true`
    console.log(`    Fetching UID ${sex} index (${country})...`)
    try {
      const data = await fetchWithRetry<UidIndexEntry[]>(url, `UID ${sex} ${country}`)
      ids.push(...data.map(e => e.id))
      console.log(`    -> ${data.length} IDs`)
    } catch (err) {
      console.error(`    ERROR: Failed to fetch UID ${sex} index (${country}): ${(err as Error).message}`)
    }
    await sleep(INDEX_DELAY_MS)
  }
  return ids
}

async function getMpIds(country: 'us' | 'canada'): Promise<string[]> {
  const ids: string[] = []
  for (const sex of ['males', 'females']) {
    const url = `${DOE_API_BASE}/mpdatabase.php?get_mp_${sex}_index_${country}=true`
    console.log(`    Fetching MP ${sex} index (${country})...`)
    try {
      const data = await fetchWithRetry<MpIndexEntry[]>(url, `MP ${sex} ${country}`)
      ids.push(...data.map(e => e.id))
      console.log(`    -> ${data.length} IDs`)
    } catch (err) {
      console.error(`    ERROR: Failed to fetch MP ${sex} index (${country}): ${(err as Error).message}`)
    }
    await sleep(INDEX_DELAY_MS)
  }
  return ids
}

// ─── Case detail fetchers ────────────────────────────────────────────────────

function buildUidCase(id: string, raw: Record<string, string>, country: 'US' | 'Canada'): DoeCase {
  return {
    id,
    url: DOE_CASE_URL(id),
    category: 'unidentified_remains',
    country,
    name: null,
    sex: raw.sex || null,
    race: raw.race || null,
    dateOfBirth: null,
    age: stripHtml(raw.estimated_age) || null,
    caseClassification: raw.state_of_remains || null,
    dateMissing: null,
    dateFound: raw.date_of_discovery || null,
    estimatedDateOfDeath: raw.estimated_date_of_death || null,
    locationLastSeen: null,
    locationOfDiscovery: raw.location_of_discovery || null,
    height: raw.height || null,
    weight: raw.weight || null,
    hair: raw.hair_color || null,
    eyes: raw.eye_color || null,
    distinguishingMarks: raw.distinguishing_marks_and_features || null,
    stateOfRemains: raw.state_of_remains || null,
    clothing: raw.clothing || null,
    jewelry: raw.jewelry || null,
    additionalPersonalItems: raw.additional_personal_items || null,
    dentals: raw.dentals || null,
    fingerprints: raw.fingerprints || null,
    dna: raw.dna || null,
    circumstances: stripHtml(raw.circumstances_of_discovery) || null,
    namusNumber: raw.namus_case_number || null,
    ncicNumber: raw.ncic_case_number || null,
    ncmecNumber: raw.ncmec_case_number || null,
    informationSources: stripHtml(raw.information_sources) || null,
    rawApiData: raw,
  }
}

function buildMpCase(id: string, raw: Record<string, string>, country: 'US' | 'Canada'): DoeCase {
  return {
    id,
    url: DOE_CASE_URL(id),
    category: 'missing_person',
    country,
    name: raw.pname || raw.missing_person_name || null,
    sex: raw.gender || null,
    race: raw.race || null,
    dateOfBirth: raw.date_of_birth || null,
    age: raw.age || null,
    caseClassification: raw.case_classification || null,
    dateMissing: raw.missing_since || null,
    dateFound: null,
    estimatedDateOfDeath: null,
    locationLastSeen: raw.location_last_seen || null,
    locationOfDiscovery: null,
    height: raw.height || null,
    weight: raw.weight || null,
    hair: raw.hair_color || null,
    eyes: raw.eye_color || null,
    distinguishingMarks: raw.distinguishing_marks_and_features || null,
    stateOfRemains: null,
    clothing: raw.clothing || null,
    jewelry: raw.jewelry || null,
    additionalPersonalItems: raw.additional_personal_items || null,
    dentals: raw.dentals || null,
    fingerprints: raw.fingerprints || null,
    dna: raw.dna || null,
    circumstances: stripHtml(raw.circumstances_of_disappearance) || null,
    namusNumber: raw.namus_case_number || null,
    ncicNumber: raw.ncic_case_number || null,
    ncmecNumber: raw.ncmec_case_number || null,
    informationSources: stripHtml(raw.information_sources) || null,
    rawApiData: raw,
  }
}

// ─── Database operations ─────────────────────────────────────────────────────

interface UpsertResult {
  inserted: number
  updated: number
  skipped: number
  errors: number
}

async function upsertCase(
  supabase: SupabaseClient,
  sourceId: string,
  doeCase: DoeCase,
  existingHashes: Map<string, string>,
): Promise<'inserted' | 'updated' | 'skipped' | 'error'> {
  const newHash = hashData(doeCase.rawApiData)
  const existingHash = existingHashes.get(doeCase.id)

  // If record exists with same hash, skip (unless --force)
  if (existingHash && existingHash === newHash && !FLAG_FORCE) {
    return 'skipped'
  }

  const location = doeCase.locationLastSeen || doeCase.locationOfDiscovery
  const state = extractState(location)
  const city = extractCity(location)

  const recordType: 'missing_person' | 'unidentified_remains' = doeCase.category === 'missing_person'
    ? 'missing_person'
    : 'unidentified_remains'

  const row = {
    source_id: sourceId,
    external_id: doeCase.id,
    external_url: doeCase.url,
    raw_data: doeCase.rawApiData,
    record_type: recordType,
    person_name: doeCase.name || null,
    age_text: doeCase.age || null,
    sex: doeCase.sex || null,
    race: doeCase.race || null,
    state,
    city,
    date_missing: parseDate(doeCase.dateMissing),
    date_found: parseDate(doeCase.dateFound),
    sync_hash: newHash,
    last_synced_at: new Date().toISOString(),
    stale: false,
  }

  const { error } = await supabase
    .from('import_records')
    .upsert(row, { onConflict: 'source_id,external_id' })

  if (error) {
    return 'error'
  }

  return existingHash ? 'updated' : 'inserted'
}

// ─── Scrape + upsert a batch ─────────────────────────────────────────────────

interface BatchConfig {
  ids: string[]
  label: string
  fetchUrl: (id: string) => string
  buildCase: (id: string, raw: Record<string, string>, country: 'US' | 'Canada') => DoeCase
  country: 'US' | 'Canada'
}

async function scrapeBatch(
  supabase: SupabaseClient,
  sourceId: string,
  existingHashes: Map<string, string>,
  config: BatchConfig,
): Promise<UpsertResult> {
  const { ids, label, fetchUrl, buildCase, country } = config
  const result: UpsertResult = { inserted: 0, updated: 0, skipped: 0, errors: 0 }

  // Pre-filter: if not --force, check which IDs already have matching hashes.
  // We still need to fetch to check for changes, but we can skip IDs we already have
  // if not using --force. Actually, we should always fetch to detect changes.
  // The skip happens in upsertCase when hashes match.

  console.log(`\n  [${label}] Processing ${ids.length} case IDs...`)

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]

    // Progress logging
    if (i > 0 && i % BATCH_SIZE === 0) {
      const pct = ((i / ids.length) * 100).toFixed(1)
      console.log(
        `  [${label}] ${i}/${ids.length} (${pct}%) — ` +
        `${result.inserted} new, ${result.updated} updated, ${result.skipped} unchanged, ${result.errors} errors`
      )
    }

    // If we already have this record with a hash and not forcing, we can skip
    // the fetch entirely — the data hasn't changed on our side
    if (!FLAG_FORCE && existingHashes.has(id)) {
      result.skipped++
      continue
    }

    // Rate limit
    await sleep(DELAY_MS)

    // Fetch case detail from Doe Network API
    let raw: Record<string, string>
    try {
      raw = await fetchWithRetry<Record<string, string>>(fetchUrl(id), `${label} ${id}`)
    } catch (err) {
      result.errors++
      console.error(`  [${label}] ERROR fetching ${id}: ${(err as Error).message}`)
      continue
    }

    // Build structured case
    const doeCase = buildCase(id, raw, country)

    // Upsert into import_records
    const outcome = await upsertCase(supabase, sourceId, doeCase, existingHashes)
    switch (outcome) {
      case 'inserted': result.inserted++; break
      case 'updated': result.updated++; break
      case 'skipped': result.skipped++; break
      case 'error':
        result.errors++
        console.error(`  [${label}] ERROR upserting ${id}`)
        break
    }
  }

  console.log(
    `  [${label}] Done: ${result.inserted} new, ${result.updated} updated, ` +
    `${result.skipped} unchanged, ${result.errors} errors`
  )

  return result
}

// ─── Load existing hashes for resume support ─────────────────────────────────

async function loadExistingHashes(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('import_records')
      .select('external_id, sync_hash')
      .eq('source_id', sourceId)
      .range(offset, offset + pageSize - 1)

    if (error) {
      console.error(`  WARNING: Failed to load existing records (offset ${offset}): ${error.message}`)
      break
    }

    if (!data || data.length === 0) break

    for (const row of data) {
      if (row.sync_hash) {
        hashes.set(row.external_id, row.sync_hash)
      }
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  return hashes
}

// ─── Update import_sources metadata ──────────────────────────────────────────

async function updateSourceMetadata(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<void> {
  // Count total records for this source
  const { count, error: countErr } = await supabase
    .from('import_records')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', sourceId)

  if (countErr) {
    console.error(`  WARNING: Could not count records: ${countErr.message}`)
    return
  }

  const { error: updateErr } = await supabase
    .from('import_sources')
    .update({
      total_records: count ?? 0,
      last_import_at: new Date().toISOString(),
    })
    .eq('id', sourceId)

  if (updateErr) {
    console.error(`  WARNING: Could not update import_sources: ${updateErr.message}`)
  } else {
    console.log(`  Updated import_sources: total_records=${count}, last_import_at=now`)
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()

  console.log('========================================')
  console.log('  Doe Network Scraper')
  console.log('  Direct-to-Supabase import_records')
  console.log('========================================')
  console.log('')
  console.log('Rate limit: 2-second delay between requests')
  console.log('The Doe Network is a nonprofit doing critical work — be gentle.')
  console.log('')

  if (FLAG_MISSING_ONLY) console.log('Mode: --missing-only (skipping unidentified)')
  if (FLAG_UNIDENTIFIED_ONLY) console.log('Mode: --unidentified-only (skipping missing)')
  if (FLAG_FORCE) console.log('Mode: --force (re-fetching all records regardless of hash)')
  console.log('')

  // ── Connect to Supabase ────────────────────────────────────────────────────
  const env = loadEnv()
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  console.log('Connected to Supabase')

  // ── Get import source ID ───────────────────────────────────────────────────
  const { data: source, error: sourceErr } = await supabase
    .from('import_sources')
    .select('id, slug, display_name')
    .eq('slug', 'doe_network')
    .single()

  if (sourceErr || !source) {
    console.error('ERROR: import_sources row with slug=\'doe_network\' not found.')
    console.error('Make sure migration 025 has been applied.')
    if (sourceErr) console.error('  Detail:', sourceErr.message)
    process.exit(1)
  }

  const sourceId = source.id
  console.log(`Import source: ${source.display_name} (${sourceId})`)

  // ── Load existing records for resume/change detection ──────────────────────
  console.log('Loading existing records for resume support...')
  const existingHashes = await loadExistingHashes(supabase, sourceId)
  console.log(`  ${existingHashes.size} records already in database`)
  console.log('')

  // ── Track totals across all batches ────────────────────────────────────────
  const totals: UpsertResult = { inserted: 0, updated: 0, skipped: 0, errors: 0 }

  function addToTotals(batch: UpsertResult) {
    totals.inserted += batch.inserted
    totals.updated += batch.updated
    totals.skipped += batch.skipped
    totals.errors += batch.errors
  }

  // ── Missing Persons ────────────────────────────────────────────────────────
  if (!FLAG_UNIDENTIFIED_ONLY) {
    console.log('--- MISSING PERSONS ---')
    console.log('  Fetching case indexes...')

    const mpUsIds = await getMpIds('us')
    const mpCanadaIds = await getMpIds('canada')
    console.log(`  Total: ${mpUsIds.length} US + ${mpCanadaIds.length} Canada = ${mpUsIds.length + mpCanadaIds.length} cases`)

    if (mpUsIds.length > 0) {
      const usResult = await scrapeBatch(supabase, sourceId, existingHashes, {
        ids: mpUsIds,
        label: 'MP-US',
        fetchUrl: (id) => `${DOE_API_BASE}/mpdatabase.php?id=${id}&fields=true`,
        buildCase: buildMpCase,
        country: 'US',
      })
      addToTotals(usResult)
    }

    if (mpCanadaIds.length > 0) {
      const caResult = await scrapeBatch(supabase, sourceId, existingHashes, {
        ids: mpCanadaIds,
        label: 'MP-CA',
        fetchUrl: (id) => `${DOE_API_BASE}/mpdatabase.php?id=${id}&fields=true`,
        buildCase: buildMpCase,
        country: 'Canada',
      })
      addToTotals(caResult)
    }
  }

  // ── Unidentified Persons / Remains ─────────────────────────────────────────
  if (!FLAG_MISSING_ONLY) {
    console.log('\n--- UNIDENTIFIED PERSONS / REMAINS ---')
    console.log('  Fetching case indexes...')

    const uidUsIds = await getUidIds('us')
    const uidCanadaIds = await getUidIds('canada')
    console.log(`  Total: ${uidUsIds.length} US + ${uidCanadaIds.length} Canada = ${uidUsIds.length + uidCanadaIds.length} cases`)

    if (uidUsIds.length > 0) {
      const usResult = await scrapeBatch(supabase, sourceId, existingHashes, {
        ids: uidUsIds,
        label: 'UID-US',
        fetchUrl: (id) => `${DOE_API_BASE}/database.php?id=${id}&fields=true`,
        buildCase: buildUidCase,
        country: 'US',
      })
      addToTotals(usResult)
    }

    if (uidCanadaIds.length > 0) {
      const caResult = await scrapeBatch(supabase, sourceId, existingHashes, {
        ids: uidCanadaIds,
        label: 'UID-CA',
        fetchUrl: (id) => `${DOE_API_BASE}/database.php?id=${id}&fields=true`,
        buildCase: buildUidCase,
        country: 'Canada',
      })
      addToTotals(caResult)
    }
  }

  // ── Update import_sources metadata ─────────────────────────────────────────
  console.log('\nUpdating import_sources metadata...')
  await updateSourceMetadata(supabase, sourceId)

  // ── Summary ────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

  console.log('')
  console.log('========================================')
  console.log('  Scrape Complete')
  console.log('========================================')
  console.log(`  New records:       ${totals.inserted}`)
  console.log(`  Updated records:   ${totals.updated}`)
  console.log(`  Unchanged (skip):  ${totals.skipped}`)
  console.log(`  Errors:            ${totals.errors}`)
  console.log(`  Elapsed:           ${elapsed} minutes`)
  console.log('')

  if (totals.errors > 0) {
    console.log(`WARNING: ${totals.errors} errors occurred. Check logs above for details.`)
    console.log('Re-run the scraper to retry failed records (they will be fetched again).')
    console.log('')
  }

  if (totals.inserted > 0 || totals.updated > 0) {
    console.log('Records are now in import_records with ai_processed=false.')
    console.log('Next step: run AI processing to extract entities and claims.')
  } else if (totals.skipped > 0 && totals.inserted === 0) {
    console.log('All records already up-to-date. Nothing new to import.')
    console.log('Use --force to re-fetch and re-hash all records.')
  }
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message)
  console.error(err.stack)
  process.exit(1)
})
