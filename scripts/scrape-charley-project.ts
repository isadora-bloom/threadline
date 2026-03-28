/**
 * Charley Project Scraper — Missing Persons Case Profiles
 *
 * Scrapes all ~16,000 case profiles from charleyproject.org and upserts them
 * into the import_records table. The Charley Project (maintained by Meaghan Good)
 * contains rich narrative "Details of Disappearance" text that NamUs and Doe Network
 * lack — this is the primary value of this data source for AI analysis.
 *
 * Two-phase approach:
 *   1. Sitemap crawl — fetch all case URLs from WordPress sitemaps (wp-sitemap-posts-case-{1-9}.xml)
 *   2. Case scrape — visit each case page, parse HTML, extract fields, upsert to DB
 *
 * HTML structure (WordPress custom post type "case"):
 *   - Name: <h1 class="title entry-title is-1">
 *   - Fields: <section id="case-top"> <ul><li><strong>Label</strong> Value</li></ul>
 *   - Narrative: <section id="case-bottom"> <h3>Details of Disappearance</h3> <p>...</p>
 *   - Agency: <h3>Investigating Agency</h3> <ul><li>...</li></ul>
 *   - Sources: <h3>Source Information</h3> <ul><li><a>...</a></li></ul>
 *
 * Rate: 1 request per 2 seconds. The Charley Project is maintained by one person — be respectful.
 *
 * Run: npx tsx scripts/scrape-charley-project.ts
 *      npx tsx scripts/scrape-charley-project.ts --force     (re-scrape even if hash unchanged)
 *      npx tsx scripts/scrape-charley-project.ts --limit=100 (scrape only first N cases)
 *      npx tsx scripts/scrape-charley-project.ts --start=500 (resume from offset)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')

// ─── Config ──────────────────────────────────────────────────────────────────

const DELAY_MS = 2000             // 2 seconds between case page requests
const SITEMAP_DELAY_MS = 1000     // 1 second between sitemap requests
const FETCH_TIMEOUT_MS = 30_000   // 30-second timeout per request
const MAX_RETRIES = 3             // retry failed fetches
const RETRY_DELAY_MS = 5000       // wait 5s before retrying
const PROGRESS_INTERVAL = 100     // log progress every N records
const CHARLEY_BASE = 'https://charleyproject.org'
const SITEMAP_COUNT = 9           // wp-sitemap-posts-case-1.xml through -9.xml

const USER_AGENT = 'Threadline Case Intelligence Platform - public interest research (threadline.app)'

// ─── Types ───────────────────────────────────────────────────────────────────

interface CharleyCase {
  url: string
  slug: string               // "firstname-lastname" from URL

  // Identity
  name: string | null
  dob: string | null         // "05/04/1982 (43)" raw string
  age: string | null         // "21 years old"
  sex: string | null
  race: string | null

  // Physical
  height_weight: string | null
  hair: string | null
  eyes: string | null
  clothing: string | null
  distinguishing_characteristics: string | null
  medical_conditions: string | null

  // Case info
  missing_since: string | null
  missing_from: string | null
  classification: string | null
  associated_vehicle: string | null

  // Narrative — THIS IS THE KEY VALUE
  details_of_disappearance: string | null

  // Agency & sources
  investigating_agency: string | null
  source_links: { name: string; url: string }[]
  namus_number: string | null

  // Metadata
  updated_text: string | null   // "Updated 5 times since..."
}

interface ImportRecord {
  source_id: string
  external_id: string
  external_url: string
  raw_data: Record<string, unknown>
  record_type: 'missing_person'
  person_name: string | null
  age_text: string | null
  sex: string | null
  race: string | null
  state: string | null
  city: string | null
  date_missing: string | null
  sync_hash: string
  case_status: string
  classification: string | null
  circumstances_summary: string | null
  key_flags: string[]
}

// ─── CLI flags ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const FLAG_FORCE = args.includes('--force')
const FLAG_LIMIT = args.find(a => a.startsWith('--limit='))
const FLAG_START = args.find(a => a.startsWith('--start='))
const LIMIT = FLAG_LIMIT ? parseInt(FLAG_LIMIT.split('=')[1], 10) : Infinity
const START_OFFSET = FLAG_START ? parseInt(FLAG_START.split('=')[1], 10) : 0

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

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#8217;/gi, '\u2019')
    .replace(/&#8216;/gi, '\u2018')
    .replace(/&#8220;/gi, '\u201C')
    .replace(/&#8221;/gi, '\u201D')
    .replace(/&#8211;/gi, '\u2013')
    .replace(/&#8212;/gi, '\u2014')
    .replace(/&#\d+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse a Charley Project date like "07/16/2011" into "2011-07-16".
 * Also handles partial dates and odd formats.
 */
function parseCharleyDate(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw.trim()

  // MM/DD/YYYY
  const mdyMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch
    const month = m.padStart(2, '0')
    const day = d.padStart(2, '0')
    return `${y}-${month}-${day}`
  }

  // YYYY-MM-DD already
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return isoMatch[0]

  // Month Day, Year (e.g., "July 16, 2011")
  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  }
  const longMatch = cleaned.match(/^(\w+)\s+(\d{1,2}),?\s*(\d{4})/i)
  if (longMatch) {
    const monthNum = months[longMatch[1].toLowerCase()]
    if (monthNum) {
      return `${longMatch[3]}-${monthNum}-${longMatch[2].padStart(2, '0')}`
    }
  }

  return null
}

/**
 * Extract age number from text like "52 years old" or "3 months old".
 */
function extractAgeText(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw.trim()
  // "52 years old" -> "52"
  const yearsMatch = cleaned.match(/^(\d+)\s+years?\s+old/i)
  if (yearsMatch) return yearsMatch[1]
  // "3 months old" -> "3 months"
  const monthsMatch = cleaned.match(/^(\d+\s+months?)\s+old/i)
  if (monthsMatch) return monthsMatch[1]
  // Just return the raw if it's short enough
  if (cleaned.length < 30) return cleaned
  return null
}

/**
 * Extract US state from "Missing From" field like "Yakima, Washington" or "Miami, Florida".
 */
const STATE_MAP: Record<string, string> = {
  'alabama': 'Alabama', 'alaska': 'Alaska', 'arizona': 'Arizona', 'arkansas': 'Arkansas',
  'california': 'California', 'colorado': 'Colorado', 'connecticut': 'Connecticut', 'delaware': 'Delaware',
  'florida': 'Florida', 'georgia': 'Georgia', 'hawaii': 'Hawaii', 'idaho': 'Idaho',
  'illinois': 'Illinois', 'indiana': 'Indiana', 'iowa': 'Iowa', 'kansas': 'Kansas',
  'kentucky': 'Kentucky', 'louisiana': 'Louisiana', 'maine': 'Maine', 'maryland': 'Maryland',
  'massachusetts': 'Massachusetts', 'michigan': 'Michigan', 'minnesota': 'Minnesota',
  'mississippi': 'Mississippi', 'missouri': 'Missouri', 'montana': 'Montana',
  'nebraska': 'Nebraska', 'nevada': 'Nevada', 'new hampshire': 'New Hampshire',
  'new jersey': 'New Jersey', 'new mexico': 'New Mexico', 'new york': 'New York',
  'north carolina': 'North Carolina', 'north dakota': 'North Dakota', 'ohio': 'Ohio',
  'oklahoma': 'Oklahoma', 'oregon': 'Oregon', 'pennsylvania': 'Pennsylvania',
  'rhode island': 'Rhode Island', 'south carolina': 'South Carolina',
  'south dakota': 'South Dakota', 'tennessee': 'Tennessee', 'texas': 'Texas',
  'utah': 'Utah', 'vermont': 'Vermont', 'virginia': 'Virginia',
  'washington': 'Washington', 'west virginia': 'West Virginia',
  'wisconsin': 'Wisconsin', 'wyoming': 'Wyoming',
  'district of columbia': 'District of Columbia', 'puerto rico': 'Puerto Rico',
  'guam': 'Guam', 'u.s. virgin islands': 'U.S. Virgin Islands',
}

function extractState(missingFrom: string | null): string | null {
  if (!missingFrom) return null
  const lower = missingFrom.toLowerCase().trim()
  for (const [name, display] of Object.entries(STATE_MAP)) {
    if (lower.includes(name)) return display
  }
  return null
}

function extractCity(missingFrom: string | null): string | null {
  if (!missingFrom) return null
  // "Yakima, Washington" -> "Yakima"
  // "Yakima,  Washington" -> "Yakima"
  const parts = missingFrom.split(',').map(p => p.trim())
  if (parts.length >= 2) {
    return parts[0] || null
  }
  return null
}

/**
 * Try to extract a NamUs case number from source links or narrative text.
 * NamUs numbers look like "MP12345" or just a numeric ID in a namus.gov URL.
 */
function extractNamusNumber(sourceLinks: { name: string; url: string }[], narrative: string | null): string | null {
  // Check source URLs for NamUs links with case numbers
  for (const link of sourceLinks) {
    if (link.url.includes('namus.gov') || link.url.includes('namus.nij.ojp.gov')) {
      // Try to extract case number from URL
      const caseMatch = link.url.match(/Case#?\/(\d+)/)
      if (caseMatch) return `MP${caseMatch[1]}`
      const mpMatch = link.url.match(/[Mm][Pp](\d+)/)
      if (mpMatch) return `MP${mpMatch[1]}`
    }
  }

  // Check narrative text for NamUs references
  if (narrative) {
    const namusMatch = narrative.match(/NamUs\s*(?:case\s*(?:number|#)?:?\s*)?(?:MP)?(\d{4,})/i)
    if (namusMatch) return `MP${namusMatch[1]}`
  }

  return null
}

/**
 * Generate key_flags from case data.
 */
function generateKeyFlags(charley: CharleyCase): string[] {
  const flags: string[] = []
  const narrative = (charley.details_of_disappearance || '').toLowerCase()
  const classification = (charley.classification || '').toLowerCase()

  // Classification-based flags
  if (classification.includes('family abduction')) flags.push('family_abduction')
  if (classification.includes('non-family abduction') || classification.includes('stranger abduction')) {
    flags.push('non_family_abduction')
  }
  if (classification.includes('endangered')) flags.push('endangered')

  // Age-based flags
  const ageMatch = charley.age?.match(/^(\d+)\s+years?/i)
  if (ageMatch && parseInt(ageMatch[1], 10) < 18) flags.push('child')
  const monthMatch = charley.age?.match(/months?\s+old/i)
  if (monthMatch) flags.push('child')

  // Narrative-based flags
  if (narrative.includes('foul play') || narrative.includes('homicide') || narrative.includes('murdered')) {
    flags.push('foul_play_suspected')
  }
  if (narrative.includes('sex offender') || narrative.includes('sexual predator') || narrative.includes('registered offender')) {
    flags.push('sex_offender_involvement')
  }
  if (narrative.includes('tribal') || narrative.includes('reservation') || narrative.includes('indigenous')) {
    flags.push('tribal_jurisdiction')
  }
  if (narrative.includes('international') || narrative.includes('mexico') || narrative.includes('canada') ||
      narrative.includes('border') || narrative.includes('passport')) {
    flags.push('international')
  }
  if (narrative.includes('dna') || narrative.includes('d.n.a.')) {
    flags.push('dna_available')
  }
  if (narrative.includes('dental')) {
    flags.push('dental_available')
  }

  return [...new Set(flags)] // deduplicate
}

/**
 * Derive case_status from classification and narrative text.
 */
function deriveCaseStatus(charley: CharleyCase): string {
  const classification = (charley.classification || '').toLowerCase()
  const narrative = (charley.details_of_disappearance || '').toLowerCase()
  const updated = (charley.updated_text || '').toLowerCase()

  // Check for resolved status indicators
  if (classification.includes('found') || classification.includes('located')) return 'resolved_alive'
  if (classification.includes('deceased') || classification.includes('remains found')) return 'resolved_deceased'
  if (narrative.includes('has been found') || narrative.includes('was found alive') || narrative.includes('was located')) {
    return 'resolved_alive'
  }
  if (narrative.includes('remains were found') || narrative.includes('body was found') || narrative.includes('found dead') ||
      narrative.includes('found deceased')) {
    return 'resolved_deceased'
  }
  if (narrative.includes('arrested') || narrative.includes('taken into custody')) return 'resolved_arrested'
  if (updated.includes('resolved') || updated.includes('found')) return 'resolved_other'

  return 'open'
}

/**
 * Build a short circumstances summary (1-2 sentences) from the narrative.
 */
function buildCircumstancesSummary(narrative: string | null): string | null {
  if (!narrative) return null
  // Take the first 2 sentences
  const sentences = narrative.match(/[^.!?]+[.!?]+/g)
  if (!sentences) return narrative.length > 300 ? narrative.slice(0, 300) + '...' : narrative
  const summary = sentences.slice(0, 2).join(' ').trim()
  return summary.length > 500 ? summary.slice(0, 500) + '...' : summary
}

// ─── Fetch with retry ────────────────────────────────────────────────────────

async function fetchHtml(url: string, label: string): Promise<string> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = RETRY_DELAY_MS * Math.pow(2, attempt - 1)
      console.log(`    [retry ${attempt}/${MAX_RETRIES}] ${label} — waiting ${backoff}ms...`)
      await sleep(backoff)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
        },
      })

      if (res.status === 429) {
        console.log(`    Rate limited (429) on ${label}. Backing off...`)
        lastError = new Error('Rate limited')
        await sleep(10000)
        continue
      }

      if (res.status === 404) {
        throw new Error(`404 Not Found: ${url}`)
      }

      if (res.status >= 500) {
        lastError = new Error(`Server error: HTTP ${res.status}`)
        continue
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      return await res.text()
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        lastError = new Error('Request timed out')
      } else {
        lastError = err as Error
      }
      // Don't retry on 404
      if ((lastError as Error).message.includes('404')) throw lastError
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError ?? new Error('Unknown fetch error')
}

// ─── Sitemap parsing ─────────────────────────────────────────────────────────

/**
 * Fetch all case URLs from the WordPress sitemaps.
 * Returns an array of { url, slug } objects.
 */
async function fetchAllCaseUrls(): Promise<{ url: string; slug: string }[]> {
  const allUrls: { url: string; slug: string }[] = []

  for (let i = 1; i <= SITEMAP_COUNT; i++) {
    const sitemapUrl = `${CHARLEY_BASE}/wp-sitemap-posts-case-${i}.xml`
    console.log(`  Fetching sitemap ${i}/${SITEMAP_COUNT}: ${sitemapUrl}`)

    try {
      const xml = await fetchHtml(sitemapUrl, `sitemap-${i}`)

      // Parse <loc> tags from the sitemap XML
      const locMatches = xml.matchAll(/<loc>([^<]+)<\/loc>/g)
      let count = 0
      for (const match of locMatches) {
        const caseUrl = match[1].trim()
        // Only include case pages (not other post types)
        if (caseUrl.includes('/case/')) {
          const slug = caseUrl.replace(`${CHARLEY_BASE}/case/`, '').replace(/\/$/, '')
          allUrls.push({ url: caseUrl, slug })
          count++
        }
      }
      console.log(`    -> ${count} case URLs`)
    } catch (err) {
      console.error(`    ERROR fetching sitemap ${i}: ${(err as Error).message}`)
    }

    if (i < SITEMAP_COUNT) await sleep(SITEMAP_DELAY_MS)
  }

  return allUrls
}

// ─── HTML parsing ────────────────────────────────────────────────────────────

/**
 * Extract a field value from the case fields HTML.
 * Fields are structured as: <li><strong>Label</strong> Value</li>
 * Some values span multiple lines with whitespace.
 */
function extractField(html: string, label: string): string | null {
  // Build a regex that matches the <li> containing this label
  // The label is in a <strong> tag, value follows until </li>
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(
    `<strong>${escapedLabel}</strong>\\s*([\\s\\S]*?)(?=</li>)`,
    'i'
  )
  const match = html.match(regex)
  if (!match) return null

  const value = stripHtml(match[1]).trim()
  return value.length > 0 ? value : null
}

/**
 * Extract the "Details of Disappearance" narrative.
 * In the HTML this is: <h3>Details of Disappearance</h3> followed by <p> paragraphs,
 * all inside a <div class="column">. We capture everything after the h3 until the
 * closing </div> of that column.
 */
function extractDetailsOfDisappearance(html: string): string | null {
  // Strategy 1: Find the column div containing the heading
  const regex = /<h3>Details of Disappearance<\/h3>\s*([\s\S]*?)(?=<\/div>\s*(?:<div class="column">|<\/div>|$))/i
  const match = html.match(regex)
  if (match) {
    const content = stripHtml(match[1]).trim()
    if (content.length > 0) return content
  }

  // Strategy 2: Grab everything between the heading and the next h3 or agencies div
  const fallback = /<h3>Details of Disappearance<\/h3>\s*([\s\S]*?)(?=<h3>|<div id="agencies">|<p class="updated">|<\/section>)/i
  const fallbackMatch = html.match(fallback)
  if (fallbackMatch) {
    const content = stripHtml(fallbackMatch[1]).trim()
    if (content.length > 0) return content
  }

  return null
}

/**
 * Extract source links from the Source Information section.
 */
function extractSourceLinks(html: string): { name: string; url: string }[] {
  const links: { name: string; url: string }[] = []

  // Find the Source Information section
  const sectionMatch = html.match(
    /<h3>Source Information<\/h3>\s*([\s\S]*?)(?=<\/div>|<p class="updated">|<\/section>)/i
  )
  if (!sectionMatch) return links

  const sectionHtml = sectionMatch[1]

  // Extract all <a> tags
  const linkMatches = sectionHtml.matchAll(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)
  for (const match of linkMatches) {
    const url = match[1].trim()
    const name = stripHtml(match[2]).trim()
    if (url && name) {
      links.push({ name, url })
    }
  }

  return links
}

/**
 * Extract investigating agency text.
 */
function extractInvestigatingAgency(html: string): string | null {
  const sectionMatch = html.match(
    /<h3>Investigating Agency<\/h3>\s*([\s\S]*?)(?=<\/div>|<h3>|<p class="updated">)/i
  )
  if (!sectionMatch) return null

  const content = stripHtml(sectionMatch[1]).trim()
  return content.length > 0 ? content : null
}

/**
 * Extract the "Updated" metadata text.
 */
function extractUpdatedText(html: string): string | null {
  const match = html.match(/<p class="updated">([\s\S]*?)<\/p>/i)
  if (!match) return null
  return stripHtml(match[1]).trim() || null
}

/**
 * Parse a full case page HTML into a CharleyCase object.
 */
function parseCase(html: string, url: string, slug: string): CharleyCase | null {
  // Check that this is actually a case page
  if (!html.includes('id="case"') && !html.includes('id="case-top"')) {
    return null
  }

  // Extract name from <h1>
  const nameMatch = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
  const name = nameMatch ? stripHtml(nameMatch[1]).trim() : null

  // Extract the case section for field parsing
  const caseMatch = html.match(/<div id="case">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/article>/i)
  const caseHtml = caseMatch ? caseMatch[1] : html

  // Extract structured fields
  const missingSince = extractField(caseHtml, 'Missing Since')
  const missingFrom = extractField(caseHtml, 'Missing From')
  const classification = extractField(caseHtml, 'Classification')
  const sex = extractField(caseHtml, 'Sex')
  const race = extractField(caseHtml, 'Race')
  const dob = extractField(caseHtml, 'Date of Birth')
  const age = extractField(caseHtml, 'Age')
  const heightWeight = extractField(caseHtml, 'Height and Weight')
  const clothing = extractField(caseHtml, 'Clothing/Jewelry Description')
  const distinguishing = extractField(caseHtml, 'Distinguishing Characteristics')
  const medicalConditions = extractField(caseHtml, 'Medical Conditions')
  const associatedVehicle = extractField(caseHtml, 'Associated Vehicle(s)')

  // Extract narrative sections
  const details = extractDetailsOfDisappearance(caseHtml)
  const agency = extractInvestigatingAgency(caseHtml)
  const sourceLinks = extractSourceLinks(caseHtml)
  const updatedText = extractUpdatedText(caseHtml)

  // Extract NamUs number from sources or narrative
  const namusNumber = extractNamusNumber(sourceLinks, details)

  // Try to extract hair and eyes from distinguishing characteristics if separate fields not present
  let hair: string | null = null
  let eyes: string | null = null
  if (distinguishing) {
    const hairMatch = distinguishing.match(/\b(blonde|blond|brown|black|red|auburn|gray|grey|white|sandy|strawberry|dark|light)\s+hair/i)
    if (hairMatch) hair = hairMatch[0]
    const eyesMatch = distinguishing.match(/\b(brown|blue|green|hazel|gray|grey|black)\s+eyes/i)
    if (eyesMatch) eyes = eyesMatch[0]
  }

  return {
    url,
    slug,
    name,
    dob,
    age,
    sex,
    race,
    height_weight: heightWeight,
    hair,
    eyes,
    clothing,
    distinguishing_characteristics: distinguishing,
    medical_conditions: medicalConditions,
    missing_since: missingSince,
    missing_from: missingFrom,
    classification,
    associated_vehicle: associatedVehicle,
    details_of_disappearance: details,
    investigating_agency: agency,
    source_links: sourceLinks,
    namus_number: namusNumber,
    updated_text: updatedText,
  }
}

// ─── Transform to import_records ─────────────────────────────────────────────

function transformToImportRecord(charley: CharleyCase, sourceId: string): ImportRecord {
  // Build the raw_data JSONB — store EVERYTHING including full narrative
  const rawData: Record<string, unknown> = {
    name: charley.name,
    dob: charley.dob,
    age: charley.age,
    sex: charley.sex,
    race: charley.race,
    height_weight: charley.height_weight,
    hair: charley.hair,
    eyes: charley.eyes,
    clothing: charley.clothing,
    distinguishing_characteristics: charley.distinguishing_characteristics,
    medical_conditions: charley.medical_conditions,
    missing_since: charley.missing_since,
    missing_from: charley.missing_from,
    classification: charley.classification,
    associated_vehicle: charley.associated_vehicle,
    // THE KEY VALUE — full narrative text for AI analysis
    details_of_disappearance: charley.details_of_disappearance,
    investigating_agency: charley.investigating_agency,
    source_links: charley.source_links,
    namus_number: charley.namus_number,
    updated_text: charley.updated_text,
    slug: charley.slug,
  }

  return {
    source_id: sourceId,
    external_id: `charley_${charley.slug}`,
    external_url: charley.url,
    raw_data: rawData,
    record_type: 'missing_person',
    person_name: charley.name,
    age_text: extractAgeText(charley.age),
    sex: charley.sex,
    race: charley.race,
    state: extractState(charley.missing_from),
    city: extractCity(charley.missing_from),
    date_missing: parseCharleyDate(charley.missing_since),
    sync_hash: hashData(rawData),
    case_status: deriveCaseStatus(charley),
    classification: charley.classification,
    circumstances_summary: buildCircumstancesSummary(charley.details_of_disappearance),
    key_flags: generateKeyFlags(charley),
  }
}

// ─── Database operations ─────────────────────────────────────────────────────

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

async function upsertRecord(
  supabase: SupabaseClient,
  record: ImportRecord,
  existingHashes: Map<string, string>,
): Promise<'inserted' | 'updated' | 'skipped' | 'error'> {
  const existingHash = existingHashes.get(record.external_id)

  // Skip if hash unchanged (unless --force)
  if (existingHash && existingHash === record.sync_hash && !FLAG_FORCE) {
    return 'skipped'
  }

  const row = {
    ...record,
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

async function updateSourceMetadata(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<void> {
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

// ─── Checkpoint / resume support ─────────────────────────────────────────────

const CHECKPOINT_FILE = join(DATA_DIR, 'charley-checkpoint.json')

interface Checkpoint {
  urls: { url: string; slug: string }[]
  lastProcessedIndex: number
  timestamp: string
}

function saveCheckpoint(urls: { url: string; slug: string }[], lastIndex: number): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const checkpoint: Checkpoint = {
    urls,
    lastProcessedIndex: lastIndex,
    timestamp: new Date().toISOString(),
  }
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
}

function loadCheckpoint(): Checkpoint | null {
  if (!existsSync(CHECKPOINT_FILE)) return null
  try {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8'))
  } catch {
    return null
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()

  console.log('========================================================')
  console.log('  Charley Project Scraper')
  console.log('  The Charley Project — charleyproject.org')
  console.log('========================================================')
  console.log('')
  console.log('Maintained by Meaghan Good. Charley Project permits reuse with credit.')
  console.log('Rate limit: 2-second delay between requests.')
  console.log('')

  if (FLAG_FORCE) console.log('Mode: --force (re-scrape all records regardless of hash)')
  if (FLAG_LIMIT) console.log(`Mode: --limit=${LIMIT} (scrape only first ${LIMIT} cases)`)
  if (FLAG_START) console.log(`Mode: --start=${START_OFFSET} (resume from offset ${START_OFFSET})`)
  console.log('')

  // ── Connect to Supabase ───────────────────────────────────────────────────
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

  // ── Get import source ID ──────────────────────────────────────────────────
  const { data: source, error: sourceErr } = await supabase
    .from('import_sources')
    .select('id, slug, display_name')
    .eq('slug', 'charley_project')
    .single()

  if (sourceErr || !source) {
    console.error("ERROR: import_sources row with slug='charley_project' not found.")
    console.error('Make sure migration 025 has been applied.')
    if (sourceErr) console.error('  Detail:', sourceErr.message)
    process.exit(1)
  }

  const sourceId = source.id
  console.log(`Import source: ${source.display_name} (${sourceId})`)

  // ── Load existing records for resume/change detection ─────────────────────
  console.log('Loading existing records for change detection...')
  const existingHashes = await loadExistingHashes(supabase, sourceId)
  console.log(`  ${existingHashes.size} records already in database`)
  console.log('')

  // ── Phase 1: Fetch all case URLs from sitemaps ────────────────────────────
  console.log('Phase 1: Fetching case URLs from sitemaps...')

  let caseUrls: { url: string; slug: string }[]

  // Check for checkpoint if resuming
  const checkpoint = loadCheckpoint()
  if (checkpoint && START_OFFSET === 0 && !FLAG_FORCE) {
    console.log(`  Found checkpoint with ${checkpoint.urls.length} URLs from ${checkpoint.timestamp}`)
    console.log('  Using cached URL list. Use --force to re-fetch sitemaps.')
    caseUrls = checkpoint.urls
  } else {
    caseUrls = await fetchAllCaseUrls()
    console.log(`\n  Total case URLs found: ${caseUrls.length}`)
    saveCheckpoint(caseUrls, -1)
  }

  if (caseUrls.length === 0) {
    console.error('ERROR: No case URLs found. Check sitemaps.')
    process.exit(1)
  }

  // Apply offset and limit
  const startIdx = START_OFFSET
  const endIdx = Math.min(startIdx + LIMIT, caseUrls.length)
  const urlsToProcess = caseUrls.slice(startIdx, endIdx)

  console.log(`\nPhase 2: Scraping ${urlsToProcess.length} case pages (${startIdx} to ${endIdx - 1} of ${caseUrls.length})...`)
  console.log('')

  // ── Phase 2: Scrape each case page ────────────────────────────────────────
  let inserted = 0
  let updated = 0
  let skipped = 0
  let errors = 0
  let parsed = 0
  let notFound = 0

  for (let i = 0; i < urlsToProcess.length; i++) {
    const { url, slug } = urlsToProcess[i]
    const globalIndex = startIdx + i

    // Progress logging
    if (i > 0 && i % PROGRESS_INTERVAL === 0) {
      const pct = ((i / urlsToProcess.length) * 100).toFixed(1)
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
      const rate = (i / ((Date.now() - startTime) / 1000)).toFixed(2)
      console.log(
        `  [${i}/${urlsToProcess.length}] (${pct}%) ${elapsed}min elapsed, ${rate}/sec — ` +
        `+${inserted} new, ~${updated} updated, =${skipped} unchanged, ${errors} errors`
      )
      // Save checkpoint
      saveCheckpoint(caseUrls, globalIndex)
    }

    // Check if we can skip (hash match, no --force)
    const externalId = `charley_${slug}`
    if (!FLAG_FORCE && existingHashes.has(externalId)) {
      skipped++
      continue
    }

    // Rate limit
    await sleep(DELAY_MS)

    // Fetch the case page
    let html: string
    try {
      html = await fetchHtml(url, slug)
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('404')) {
        notFound++
        if (notFound <= 10) console.log(`    [404] ${slug} — page not found, skipping`)
      } else {
        errors++
        if (errors <= 20) console.error(`    ERROR fetching ${slug}: ${msg}`)
      }
      continue
    }

    // Parse the HTML
    const charleyCase = parseCase(html, url, slug)
    if (!charleyCase) {
      errors++
      if (errors <= 20) console.error(`    ERROR parsing ${slug} — no case data found in HTML`)
      continue
    }
    parsed++

    // Transform and upsert
    const record = transformToImportRecord(charleyCase, sourceId)
    const outcome = await upsertRecord(supabase, record, existingHashes)

    switch (outcome) {
      case 'inserted': inserted++; break
      case 'updated': updated++; break
      case 'skipped': skipped++; break
      case 'error':
        errors++
        if (errors <= 20) console.error(`    ERROR upserting ${slug}`)
        break
    }
  }

  // ── Update import_sources metadata ────────────────────────────────────────
  console.log('\nUpdating import_sources metadata...')
  await updateSourceMetadata(supabase, sourceId)

  // Save final checkpoint
  saveCheckpoint(caseUrls, startIdx + urlsToProcess.length)

  // ── Summary ───────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

  console.log('')
  console.log('========================================================')
  console.log('  Charley Project Scrape Complete')
  console.log('========================================================')
  console.log(`  URLs in sitemaps:    ${caseUrls.length}`)
  console.log(`  Processed:           ${urlsToProcess.length}`)
  console.log(`  Parsed successfully: ${parsed}`)
  console.log(`  New records:         ${inserted}`)
  console.log(`  Updated records:     ${updated}`)
  console.log(`  Unchanged (skip):    ${skipped}`)
  console.log(`  Not found (404):     ${notFound}`)
  console.log(`  Errors:              ${errors}`)
  console.log(`  Elapsed:             ${elapsed} minutes`)
  console.log('')

  if (errors > 0) {
    console.log(`WARNING: ${errors} errors occurred. Check logs above for details.`)
    console.log('Re-run the scraper to retry failed records.')
    console.log('')
  }

  if (inserted > 0 || updated > 0) {
    console.log('Records are now in import_records with ai_processed=false.')
    console.log('The "details_of_disappearance" narrative is stored in raw_data — this is')
    console.log('the key value for AI analysis (circumstances, suspect info, family context).')
    console.log('')
    console.log('Next step: run AI processing to extract entities and enrich records.')
  } else if (skipped > 0 && inserted === 0) {
    console.log('All records already up-to-date. Nothing new to import.')
    console.log('Use --force to re-scrape and re-hash all records.')
  }

  // Estimated runtime info
  if (urlsToProcess.length < caseUrls.length) {
    const remainingCount = caseUrls.length - (startIdx + urlsToProcess.length)
    const estimatedMins = (remainingCount * DELAY_MS / 1000 / 60).toFixed(0)
    console.log('')
    console.log(`  ${remainingCount} cases remaining. Estimated ~${estimatedMins} minutes to complete.`)
    console.log(`  Resume with: npx tsx scripts/scrape-charley-project.ts --start=${startIdx + urlsToProcess.length}`)
  }
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message)
  console.error(err.stack)
  process.exit(1)
})
