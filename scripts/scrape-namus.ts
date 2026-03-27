/**
 * NamUs Scraper — Missing Persons & Unidentified Remains
 *
 * Fetches all public records from the National Missing and Unidentified Persons
 * System (NamUs) via their public search API, then upserts into Threadline's
 * import_records table.
 *
 * Two-phase approach:
 *   1. Search API — paginated bulk fetch (100 per page) to get all case summaries
 *   2. Upsert — each record goes into import_records with extracted fields
 *
 * Individual case detail endpoints exist but are not needed for the bulk import.
 * The search results contain enough data for our summary fields. If we need full
 * case details later, we can add a detail-fetch pass.
 *
 * Rate: 1 second between API requests. NamUs is a government resource — be respectful.
 *
 * Run: npx tsx scripts/scrape-namus.ts
 *       npx tsx scripts/scrape-namus.ts --missing-only
 *       npx tsx scripts/scrape-namus.ts --unidentified-only
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')
const DELAY_MS = 1000
const FETCH_TIMEOUT_MS = 30000
const PAGE_SIZE = 100
const NAMUS_BASE = 'https://www.namus.gov'

// ─── Types ──────────────────────────────────────────────────────────────────

interface NamusMissingSearchResult {
  namus2Number: number
  firstName: string | null
  lastName: string | null
  middleName: string | null
  gender: string | null
  hairColor: string | null
  raceEthnicity: string | null
  computedMissingMinAge: number | null
  computedMissingMaxAge: number | null
  currentAgeFrom: number | null
  currentAgeTo: number | null
  cityOfLastContact: string | null
  stateOfLastContact: string | null
  countyOfLastContact: string | null
  dateOfLastContact: string | null
  modifiedDateTime: string | null
  createdDateTime: string | null
  link: string | null
  image: string | null
  missingAgeRangeValue: string | null
}

interface NamusUnidentifiedSearchResult {
  namus2Number: number
  sex: string | null
  caseNumber: string | null
  raceEthnicity: string | string[] | null
  estimatedAgeFrom: number | null
  estimatedAgeTo: number | null
  hairColor: string | null
  conditionOfRemains: string | null
  dateFound: string | null
  cityOfRecovery: string | null
  stateOfRecovery: string | null
  countyOfRecovery: string | null
  modifiedDateTime: string | null
  createdDateTime: string | null
  link: string | null
  image: string | null
}

interface SearchResponse<T> {
  count: number
  results: T[]
}

interface ImportRecord {
  source_id: string
  external_id: string
  external_url: string
  raw_data: Record<string, unknown>
  record_type: 'missing_person' | 'unidentified_remains'
  person_name: string | null
  age_text: string | null
  sex: string | null
  race: string | null
  state: string | null
  city: string | null
  date_missing: string | null
  date_found: string | null
  sync_hash: string
}

// ─── Environment ────────────────────────────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

function parseDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  // NamUs dates come as "1988-09-20T00:00:00" or "1988-09-20"
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]
  return null
}

function buildAgeText(minAge: number | null, maxAge: number | null): string | null {
  if (minAge == null && maxAge == null) return null
  if (minAge != null && maxAge != null) {
    if (minAge === maxAge) return String(minAge)
    return `${minAge}-${maxAge}`
  }
  return String(minAge ?? maxAge)
}

function normalizeRace(race: string | string[] | null): string | null {
  if (!race) return null
  if (Array.isArray(race)) return race.join('; ')
  return race
}

/**
 * Extract state abbreviation from full state name.
 * NamUs returns "California", "New Mexico", etc. We store the full name
 * since import_records.state is TEXT and not constrained to abbreviations.
 */
function normalizeState(state: string | null): string | null {
  if (!state) return null
  return state.trim() || null
}

async function fetchWithRetry<T>(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = DELAY_MS * Math.pow(2, attempt)
      console.log(`    Retry ${attempt}/${maxRetries - 1} after ${backoff}ms...`)
      await sleep(backoff)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      if (res.status === 429) {
        // Rate limited — back off
        console.log('    Rate limited (429). Backing off...')
        lastError = new Error('Rate limited')
        await sleep(5000)
        continue
      }

      if (res.status >= 500) {
        lastError = new Error(`Server error: HTTP ${res.status}`)
        continue
      }

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
      }

      return await res.json() as T
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        lastError = new Error('Request timed out')
      } else {
        lastError = err as Error
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError ?? new Error('Unknown fetch error')
}

// ─── NamUs API Functions ────────────────────────────────────────────────────

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Threadline Case Intelligence Platform - public interest research (threadline.app)',
}

const MISSING_PROJECTIONS = [
  'namus2Number',
  'firstName',
  'lastName',
  'middleName',
  'gender',
  'hairColor',
  'raceEthnicity',
  'computedMissingMinAge',
  'computedMissingMaxAge',
  'currentAgeFrom',
  'currentAgeTo',
  'cityOfLastContact',
  'stateOfLastContact',
  'countyOfLastContact',
  'dateOfLastContact',
  'modifiedDateTime',
  'createdDateTime',
]

const UNIDENTIFIED_PROJECTIONS = [
  'namus2Number',
  'sex',
  'caseNumber',
  'raceEthnicity',
  'estimatedAgeFrom',
  'estimatedAgeTo',
  'hairColor',
  'conditionOfRemains',
  'dateFound',
  'cityOfRecovery',
  'stateOfRecovery',
  'countyOfRecovery',
  'modifiedDateTime',
  'createdDateTime',
]

async function searchMissing(skip: number, take: number): Promise<SearchResponse<NamusMissingSearchResult>> {
  return fetchWithRetry<SearchResponse<NamusMissingSearchResult>>(
    `${NAMUS_BASE}/api/CaseSets/NamUs/MissingPersons/Search`,
    {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        take,
        skip,
        projections: MISSING_PROJECTIONS,
        predicates: [],
      }),
    }
  )
}

async function searchUnidentified(skip: number, take: number): Promise<SearchResponse<NamusUnidentifiedSearchResult>> {
  return fetchWithRetry<SearchResponse<NamusUnidentifiedSearchResult>>(
    `${NAMUS_BASE}/api/CaseSets/NamUs/UnidentifiedPersons/Search`,
    {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        take,
        skip,
        projections: UNIDENTIFIED_PROJECTIONS,
        predicates: [],
      }),
    }
  )
}

// ─── Record Transformers ────────────────────────────────────────────────────

function transformMissingRecord(record: NamusMissingSearchResult, sourceId: string): ImportRecord {
  const caseNum = `MP${record.namus2Number}`
  const nameParts = [record.firstName, record.middleName, record.lastName].filter(Boolean)
  const personName = nameParts.length > 0 ? nameParts.join(' ') : null

  return {
    source_id: sourceId,
    external_id: caseNum,
    external_url: `${NAMUS_BASE}/MissingPersons/Case#/${record.namus2Number}`,
    raw_data: record as unknown as Record<string, unknown>,
    record_type: 'missing_person',
    person_name: personName,
    age_text: buildAgeText(record.computedMissingMinAge, record.computedMissingMaxAge),
    sex: record.gender ?? null,
    race: normalizeRace(record.raceEthnicity),
    state: normalizeState(record.stateOfLastContact),
    city: record.cityOfLastContact ?? null,
    date_missing: parseDate(record.dateOfLastContact),
    date_found: null,
    sync_hash: hashData(record),
  }
}

function transformUnidentifiedRecord(record: NamusUnidentifiedSearchResult, sourceId: string): ImportRecord {
  const caseNum = `UP${record.namus2Number}`

  return {
    source_id: sourceId,
    external_id: caseNum,
    external_url: `${NAMUS_BASE}/UnidentifiedPersons/Case#/${record.namus2Number}`,
    raw_data: record as unknown as Record<string, unknown>,
    record_type: 'unidentified_remains',
    person_name: null,
    age_text: buildAgeText(record.estimatedAgeFrom, record.estimatedAgeTo),
    sex: record.sex ?? null,
    race: normalizeRace(record.raceEthnicity),
    state: normalizeState(record.stateOfRecovery),
    city: record.cityOfRecovery ?? null,
    date_missing: null,
    date_found: parseDate(record.dateFound),
    sync_hash: hashData(record),
  }
}

// ─── Upsert Logic ───────────────────────────────────────────────────────────

async function upsertBatch(
  supabase: SupabaseClient,
  records: ImportRecord[]
): Promise<{ inserted: number; updated: number; unchanged: number; errors: number }> {
  let inserted = 0
  let updated = 0
  let unchanged = 0
  let errors = 0

  // Batch upsert — Supabase supports onConflict
  // We upsert in chunks to avoid payload limits
  const CHUNK_SIZE = 50
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE)

    // First, check which records already exist and their current hashes
    const externalIds = chunk.map(r => r.external_id)
    const sourceId = chunk[0].source_id

    const { data: existing } = await supabase
      .from('import_records')
      .select('external_id, sync_hash')
      .eq('source_id', sourceId)
      .in('external_id', externalIds)

    const existingMap = new Map<string, string>()
    if (existing) {
      for (const row of existing) {
        existingMap.set(row.external_id, row.sync_hash)
      }
    }

    // Split into: new records, changed records, unchanged records
    const toInsert: ImportRecord[] = []
    const toUpdate: ImportRecord[] = []

    for (const record of chunk) {
      const existingHash = existingMap.get(record.external_id)
      if (!existingHash) {
        toInsert.push(record)
      } else if (existingHash !== record.sync_hash) {
        toUpdate.push(record)
      } else {
        unchanged++
      }
    }

    // Insert new records
    if (toInsert.length > 0) {
      const { error } = await supabase
        .from('import_records')
        .insert(toInsert.map(r => ({
          ...r,
          last_synced_at: new Date().toISOString(),
        })))

      if (error) {
        // Try one-by-one on batch failure
        for (const record of toInsert) {
          const { error: singleErr } = await supabase
            .from('import_records')
            .insert({
              ...record,
              last_synced_at: new Date().toISOString(),
            })

          if (singleErr) {
            errors++
            if (errors <= 5) {
              console.error(`    ERROR inserting ${record.external_id}: ${singleErr.message}`)
            }
          } else {
            inserted++
          }
        }
      } else {
        inserted += toInsert.length
      }
    }

    // Update changed records
    for (const record of toUpdate) {
      const { error } = await supabase
        .from('import_records')
        .update({
          raw_data: record.raw_data,
          person_name: record.person_name,
          age_text: record.age_text,
          sex: record.sex,
          race: record.race,
          state: record.state,
          city: record.city,
          date_missing: record.date_missing,
          date_found: record.date_found,
          sync_hash: record.sync_hash,
          stale: false,
          last_synced_at: new Date().toISOString(),
        })
        .eq('source_id', record.source_id)
        .eq('external_id', record.external_id)

      if (error) {
        errors++
        if (errors <= 5) {
          console.error(`    ERROR updating ${record.external_id}: ${error.message}`)
        }
      } else {
        updated++
      }
    }
  }

  return { inserted, updated, unchanged, errors }
}

// ─── Main Scrape Functions ──────────────────────────────────────────────────

async function scrapeMissing(supabase: SupabaseClient, sourceId: string): Promise<number> {
  console.log('\n[MISSING PERSONS] Starting NamUs missing persons scrape...')

  // Get total count first
  const initial = await searchMissing(0, 0)
  const totalCount = initial.count
  console.log(`  Total records in NamUs: ${totalCount.toLocaleString()}`)

  let allRecords: ImportRecord[] = []
  let page = 0
  let fetchedSoFar = 0
  let totalInserted = 0
  let totalUpdated = 0
  let totalUnchanged = 0
  let totalErrors = 0

  while (fetchedSoFar < totalCount) {
    const skip = page * PAGE_SIZE

    try {
      const response = await searchMissing(skip, PAGE_SIZE)

      if (!response.results || response.results.length === 0) {
        console.log(`  Page ${page}: no more results. Done.`)
        break
      }

      const records = response.results.map(r => transformMissingRecord(r, sourceId))
      allRecords.push(...records)
      fetchedSoFar += response.results.length

      // Upsert every PAGE_SIZE records
      const stats = await upsertBatch(supabase, records)
      totalInserted += stats.inserted
      totalUpdated += stats.updated
      totalUnchanged += stats.unchanged
      totalErrors += stats.errors

      // Progress log every 100 records
      if (fetchedSoFar % 100 === 0 || fetchedSoFar >= totalCount) {
        console.log(
          `  Progress: ${fetchedSoFar.toLocaleString()}/${totalCount.toLocaleString()} fetched` +
          ` | +${stats.inserted} new, ~${stats.updated} updated, =${stats.unchanged} unchanged`
        )
      }

      page++
      await sleep(DELAY_MS)
    } catch (err) {
      console.error(`  ERROR on page ${page} (skip=${skip}): ${(err as Error).message}`)
      totalErrors++

      // Save progress checkpoint
      if (allRecords.length > 0) {
        const checkpointPath = join(DATA_DIR, 'namus-missing-checkpoint.json')
        writeFileSync(checkpointPath, JSON.stringify({
          lastPage: page,
          lastSkip: skip,
          fetchedSoFar,
          timestamp: new Date().toISOString(),
        }, null, 2))
        console.log(`  Checkpoint saved to ${checkpointPath}`)
      }

      // If many consecutive errors, stop
      if (totalErrors > 10) {
        console.error('  Too many errors. Stopping missing persons scrape.')
        break
      }

      page++
      await sleep(DELAY_MS * 3)
    }
  }

  console.log(`\n  [MISSING PERSONS] Summary:`)
  console.log(`    Fetched: ${fetchedSoFar.toLocaleString()} records`)
  console.log(`    Inserted: ${totalInserted.toLocaleString()}`)
  console.log(`    Updated: ${totalUpdated.toLocaleString()}`)
  console.log(`    Unchanged: ${totalUnchanged.toLocaleString()}`)
  console.log(`    Errors: ${totalErrors}`)

  return fetchedSoFar
}

async function scrapeUnidentified(supabase: SupabaseClient, sourceId: string): Promise<number> {
  console.log('\n[UNIDENTIFIED REMAINS] Starting NamUs unidentified persons scrape...')

  // Get total count first
  const initial = await searchUnidentified(0, 0)
  const totalCount = initial.count
  console.log(`  Total records in NamUs: ${totalCount.toLocaleString()}`)

  let allRecords: ImportRecord[] = []
  let page = 0
  let fetchedSoFar = 0
  let totalInserted = 0
  let totalUpdated = 0
  let totalUnchanged = 0
  let totalErrors = 0

  while (fetchedSoFar < totalCount) {
    const skip = page * PAGE_SIZE

    try {
      const response = await searchUnidentified(skip, PAGE_SIZE)

      if (!response.results || response.results.length === 0) {
        console.log(`  Page ${page}: no more results. Done.`)
        break
      }

      const records = response.results.map(r => transformUnidentifiedRecord(r, sourceId))
      allRecords.push(...records)
      fetchedSoFar += response.results.length

      // Upsert every PAGE_SIZE records
      const stats = await upsertBatch(supabase, records)
      totalInserted += stats.inserted
      totalUpdated += stats.updated
      totalUnchanged += stats.unchanged
      totalErrors += stats.errors

      // Progress log every 100 records
      if (fetchedSoFar % 100 === 0 || fetchedSoFar >= totalCount) {
        console.log(
          `  Progress: ${fetchedSoFar.toLocaleString()}/${totalCount.toLocaleString()} fetched` +
          ` | +${stats.inserted} new, ~${stats.updated} updated, =${stats.unchanged} unchanged`
        )
      }

      page++
      await sleep(DELAY_MS)
    } catch (err) {
      console.error(`  ERROR on page ${page} (skip=${skip}): ${(err as Error).message}`)
      totalErrors++

      // Save progress checkpoint
      if (allRecords.length > 0) {
        const checkpointPath = join(DATA_DIR, 'namus-unidentified-checkpoint.json')
        writeFileSync(checkpointPath, JSON.stringify({
          lastPage: page,
          lastSkip: skip,
          fetchedSoFar,
          timestamp: new Date().toISOString(),
        }, null, 2))
        console.log(`  Checkpoint saved to ${checkpointPath}`)
      }

      if (totalErrors > 10) {
        console.error('  Too many errors. Stopping unidentified persons scrape.')
        break
      }

      page++
      await sleep(DELAY_MS * 3)
    }
  }

  console.log(`\n  [UNIDENTIFIED REMAINS] Summary:`)
  console.log(`    Fetched: ${fetchedSoFar.toLocaleString()} records`)
  console.log(`    Inserted: ${totalInserted.toLocaleString()}`)
  console.log(`    Updated: ${totalUpdated.toLocaleString()}`)
  console.log(`    Unchanged: ${totalUnchanged.toLocaleString()}`)
  console.log(`    Errors: ${totalErrors}`)

  return fetchedSoFar
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('NamUs Scraper — Threadline')
  console.log('=========================')
  console.log('National Missing and Unidentified Persons System')
  console.log('Rate: 1 second between requests. NamUs is a government resource.')
  console.log('')

  // Parse CLI flags
  const args = process.argv.slice(2)
  const missingOnly = args.includes('--missing-only')
  const unidentifiedOnly = args.includes('--unidentified-only')

  if (missingOnly && unidentifiedOnly) {
    console.error('Cannot use both --missing-only and --unidentified-only')
    process.exit(1)
  }

  // Ensure data directory exists (for checkpoints)
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

  // Load environment
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

  // Look up import_sources IDs
  const { data: sources, error: sourcesErr } = await supabase
    .from('import_sources')
    .select('id, slug')
    .in('slug', ['namus_missing', 'namus_unidentified'])

  if (sourcesErr || !sources || sources.length === 0) {
    console.error('ERROR: import_sources not found. Run migration 025 first.')
    console.error(sourcesErr?.message)
    process.exit(1)
  }

  const sourceMap = new Map(sources.map(s => [s.slug, s.id]))
  const missingSourceId = sourceMap.get('namus_missing')
  const unidentifiedSourceId = sourceMap.get('namus_unidentified')

  if (!missingSourceId || !unidentifiedSourceId) {
    console.error('ERROR: Missing import_sources rows. Expected slugs: namus_missing, namus_unidentified')
    console.error(`Found: ${sources.map(s => s.slug).join(', ')}`)
    process.exit(1)
  }

  console.log(`  import_sources: namus_missing=${missingSourceId}, namus_unidentified=${unidentifiedSourceId}`)

  const startTime = Date.now()

  // ── Scrape Missing Persons ──────────────────────────────────────────────
  let missingCount = 0
  if (!unidentifiedOnly) {
    missingCount = await scrapeMissing(supabase, missingSourceId)

    // Update import_sources metadata
    await supabase
      .from('import_sources')
      .update({
        total_records: missingCount,
        last_import_at: new Date().toISOString(),
      })
      .eq('id', missingSourceId)
  }

  // ── Scrape Unidentified Persons ─────────────────────────────────────────
  let unidentifiedCount = 0
  if (!missingOnly) {
    unidentifiedCount = await scrapeUnidentified(supabase, unidentifiedSourceId)

    // Update import_sources metadata
    await supabase
      .from('import_sources')
      .update({
        total_records: unidentifiedCount,
        last_import_at: new Date().toISOString(),
      })
      .eq('id', unidentifiedSourceId)
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

  console.log('\n===================================================')
  console.log('NamUs scrape complete')
  console.log(`  Missing persons: ${missingCount.toLocaleString()} records`)
  console.log(`  Unidentified remains: ${unidentifiedCount.toLocaleString()} records`)
  console.log(`  Total: ${(missingCount + unidentifiedCount).toLocaleString()} records`)
  console.log(`  Elapsed: ${elapsed} minutes`)
  console.log('\nAll records upserted into import_records table.')
  console.log('Re-run this script anytime — only changed records will be updated.')
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message)
  console.error(err.stack)
  process.exit(1)
})
