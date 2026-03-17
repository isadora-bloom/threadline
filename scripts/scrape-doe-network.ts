/**
 * Doe Network Scraper — JSON API version
 *
 * Uses the Doe Network's internal JSON API (same data their public pages load)
 * to fetch all case records without scraping HTML.
 *
 * Saves to:
 *   scripts/data/doe-missing.json
 *   scripts/data/doe-unidentified.json
 *   scripts/data/doe-remains.json
 *
 * Rate: 2-second delay between each case detail request.
 * The Doe Network is a nonprofit doing critical work — do not abuse their bandwidth.
 *
 * Run: npx tsx scripts/scrape-doe-network.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')
const DELAY_MS = 2000
const FETCH_TIMEOUT_MS = 20000
const BASE = 'https://www.doenetwork.org/cases/software/php'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DoeCase {
  id: string
  url: string
  category: 'missing_person' | 'unidentified_person' | 'unidentified_remains'
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
  circumstances: string | null  // disappearance or discovery circumstances

  // Reference numbers
  namusNumber: string | null
  ncicNumber: string | null
  ncmecNumber: string | null

  // Investigating agency (raw HTML — plain text extracted)
  informationSources: string | null

  rawApiData: Record<string, string>  // full raw response
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
    const url = `${BASE}/database.php?get_uid_${sex}_index_${country}=true`
    try {
      const data = await fetchJson<UidIndexEntry[]>(url)
      ids.push(...data.map(e => e.id))
    } catch (err) {
      console.error(`    ✗ Failed to fetch index ${url}: ${(err as Error).message}`)
    }
    await sleep(DELAY_MS)
  }
  return ids
}

async function getMpIds(country: 'us' | 'canada'): Promise<string[]> {
  const ids: string[] = []
  for (const sex of ['males', 'females']) {
    const url = `${BASE}/mpdatabase.php?get_mp_${sex}_index_${country}=true`
    try {
      const data = await fetchJson<MpIndexEntry[]>(url)
      ids.push(...data.map(e => e.id))
    } catch (err) {
      console.error(`    ✗ Failed to fetch index ${url}: ${(err as Error).message}`)
    }
    await sleep(DELAY_MS)
  }
  return ids
}

// ─── Case detail fetchers ─────────────────────────────────────────────────────

async function fetchUidCase(id: string, country: 'US' | 'Canada'): Promise<DoeCase | null> {
  const url = `${BASE}/database.php?id=${id}&fields=true`
  const raw = await fetchJson<Record<string, string>>(url)

  return {
    id,
    url: `https://www.doenetwork.org/cases/software/main.html?id=${id.toLowerCase()}`,
    category: 'unidentified_remains',  // UID cases are unidentified remains
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

async function fetchMpCase(id: string, country: 'US' | 'Canada'): Promise<DoeCase | null> {
  const url = `${BASE}/mpdatabase.php?id=${id}&fields=true`
  const raw = await fetchJson<Record<string, string>>(url)

  return {
    id,
    url: `https://www.doenetwork.org/cases/software/main.html?id=${id.toLowerCase()}`,
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

// ─── Scrape a batch of case IDs ───────────────────────────────────────────────

async function scrapeIds(
  ids: string[],
  label: string,
  fetcher: (id: string) => Promise<DoeCase | null>,
  outputFile: string,
  existingCases: DoeCase[]
): Promise<DoeCase[]> {
  const results = [...existingCases]
  const existingIds = new Set(existingCases.map(c => c.id))
  const toFetch = ids.filter(id => !existingIds.has(id))

  console.log(`  ${toFetch.length} new cases to fetch (${ids.length - toFetch.length} already have)`)

  let errors = 0
  for (let i = 0; i < toFetch.length; i++) {
    const id = toFetch[i]
    const progress = `[${label}] Fetching case ${i + 1} of ${toFetch.length} (${id})`
    process.stdout.write(`\r${progress.padEnd(80)}`)

    try {
      await sleep(DELAY_MS)
      const caseData = await fetcher(id)
      if (caseData) results.push(caseData)
    } catch (err) {
      errors++
      process.stdout.write(`\n  ✗ ${id}: ${(err as Error).message}\n`)
    }

    // Save progress every 50 cases
    if ((i + 1) % 50 === 0) {
      writeFileSync(join(DATA_DIR, outputFile), JSON.stringify(results, null, 2), 'utf-8')
    }
  }

  process.stdout.write('\n')
  if (errors) console.log(`  ${errors} errors (logged above, skipped)`)
  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Doe Network Scraper (JSON API)')
  console.log('==============================')
  console.log('Rate: 2 second delay between each case request')
  console.log('Respecting the Doe Network — a nonprofit doing critical work.\n')

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

  // ── Missing Persons (US + Canada) ────────────────────────────────────────
  console.log('\n[MISSING PERSONS] Fetching case IDs…')
  const mpUsIds = await getMpIds('us')
  const mpCanadaIds = await getMpIds('canada')
  console.log(`  US: ${mpUsIds.length} cases | Canada: ${mpCanadaIds.length} cases`)

  let missingCases: DoeCase[] = []

  console.log('\n[MISSING PERSONS (US)] Scraping case details…')
  missingCases = await scrapeIds(
    mpUsIds, 'MISSING PERSONS (US)',
    id => fetchMpCase(id, 'US'),
    'doe-missing.json', missingCases
  )

  console.log('\n[MISSING PERSONS (Canada)] Scraping case details…')
  missingCases = await scrapeIds(
    mpCanadaIds, 'MISSING PERSONS (Canada)',
    id => fetchMpCase(id, 'Canada'),
    'doe-missing.json', missingCases
  )

  writeFileSync(join(DATA_DIR, 'doe-missing.json'), JSON.stringify(missingCases, null, 2), 'utf-8')
  console.log(`  Saved ${missingCases.length} total missing persons cases`)

  // ── Unidentified Persons (US only) ────────────────────────────────────────
  // Note: The Doe Network indexes UID cases as "unidentified persons" but these
  // are predominantly unidentified remains cases. We label them 'unidentified_remains'
  // but also include cases where remains are not deceased (stateOfRemains check).
  console.log('\n[UNIDENTIFIED PERSONS (US)] Fetching case IDs…')
  const uidUsIds = await getUidIds('us')
  console.log(`  US: ${uidUsIds.length} cases`)

  let unidentifiedCases: DoeCase[] = []
  console.log('\n[UNIDENTIFIED PERSONS (US)] Scraping case details…')
  unidentifiedCases = await scrapeIds(
    uidUsIds, 'UNIDENTIFIED (US)',
    id => fetchUidCase(id, 'US'),
    'doe-unidentified.json', unidentifiedCases
  )

  writeFileSync(join(DATA_DIR, 'doe-unidentified.json'), JSON.stringify(unidentifiedCases, null, 2), 'utf-8')
  console.log(`  Saved ${unidentifiedCases.length} total unidentified (US) cases`)

  // ── Unidentified Remains (Canada) ────────────────────────────────────────
  console.log('\n[UNIDENTIFIED REMAINS (Canada)] Fetching case IDs…')
  const uidCanadaIds = await getUidIds('canada')
  console.log(`  Canada: ${uidCanadaIds.length} cases`)

  let remainsCases: DoeCase[] = [...unidentifiedCases]  // US already included
  console.log('\n[UNIDENTIFIED REMAINS (Canada)] Scraping case details…')
  const canadaRemainsOnly = await scrapeIds(
    uidCanadaIds, 'UNIDENTIFIED (Canada)',
    id => fetchUidCase(id, 'Canada'),
    'doe-remains.json', []
  )

  // doe-remains.json = US unidentified + Canada unidentified
  const remainsAll = [...unidentifiedCases, ...canadaRemainsOnly]
  writeFileSync(join(DATA_DIR, 'doe-remains.json'), JSON.stringify(remainsAll, null, 2), 'utf-8')
  console.log(`  Saved ${remainsAll.length} total unidentified remains cases`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════')
  console.log('Scrape complete')
  console.log(`  doe-missing.json:        ${missingCases.length} cases`)
  console.log(`  doe-unidentified.json:   ${unidentifiedCases.length} cases`)
  console.log(`  doe-remains.json:        ${remainsAll.length} cases`)
  console.log('\nNext step: npm run import:doe')
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err.message)
  process.exit(1)
})
