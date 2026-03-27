/**
 * POST /api/pattern/doe-match
 *
 * Actions:
 *   cross_match             — score missing persons vs unidentified remains, with body state weighting
 *   cluster                 — demographic + temporal victimology clusters
 *   circumstance_cluster    — clusters based on shared circumstances (foster care, hitchhiking, etc.)
 *   synthesize_cluster      — AI narrative for a specific cluster (on demand)
 *   confirm_doe_submissions — set all case submissions to review_status 'confirmed'
 *   same_date_cluster       — group missing persons by same-date + same-state proximity
 *   extract_entities        — extract person names and vehicle descriptions from circumstances text
 *   name_dedup              — phonetic (Jaro-Winkler) comparison to find likely duplicate records
 *   detect_stalls           — flag voluntary/runaway classifications with years elapsed, no resolution
 *   location_runaway_cluster — 3+ runaway/voluntary cases from same city within a 5-year window
 *   corridor_cluster        — cases whose circumstances mention a major US highway corridor
 *   highway_proximity       — cases where disappearance city is within ~20mi of an interstate
 *   national_park_proximity — cases where disappearance city is within ~20mi of a national park/wilderness
 *   age_bracket_cluster     — 4+ cases in same sex+state with age SD ≤ 3.5yr spanning 5+ years
 *
 * GET  — fetch candidates, clusters, stalls, entities, or cluster_members
 * PATCH — review a candidate, cluster, stall flag, or cluster_member
 *
 * ALL results require investigator review. Scores are signals, not conclusions.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 300

// ─── Types ────────────────────────────────────────────────────────────────────

type BodyState = 'intact' | 'mild' | 'moderate' | 'advanced' | 'skeletal' | 'burned' | 'partial' | 'unknown'

interface RawSubmission {
  id: string
  raw_text: string
  notes: string | null
}

interface ParsedCase {
  submissionId: string
  doeId: string | null
  name: string | null
  sex: string | null
  race: string | null
  age: string | null
  height: string | null
  weight: string | null
  hair: string | null
  eyes: string | null
  marks: string | null
  clothing: string | null     // "Last seen wearing" / clothing found with remains
  jewelry: string | null      // jewelry / personal effects
  dental: string | null       // dental record availability
  childbirth: 'evidence' | 'no_evidence' | 'unknown'  // forensic/stated childbirth status
  dna: string | null          // DNA availability
  fingerprints: string | null // fingerprint availability
  location: string | null
  state: string | null
  date: string | null
  month: number | null
  year: number | null
  circumstances: string | null
  bodyState: BodyState       // unidentified only
  stateOfRemains: string | null
}

interface SignalResult {
  score: number
  match: string
  detail?: string
  keywords?: string[]
}

interface MatchSignals {
  sex:           SignalResult
  race:          SignalResult
  age:           SignalResult
  hair:          SignalResult
  eyes:          SignalResult
  height:        SignalResult
  weight:        SignalResult
  tattoo:        SignalResult & { keywords?: string[] }
  body_marks:    SignalResult & { keywords?: string[] }
  jewelry:       SignalResult & { keywords?: string[] }
  location:      SignalResult
  childbirth:    SignalResult
  time_gap?:     SignalResult
  body_state?:   { state: BodyState; note: string | null; weight_applied: boolean }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseLine(rawText: string, ...keys: string[]): string | null {
  for (const key of keys) {
    const m = rawText.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'))
    if (m) return m[1].trim()
  }
  return null
}

const US_STATE_ABBREVS = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]

const US_STATE_NAMES: Record<string, string> = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
  'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA',
  'Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD',
  'Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS',
  'Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV',
  'New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY',
  'North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI',
  'Wyoming':'WY','District of Columbia':'DC',
}

function extractState(location: string | null): string | null {
  if (!location) return null
  const s = location.toUpperCase()
  for (const abbr of US_STATE_ABBREVS) {
    if (new RegExp(`\\b${abbr}\\b`).test(s)) return abbr
  }
  for (const [name, abbr] of Object.entries(US_STATE_NAMES)) {
    if (location.toLowerCase().includes(name.toLowerCase())) return abbr
  }
  return null
}

function extractDoeId(notes: string | null): string | null {
  if (!notes) return null
  const m = notes.match(/Case #(\w+)/)
  return m ? m[1] : null
}

function parseBodyState(rawText: string): BodyState {
  const s = (
    parseLine(rawText, 'State of Remains', 'Stateofremains', 'Case Classification') ?? ''
  ).toLowerCase()
  if (!s) return 'unknown'
  if (s.includes('skeletal') || s.includes('skeleton'))           return 'skeletal'
  if (s.includes('burn') || s.includes('charr') || s.includes('fire')) return 'burned'
  if (s.includes('partial') || s.includes('fragment'))            return 'partial'
  if (s.includes('mummif') || s.includes('saponif'))              return 'advanced'
  if (s.includes('advanced decomp') || s.includes('severe decomp') ||
      s.includes('heavily decomp') || s.includes('extensive decomp')) return 'advanced'
  if (s.includes('decomp') || s.includes('putrefaction'))         return 'moderate'
  if (s.includes('intact') || s.includes('well preserved') ||
      s.includes('fresh') || s.includes('recent') ||
      s.includes('recognizable'))                                 return 'intact'
  // NamUs uses "Not recognizable" as a prefix — if nothing else matched, it's moderate+
  if (s.includes('not recognizable'))                             return 'moderate'
  return 'unknown'
}

function parseChildbirthStatus(rawText: string): 'evidence' | 'no_evidence' | 'unknown' {
  if (/no signs of childbirth|nulliparous|never had children|no evidence of childbirth|not believed to have (had|given birth)|never gave birth/i.test(rawText)) return 'no_evidence'
  if (/signs of childbirth|parous\b|gave birth|has children|mother of \d|had child|evidence of (pregnancy|childbirth)|was pregnant|evidence of giving birth|evidence of having given birth/i.test(rawText)) return 'evidence'
  return 'unknown'
}

function parseSubmission(sub: RawSubmission): ParsedCase {
  const r = sub.raw_text
  const location = parseLine(r, 'Last Seen', 'Location Found', 'Location of Discovery', 'Location Last Seen')
  const dateStr   = parseLine(r, 'Date Missing', 'Date Found', 'Estimated Date of Death')
  const doeId     = extractDoeId(sub.notes) || parseLine(r, 'Doe Network ID')

  let month: number | null = null
  let year:  number | null = null
  if (dateStr) {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) {
      month = d.getMonth() + 1
      year  = d.getFullYear()
    } else {
      const yearM = dateStr.match(/\b(19|20)\d{2}\b/)
      if (yearM) year = parseInt(yearM[0])
      const months = ['january','february','march','april','may','june','july','august','september','october','november','december']
      for (let i = 0; i < months.length; i++) {
        if (dateStr.toLowerCase().includes(months[i])) { month = i + 1; break }
      }
    }
  }

  // Extract circumstances — look for the Circumstances: section
  const circMatch = r.match(/^Circumstances:\s*([\s\S]+?)(?:\nInformation Sources:|$)/mi)
  const circumstances = circMatch ? circMatch[1].trim() : null

  const clothingRaw = parseLine(r, 'Clothing')
  const clothing = clothingRaw && !/^unknown$/i.test(clothingRaw.trim()) ? clothingRaw : null
  const jewelryRaw = parseLine(r, 'Jewelry', 'Additional Items')
  const jewelry = jewelryRaw && !/^unknown$/i.test(jewelryRaw.trim()) ? jewelryRaw : null
  const dentalRaw = parseLine(r, 'Dentals', 'Dental')
  const dental = dentalRaw && !/^(unknown|not available|n\/a)$/i.test(dentalRaw.trim()) ? dentalRaw : null
  const dnaRaw = parseLine(r, 'DNA', 'Dna')
  const dna = dnaRaw && !/^(unknown|not available|n\/a)$/i.test(dnaRaw.trim()) ? dnaRaw : null
  const fpRaw = parseLine(r, 'Fingerprints', 'Fingerprint')
  const fingerprints = fpRaw && !/^(unknown|not available|n\/a)$/i.test(fpRaw.trim()) ? fpRaw : null

  return {
    submissionId: sub.id,
    doeId,
    name:          parseLine(r, 'Name'),
    sex:           parseLine(r, 'Sex', 'Gender'),
    race:          parseLine(r, 'Race/Ethnicity', 'Race'),
    age:           parseLine(r, 'Age'),
    height:        parseLine(r, 'Height'),
    weight:        parseLine(r, 'Weight'),
    hair:          parseLine(r, 'Hair'),
    eyes:          parseLine(r, 'Eyes'),
    marks:         parseLine(r, 'Distinguishing Marks'),
    clothing,
    jewelry,
    dental,
    dna,
    fingerprints,
    location,
    state:         extractState(location),
    date:          dateStr,
    month,
    year,
    circumstances,
    bodyState:      parseBodyState(r),
    stateOfRemains: parseLine(r, 'State of Remains'),
    childbirth:     parseChildbirthStatus(r),
  }
}

// ─── Pattern detection helpers ────────────────────────────────────────────────

function extractCity(location: string | null): string | null {
  if (!location) return null
  const city = location.split(',')[0].trim()
  return city.length > 2 ? city.toLowerCase().replace(/[^a-z\s]/g, '').trim() : null
}

function calcStdDev(nums: number[]): number {
  if (nums.length < 2) return 0
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const variance = nums.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / nums.length
  return Math.sqrt(variance)
}

// Major US transport corridors — patterns matched against circumstances + location text
const CORRIDORS: Array<{ id: string; label: string; patterns: RegExp[] }> = [
  { id: 'I-10',  label: 'I-10 (Gulf Coast/Southwest)',   patterns: [/\bI-?10\b/i, /interstate\s*10\b/i] },
  { id: 'I-20',  label: 'I-20 (Deep South)',             patterns: [/\bI-?20\b/i, /interstate\s*20\b/i] },
  { id: 'I-35',  label: 'I-35 (Central)',                patterns: [/\bI-?35\b/i, /interstate\s*35\b/i] },
  { id: 'I-40',  label: 'I-40 (Mid-South Crossroads)',   patterns: [/\bI-?40\b/i, /interstate\s*40\b/i] },
  { id: 'I-55',  label: 'I-55 (Mississippi Corridor)',   patterns: [/\bI-?55\b/i, /interstate\s*55\b/i] },
  { id: 'I-75',  label: 'I-75 (Southeast)',              patterns: [/\bI-?75\b/i, /interstate\s*75\b/i] },
  { id: 'I-80',  label: 'I-80 (Northern Transcontinental)', patterns: [/\bI-?80\b/i, /interstate\s*80\b/i] },
  { id: 'I-90',  label: 'I-90 (Northern)',               patterns: [/\bI-?90\b/i, /interstate\s*90\b/i] },
  { id: 'I-95',  label: 'I-95 (East Coast)',             patterns: [/\bI-?95\b/i, /interstate\s*95\b/i] },
  { id: 'US-1',  label: 'US-1 (East Coast Highway)',     patterns: [/\bUS-?1\b/i, /route\s*1\b/i] },
  { id: 'US-101', label: 'US-101 (Pacific Coast)',       patterns: [/\bUS-?101\b/i, /route\s*101\b/i, /pacific\s*coast\s*hwy/i] },
  { id: 'I-25',  label: 'I-25 (Rocky Mountain)',         patterns: [/\bI-?25\b/i, /interstate\s*25\b/i] },
  { id: 'I-65',  label: 'I-65 (Central South)',          patterns: [/\bI-?65\b/i, /interstate\s*65\b/i] },
]

// ─── Highway proximity lookup ─────────────────────────────────────────────────
// Cities within ~20 miles of major interstate corridors
// Format: 'City' → ['I-xx', ...] (corridor IDs)
// Compiled from geographic proximity — this is a signal, not a precise measurement.
// Focus on corridors known to law enforcement as dumping/transit routes.
const HIGHWAY_PROXIMITY: Record<string, string[]> = {
  // I-10 belt (Gulf Coast / Southwest)
  'Jacksonville': ['I-10','I-95'], 'Tallahassee': ['I-10'], 'Pensacola': ['I-10'],
  'Mobile': ['I-10','I-65'], 'Biloxi': ['I-10'], 'Gulfport': ['I-10'],
  'New Orleans': ['I-10','I-55'], 'Baton Rouge': ['I-10'], 'Lafayette': ['I-10'],
  'Beaumont': ['I-10'], 'Houston': ['I-10','I-45'], 'San Antonio': ['I-10','I-35'],
  'El Paso': ['I-10','I-25'], 'Las Cruces': ['I-10','I-25'],
  'Tucson': ['I-10','I-19'], 'Phoenix': ['I-10'], 'Tempe': ['I-10'],
  'Mesa': ['I-10'], 'Chandler': ['I-10'], 'Glendale': ['I-10'],
  'Palm Springs': ['I-10'], 'Ontario': ['I-10'], 'Pomona': ['I-10'],
  'Los Angeles': ['I-10','US-101'], 'Santa Monica': ['I-10'],
  // I-20 (Deep South)
  'Atlanta': ['I-20','I-75','I-85'], 'Augusta': ['I-20'],
  'Columbia': ['I-20','I-26'], 'Charlotte': ['I-85'],
  'Birmingham': ['I-20','I-65'], 'Tuscaloosa': ['I-20'],
  'Jackson': ['I-20','I-55'], 'Vicksburg': ['I-20'],
  'Shreveport': ['I-20'], 'Dallas': ['I-20','I-35'],
  'Fort Worth': ['I-20','I-35'], 'Abilene': ['I-20'],
  'Midland': ['I-20'], 'Odessa': ['I-20'],
  // I-35 (Central corridor — border to Minnesota)
  'Laredo': ['I-35'], 'San Marcos': ['I-35'], 'Austin': ['I-35'],
  'Waco': ['I-35'], 'Temple': ['I-35'], 'Killeen': ['I-35'],
  'Oklahoma City': ['I-35','I-40','I-44'], 'Norman': ['I-35'],
  'Wichita': ['I-35'], 'Salina': ['I-35'],
  'Kansas City': ['I-35','I-70'], 'Overland Park': ['I-35'],
  'Des Moines': ['I-35','I-80'], 'Ames': ['I-35'],
  'Minneapolis': ['I-35','I-94'], 'Bloomington': ['I-35'],
  'Duluth': ['I-35'],
  // I-40 (East-West midline)
  'Memphis': ['I-40','I-55'], 'Nashville': ['I-40','I-65','I-24'],
  'Knoxville': ['I-40','I-75'], 'Asheville': ['I-40'],
  'Little Rock': ['I-40','I-30'], 'Fort Smith': ['I-40'],
  'Tulsa': ['I-40','I-44'],
  'Amarillo': ['I-40'], 'Albuquerque': ['I-40','I-25'],
  'Flagstaff': ['I-40'], 'Barstow': ['I-40'],
  // I-55 (Mississippi Valley)
  'Chicago': ['I-55','I-90','I-94'], 'Joliet': ['I-55'],
  'Springfield': ['I-55'], 'St. Louis': ['I-55','I-70'],
  'Cape Girardeau': ['I-55'], 'Blytheville': ['I-55'],
  'West Memphis': ['I-55'], 'Greenville': ['I-55'],
  'Greenwood': ['I-55'], 'Batesville': ['I-55'],
  // I-65 (Central South — Gulf to Great Lakes)
  'Huntsville': ['I-65'], 'Decatur': ['I-65'],
  'Bowling Green': ['I-65'], 'Louisville': ['I-65','I-64'],
  'Indianapolis': ['I-65','I-70','I-74'], 'Columbus': ['I-65'],
  // I-75 (Southeast — Michigan to Florida)
  'Detroit': ['I-75','I-94'], 'Flint': ['I-75'],
  'Toledo': ['I-75','I-80'], 'Dayton': ['I-75','I-70'],
  'Cincinnati': ['I-75'], 'Lexington': ['I-75'],
  'Corbin': ['I-75'], 'Chattanooga': ['I-75','I-24'],
  'Dalton': ['I-75'], 'Gainesville': ['I-75'],
  'Ocala': ['I-75'], 'Tampa': ['I-75','I-4'],
  'Naples': ['I-75'],
  // I-80 (Northern Transcontinental)
  'Sacramento': ['I-80'], 'Reno': ['I-80'],
  'Salt Lake City': ['I-80','I-15'], 'Ogden': ['I-80'],
  'Elko': ['I-80'], 'Battle Mountain': ['I-80'],
  'Winnemucca': ['I-80'], 'Cheyenne': ['I-80','I-25'],
  'Laramie': ['I-80'], 'Rawlins': ['I-80'],
  'Rock Springs': ['I-80'], 'Evanston': ['I-80'],
  'Lincoln': ['I-80'], 'Omaha': ['I-80','I-29'],
  'Iowa City': ['I-80'], 'Davenport': ['I-80'],
  'Moline': ['I-80'], 'South Bend': ['I-80'],
  'Cleveland': ['I-80','I-77'],
  'Youngstown': ['I-80'], 'Erie': ['I-80'],
  // I-90 (Northern — Seattle to Boston)
  'Seattle': ['I-90','I-5'], 'Bellevue': ['I-90'],
  'Spokane': ['I-90'], 'Missoula': ['I-90'],
  'Billings': ['I-90'], 'Sheridan': ['I-90'],
  'Buffalo': ['I-90'], 'Rochester': ['I-90'],
  'Syracuse': ['I-90'], 'Albany': ['I-90','I-87'],
  'Boston': ['I-90','I-93','I-95'], 'Worcester': ['I-90'],
  // I-95 (East Coast)
  'Miami': ['I-95'], 'Fort Lauderdale': ['I-95'],
  'West Palm Beach': ['I-95'], 'Orlando': ['I-95','I-4'],
  'Daytona Beach': ['I-95'], 'Savannah': ['I-95'],
  'Charleston': ['I-95','I-26'], 'Fayetteville': ['I-95'],
  'Raleigh': ['I-95','I-40'], 'Rocky Mount': ['I-95'],
  'Richmond': ['I-95'], 'Fredericksburg': ['I-95'],
  'Washington': ['I-95'], 'Baltimore': ['I-95'],
  'Wilmington': ['I-95'], 'Philadelphia': ['I-95'],
  'Trenton': ['I-95'], 'Newark': ['I-95'],
  'New York': ['I-95','US-1'], 'Bridgeport': ['I-95'],
  'New Haven': ['I-95'], 'Providence': ['I-95'],
  // I-25 (Rocky Mountain)
  'Denver': ['I-25','I-70'], 'Colorado Springs': ['I-25'],
  'Pueblo': ['I-25'], 'Trinidad': ['I-25'],
  'Raton': ['I-25'], 'Santa Fe': ['I-25'],
  // US-101 / Pacific Coast
  'San Francisco': ['US-101','I-80'], 'Oakland': ['US-101'],
  'San Jose': ['US-101'], 'Santa Cruz': ['US-101'],
  'Santa Barbara': ['US-101'], 'Ventura': ['US-101'],
  'San Luis Obispo': ['US-101'], 'Salinas': ['US-101'],
  'Eureka': ['US-101'], 'Portland': ['US-101','I-5'],
  'Salem': ['US-101','I-5'],
}

// ─── National park / wilderness proximity lookup ───────────────────────────────
// Cities/towns within ~20 miles of a major national park or wilderness area
// Used to identify cases where remains may be in remote/undiscovered terrain.
const NATIONAL_PARK_PROXIMITY: Record<string, string[]> = {
  // Yellowstone / Grand Teton
  'Jackson': ['Grand Teton NP'], 'Cody': ['Yellowstone NP'],
  'Gardiner': ['Yellowstone NP'], 'West Yellowstone': ['Yellowstone NP'],
  'Livingston': ['Yellowstone NP'], 'Driggs': ['Grand Teton NP'],
  'Afton': ['Grand Teton NP'],
  // Grand Canyon
  'Williams': ['Grand Canyon NP'], 'Flagstaff': ['Grand Canyon NP'],
  'Kanab': ['Grand Canyon NP','Zion NP'],
  'Grand Canyon Village': ['Grand Canyon NP'],
  // Zion / Bryce
  'St. George': ['Zion NP'], 'Springdale': ['Zion NP'],
  'Panguitch': ['Bryce Canyon NP'], 'Escalante': ['Grand Staircase NM'],
  // Great Smoky Mountains
  'Gatlinburg': ['Great Smoky Mountains NP'],
  'Pigeon Forge': ['Great Smoky Mountains NP'],
  'Cherokee': ['Great Smoky Mountains NP'],
  'Bryson City': ['Great Smoky Mountains NP'],
  // Shenandoah
  'Luray': ['Shenandoah NP'], 'Front Royal': ['Shenandoah NP'],
  'Waynesboro': ['Shenandoah NP','AT Corridor'],
  // Olympic
  'Port Angeles': ['Olympic NP'], 'Sequim': ['Olympic NP'],
  'Forks': ['Olympic NP'],
  // Mt Rainier / Cascades
  'Enumclaw': ['Mt Rainier NP'], 'Packwood': ['Mt Rainier NP'],
  'Ashford': ['Mt Rainier NP'], 'Winthrop': ['North Cascades NP'],
  // Rocky Mountain NP
  'Estes Park': ['Rocky Mountain NP'], 'Grand Lake': ['Rocky Mountain NP'],
  'Loveland': ['Rocky Mountain NP'],
  // Glacier
  'Whitefish': ['Glacier NP'], 'Kalispell': ['Glacier NP'],
  'Browning': ['Glacier NP'], 'Cut Bank': ['Glacier NP'],
  // Everglades / Big Cypress
  'Homestead': ['Everglades NP'], 'Florida City': ['Everglades NP'],
  'Immokalee': ['Big Cypress Preserve'], 'Naples': ['Big Cypress Preserve','I-75'],
  // Appalachian Trail corridor (high disappearance rate)
  'Harpers Ferry': ['AT Corridor'],
  'Hot Springs': ['AT Corridor','Ouachita NF'], 'Erwin': ['AT Corridor'],
  'Springer Mountain': ['AT Corridor'],
  // Ozark / Ouachita
  'Harrison': ['Ozark NF'], 'Mountain View': ['Ozark NF'],
  'Mena': ['Ouachita NF'],
  // Angeles / San Bernardino (LA basin — high missing persons volume)
  'Palmdale': ['Angeles NF'], 'Lancaster': ['Angeles NF'],
  'Victorville': ['San Bernardino NF'], 'Big Bear': ['San Bernardino NF'],
  'Redlands': ['San Bernardino NF'],
  // Shasta-Trinity / Klamath
  'Redding': ['Shasta-Trinity NF'], 'Weaverville': ['Shasta-Trinity NF'],
  'Yreka': ['Klamath NF'], 'Happy Camp': ['Klamath NF'],
  // Lake Mead / Mojave
  'Needles': ['Mojave NP'], 'Twentynine Palms': ['Joshua Tree NP'],
  'Yucca Valley': ['Joshua Tree NP'], 'Palm Springs': ['San Jacinto NF','I-10'],
  'Henderson': ['Lake Mead NRA'], 'Boulder City': ['Lake Mead NRA'],
  // Pisgah / Nantahala
  'Asheville': ['Pisgah NF','I-40'], 'Brevard': ['Pisgah NF'],
  'Murphy': ['Nantahala NF'], 'Robbinsville': ['Nantahala NF'],
  // Green Mountain / White Mountain
  'Burlington': ['Green Mountain NF'], 'Rutland': ['Green Mountain NF'],
  'Conway': ['White Mountain NF'], 'North Conway': ['White Mountain NF'],
  // Tongass (SE Alaska)
  'Ketchikan': ['Tongass NF'], 'Sitka': ['Tongass NF'],
  'Juneau': ['Tongass NF'], 'Wrangell': ['Tongass NF'],
}

// ─── Body state decomposition weighting ──────────────────────────────────────
//
// When remains are decomposed, soft-tissue signals (hair colour, eye colour, weight)
// become unreliable.  We scale their contribution down and recalculate the maximum
// possible score so a good skeletal match can still surface.
//
// State      | hair  eyes  weight  marks
// -----------|----------------------------
// intact     | 100%  100%  100%    100%
// mild       |  90%   90%   80%     90%
// moderate   |  50%   30%   40%     60%
// advanced   |  10%    0%   10%     30%
// skeletal   |   0%    0%    0%     20%  (tattoo staining can survive on bone)
// burned     |   0%    0%    0%     10%
// partial    |  30%   10%   20%     40%
// unknown    |  80%   80%   80%     80%  (benefit of the doubt)

const DECOMP_WEIGHTS: Record<BodyState, { hair: number; eyes: number; weight: number; tattoo: number; body_marks: number }> = {
  intact:   { hair: 1.0, eyes: 1.0, weight: 1.0, tattoo: 1.0, body_marks: 1.0 },
  mild:     { hair: 0.9, eyes: 0.9, weight: 0.8, tattoo: 0.9, body_marks: 0.9 },
  moderate: { hair: 0.5, eyes: 0.3, weight: 0.4, tattoo: 0.5, body_marks: 0.6 },
  advanced: { hair: 0.1, eyes: 0.0, weight: 0.1, tattoo: 0.2, body_marks: 0.3 },
  skeletal: { hair: 0.0, eyes: 0.0, weight: 0.0, tattoo: 0.0, body_marks: 0.1 },
  burned:   { hair: 0.0, eyes: 0.0, weight: 0.0, tattoo: 0.0, body_marks: 0.0 },
  partial:  { hair: 0.3, eyes: 0.1, weight: 0.2, tattoo: 0.3, body_marks: 0.4 },
  unknown:  { hair: 0.8, eyes: 0.8, weight: 0.8, tattoo: 0.8, body_marks: 0.8 },
}
// Jewelry NOT decomp-weighted — physical objects survive decomp better than soft tissue

const DECOMP_NOTES: Record<BodyState, string | null> = {
  intact:   null,
  mild:     null,
  moderate: 'Moderate decomposition — soft-tissue signal weights reduced. Hair, eyes, weight may not be reliable.',
  advanced: 'Advanced decomposition — hair and eye colour unavailable. Score reflects sex, age, height, race, and location only.',
  skeletal: 'Skeletal remains — soft-tissue signals excluded. Match scored on sex, age estimate, height, race, and location. Dental or DNA comparison required to confirm.',
  burned:   'Burned remains — most physical signals excluded. Treat score as indicative only. Forensic identification required.',
  partial:  'Partial remains — some physical signals unavailable. Score reflects available data.',
  unknown:  null,
}

const MAX_SIGNAL_SCORES = { sex: 15, race: 12, age: 15, hair: 8, eyes: 8, height: 8, weight: 5, tattoo: 15, body_marks: 8, jewelry: 10, location: 15, childbirth: 8, time_gap: 10 }
const MAX_POSSIBLE_BASE = Object.values(MAX_SIGNAL_SCORES).reduce((a, b) => a + b, 0)

// ─── Scorers ──────────────────────────────────────────────────────────────────

function normSex(s: string | null): string | null {
  if (!s) return null
  const l = s.toLowerCase()
  if (l.includes('female') || l === 'f') return 'female'
  if (l.includes('male')   || l === 'm') return 'male'
  return null
}

const RACE_GROUPS: Record<string, string[]> = {
  white:    ['white', 'caucasian', 'european'],
  black:    ['black', 'african american', 'african-american'],
  hispanic: ['hispanic', 'latino', 'latina', 'latinx', 'mexican', 'cuban', 'puerto rican'],
  asian:    ['asian', 'pacific islander', 'hawaiian', 'filipino', 'chinese', 'japanese', 'korean', 'vietnamese', 'indian'],
  native:   ['native american', 'american indian', 'alaska native', 'indigenous', 'first nations'],
}

function normRace(r: string | null): string | null {
  if (!r) return null
  const l = r.toLowerCase()
  for (const [group, terms] of Object.entries(RACE_GROUPS)) {
    if (terms.some(t => l.includes(t))) return group
  }
  return null
}

function parseAgeRange(s: string | null): [number, number] | null {
  if (!s) return null
  const range = s.match(/(\d+)\s*[-–to]+\s*(\d+)/)
  if (range) return [parseInt(range[1]), parseInt(range[2])]
  const single = s.match(/(\d+)/)
  if (single) { const n = parseInt(single[1]); return [Math.max(0, n - 2), n + 2] }
  return null
}

const HAIR_GROUPS: Record<string, string[]> = {
  black:      ['black', 'jet black'],
  dark_brown: ['dark brown', 'brown black', 'brunette', 'chocolate'],
  brown:      ['brown', 'medium brown', 'light brown', 'chestnut'],
  blonde:     ['blonde', 'blond', 'light blonde', 'dark blonde', 'strawberry blonde', 'golden'],
  red:        ['red', 'auburn', 'ginger', 'reddish', 'strawberry'],
  gray:       ['gray', 'grey', 'silver', 'salt and pepper', 'white'],
}
const HAIR_ADJACENT: [string, string][] = [
  ['black', 'dark_brown'], ['dark_brown', 'brown'], ['brown', 'blonde'],
  ['red', 'blonde'], ['gray', 'blonde'],
]

const EYE_GROUPS: Record<string, string[]> = {
  blue:  ['blue', 'light blue'],
  green: ['green', 'light green'],
  hazel: ['hazel', 'hazel brown', 'hazel green', 'greenish brown', 'brownish green'],
  brown: ['brown', 'dark brown', 'light brown'],
  gray:  ['gray', 'grey'],
  black: ['black', 'very dark'],
}
const EYE_ADJACENT: [string, string][] = [
  ['blue', 'gray'], ['green', 'hazel'], ['hazel', 'brown'], ['brown', 'black'],
]

const STATE_ADJACENT: Record<string, string[]> = {
  VA: ['MD','DC','NC','TN','KY','WV'], MD: ['VA','DC','PA','DE','WV'],
  NC: ['VA','TN','GA','SC'],           SC: ['NC','GA'],
  GA: ['FL','AL','TN','NC','SC'],      FL: ['GA','AL'],
  AL: ['FL','GA','TN','MS'],           TN: ['VA','NC','GA','AL','MS','AR','MO','KY'],
  KY: ['VA','WV','TN','MO','IL','IN','OH'],
  OH: ['PA','WV','KY','IN','MI'],      IN: ['OH','KY','IL','MI'],
  IL: ['IN','KY','MO','IA','WI'],      MO: ['IA','IL','KY','TN','AR','OK','KS','NE'],
  TX: ['NM','OK','AR','LA'],           CA: ['OR','NV','AZ'],
  NY: ['NJ','CT','MA','VT','PA'],      PA: ['NY','NJ','DE','MD','WV','OH'],
  WA: ['OR','ID'],                     OR: ['WA','ID','NV','CA'],
}

const MARK_KEYWORDS = [
  // Physical marks
  'tattoo','scar','birthmark','piercing','mole','brand','amputation','prosthetic','implant',
  'surgical','operation','surgery','deformity','missing finger','missing tooth','gold tooth',
  // Body locations
  'arm','leg','chest','back','neck','hand','shoulder','wrist','ankle','face','forehead','abdomen','torso',
  // Tattoo imagery
  'eagle','cross','rose','dragon','skull','snake','heart','star','butterfly','anchor',
  'tribal','flag','military','name','initial','letter','number','portrait','angel','devil',
  'wing','sword','knife','gun','flower','tiger','wolf','bear','lion','phoenix','moon','sun',
  // Directions/position
  'left','right','upper','lower','inner','outer',
  // Clothing
  'jeans','pants','shorts','shirt','sweater','jacket','coat','dress','skirt','hoodie','vest',
  'sneakers','boots','shoes','heels','sandals','slippers','loafers',
  // Clothing brands
  'nike','adidas','converse','vans','jordan','reebok','puma','levis','wrangler',
  // Clothing descriptors
  'torn','ripped','faded','striped','plaid','denim','flannel','polo','camouflage','camo',
  'size','small','medium','large',
  // Jewelry
  'necklace','bracelet','ring','earring','watch','chain','locket','pendant','medallion',
  'choker','bangle','anklet','brooch','cufflink',
  // Jewelry materials
  'gold','silver','diamond','engraved','inscription','initials','monogram',
  // Colors (for clothing/jewelry matching)
  'red','blue','green','black','white','gray','grey','brown','pink','purple','yellow','orange','maroon','navy',
]

function scoreSex(a: ParsedCase, b: ParsedCase): SignalResult {
  const sa = normSex(a.sex), sb = normSex(b.sex)
  if (!sa || !sb) return { score: 0, match: 'unknown' }
  if (sa === sb)  return { score: 15, match: 'exact' }
  return { score: -999, match: 'mismatch' }
}

function scoreRace(a: ParsedCase, b: ParsedCase): SignalResult {
  const ra = normRace(a.race), rb = normRace(b.race)
  // Both genuinely unknown — doesn't confirm, but shouldn't count as zero evidence
  if (!ra && !rb) return { score: 2, match: 'both_unknown' }
  if (!ra || !rb) return { score: 0, match: 'unknown' }
  if (ra === rb)  return { score: 12, match: 'exact' }
  const al = (a.race ?? '').toLowerCase(), bl = (b.race ?? '').toLowerCase()
  const groups = Object.keys(RACE_GROUPS)
  const aG = groups.filter(g => RACE_GROUPS[g].some(t => al.includes(t)))
  const bG = groups.filter(g => RACE_GROUPS[g].some(t => bl.includes(t)))
  if (aG.some(g => bG.includes(g))) return { score: 6, match: 'partial' }
  // Both races are known and belong to distinct groups — penalise but do not hard-eliminate
  // (race misclassification in records is a known issue, especially in older cases)
  return { score: -15, match: 'mismatch' }
}

function scoreAge(missing: ParsedCase, unidentified: ParsedCase): SignalResult {
  const ma = parseAgeRange(missing.age), ua = parseAgeRange(unidentified.age)
  if (!ma || !ua) return { score: 0, match: 'unknown' }
  let adj = ma as [number, number]
  if (missing.year && unidentified.year && unidentified.year > missing.year) {
    const elapsed = unidentified.year - missing.year
    adj = [ma[0] + elapsed, ma[1] + elapsed]
  }
  const overlap = adj[0] <= ua[1] && ua[0] <= adj[1]
  if (!overlap) return { score: -10, match: 'incompatible' }
  const diff = Math.abs((adj[0] + adj[1]) / 2 - (ua[0] + ua[1]) / 2)
  if (diff <= 3)  return { score: 15, match: 'very_close', detail: `±${Math.round(diff)}yr` }
  if (diff <= 7)  return { score: 10, match: 'close',      detail: `±${Math.round(diff)}yr` }
  if (diff <= 12) return { score: 5,  match: 'possible',   detail: `±${Math.round(diff)}yr` }
  if (diff <= 20) return { score: 0,  match: 'distant',    detail: `±${Math.round(diff)}yr` }
  // > 20yr midpoint gap — eliminate even if age ranges nominally overlap at their extremes
  return { score: -10, match: 'incompatible', detail: `±${Math.round(diff)}yr` }
}

function scoreHair(a: ParsedCase, b: ParsedCase): SignalResult {
  const normH = (h: string | null) => {
    if (!h) return null
    const l = h.toLowerCase()
    for (const [g, terms] of Object.entries(HAIR_GROUPS)) { if (terms.some(t => l.includes(t))) return g }
    return null
  }
  const ha = normH(a.hair), hb = normH(b.hair)
  if (!ha || !hb) return { score: 0, match: 'unknown' }
  if (ha === hb) return { score: 8, match: 'exact' }
  for (const [x, y] of HAIR_ADJACENT) {
    if ((ha === x && hb === y) || (ha === y && hb === x)) return { score: 3, match: 'adjacent' }
  }
  // Non-adjacent hair mismatch is NOT a hard zero. Hair can change:
  //  - Dyed (blonde → brown, brown → red, etc.)
  //  - Darkens with age (blonde → brown is extremely common)
  //  - Decomposition changes color (dark hair fades, light hair darkens)
  //  - Human error in reporting/observation
  // Score 0 but don't penalize — let other signals decide.
  // Exception: gray vs non-gray on a young person would be caught by age mismatch instead.
  return { score: 0, match: 'could_have_changed' }
}

function scoreEyes(a: ParsedCase, b: ParsedCase): SignalResult {
  const normE = (e: string | null) => {
    if (!e) return null
    const l = e.toLowerCase()
    for (const [g, terms] of Object.entries(EYE_GROUPS)) { if (terms.some(t => l.includes(t))) return g }
    return null
  }
  const ea = normE(a.eyes), eb = normE(b.eyes)
  if (!ea || !eb) return { score: 0, match: 'unknown' }
  if (ea === eb)  return { score: 8, match: 'exact' }
  for (const [x, y] of EYE_ADJACENT) {
    if ((ea === x && eb === y) || (ea === y && eb === x)) return { score: 3, match: 'adjacent' }
  }
  return { score: 0, match: 'no_match' }
}

function scoreHeight(a: ParsedCase, b: ParsedCase): SignalResult {
  const toIn = (s: string | null) => {
    if (!s) return null
    const ftIn = s.match(/(\d+)[' ]\s*(\d+)?["]?/)
    if (ftIn) return parseInt(ftIn[1]) * 12 + parseInt(ftIn[2] || '0')
    const cm = s.match(/(\d+)\s*cm/i)
    if (cm) return Math.round(parseInt(cm[1]) / 2.54)
    return null
  }
  const ia = toIn(a.height), ib = toIn(b.height)
  if (!ia || !ib) return { score: 0, match: 'unknown' }
  const diff = Math.abs(ia - ib)
  if (diff <= 1) return { score: 8, match: 'exact' }
  if (diff <= 2) return { score: 6, match: 'very_close' }
  if (diff <= 3) return { score: 4, match: 'close' }
  if (diff <= 5) return { score: 2, match: 'possible' }
  return { score: 0, match: 'no_match' }
}

function scoreWeight(a: ParsedCase, b: ParsedCase): SignalResult {
  const toLbs = (s: string | null) => {
    if (!s) return null
    const lbs = s.match(/(\d+)\s*(?:lbs?|pounds?)/i); if (lbs) return parseInt(lbs[1])
    const kg  = s.match(/(\d+)\s*kg/i);                if (kg)  return Math.round(parseInt(kg[1]) * 2.205)
    const raw = s.match(/^(\d{2,3})$/);                if (raw) return parseInt(raw[1])
    return null
  }
  const wa = toLbs(a.weight), wb = toLbs(b.weight)
  if (!wa || !wb) return { score: 0, match: 'unknown' }
  const diff = Math.abs(wa - wb)
  if (diff <= 10) return { score: 5, match: 'exact' }
  if (diff <= 20) return { score: 3, match: 'close' }
  if (diff <= 30) return { score: 1, match: 'possible' }
  return { score: 0, match: 'no_match' }
}

// Tattoo imagery — only scored when both sides mention "tattoo"
const TATTOO_IMAGERY = [
  'eagle','cross','rose','dragon','skull','snake','heart','star','butterfly','anchor',
  'tribal','angel','devil','wing','sword','knife','gun','flower','tiger','wolf',
  'bear','lion','phoenix','moon','sun','portrait','flag','military',
]

// Body marks — physical identifiers that survive longer than soft tissue
const BODY_MARK_KW = [
  'scar','birthmark','piercing','mole','brand','amputation','prosthetic','implant',
  'surgical','surgery','deformity','missing finger','missing tooth','gold tooth',
]

// Jewelry compound token scoring
const JEWELRY_ITEMS = ['locket','pendant','medallion','brooch','bracelet','necklace','earring','anklet','choker','bangle','ring','chain','watch']
const JEWELRY_ADJ   = ['heart','cross','diamond','gold','silver','engraved','monogram','pearl','wedding','engagement','initial','rope','link']
function buildJewelryTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  for (const item of JEWELRY_ITEMS) {
    if (!text.includes(item)) continue
    tokens.add(item)
    for (const adj of JEWELRY_ADJ) {
      if (text.includes(adj)) tokens.add(`${adj}_${item}`)
    }
  }
  return tokens
}

function scoreTattoos(a: ParsedCase, b: ParsedCase): SignalResult & { keywords: string[] } {
  const mText = (a.marks ?? '').toLowerCase()
  const uText = (b.marks ?? '').toLowerCase()

  const mHasTattoo = mText.includes('tattoo') || mText.includes('tatoo')
  const uHasTattoo = uText.includes('tattoo') || uText.includes('tatoo')

  // Explicit contradictions — one side confirms no tattoos
  const mNoTattoo = /no (known |visible )?tattoo|no tattoo/i.test(mText)
  const uNoTattoo = /no (known |visible )?tattoo|no tattoo/i.test(uText)
  if ((mHasTattoo && uNoTattoo) || (uHasTattoo && mNoTattoo)) {
    return { score: -15, match: 'contradiction', keywords: [] }
  }

  const mMotifs = mHasTattoo ? TATTOO_IMAGERY.filter(t => mText.includes(t)) : []
  const uMotifs = uHasTattoo ? TATTOO_IMAGERY.filter(t => uText.includes(t)) : []
  const shared = mMotifs.filter(t => uMotifs.includes(t))

  // Reward shared specific imagery
  const score = shared.length >= 3 ? 20 : shared.length >= 2 ? 14 : shared.length >= 1 ? 8
    : mHasTattoo && uHasTattoo ? 3   // both tattooed, no imagery overlap
    : !mHasTattoo && !uHasTattoo ? 0  // neither mentioned
    : 0                               // one has, one doesn't (not explicit contradiction)

  const match = shared.length >= 3 ? 'strong_match' : shared.length >= 2 ? 'partial_match'
    : shared.length >= 1 ? 'possible_match'
    : mHasTattoo && uHasTattoo ? 'both_have_tattoos'
    : !mHasTattoo && !uHasTattoo ? 'none_mentioned' : 'one_side_only'
  return { score, match, keywords: shared }
}

function scoreBodyMarks(a: ParsedCase, b: ParsedCase): SignalResult & { keywords: string[] } {
  const mText = (a.marks ?? '').toLowerCase()
  const uText = (b.marks ?? '').toLowerCase()
  const mMarks = BODY_MARK_KW.filter(k => mText.includes(k))
  const uMarks = BODY_MARK_KW.filter(k => uText.includes(k))
  const shared = mMarks.filter(k => uMarks.includes(k))

  // Explicit scar contradiction — one has a specific scar, the other has no scars
  const mNoScars = /no (known |visible )?scars?|no marks/i.test(mText)
  const uNoScars = /no (known |visible )?scars?|no marks/i.test(uText)
  const mHasSpecific = mMarks.length > 0
  const uHasSpecific = uMarks.length > 0
  if ((mHasSpecific && uNoScars) || (uHasSpecific && mNoScars)) {
    return { score: -10, match: 'contradiction', keywords: [] }
  }

  // Strong reward for shared specific marks (surgical scars, amputations, implants — highly identifying)
  const highValue = ['surgical','amputation','prosthetic','implant','brand']
  const sharedHigh = shared.filter(k => highValue.includes(k))
  const score = sharedHigh.length > 0 ? Math.min(20, sharedHigh.length * 12)
    : shared.length > 0 ? Math.min(12, shared.length * 5)
    : 0
  const match = shared.length > 0 ? 'shared' : mMarks.length > 0 && uMarks.length > 0 ? 'both_have_marks' : 'none_mentioned'
  return { score, match, keywords: shared }
}

function scoreJewelry(a: ParsedCase, b: ParsedCase): SignalResult & { keywords: string[] } {
  const mText = (a.jewelry ?? '').toLowerCase()
  const uText = (b.jewelry ?? '').toLowerCase()
  if (!mText && !uText) return { score: 0, match: 'none_mentioned', keywords: [] }
  const mTokens = buildJewelryTokens(mText)
  const uTokens = buildJewelryTokens(uText)
  const sharedCompound = [...mTokens].filter(t => t.includes('_') && uTokens.has(t))
  const sharedGeneric  = [...mTokens].filter(t => !t.includes('_') && uTokens.has(t))
  const score = sharedCompound.length > 0 ? Math.min(10, sharedCompound.length * 8)
    : sharedGeneric.length > 0 ? Math.min(6, sharedGeneric.length * 3) : 0
  const match = sharedCompound.length > 0 ? 'specific_match'
    : sharedGeneric.length > 0 ? 'generic_match'
    : mTokens.size > 0 && uTokens.size > 0 ? 'both_have_jewelry' : 'none_mentioned'
  return { score, match, keywords: [...sharedCompound, ...sharedGeneric] }
}

// Words that are too generic to constitute a "unique identifier" — body positions,
// common garment types, generic mark terms. A match only on these is not specific.
const GENERIC_IDENTIFIER_WORDS = new Set([
  'tattoo','scar','mark','left','right','upper','lower','inner','outer','small','large',
  'arm','leg','chest','back','neck','hand','shoulder','wrist','ankle','face','forehead',
  'abdomen','torso','skin','body',
  'shirt','pants','jeans','shoes','jacket','coat','clothing','worn','wearing',
  'unknown','available','not',
])

const MARK_TYPES = ['tattoo', 'scar', 'birthmark', 'brand', 'piercing', 'mark', 'mole']
const BODY_LOCS  = ['shoulder','arm','wrist','forearm','chest','back','neck','leg','thigh','ankle','face','hand','abdomen','torso','rib','hip','calf','forehead','scalp','ear']
const SIDE_WORDS = ['left','right','upper','lower','inner','outer']

// Extract meaningful content words from marks+clothing+jewelry text
// Also synthesises "located mark" compounds (e.g. "left_shoulder_tattoo") so that
// a heart tattoo on the left shoulder vs a partial tattoo on the left shoulder
// both produce the same location compound, triggering a strong identifier match.
function extractContentWords(p: ParsedCase): Set<string> {
  // Marks only — clothing and jewelry are scored separately
  const text = (p.marks ?? '').toLowerCase()
  if (!text) return new Set()

  const words = new Set(
    text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !GENERIC_IDENTIFIER_WORDS.has(w) && !/^\d+$/.test(w))
  )

  // Add located-mark compounds: side+location+type and location+type
  // e.g. "left shoulder tattoo" → synthetic token "left_shoulder_tattoo"
  // This means two records sharing any tattoo at the same body location will match
  // as a specific identifier even if the tattoo imagery differs.
  for (const loc of BODY_LOCS) {
    if (!text.includes(loc)) continue
    for (const type of MARK_TYPES) {
      if (!text.includes(type)) continue
      // bare location+type compound
      words.add(`${loc}_${type}`)
      // with side qualifier
      for (const side of SIDE_WORDS) {
        if (text.includes(side)) words.add(`${side}_${loc}_${type}`)
      }
    }
  }

  return words
}

// Score based on shared specific content words.
// 3+ shared content words = strong match (likely unique identifier)
// 2 shared = possible match
// Outputs a score bonus AND a flag that can override sex/age elimination
function scoreUniqueIdentifier(a: ParsedCase, b: ParsedCase): {
  score: number
  sharedWords: string[]
  strength: 'none' | 'possible' | 'strong' | 'near_certain'
  overridesElimination: boolean
  detail: string | null
} {
  const wordsA = extractContentWords(a)
  const wordsB = extractContentWords(b)
  if (wordsA.size === 0 || wordsB.size === 0) {
    return { score: 0, sharedWords: [], strength: 'none', overridesElimination: false, detail: null }
  }
  const shared = [...wordsA].filter(w => wordsB.has(w))
  if (shared.length === 0) {
    return { score: 0, sharedWords: [], strength: 'none', overridesElimination: false, detail: null }
  }
  if (shared.length >= 5) {
    return {
      score: 25,
      sharedWords: shared,
      strength: 'near_certain',
      overridesElimination: true,
      detail: `Near-certain physical identifier match: "${shared.slice(0, 6).join(', ')}" — even if demographic signals conflict, these records share highly specific descriptors`,
    }
  }
  if (shared.length >= 3) {
    return {
      score: 15,
      sharedWords: shared,
      strength: 'strong',
      overridesElimination: true,
      detail: `Strong physical identifier match: "${shared.join(', ')}" — review for same person or connected case`,
    }
  }
  if (shared.length >= 2) {
    return {
      score: 5,
      sharedWords: shared,
      strength: 'possible',
      overridesElimination: false,
      detail: `Possible identifier overlap: "${shared.join(', ')}"`,
    }
  }
  return { score: 0, sharedWords: shared, strength: 'none', overridesElimination: false, detail: null }
}

function forensicAvailabilityNote(a: ParsedCase, b: ParsedCase): string | null {
  const notes: string[] = []
  if (a.dental && a.dental.toLowerCase().includes('available')) notes.push('Missing: dental records available')
  if (b.dental && b.dental.toLowerCase().includes('available')) notes.push('Unidentified: dental records available')
  if (a.dna && !/not available/i.test(a.dna)) notes.push(`Missing: DNA — ${a.dna}`)
  if (b.dna && !/not available/i.test(b.dna)) notes.push(`Unidentified: DNA — ${b.dna}`)
  if (a.fingerprints && a.fingerprints.toLowerCase().includes('available')) notes.push('Missing: fingerprints available')
  if (b.fingerprints && b.fingerprints.toLowerCase().includes('available')) notes.push('Unidentified: fingerprints available')
  return notes.length ? notes.join('; ') : null
}

function scoreLocation(a: ParsedCase, b: ParsedCase): SignalResult {
  const sa = a.state, sb = b.state
  if (!sa || !sb) return { score: 0, match: 'unknown' }
  if (sa === sb) return { score: 15, match: 'same_state', detail: sa }
  if (STATE_ADJACENT[sa]?.includes(sb) || STATE_ADJACENT[sb]?.includes(sa)) return { score: 5, match: 'adjacent_state', detail: `${sa}↔${sb}` }
  return { score: -5, match: 'different_state' }
}

// Childbirth / parity status — forensic bone analysis can detect signs of childbirth,
// and MP records often note whether a person has children. A confirmed mismatch
// (one clearly parous, one clearly nulliparous) is a strong negative indicator.
function scoreChildbirth(a: ParsedCase, b: ParsedCase): SignalResult {
  const ca = a.childbirth, cb = b.childbirth
  if (ca === 'unknown' || cb === 'unknown') return { score: 0, match: 'unknown' }
  if (ca === cb) {
    return ca === 'evidence'
      ? { score: 8, match: 'both_parous',      detail: 'both show signs of childbirth' }
      : { score: 5, match: 'both_nulliparous', detail: 'neither shows signs of childbirth' }
  }
  return { score: -20, match: 'mismatch', detail: 'one parous, one nulliparous — strong negative' }
}

// ─── Time gap between disappearance and body found ────────────────────────────
// Shorter recovery window = stronger match signal. Physical preservation is higher,
// temporal plausibility is tighter. Hard guard: gap < 0 is structurally impossible
// and should never reach this function (eliminated upstream), but we return 0 safely.

function scoreTimeGap(missing: ParsedCase, unidentified: ParsedCase): SignalResult {
  if (!missing.year || !unidentified.year) return { score: 0, match: 'unknown' }
  // Structural guard — should already be hard-eliminated upstream
  if (unidentified.year < missing.year) return { score: 0, match: 'n/a' }
  const gapYears = Math.max(0,
    (unidentified.year - missing.year) +
    ((unidentified.month ?? 6) - (missing.month ?? 6)) / 12
  )
  const detail = gapYears < 2
    ? `${Math.round(gapYears * 12)}mo gap`
    : `${Math.round(gapYears)}yr gap`
  if (gapYears < 2)  return { score: 10, match: 'very_short',  detail }
  if (gapYears < 5)  return { score: 7,  match: 'short',       detail }
  if (gapYears < 10) return { score: 4,  match: 'moderate',    detail }
  if (gapYears < 15) return { score: 1,  match: 'long',        detail }
  if (gapYears < 20) return { score: -2, match: 'very_long',   detail }
  return               { score: -5, match: 'extended',          detail }
}

// ─── Composite score with decomposition adjustment ────────────────────────────

function scoreMatch(missing: ParsedCase, unidentified: ParsedCase): {
  signals: MatchSignals
  composite: number
  grade: string
  eliminated: boolean
  eliminationReason?: string
} {
  // Chronological impossibility — remains found before person went missing
  const chronoImpossible = missing.year && unidentified.year && (
    unidentified.year < missing.year ||
    (unidentified.year === missing.year && missing.month && unidentified.month && unidentified.month < missing.month)
  )
  if (chronoImpossible) {
    return { signals: { sex: { score: 0, match: 'n/a' }, race: { score: 0, match: 'n/a' }, age: { score: 0, match: 'n/a' }, hair: { score: 0, match: 'n/a' }, eyes: { score: 0, match: 'n/a' }, height: { score: 0, match: 'n/a' }, weight: { score: 0, match: 'n/a' }, tattoo: { score: 0, match: 'n/a', keywords: [] }, body_marks: { score: 0, match: 'n/a', keywords: [] }, jewelry: { score: 0, match: 'n/a', keywords: [] }, location: { score: 0, match: 'n/a' }, childbirth: { score: 0, match: 'n/a' } }, composite: 0, grade: 'weak', eliminated: true, eliminationReason: 'chronologically_impossible' }
  }

  // Cheap sex + age checks first — scoreUniqueIdentifier only runs on surviving pairs
  const sexSig = scoreSex(missing, unidentified)
  const ageSig = scoreAge(missing, unidentified)

  if (sexSig.score < -100 || ageSig.score < -5) {
    // Only worth calling scoreUniqueIdentifier if there's a potential elimination to override
    const uniqueId = scoreUniqueIdentifier(missing, unidentified)
    if (sexSig.score < -100 && !uniqueId.overridesElimination) {
      return { signals: { sex: sexSig, race: { score: 0, match: 'n/a' }, age: { score: 0, match: 'n/a' }, hair: { score: 0, match: 'n/a' }, eyes: { score: 0, match: 'n/a' }, height: { score: 0, match: 'n/a' }, weight: { score: 0, match: 'n/a' }, tattoo: { score: 0, match: 'n/a', keywords: [] }, body_marks: { score: 0, match: 'n/a', keywords: [] }, jewelry: { score: 0, match: 'n/a', keywords: [] }, location: { score: 0, match: 'n/a' }, childbirth: { score: 0, match: 'n/a' } }, composite: 0, grade: 'weak', eliminated: true, eliminationReason: 'sex_mismatch' }
    }
    if (ageSig.score < -5 && !uniqueId.overridesElimination) {
      return { signals: { sex: sexSig, race: { score: 0, match: 'n/a' }, age: ageSig, hair: { score: 0, match: 'n/a' }, eyes: { score: 0, match: 'n/a' }, height: { score: 0, match: 'n/a' }, weight: { score: 0, match: 'n/a' }, tattoo: { score: 0, match: 'n/a', keywords: [] }, body_marks: { score: 0, match: 'n/a', keywords: [] }, jewelry: { score: 0, match: 'n/a', keywords: [] }, location: { score: 0, match: 'n/a' }, childbirth: { score: 0, match: 'n/a' } }, composite: 0, grade: 'weak', eliminated: true, eliminationReason: 'age_incompatible' }
    }
  }

  // Pair survived elimination — full scoring
  const uniqueId = scoreUniqueIdentifier(missing, unidentified)

  const rawSignals: MatchSignals = {
    sex:        sexSig,
    race:       scoreRace(missing, unidentified),
    age:        ageSig,
    hair:       scoreHair(missing, unidentified),
    eyes:       scoreEyes(missing, unidentified),
    height:     scoreHeight(missing, unidentified),
    weight:     scoreWeight(missing, unidentified),
    tattoo:     scoreTattoos(missing, unidentified),
    body_marks: scoreBodyMarks(missing, unidentified),
    jewelry:    scoreJewelry(missing, unidentified),
    location:   scoreLocation(missing, unidentified),
    childbirth: scoreChildbirth(missing, unidentified),
    time_gap:   scoreTimeGap(missing, unidentified),
  }

  // Apply body state decomposition weighting
  // If body state is unknown but time gap is large, infer minimum decomposition.
  // 20+ years with unknown state → at least advanced decomposition
  // 10+ years with unknown state → at least moderate decomposition
  // This prevents unknown-state records from getting full soft-tissue signal credit
  // when the time gap makes intact preservation implausible.
  let bodyState = unidentified.bodyState
  if (bodyState === 'unknown' && missing.year && unidentified.year) {
    const gapYears = unidentified.year - missing.year
    if (gapYears >= 20) bodyState = 'advanced'
    else if (gapYears >= 10) bodyState = 'moderate'
  }
  const w = DECOMP_WEIGHTS[bodyState]
  const decompNote = DECOMP_NOTES[bodyState]

  const signals: MatchSignals = {
    ...rawSignals,
    hair:       { ...rawSignals.hair,       score: Math.round(rawSignals.hair.score       * w.hair)       },
    eyes:       { ...rawSignals.eyes,       score: Math.round(rawSignals.eyes.score       * w.eyes)       },
    weight:     { ...rawSignals.weight,     score: Math.round(rawSignals.weight.score     * w.weight)     },
    tattoo:     { ...rawSignals.tattoo,     score: Math.round(rawSignals.tattoo.score     * w.tattoo)     },
    body_marks: { ...rawSignals.body_marks, score: Math.round(rawSignals.body_marks.score * w.body_marks) },
    // jewelry is NOT decomp-weighted — physical objects survive decomp better than soft tissue
    body_state: {
      state: bodyState,
      note: decompNote,
      weight_applied: bodyState !== 'intact' && bodyState !== 'unknown',
    },
  }

  // Recalculate max possible accounting for zeroed signals
  const deductedMax =
    (1 - w.hair)       * MAX_SIGNAL_SCORES.hair       +
    (1 - w.eyes)       * MAX_SIGNAL_SCORES.eyes       +
    (1 - w.weight)     * MAX_SIGNAL_SCORES.weight     +
    (1 - w.tattoo)     * MAX_SIGNAL_SCORES.tattoo     +
    (1 - w.body_marks) * MAX_SIGNAL_SCORES.body_marks
  const adjustedMax = Math.max(30, MAX_POSSIBLE_BASE - Math.round(deductedMax))

  // Inject unique identifier signal — added separately because it can change grade
  // regardless of decomposition state and can survive demographic eliminations
  if (uniqueId.strength !== 'none') {
    (signals as unknown as Record<string, unknown>).unique_identifier = {
      score: uniqueId.score,
      match: uniqueId.strength,
      keywords: uniqueId.sharedWords,
      detail: uniqueId.detail,
      overrode_elimination: uniqueId.overridesElimination && (sexSig.score < -100 || ageSig.score < -5),
    }
  }

  // Include negative scores (race mismatch, childbirth mismatch, age gap) — they lower the composite
  const rawScore = Object.entries(signals)
    .filter(([k]) => !['body_state', 'forensic_availability', 'unique_identifier'].includes(k))
    .reduce((sum, [, s]) => sum + (s as SignalResult).score, 0)

  // Apply unique identifier bonus on top — it's additive and not subject to decomp scaling
  const identifierBonus = uniqueId.score
  const composite = Math.round(Math.max(0, Math.min(100, ((rawScore + identifierBonus) / adjustedMax) * 100)))
  const grade =
    composite >= 73 ? 'very_strong' :
    composite >= 56 ? 'strong' :
    composite >= 39 ? 'notable' :
    composite >= 22 ? 'moderate' : 'weak'

  // Add forensic availability note — tells investigator if dental/DNA/prints can confirm this match
  const forensicNote = forensicAvailabilityNote(missing, unidentified)
  if (forensicNote) {
    (signals as unknown as Record<string, unknown>).forensic_availability = { note: forensicNote }
  }

  return { signals, composite, grade, eliminated: false }
}

// ─── Circumstance signal extraction ──────────────────────────────────────────

interface CircumstanceSignalDef {
  category: 'location_context' | 'last_activity' | 'social_context' | 'behavioral' | 'investigative'
  label: string
  keywords: string[]
}

const CIRCUMSTANCE_SIGNALS: Record<string, CircumstanceSignalDef> = {
  // Location context
  foster_care:        { category: 'location_context', label: 'Foster care / group home', keywords: ['foster', 'group home', 'residential facility', 'dcf', 'dcs', 'dss', 'child protective', 'state custody', 'group care', 'youth home', 'treatment center', 'residential treatment'] },
  truck_stop:         { category: 'location_context', label: 'Truck stop / rest area', keywords: ['truck stop', 'travel plaza', 'rest area', 'weigh station', "pilot's", "love's", 'flying j', 'petro', 'ta travel'] },
  highway:            { category: 'location_context', label: 'Highway corridor', keywords: ['highway', 'interstate', ' i-', 'route ', 'overpass', 'on-ramp', 'off-ramp', 'roadside', 'road side'] },
  park_trail:         { category: 'location_context', label: 'Park / trail / wilderness', keywords: ['park', 'trail', 'woods', 'wooded', 'forest', 'lake', 'river', 'creek', 'national forest', 'state park', 'campground', 'wilderness'] },
  school_route:       { category: 'location_context', label: 'School route', keywords: ['school', 'bus stop', 'walking home', 'walking to school', 'after school', 'from school', 'school bus'] },
  bar_party:          { category: 'location_context', label: 'Bar / party / nightlife', keywords: ['bar', 'nightclub', 'club', 'party', 'gathering', 'concert', 'tavern', 'drinking', 'night out'] },
  convenience_store:  { category: 'location_context', label: 'Convenience store / gas station', keywords: ['convenience store', 'gas station', 'parking lot', '7-eleven', 'circle k', 'wawa', 'quick mart'] },
  shelter:            { category: 'location_context', label: 'Shelter / transitional housing', keywords: ['shelter', 'transitional housing', 'halfway house', 'mission', 'soup kitchen', 'homeless shelter'] },
  motel:              { category: 'location_context', label: 'Motel / budget lodging', keywords: ['motel', 'hotel', 'inn', 'lodging', 'extended stay', 'budget inn'] },

  // Last known activity
  hitchhiking:        { category: 'last_activity', label: 'Hitchhiking / accepting a ride', keywords: ['hitchhik', 'hitch hiking', 'accepting a ride', 'getting in a car', 'got into a vehicle', 'thumbing a ride', 'accepted a ride', 'ride from a stranger'] },
  met_online:         { category: 'last_activity', label: 'Met someone online', keywords: ['online', 'internet', 'craigslist', 'facebook', 'social media', 'chatting online', 'met online', 'messaging', 'texting someone', 'chat app', 'dating app'] },
  left_with_unknown:  { category: 'last_activity', label: 'Left with unknown person', keywords: ['left with', 'last seen with', 'seen with unknown', 'unknown male', 'unknown man', 'unknown woman', 'unknown female', 'unknown individual', 'stranger', 'unidentified man', 'unidentified male'] },
  never_arrived:      { category: 'last_activity', label: 'Never arrived at destination', keywords: ['never arrived', 'never made it', 'failed to arrive', 'did not return', 'did not come home', 'did not show up', 'was supposed to'] },
  left_work:          { category: 'last_activity', label: 'Disappeared after work', keywords: ['left work', 'after work', 'leaving job', 'got off work', 'finished work', 'end of shift', 'leaving her job', 'leaving his job'] },
  late_night:         { category: 'last_activity', label: 'Late night disappearance', keywords: ['late at night', 'late night', 'early morning', 'after midnight', 'overnight', '2 am', '3 am', '1 am', '2:00 am', '3:00 am'] },
  runaway_episode:    { category: 'last_activity', label: 'Left as runaway', keywords: ['ran away from home', 'ran away from foster', 'left without permission', 'walked away', 'ran away from placement', 'absconded'] },

  // Social vulnerability
  prior_runaway:      { category: 'social_context', label: 'History of running away', keywords: ['history of running', 'prior runaway', 'known to run', 'had run away before', 'history of leaving', 'previously ran away', 'multiple runaway'] },
  foster_status:      { category: 'social_context', label: 'In foster care / state custody', keywords: ['foster child', 'foster kid', 'in foster care', 'ward of the state', 'state ward', 'group home resident', 'placed in foster'] },
  homeless:           { category: 'social_context', label: 'Homeless / transient', keywords: ['homeless', 'no fixed address', 'transient', 'living on the streets', 'street youth', 'couch surfing', 'no permanent address'] },
  trafficking_risk:   { category: 'social_context', label: 'Trafficking / exploitation risk', keywords: ['prostitut', 'sex work', 'escort', 'trafficking', 'exploitation', 'solicitation', 'street work', 'survival sex', 'commercial sex', 'pimped'] },
  substance_use:      { category: 'social_context', label: 'Substance use history', keywords: ['drug', 'alcohol', 'substance', 'addiction', 'under the influence', 'intoxicat', 'narcotics', 'heroin', 'meth', 'crack', 'cocaine', 'fentanyl'] },
  domestic_violence:  { category: 'social_context', label: 'Domestic violence / abuse', keywords: ['domestic violence', 'abusive relationship', 'abusive partner', 'fled abuse', 'fear of', 'restraining order', 'protective order', 'abusive home'] },
  mental_health:      { category: 'social_context', label: 'Mental health history', keywords: ['mental health', 'psychiatric', 'depression', 'anxiety', 'bipolar', 'schizophreni', 'paranoia', 'mental illness', 'on medication', 'institutionalized'] },
  juvenile_justice:   { category: 'social_context', label: 'Juvenile justice involvement', keywords: ['juvenile', 'detention', 'juvie', 'probation', 'parole', 'youth correctional', 'incarcerated youth', 'youth offender'] },

  // Behavioral indicators
  belongings_left:    { category: 'behavioral', label: 'Left belongings behind', keywords: ['left her phone', 'left his phone', 'left belongings', 'left her wallet', 'left his wallet', 'left purse', 'left id', 'left keys', 'left bag', 'belongings found', 'purse found', 'phone found', 'wallet found'] },
  vehicle_abandoned:  { category: 'behavioral', label: 'Vehicle abandoned', keywords: ['vehicle found', 'car found', 'car was found', 'car abandoned', 'vehicle abandoned', 'vehicle left', 'abandoned vehicle', 'her car was found', 'his car was found'] },
  no_contact:         { category: 'behavioral', label: 'No contact with family', keywords: ['no contact', 'never contacted', 'failed to call', 'never called', 'cut off contact', 'no communication', 'failed to make contact', 'never reached out'] },
  out_of_character:   { category: 'behavioral', label: 'Disappearance out of character', keywords: ['out of character', 'not like her', 'not like him', 'uncharacteristic', 'unlike her', 'unlike him', 'unusual behavior', 'this is unlike'] },

  // Investigative patterns
  classified_runaway: { category: 'investigative', label: 'Classified as runaway / voluntary', keywords: ['classified as runaway', 'listed as voluntary', 'runaway classification', 'voluntary missing', 'voluntarily missing', 'awol', 'marked as runaway', 'entered as runaway'] },
}

function extractCircumstanceSignals(sub: ParsedCase): string[] {
  const text = ((sub.circumstances ?? '') + ' ' + (sub.marks ?? '')).toLowerCase()
  const present: string[] = []
  for (const [signal, def] of Object.entries(CIRCUMSTANCE_SIGNALS)) {
    if (def.keywords.some(kw => text.includes(kw))) present.push(signal)
  }
  return present
}

// ─── Victimology clustering helpers ──────────────────────────────────────────

function ageGroup(age: string | null): string {
  const r = parseAgeRange(age); if (!r) return 'unknown'
  const mid = (r[0] + r[1]) / 2
  if (mid <= 12) return 'child'
  if (mid <= 17) return 'teen'
  if (mid <= 25) return 'young_adult'
  if (mid <= 40) return 'adult'
  if (mid <= 60) return 'middle_age'
  return 'senior'
}

function seasonOf(month: number | null): string | null {
  if (!month) return null
  if ([3,4,5].includes(month))   return 'spring'
  if ([6,7,8].includes(month))   return 'summer'
  if ([9,10,11].includes(month)) return 'fall'
  return 'winter'
}

const MONTH_NAMES = ['','January','February','March','April','May','June','July','August','September','October','November','December']

// ─── Jaro-Winkler string similarity ──────────────────────────────────────────

function jaroSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const len1 = a.length, len2 = b.length
  if (len1 === 0 || len2 === 0) return 0
  const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1
  const aM = new Array(len1).fill(false)
  const bM = new Array(len2).fill(false)
  let matches = 0, trans = 0
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - matchDist), hi = Math.min(i + matchDist + 1, len2)
    for (let j = lo; j < hi; j++) {
      if (bM[j] || a[i] !== b[j]) continue
      aM[i] = true; bM[j] = true; matches++; break
    }
  }
  if (matches === 0) return 0
  let k = 0
  for (let i = 0; i < len1; i++) {
    if (!aM[i]) continue
    while (!bM[k]) k++
    if (a[i] !== b[k]) trans++
    k++
  }
  return (matches / len1 + matches / len2 + (matches - trans / 2) / matches) / 3
}

function jaroWinkler(a: string, b: string): number {
  const j = jaroSimilarity(a, b)
  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++; else break
  }
  return j + prefix * 0.1 * (1 - j)
}

// ─── Entity extractors ────────────────────────────────────────────────────────

const VEHICLE_COLORS = ['red','blue','white','black','silver','gray','grey','green','yellow','brown','maroon','tan','navy','dark blue','light blue','dark green']
const VEHICLE_MAKES  = ['ford','chevy','chevrolet','dodge','gmc','toyota','honda','nissan','mazda','volkswagen','vw','bmw','pontiac','oldsmobile','buick','cadillac','lincoln','mercury','chrysler','plymouth','jeep','subaru','hyundai','kia','saturn']
const VEHICLE_TYPES  = ['car','truck','van','suv','pickup','sedan','hatchback','minivan','motorcycle','vehicle','station wagon']

function extractVehicles(text: string): { value: string; snippet: string }[] {
  const results: { value: string; snippet: string }[] = []
  // "last seen entering / got into a [color] [make/type]"
  const entryPat = /(?:last seen (?:entering|getting into|in|driving)|entered|got into|seen entering|seen in)\s+(?:a|an)?\s*((?:(?:red|blue|white|black|silver|gray|grey|green|yellow|brown|maroon|tan|navy|dark blue|light blue|dark green)[\s-])?(?:ford|chevy|chevrolet|dodge|gmc|toyota|honda|nissan|mazda|volkswagen|vw|bmw|pontiac|oldsmobile|buick|cadillac|lincoln|mercury|chrysler|plymouth|jeep|subaru|hyundai|kia|saturn|car|truck|van|suv|pickup|sedan|minivan|vehicle|motorcycle)[^.;\n]{0,30})/gi
  let m: RegExpExecArray | null
  while ((m = entryPat.exec(text)) !== null) {
    const val = m[1].trim().replace(/\s+/g, ' ').toLowerCase()
    if (val.length > 3 && !results.some(r => r.value === val))
      results.push({ value: val, snippet: m[0].trim() })
  }
  // "[color] [make]" or "[color] [type]" standalone
  for (const color of VEHICLE_COLORS) {
    for (const mt of [...VEHICLE_MAKES, ...VEHICLE_TYPES]) {
      const pat = new RegExp(`\\b(${color}[\\s-]+${mt}\\b[^.;,\\n]{0,20})`, 'gi')
      while ((m = pat.exec(text)) !== null) {
        const val = m[1].trim().toLowerCase()
        if (!results.some(r => r.value === val))
          results.push({ value: val, snippet: m[0].trim() })
      }
    }
  }
  return results.slice(0, 5)
}

const NAME_CONTEXT_PATS = [
  /(?:last seen with|seen with|was with|left with|accompanied by|met with|in company of)\s+([A-Z][a-z]+ (?:[A-Z][a-z']+\s?)+)/g,
  /(?:boyfriend named?|girlfriend named?|friend named?|man named?|woman named?|male named?|female named?)\s+([A-Z][a-z]+ (?:[A-Z][a-z']+\s?)+)/g,
]

function extractPersonNames(text: string): { value: string; snippet: string }[] {
  const results: { value: string; snippet: string }[] = []
  for (const pat of NAME_CONTEXT_PATS) {
    const re = new RegExp(pat.source, pat.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const val = m[1].trim()
      if (val.split(' ').length >= 2 && val.length > 5 && !results.some(r => r.value === val))
        results.push({ value: val, snippet: m[0].trim() })
    }
  }
  return results.slice(0, 5)
}

// ─── Destination extraction ──────────────────────────────────────────────────
// Extracts "believed to be heading to" destination from circumstances text.
// Returns { text, city, state } or null if no destination found.

const DESTINATION_RE = [
  /\ben\s+route\s+to\s+([A-Z][^.,;!?\n]{2,50})/i,
  /\bheading\s+(?:to|towards|for)\s+([A-Z][^.,;!?\n]{2,50})/i,
  /\bon\s+(?:her|his|their)\s+way\s+to\s+([A-Z][^.,;!?\n]{2,50})/i,
  /\btraveling\s+(?:to|towards)\s+([A-Z][^.,;!?\n]{2,50})/i,
  /\bdriving\s+to\s+([A-Z][^.,;!?\n]{2,50})/i,
  /\bbound\s+for\s+([A-Z][^.,;!?\n]{2,50})/i,
  /\bdestination\s+(?:was|is)\s+([A-Z][^.,;!?\n]{2,50})/i,
  /\bgoing\s+to\s+(?:visit|stay|meet|see)\s+(?:\w+\s+)?(?:in|at)\s+([A-Z][^.,;!?\n]{2,50})/i,
  /\bintended\s+(?:destination|to\s+(?:go|travel|drive)(?:\s+to)?)\s+([A-Z][^.,;!?\n]{2,50})/i,
  /\bplanning\s+to\s+(?:go\s+to|travel\s+to|move\s+to|visit)\s+([A-Z][^.,;!?\n]{2,50})/i,
]

const DEST_STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  DC:'District of Columbia',
}

// Additional countries to detect as cross-border destinations
// Must use word-boundary safe patterns — "panama city" should NOT match "panama"
const FOREIGN_COUNTRIES = ['canada', 'mexico', 'united kingdom', 'england', 'france', 'germany',
  'puerto rico', 'cuba', 'haiti', 'dominican republic', 'colombia', 'brazil', 'venezuela', 'honduras',
  'guatemala', 'el salvador', 'nicaragua', 'costa rica', 'jamaica']

function extractDestination(circumstances: string | null): { text: string; city: string | null; state: string | null } | null {
  if (!circumstances) return null
  for (const re of DESTINATION_RE) {
    const m = circumstances.match(re)
    if (!m) continue
    const raw = m[1].trim().replace(/\s*[.!?]$/, '')

    // Try "City, State" format first
    const parts = raw.split(',').map(s => s.trim())
    const city = parts[0] || null
    let state: string | null = null
    if (parts[1]) {
      const w = parts[1].split(' ')[0].toUpperCase()
      state = DEST_STATE_NAMES[w] ?? parts[1]
    }

    // If no state found via comma, search the full raw text for a state name
    // e.g. "Elephant Butte Reservoir in southern New Mexico"
    if (!state) {
      const rawLower = raw.toLowerCase()
      for (const [abbr, fullName] of Object.entries(DEST_STATE_NAMES)) {
        if (rawLower.includes(fullName.toLowerCase())) { state = fullName; break }
        // Also catch " NY " / " CA " as standalone abbreviation in text
        const abbrRe = new RegExp(`\\b${abbr}\\b`)
        if (abbrRe.test(raw)) { state = fullName; break }
      }
    }

    // Check for foreign country mentions (word-boundary match to avoid "Panama City" → "panama")
    if (!state) {
      const rawLower = raw.toLowerCase()
      for (const country of FOREIGN_COUNTRIES) {
        const re = new RegExp(`\\b${country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
        if (re.test(rawLower)) { state = country; break }
      }
    }

    if (city && city.length >= 2) {
      return { text: m[0].trim(), city, state }
    }
  }
  return null
}

// ─── Paginated fetch — Supabase PostgREST caps at max-rows (usually 1 000) ────
// Fetches all submissions in 1 000-row pages and merges them.

async function fetchAllSubmissions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  caseId: string,
): Promise<RawSubmission[]> {
  const PAGE = 1000
  const all: RawSubmission[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('submissions')
      .select('id, raw_text, notes')
      .eq('case_id', caseId)
      .range(from, from + PAGE - 1)
    if (error || !data?.length) break
    all.push(...(data as RawSubmission[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

// ─── API handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Internal script access: X-Internal-Key header with service role key bypasses cookie auth
  const internalKey = req.headers.get('x-internal-key')
  const isInternal  = internalKey && internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY

  let supabase: Awaited<ReturnType<typeof createClient>>
  if (isInternal) {
    const { createClient: createSvcClient } = await import('@supabase/supabase-js')
    supabase = createSvcClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    ) as unknown as Awaited<ReturnType<typeof createClient>>
  } else {
    supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { action, missingCaseId, unidentifiedCaseId, offset = 0, limit = 400, clusterId } = body

  if (!missingCaseId && action !== 'synthesize_cluster') {
    return NextResponse.json({ error: 'missingCaseId required' }, { status: 400 })
  }

  // Auth check (skip for internal script calls)
  if (!isInternal) {
    const { data: { user } } = await supabase.auth.getUser()
    const caseIdToCheck = missingCaseId ?? ''
    if (caseIdToCheck && user) {
      const { data: roleData } = await supabase
        .from('case_user_roles').select('role')
        .eq('case_id', caseIdToCheck).eq('user_id', user.id).single()
      if (!roleData || !['lead_investigator', 'admin'].includes((roleData as { role: string }).role)) {
        return NextResponse.json({ error: 'Forbidden — lead investigator or admin only' }, { status: 403 })
      }
    }
  }

  // ── MANUAL LINK ──────────────────────────────────────────────────────────────
  if (action === 'manual_link') {
    const { missingSubmissionId, unidentifiedSubmissionId, unidentifiedCaseId: unidCaseId } = body
    if (!missingSubmissionId || !unidentifiedSubmissionId) {
      return NextResponse.json({ error: 'missingSubmissionId and unidentifiedSubmissionId required' }, { status: 400 })
    }

    const [{ data: mRow }, { data: uRow }] = await Promise.all([
      supabase.from('submissions' as never).select('id, raw_text, notes').eq('id', missingSubmissionId as never).single() as unknown as Promise<{ data: { id: string; raw_text: string; notes: string | null } | null }>,
      supabase.from('submissions' as never).select('id, raw_text, notes').eq('id', unidentifiedSubmissionId as never).single() as unknown as Promise<{ data: { id: string; raw_text: string; notes: string | null } | null }>,
    ])
    if (!mRow || !uRow) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

    const mp = parseSubmission(mRow)
    const up = parseSubmission(uRow)

    const { error } = await supabase.from('doe_match_candidates' as never).upsert({
      missing_submission_id:      missingSubmissionId,
      unidentified_submission_id: unidentifiedSubmissionId,
      missing_case_id:            missingCaseId,
      unidentified_case_id:       unidCaseId ?? null,
      composite_score:            999,
      grade:                      'manual',
      signals:                    { manual: true },
      match_type:                 'manual_link',
      reviewer_status:            'confirmed',
      missing_doe_id:             mp.doeId,
      missing_name:               mp.name,
      missing_sex:                mp.sex,
      missing_race:               mp.race,
      missing_age:                mp.age,
      missing_location:           mp.location,
      missing_date:               mp.date,
      missing_hair:               mp.hair,
      missing_eyes:               mp.eyes,
      missing_marks:              mp.marks,
      unidentified_doe_id:        up.doeId,
      unidentified_sex:           up.sex,
      unidentified_race:          up.race,
      unidentified_age:           up.age,
      unidentified_location:      up.location,
      unidentified_date:          up.date,
      unidentified_hair:          up.hair,
      unidentified_eyes:          up.eyes,
      unidentified_marks:         up.marks,
    } as never, {
      onConflict: 'missing_submission_id,unidentified_submission_id',
      ignoreDuplicates: false,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'manual_link' })
  }

  // ── CROSS MATCH ──────────────────────────────────────────────────────────────
  if (action === 'cross_match') {
    if (!unidentifiedCaseId) return NextResponse.json({ error: 'unidentifiedCaseId required' }, { status: 400 })

    const { data: unidentifiedRaw } = await supabase
      .from('submissions').select('id, raw_text, notes').eq('case_id', unidentifiedCaseId)
    const unidentifiedParsed = (unidentifiedRaw ?? []).map(parseSubmission)

    const { data: missingRaw, count: totalCount } = await supabase
      .from('submissions').select('id, raw_text, notes', { count: 'exact' })
      .eq('case_id', missingCaseId).range(offset, offset + limit - 1)
    const missingParsed = (missingRaw ?? []).map(parseSubmission)
    const total = totalCount ?? 0

    const missingSubIds = missingParsed.map(p => p.submissionId)
    const { data: existingMatches } = await supabase
      .from('doe_match_candidates' as never)
      .select('missing_submission_id, unidentified_submission_id, reviewer_status')
      .in('missing_submission_id', missingSubIds)

    type ExistingMatch = { missing_submission_id: string; unidentified_submission_id: string; reviewer_status: string }
    const existingList = (existingMatches ?? []) as ExistingMatch[]

    // Only skip pairs that have been human-reviewed — unreviewed pairs will be rescored
    const reviewedPairs = new Set(
      existingList
        .filter(e => e.reviewer_status !== 'unreviewed')
        .map(e => `${e.missing_submission_id}__${e.unidentified_submission_id}`)
    )
    // Delete existing unreviewed pairs for this batch so we can reinsert with corrected scores
    const unreviewedSubIds = [...new Set(
      existingList.filter(e => e.reviewer_status === 'unreviewed').map(e => e.missing_submission_id)
    )]
    if (unreviewedSubIds.length > 0) {
      for (let i = 0; i < unreviewedSubIds.length; i += 50) {
        await supabase
          .from('doe_match_candidates' as never)
          .delete()
          .in('missing_submission_id', unreviewedSubIds.slice(i, i + 50) as never)
          .eq('reviewer_status', 'unreviewed')
      }
    }

    const toInsert: object[] = []
    let eliminated = 0

    for (const missing of missingParsed) {
      for (const uid of unidentifiedParsed) {
        if (reviewedPairs.has(`${missing.submissionId}__${uid.submissionId}`)) continue
        const result = scoreMatch(missing, uid)
        if (result.eliminated) { eliminated++; continue }
        if (result.composite < 22) continue

        toInsert.push({
          missing_submission_id:      missing.submissionId,
          unidentified_submission_id: uid.submissionId,
          missing_case_id:            missingCaseId,
          unidentified_case_id:       unidentifiedCaseId,
          composite_score:            result.composite,
          grade:                      result.grade,
          signals:                    result.signals,
          missing_doe_id:             missing.doeId,
          missing_name:               missing.name,
          missing_sex:                missing.sex,
          missing_race:               missing.race,
          missing_age:                missing.age,
          missing_location:           missing.location,
          missing_date:               missing.date,
          missing_hair:               missing.hair,
          missing_eyes:               missing.eyes,
          missing_marks:              missing.marks,
          unidentified_doe_id:        uid.doeId,
          unidentified_sex:           uid.sex,
          unidentified_race:          uid.race,
          unidentified_age:           uid.age,
          unidentified_location:      uid.location,
          unidentified_date:          uid.date,
          unidentified_hair:          uid.hair,
          unidentified_eyes:          uid.eyes,
          unidentified_marks:         uid.marks,
        })
      }
    }

    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 100) {
      const { error } = await supabase
        .from('doe_match_candidates' as never)
        .upsert(toInsert.slice(i, i + 100) as never, {
          onConflict: 'missing_submission_id,unidentified_submission_id',
          ignoreDuplicates: false,
        })
      if (!error) inserted += Math.min(100, toInsert.length - i)
    }

    const processed = offset + missingParsed.length
    return NextResponse.json({ action: 'cross_match', processed, total, hasMore: processed < total, newMatches: inserted, eliminated, nextOffset: processed })
  }

  // ── DESTINATION ROUTE MATCH ──────────────────────────────────────────────────
  // Same scoring as cross_match. Location signal uses destination (where the
  // missing person was believed to be heading) instead of last-known location.
  // Pre-filters unidentified remains to destination state to reduce noise.
  if (action === 'destination_route_match') {
    if (!unidentifiedCaseId) return NextResponse.json({ error: 'unidentifiedCaseId required' }, { status: 400 })

    // Fetch all missing persons and filter to those with cross-state destinations
    // Only include if destination state is identified AND differs from home state
    // (local/in-state travel is handled by standard cross_match)
    const missingRaw = await fetchAllSubmissions(supabase, missingCaseId)
    const missingParsed = missingRaw.map(parseSubmission)
      .filter(p => {
        const dest = extractDestination(p.circumstances)
        if (!dest) return false
        // Must have identified a destination state
        if (!dest.state) return false
        // Destination must differ from home state (cross-state travel)
        if (p.state) {
          const homeNorm = p.state.toLowerCase().trim()
          const destNorm = dest.state.toLowerCase().trim()
          if (homeNorm === destNorm) return false
        }
        return true
      })

    if (!missingParsed.length) {
      return NextResponse.json({ action: 'destination_route_match', processed: 0, total: 0, inserted: 0, hasMore: false })
    }

    // Fetch all unidentified remains
    const unidentRaw = await fetchAllSubmissions(supabase, unidentifiedCaseId)
    const unidentParsed = unidentRaw.map(parseSubmission)

    // Paginate through missing persons with destinations
    const total = missingParsed.length
    const batch = missingParsed.slice(offset, offset + limit)
    let inserted = 0
    let eliminated = 0
    const toInsert: object[] = []

    // Delete existing destination_route_match candidates for this page's missing persons
    const batchIds = batch.map(p => p.submissionId)
    if (batchIds.length) {
      await supabase.from('doe_match_candidates' as never)
        .delete()
        .in('missing_submission_id', batchIds as never)
        .eq('match_type', 'destination_route_match' as never)
    }

    for (const missing of batch) {
      const dest = extractDestination(missing.circumstances)
      if (!dest) continue

      // Build a proxy ParsedCase with destination as location for scoring
      const destProxy: ParsedCase = {
        ...missing,
        location: dest.city ? `${dest.city}${dest.state ? ', ' + dest.state : ''}` : missing.location,
        state: dest.state ? extractState(dest.state) ?? missing.state : missing.state,
      }

      // Filter unidentified to destination state (or all if state unknown)
      const destStateAbbr = destProxy.state
      const candidates = destStateAbbr
        ? unidentParsed.filter(u => !u.state || u.state.toLowerCase() === destStateAbbr.toLowerCase())
        : unidentParsed

      for (const unident of candidates) {
        // Hard eliminate sex mismatch
        const sexA = normSex(missing.sex), sexB = normSex(unident.sex)
        if (sexA && sexB && sexA !== sexB) { eliminated++; continue }

        // Hard eliminate temporal impossibility — remains found before person went missing
        if (unident.year && missing.year && (
          unident.year < missing.year ||
          (unident.year === missing.year && missing.month && unident.month && unident.month < missing.month)
        )) { eliminated++; continue }

        // Hard eliminate race mismatch
        const raceA = normRace(missing.race), raceB = normRace(unident.race)
        if (raceA && raceB && raceA !== raceB) { eliminated++; continue }

        // Hard eliminate large age gap (> 12 years mid-point to mid-point)
        const ageRangeA = parseAgeRange(missing.age), ageRangeB = parseAgeRange(unident.age)
        if (ageRangeA && ageRangeB) {
          const midA = (ageRangeA[0] + ageRangeA[1]) / 2
          const midB = (ageRangeB[0] + ageRangeB[1]) / 2
          if (Math.abs(midA - midB) > 12) { eliminated++; continue }
        }

        const signals: MatchSignals = {
          sex:        scoreSex(missing, unident),
          race:       scoreRace(missing, unident),
          age:        scoreAge(missing, unident),
          hair:       scoreHair(missing, unident),
          eyes:       scoreEyes(missing, unident),
          height:     scoreHeight(missing, unident),
          weight:     scoreWeight(missing, unident),
          tattoo:     scoreTattoos(missing, unident),
          body_marks: scoreBodyMarks(missing, unident),
          jewelry:    scoreJewelry(missing, unident),
          location:   scoreLocation(destProxy, unident),   // <-- destination proxy
          childbirth: scoreChildbirth(missing, unident),
          time_gap:   scoreTimeGap(missing, unident),
        }

        // Apply body state decomposition weighting
        const bsBodyState = unident.bodyState
        const bsW = DECOMP_WEIGHTS[bsBodyState]
        const bsNote = DECOMP_NOTES[bsBodyState]
        signals.hair       = { ...signals.hair,       score: Math.round(signals.hair.score       * bsW.hair)       }
        signals.eyes       = { ...signals.eyes,       score: Math.round(signals.eyes.score       * bsW.eyes)       }
        signals.weight     = { ...signals.weight,     score: Math.round(signals.weight.score     * bsW.weight)     }
        signals.tattoo     = { ...signals.tattoo,     score: Math.round(signals.tattoo.score     * bsW.tattoo)     }
        signals.body_marks = { ...signals.body_marks, score: Math.round(signals.body_marks.score * bsW.body_marks) }
        if (bsBodyState !== 'intact' && bsBodyState !== 'unknown') {
          signals.body_state = { state: bsBodyState, note: bsNote, weight_applied: true }
        }

        const composite = Object.values(signals).reduce((sum, s) => {
          if (s && typeof s === 'object' && 'score' in s) return sum + (s as SignalResult).score
          return sum
        }, 0)

        // Route matches require a higher baseline — sex+race already confirmed above,
        // so we expect more meaningful signal before storing
        if (composite < 35) { eliminated++; continue }

        const grade = composite >= 70 ? 'very_strong' : composite >= 55 ? 'strong' : composite >= 40 ? 'notable' : 'moderate'

        toInsert.push({
          missing_case_id:                missingCaseId,
          unidentified_case_id:           unidentifiedCaseId,
          missing_submission_id:          missing.submissionId,
          unidentified_submission_id:     unident.submissionId,
          composite_score:                composite,
          grade,
          signals:                        signals as unknown as Record<string, unknown>,
          missing_doe_id:                 missing.doeId,
          missing_name:                   missing.name,
          missing_sex:                    missing.sex,
          missing_race:                   missing.race,
          missing_age:                    missing.age,
          missing_location:               missing.location,
          missing_date:                   missing.date,
          missing_hair:                   missing.hair,
          missing_eyes:                   missing.eyes,
          missing_marks:                  missing.marks,
          missing_jewelry:                missing.jewelry,
          unidentified_doe_id:            unident.doeId,
          unidentified_sex:               unident.sex,
          unidentified_race:              unident.race,
          unidentified_age:               unident.age,
          unidentified_location:          unident.location,
          unidentified_date:              unident.date,
          unidentified_hair:              unident.hair,
          unidentified_eyes:              unident.eyes,
          unidentified_marks:             unident.marks,
          unidentified_jewelry:           unident.jewelry,
          reviewer_status:                'unreviewed',
          match_type:                     'destination_route_match',
          destination_text:               dest.text,
          destination_city:               dest.city,
          destination_state:              dest.state,
        })
      }
    }

    // Batch upsert (safe to re-run)
    for (let i = 0; i < toInsert.length; i += 200) {
      const { error } = await supabase.from('doe_match_candidates' as never)
        .upsert(toInsert.slice(i, i + 200) as never, {
          onConflict: 'missing_submission_id,unidentified_submission_id',
          ignoreDuplicates: false,
        })
      if (!error) inserted += Math.min(200, toInsert.length - i)
    }

    const processed = offset + batch.length
    const hasMore = processed < total
    return NextResponse.json({
      action: 'destination_route_match',
      processed,
      total,
      hasMore,
      nextOffset: processed,
      newMatches: inserted,
      eliminated,
    })
  }

  // ── DEMOGRAPHIC / TEMPORAL CLUSTER ───────────────────────────────────────────
  if (action === 'cluster') {
    const parsed = (await fetchAllSubmissions(supabase, missingCaseId)).map(parseSubmission)

    const { data: oldDT } = await supabase.from('doe_victimology_clusters' as never)
      .select('id').eq('case_id', missingCaseId).eq('cluster_type', 'demographic_temporal') as { data: Array<{ id: string }> | null }
    if (oldDT?.length) {
      await supabase.from('doe_cluster_members' as never).delete().in('cluster_id', oldDT.map(c => c.id))
      await supabase.from('doe_victimology_clusters' as never).delete().in('id', oldDT.map(c => c.id))
    }

    const buckets = new Map<string, ParsedCase[]>()
    for (const p of parsed) {
      const sex   = normSex(p.sex)  ?? 'unknown'
      const race  = normRace(p.race) ?? 'unknown'
      const ag    = ageGroup(p.age)
      const state = p.state ?? 'unknown'
      if (sex === 'unknown' && race === 'unknown' && ag === 'unknown') continue
      const key = `${sex}|${race}|${ag}|${state}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(p)
    }

    const toInsert: object[] = []
    const memberRowsDT: object[] = []

    for (const [key, subs] of buckets) {
      if (subs.length < 3) continue
      const [sex, race, ag, state] = key.split('|')

      const monthCounts: Record<number, number> = {}
      const seasonCounts: Record<string, number> = {}
      for (const s of subs) {
        if (s.month) { monthCounts[s.month] = (monthCounts[s.month] ?? 0) + 1 }
        const season = seasonOf(s.month)
        if (season) { seasonCounts[season] = (seasonCounts[season] ?? 0) + 1 }
      }

      let temporalPattern: string | null = null, temporalCount = 0
      for (const [m, c] of Object.entries(monthCounts)) {
        if (c >= 2 && c > temporalCount) { temporalPattern = MONTH_NAMES[parseInt(m)]; temporalCount = c }
      }
      if (!temporalPattern) {
        for (const [s, c] of Object.entries(seasonCounts)) {
          if (c >= 3 && c > temporalCount) { temporalPattern = s; temporalCount = c }
        }
      }

      const years = subs.map(s => s.year).filter(Boolean) as number[]
      const yearMin = years.length ? Math.min(...years) : null
      const yearMax = years.length ? Math.max(...years) : null
      if (yearMin && yearMax && yearMax - yearMin > 25) continue // 25-year cap
      const ageGroupLabel: Record<string, string> = { child: 'children', teen: 'teens', young_adult: 'young adults', adult: 'adults', middle_age: 'middle-aged', senior: 'seniors' }
      const yearSpan = yearMin && yearMax && yearMin !== yearMax ? ` (${yearMin}–${yearMax})` : yearMax ? ` (${yearMax})` : ''
      const temporal = temporalPattern ? `, ${temporalPattern} pattern` : ''
      const stateLabel = state !== 'unknown' ? `, ${state}` : ''
      const raceLabel = race === 'unknown' ? 'unknown race' : race
      const sexAgLabel = sex === 'unknown' ? 'persons' : `${sex} ${ageGroupLabel[ag] ?? ag}`
      const label = `${subs.length} ${raceLabel} ${sexAgLabel}${stateLabel}${yearSpan}${temporal}`
      const clusterId = crypto.randomUUID()
      const confidence = Math.min(0.85, 0.55 + subs.length * 0.01)

      toInsert.push({
        id: clusterId,
        case_id: missingCaseId, cluster_label: label, cluster_type: 'demographic_temporal',
        sex: sex === 'unknown' ? null : sex, race: race === 'unknown' ? null : race,
        age_group: ag === 'unknown' ? null : ag, state: state === 'unknown' ? null : state,
        temporal_pattern: temporalPattern, year_span_start: yearMin, year_span_end: yearMax,
        case_count: subs.length, submission_ids: subs.map(s => s.submissionId),
        signals: { month_counts: monthCounts, season_counts: seasonCounts, temporal_count: temporalCount },
      })

      for (const sub of subs) {
        memberRowsDT.push({
          cluster_id: clusterId, submission_id: sub.submissionId, case_id: missingCaseId,
          confidence: Math.round(confidence * 1000) / 1000,
          confidence_reason: `${raceLabel} ${sexAgLabel}, ${state !== 'unknown' ? state : 'unknown state'}`,
          membership_status: 'candidate',
          member_name: sub.name, member_doe_id: sub.doeId, member_location: sub.location,
          member_date: sub.date, member_age: sub.age, member_sex: sub.sex,
        })
      }
    }

    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('doe_victimology_clusters' as never).insert(toInsert.slice(i, i + 50) as never)
      if (!error) inserted += Math.min(50, toInsert.length - i)
    }
    for (let i = 0; i < memberRowsDT.length; i += 200) {
      await supabase.from('doe_cluster_members' as never).insert(memberRowsDT.slice(i, i + 200) as never)
    }

    return NextResponse.json({ action: 'cluster', clustersInserted: inserted, membersInserted: memberRowsDT.length, totalSubmissions: parsed.length })
  }

  // ── CIRCUMSTANCE CLUSTERING ───────────────────────────────────────────────────
  if (action === 'circumstance_cluster') {
    const parsed = (await fetchAllSubmissions(supabase, missingCaseId)).map(parseSubmission)

    // Extract signals for each case
    const caseSignals = parsed.map(p => ({ p, signals: extractCircumstanceSignals(p) }))
      .filter(({ signals }) => signals.length > 0)

    // Clear old circumstance clusters and their members
    const { data: oldCS } = await supabase.from('doe_victimology_clusters' as never)
      .select('id').eq('case_id', missingCaseId).eq('cluster_type', 'circumstance_signal') as { data: Array<{ id: string }> | null }
    if (oldCS?.length) {
      await supabase.from('doe_cluster_members' as never).delete().in('cluster_id', oldCS.map(c => c.id))
      await supabase.from('doe_victimology_clusters' as never).delete().in('id', oldCS.map(c => c.id))
    }

    // Build clusters: for each signal, find all cases that have it + additional signals
    const signalToSubmissions = new Map<string, ParsedCase[]>()
    for (const { p, signals } of caseSignals) {
      for (const sig of signals) {
        if (!signalToSubmissions.has(sig)) signalToSubmissions.set(sig, [])
        signalToSubmissions.get(sig)!.push(p)
      }
    }

    const toInsert: object[] = []
    const memberRowsCS: object[] = []

    for (const [primarySignal, subs] of signalToSubmissions) {
      if (subs.length < 3) continue
      const def = CIRCUMSTANCE_SIGNALS[primarySignal]
      if (!def) continue

      // Count co-occurring signals within this group
      const coSignalCounts = new Map<string, number>()
      const allSubIds = new Set(subs.map(s => s.submissionId))
      for (const { p, signals } of caseSignals) {
        if (!allSubIds.has(p.submissionId)) continue
        for (const sig of signals) {
          if (sig !== primarySignal) coSignalCounts.set(sig, (coSignalCounts.get(sig) ?? 0) + 1)
        }
      }

      // Top co-occurring signals
      const topCoSignals = [...coSignalCounts.entries()]
        .filter(([, count]) => count >= Math.ceil(subs.length * 0.3))
        .sort(([, a], [, b]) => b - a).slice(0, 4).map(([sig]) => sig)

      const years = subs.map(s => s.year).filter(Boolean) as number[]
      const yearMin = years.length ? Math.min(...years) : null
      const yearMax = years.length ? Math.max(...years) : null
      if (yearMin && yearMax && yearMax - yearMin > 25) continue // 25-year cap

      // Build label
      const coLabels = topCoSignals.map(s => CIRCUMSTANCE_SIGNALS[s]?.label ?? s).join(', ')
      const yearSpan = yearMin && yearMax && yearMin !== yearMax ? ` (${yearMin}–${yearMax})` : yearMax ? ` (${yearMax})` : ''
      const label = `${subs.length} cases: ${def.label}${coLabels ? ` + ${coLabels}` : ''}${yearSpan}`
      const clusterId = crypto.randomUUID()
      const confidence = Math.min(0.88, 0.60 + subs.length * 0.01)

      toInsert.push({
        id: clusterId,
        case_id: missingCaseId,
        cluster_label: label,
        cluster_type: 'circumstance_signal',
        primary_signal: primarySignal,
        signal_category: def.category,
        matched_signals: [primarySignal, ...topCoSignals],
        case_count: subs.length,
        submission_ids: subs.map(s => s.submissionId),
        signals: {
          primary_signal: primarySignal,
          primary_label: def.label,
          co_signals: Object.fromEntries(coSignalCounts),
          top_co_signals: topCoSignals,
          year_min: yearMin,
          year_max: yearMax,
        },
      })

      for (const sub of subs) {
        memberRowsCS.push({
          cluster_id: clusterId, submission_id: sub.submissionId, case_id: missingCaseId,
          confidence: Math.round(confidence * 1000) / 1000,
          confidence_reason: `Circumstances match: ${def.label}`,
          membership_status: 'candidate',
          member_name: sub.name, member_doe_id: sub.doeId, member_location: sub.location,
          member_date: sub.date, member_age: sub.age, member_sex: sub.sex,
        })
      }
    }

    // Sort by case_count desc
    toInsert.sort((a, b) => (b as { case_count: number }).case_count - (a as { case_count: number }).case_count)

    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('doe_victimology_clusters' as never).insert(toInsert.slice(i, i + 50) as never)
      if (!error) inserted += Math.min(50, toInsert.length - i)
    }
    for (let i = 0; i < memberRowsCS.length; i += 200) {
      await supabase.from('doe_cluster_members' as never).insert(memberRowsCS.slice(i, i + 200) as never)
    }

    return NextResponse.json({
      action: 'circumstance_cluster',
      clustersInserted: inserted,
      membersInserted: memberRowsCS.length,
      signalsFound: signalToSubmissions.size,
      totalSubmissions: parsed.length,
      casesWithSignals: caseSignals.length,
    })
  }

  // ── AI NARRATIVE SYNTHESIS ────────────────────────────────────────────────────
  if (action === 'synthesize_cluster') {
    if (!clusterId) return NextResponse.json({ error: 'clusterId required' }, { status: 400 })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })

    // Fetch the cluster
    const { data: cluster } = await supabase
      .from('doe_victimology_clusters' as never)
      .select('*').eq('id', clusterId).single()

    if (!cluster) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })

    const c = cluster as {
      cluster_label: string; cluster_type: string; submission_ids: string[]
      signals: Record<string, unknown>; primary_signal?: string; matched_signals?: string[]
    }

    // Fetch the circumstances text for up to 12 cases in this cluster
    const subIds = (c.submission_ids ?? []).slice(0, 12)
    const { data: subs } = await supabase
      .from('submissions').select('raw_text, notes').in('id', subIds)

    const caseSummaries = (subs ?? []).map((s: { raw_text: string; notes: string | null }, i: number) => {
      const p = parseSubmission({ id: `${i}`, raw_text: s.raw_text, notes: s.notes })
      const signals = extractCircumstanceSignals(p)
      return [
        `Case ${i + 1}: ${p.name ?? 'Unknown'}, ${p.sex ?? '?'}, ${p.race ?? '?'}, age ${p.age ?? '?'}`,
        `  Last seen: ${p.location ?? 'unknown'}, ${p.date ?? 'unknown date'}`,
        p.circumstances ? `  Circumstances: ${p.circumstances.slice(0, 300)}` : null,
        signals.length ? `  Signals: ${signals.join(', ')}` : null,
      ].filter(Boolean).join('\n')
    }).join('\n\n')

    const anthropic = new Anthropic({ apiKey, timeout: 45_000 })

    const prompt = [
      `You are an analyst assisting investigative researchers reviewing missing persons case patterns.`,
      `The following is a cluster of ${c.submission_ids.length} missing persons cases that share the pattern: "${c.cluster_label}"`,
      ``,
      `Here are summaries of up to 12 cases in this cluster:`,
      ``,
      caseSummaries,
      ``,
      `Write a concise investigative analysis (3–5 sentences) covering:`,
      `1. What the cases have in common and why this pattern may be significant`,
      `2. What the shared signals suggest about vulnerability factors or circumstances`,
      `3. What an investigator should look for or verify across these cases`,
      ``,
      `Then rate the strength of the connection between these cases on a scale of 1–5:`,
      `1 — Ignore: coincidental overlap, no meaningful investigative link`,
      `2 — Slim connection: surface-level similarity only`,
      `3 — Some connection: partial alignment, worth noting`,
      `4 — Strong connection: meaningful shared signals, warrants investigation`,
      `5 — Very strong connection: specific and unusual overlap, top priority (reserve for top 5–10% of clusters)`,
      ``,
      `Respond in this exact JSON format:`,
      `{`,
      `  "narrative": "Your 3–5 sentence analysis here...",`,
      `  "connection_level": 3`,
      `}`,
      ``,
      `Be specific and factual. Do not speculate about perpetrators. Do not state conclusions — only surface patterns for human review.`,
    ].join('\n')

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
    if (!raw) return NextResponse.json({ error: 'AI did not return a response' }, { status: 500 })

    let narrative = raw
    let connectionLevel: number | null = null
    try {
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) {
        const parsed = JSON.parse(m[0])
        narrative = parsed.narrative ?? raw
        const lvl = parseInt(String(parsed.connection_level ?? ''))
        if (!isNaN(lvl)) connectionLevel = Math.max(1, Math.min(5, lvl))
      }
    } catch { /* use raw text as narrative */ }

    const updatedSignals = { ...(c.signals ?? {}), connection_level: connectionLevel }
    await supabase.from('doe_victimology_clusters' as never).update({
      ai_narrative: narrative,
      ai_generated_at: new Date().toISOString(),
      signals: updatedSignals,
    } as never).eq('id', clusterId)

    return NextResponse.json({ narrative, connection_level: connectionLevel })
  }

  // ── CONFIRM DOE SUBMISSIONS ─────────────────────────────────────────────────
  if (action === 'confirm_doe_submissions') {
    const { error } = await supabase
      .from('submissions')
      .update({ review_status: 'confirmed' } as never)
      .eq('case_id', missingCaseId)
      .neq('review_status', 'confirmed')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ action: 'confirm_doe_submissions', ok: true })
  }

  // ── SAME DATE CLUSTER ────────────────────────────────────────────────────────
  if (action === 'same_date_cluster') {
    const subs = await fetchAllSubmissions(supabase, missingCaseId)
    if (!subs.length) return NextResponse.json({ error: 'No submissions found' }, { status: 404 })

    const parsed = (subs as RawSubmission[]).map(parseSubmission).filter(p => p.year && p.state)

    // Group 1 — same state + same 7-day window
    const weekBuckets = new Map<string, ParsedCase[]>()
    for (const p of parsed) {
      if (!p.year || !p.month || !p.state) continue
      const dayMatch = p.date?.match(/\b(\d{1,2})[,\s]+\d{4}/)
      const day = dayMatch ? parseInt(dayMatch[1]) : 15
      const weekNum = Math.floor(new Date(p.year, p.month - 1, day).getTime() / (7 * 86_400_000))
      const key = `${p.state}_${weekNum}`
      if (!weekBuckets.has(key)) weekBuckets.set(key, [])
      weekBuckets.get(key)!.push(p)
    }

    // Group 2 — same state + same month, recurring across multiple years
    const monthBuckets = new Map<string, ParsedCase[]>()
    for (const p of parsed) {
      if (!p.year || !p.month || !p.state) continue
      const key = `${p.state}_m${p.month}`
      if (!monthBuckets.has(key)) monthBuckets.set(key, [])
      monthBuckets.get(key)!.push(p)
    }

    const toInsert: object[] = []
    const memberRowsSD: object[] = []

    for (const [key, cases] of weekBuckets) {
      if (cases.length < 2) continue
      const [state] = key.split('_')
      const years = [...new Set(cases.map(c => c.year).filter(Boolean) as number[])]
      const yearMin = Math.min(...years), yearMax = Math.max(...years)
      if (yearMax - yearMin > 25) continue // 25-year cap
      const s = cases[0]
      const clusterId = crypto.randomUUID()
      toInsert.push({
        id: clusterId,
        case_id: missingCaseId,
        cluster_label: `${cases.length} cases: ${state}, same week ${s.month ? MONTH_NAMES[s.month] : ''} ${years.length === 1 ? years[0] : `${yearMin}–${yearMax}`}`,
        cluster_type: 'same_date_proximity',
        state,
        case_count: cases.length,
        year_span_start: yearMin,
        year_span_end: yearMax,
        submission_ids: cases.map(c => c.submissionId),
        signals: { pattern: 'same_week', state, month: s.month, years: years.sort() },
      })
      for (const c of cases) {
        memberRowsSD.push({
          cluster_id: clusterId, submission_id: c.submissionId, case_id: missingCaseId,
          confidence: 0.70, confidence_reason: `Same-week disappearance, ${state}`,
          membership_status: 'candidate',
          member_name: c.name, member_doe_id: c.doeId, member_location: c.location,
          member_date: c.date, member_age: c.age, member_sex: c.sex,
        })
      }
    }

    for (const [key, cases] of monthBuckets) {
      if (cases.length < 3) continue
      const [state, monthStr] = key.split('_m')
      const month = parseInt(monthStr)
      const years = [...new Set(cases.map(c => c.year).filter(Boolean) as number[])].sort((a, b) => a - b)
      if (years.length < 2) continue
      if (years[years.length - 1] - years[0] > 25) continue // 25-year cap
      const season = seasonOf(month)
      const clusterId = crypto.randomUUID()
      toInsert.push({
        id: clusterId,
        case_id: missingCaseId,
        cluster_label: `${cases.length} cases: ${state}, ${MONTH_NAMES[month]} disappearances, ${years[0]}–${years[years.length - 1]}`,
        cluster_type: 'same_date_proximity',
        state,
        temporal_pattern: season ? `recurring_${season}` : `recurring_${MONTH_NAMES[month].toLowerCase()}`,
        case_count: cases.length,
        year_span_start: years[0],
        year_span_end: years[years.length - 1],
        submission_ids: cases.map(c => c.submissionId),
        signals: { pattern: 'recurring_month', state, month, season, year_count: years.length, years },
      })
      for (const c of cases) {
        memberRowsSD.push({
          cluster_id: clusterId, submission_id: c.submissionId, case_id: missingCaseId,
          confidence: 0.65, confidence_reason: `Recurring ${MONTH_NAMES[month]} disappearance, ${state}`,
          membership_status: 'candidate',
          member_name: c.name, member_doe_id: c.doeId, member_location: c.location,
          member_date: c.date, member_age: c.age, member_sex: c.sex,
        })
      }
    }

    toInsert.sort((a, b) =>
      (b as { case_count: number }).case_count - (a as { case_count: number }).case_count)

    // Clear old clusters and members, then re-insert
    const { data: oldSD } = await supabase.from('doe_victimology_clusters' as never)
      .select('id').eq('case_id', missingCaseId).eq('cluster_type', 'same_date_proximity') as { data: Array<{ id: string }> | null }
    if (oldSD?.length) {
      await supabase.from('doe_cluster_members' as never).delete().in('cluster_id', oldSD.map(c => c.id))
      await supabase.from('doe_victimology_clusters' as never).delete().in('id', oldSD.map(c => c.id))
    }

    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('doe_victimology_clusters' as never)
        .insert(toInsert.slice(i, i + 50) as never)
      if (!error) inserted += Math.min(50, toInsert.length - i)
    }
    for (let i = 0; i < memberRowsSD.length; i += 200) {
      await supabase.from('doe_cluster_members' as never).insert(memberRowsSD.slice(i, i + 200) as never)
    }

    return NextResponse.json({ action: 'same_date_cluster', clustersInserted: inserted, membersInserted: memberRowsSD.length, total: toInsert.length })
  }

  // ── EXTRACT ENTITIES ─────────────────────────────────────────────────────────
  if (action === 'extract_entities') {
    const subs = await fetchAllSubmissions(supabase, missingCaseId)
    if (!subs.length) return NextResponse.json({ error: 'No submissions found' }, { status: 404 })

    // Clear existing
    await supabase.from('doe_entity_mentions' as never)
      .delete().eq('case_id', missingCaseId)
      .in('entity_type', ['person_name', 'vehicle'])

    const raw: { case_id: string; submission_id: string; entity_type: string; entity_value: string; raw_snippet: string }[] = []

    for (const sub of subs as RawSubmission[]) {
      for (const v of extractVehicles(sub.raw_text))
        raw.push({ case_id: missingCaseId, submission_id: sub.id, entity_type: 'vehicle',      entity_value: v.value, raw_snippet: v.snippet })
      for (const n of extractPersonNames(sub.raw_text))
        raw.push({ case_id: missingCaseId, submission_id: sub.id, entity_type: 'person_name', entity_value: n.value, raw_snippet: n.snippet })
    }

    // Cross-match: same entity_value in multiple submissions
    const valMap = new Map<string, string[]>()
    for (const e of raw) {
      const k = `${e.entity_type}::${e.entity_value.trim().toLowerCase()}`
      if (!valMap.has(k)) valMap.set(k, [])
      valMap.get(k)!.push(e.submission_id)
    }

    const enriched = raw.map(e => {
      const k = `${e.entity_type}::${e.entity_value.trim().toLowerCase()}`
      const others = (valMap.get(k) ?? []).filter(id => id !== e.submission_id)
      return { ...e, matched_submission_ids: others, match_count: others.length }
    })

    let inserted = 0
    for (let i = 0; i < enriched.length; i += 100) {
      const { error } = await supabase.from('doe_entity_mentions' as never)
        .insert(enriched.slice(i, i + 100) as never)
      if (!error) inserted += Math.min(100, enriched.length - i)
    }

    return NextResponse.json({
      action: 'extract_entities',
      inserted,
      vehicles:     enriched.filter(e => e.entity_type === 'vehicle').length,
      personNames:  enriched.filter(e => e.entity_type === 'person_name').length,
      crossMatches: enriched.filter(e => e.match_count > 0).length,
    })
  }

  // ── NAME DEDUPLICATION ────────────────────────────────────────────────────────
  if (action === 'name_dedup') {
    const subs = await fetchAllSubmissions(supabase, missingCaseId)
    if (!subs.length) return NextResponse.json({ error: 'No submissions found' }, { status: 404 })

    const named = (subs as RawSubmission[])
      .map(s => ({ id: s.id, p: parseSubmission(s) }))
      .filter(x => x.p.name && x.p.name.trim().length > 4)

    // Block by first char of first word + first char of last word to avoid O(n²) on 8k records
    const blocks = new Map<string, typeof named>()
    for (const x of named) {
      const words = (x.p.name ?? '').toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(w => w.length > 1)
      if (words.length < 2) continue
      const key = `${words[0][0]}${words[words.length - 1][0]}`
      if (!blocks.has(key)) blocks.set(key, [])
      blocks.get(key)!.push(x)
    }

    await supabase.from('doe_entity_mentions' as never)
      .delete().eq('case_id', missingCaseId).eq('entity_type', 'possible_duplicate')

    const pairs: object[] = []
    const seen = new Set<string>()

    for (const block of blocks.values()) {
      for (let i = 0; i < block.length; i++) {
        for (let j = i + 1; j < block.length; j++) {
          const a = block[i], b = block[j]
          if (!a.p.name || !b.p.name) continue
          const na = a.p.name.toLowerCase().replace(/[^a-z\s]/g, '').trim()
          const nb = b.p.name.toLowerCase().replace(/[^a-z\s]/g, '').trim()
          if (na === nb) continue
          const sim = jaroWinkler(na, nb)
          if (sim < 0.88) continue
          const pairKey = [a.id, b.id].sort().join('::')
          if (seen.has(pairKey)) continue
          seen.add(pairKey)
          pairs.push({
            case_id: missingCaseId,
            submission_id: a.id,
            entity_type: 'possible_duplicate',
            entity_value: `${a.p.name} ↔ ${b.p.name}`,
            raw_snippet: `Phonetic similarity ${Math.round(sim * 100)}% — possible duplicate record`,
            matched_submission_ids: [b.id],
            match_count: 1,
          })
        }
      }
    }

    let inserted = 0
    for (let i = 0; i < pairs.length; i += 100) {
      const { error } = await supabase.from('doe_entity_mentions' as never)
        .insert(pairs.slice(i, i + 100) as never)
      if (!error) inserted += Math.min(100, pairs.length - i)
    }

    return NextResponse.json({ action: 'name_dedup', pairsFound: pairs.length, inserted, compared: named.length })
  }

  // ── DETECT INVESTIGATIVE STALLS ───────────────────────────────────────────────
  if (action === 'detect_stalls') {
    const subs = await fetchAllSubmissions(supabase, missingCaseId)
    if (!subs.length) return NextResponse.json({ error: 'No submissions found' }, { status: 404 })

    // Clear previous
    await supabase.from('doe_stall_flags' as never).delete().eq('case_id', missingCaseId)

    const NOW = Date.now()
    const stalls: object[] = []
    const seenSubTypes = new Set<string>()

    for (const sub of subs as RawSubmission[]) {
      const p = parseSubmission(sub)
      const lower = (p.circumstances ?? '').toLowerCase() + ' ' + sub.raw_text.toLowerCase()

      let elapsed: number | null = null
      if (p.year) {
        const d = new Date(p.year, (p.month ?? 7) - 1, 1)
        elapsed = Math.floor((NOW - d.getTime()) / 86_400_000)
      }

      const isVoluntary = /voluntar(?:y|ily)|left voluntarily|listed as voluntary|voluntary missing/.test(lower)
      const isRunaway   = /classified as runaway|listed as runaway|marked as runaway|entered as runaway|runaway classification/.test(lower)
      const hasRunaway  = /runaway|voluntary/.test(lower)
      const ageRange    = parseAgeRange(p.age)
      const isMinor     = ageRange !== null && ageRange[1] <= 17

      const push = (type: string, label: string, classification: string, signals: string[]) => {
        const k = `${sub.id}::${type}`
        if (seenSubTypes.has(k)) return
        seenSubTypes.add(k)
        stalls.push({
          case_id: missingCaseId, submission_id: sub.id,
          stall_type: type, stall_label: label,
          elapsed_days: elapsed, classification_used: classification,
          supporting_signals: signals,
          missing_name: p.name, missing_age: p.age,
          missing_date: p.date, missing_location: p.location,
        })
      }

      if (isVoluntary && elapsed && elapsed > 180) {
        const yrs = Math.floor(elapsed / 365)
        push('voluntary_misclassification',
          `"Voluntary" classification — ${yrs}+ year${yrs !== 1 ? 's' : ''} elapsed, case still open`,
          'voluntary',
          ['voluntary_missing', elapsed > 365 ? 'open_1yr_plus' : 'open_6mo_plus'])
      }
      if (isRunaway && elapsed && elapsed > 180) {
        const yrs = Math.floor(elapsed / 365)
        push('runaway_no_followup',
          `"Runaway" classification — ${yrs}+ year${yrs !== 1 ? 's' : ''} elapsed, case still open`,
          'runaway',
          ['runaway_classification', elapsed > 365 ? 'open_1yr_plus' : 'open_6mo_plus'])
      }
      if (isMinor && hasRunaway && elapsed && elapsed > 90) {
        const yrs = Math.floor(elapsed / 365)
        push('quick_closure_young',
          `Minor (age ${p.age}) — runaway/voluntary classification, ${yrs}+ year${yrs !== 1 ? 's' : ''} open`,
          'runaway/voluntary',
          ['juvenile', 'runaway_voluntary', elapsed > 365 ? 'open_1yr_plus' : 'open_90d_plus'])
      }
    }

    let inserted = 0
    for (let i = 0; i < stalls.length; i += 100) {
      const { error } = await supabase.from('doe_stall_flags' as never)
        .insert(stalls.slice(i, i + 100) as never)
      if (!error) inserted += Math.min(100, stalls.length - i)
    }

    return NextResponse.json({
      action: 'detect_stalls',
      detected: stalls.length,
      inserted,
      voluntary: stalls.filter((s: unknown) => (s as { stall_type: string }).stall_type === 'voluntary_misclassification').length,
      runaway:   stalls.filter((s: unknown) => (s as { stall_type: string }).stall_type === 'runaway_no_followup').length,
      minors:    stalls.filter((s: unknown) => (s as { stall_type: string }).stall_type === 'quick_closure_young').length,
    })
  }

  // ── LOCATION RUNAWAY CLUSTER ──────────────────────────────────────────────────
  // 3+ runaway/voluntary classified cases from the same city within any 5-year window
  if (action === 'location_runaway_cluster') {
    const parsed = (await fetchAllSubmissions(supabase, missingCaseId)).map(parseSubmission)

    // Only runaway/voluntary-flagged cases with a location + year
    const runaways = parsed.filter(p => {
      const lower = (p.circumstances ?? '').toLowerCase()
      return (lower.includes('runaway') || lower.includes('voluntary')) && p.year && p.location
    })

    // Group by normalised city + state
    const cityBuckets = new Map<string, ParsedCase[]>()
    for (const p of runaways) {
      const city = extractCity(p.location)
      if (!city || !p.state) continue
      const key = `${city}|${p.state}`
      if (!cityBuckets.has(key)) cityBuckets.set(key, [])
      cityBuckets.get(key)!.push(p)
    }

    await supabase.from('doe_victimology_clusters' as never)
      .delete().eq('case_id', missingCaseId).eq('cluster_type', 'location_runaway_cluster')

    const toInsert: object[] = []
    const memberRows: object[] = []

    for (const [key, subs] of cityBuckets) {
      if (subs.length < 3) continue
      const [city, state] = key.split('|')

      // Find the largest cluster within any 5-year window
      const years = subs.map(s => s.year).filter(Boolean) as number[]
      let bestWindow: ParsedCase[] = []
      for (const startYear of years) {
        const win = subs.filter(s => s.year && s.year >= startYear && s.year < startYear + 5)
        if (win.length > bestWindow.length) bestWindow = win
      }
      if (bestWindow.length < 3) continue

      const winYears  = bestWindow.map(s => s.year).filter(Boolean) as number[]
      const winMin    = Math.min(...winYears)
      const winMax    = Math.max(...winYears)
      const cityLabel = city.replace(/\b\w/g, c => c.toUpperCase())
      const sexCounts = bestWindow.reduce((acc, s) => {
        const sx = normSex(s.sex) ?? 'unknown'
        acc[sx] = (acc[sx] ?? 0) + 1
        return acc
      }, {} as Record<string, number>)

      const confidence  = Math.min(0.95, 0.65 + bestWindow.length * 0.05)
      const clusterId   = crypto.randomUUID()
      const yearRange   = winMin === winMax ? String(winMin) : `${winMin}–${winMax}`

      toInsert.push({
        id: clusterId,
        case_id: missingCaseId,
        cluster_label: `${bestWindow.length} runaway/voluntary cases — ${cityLabel}, ${state} (${yearRange})`,
        cluster_type: 'location_runaway_cluster',
        state,
        case_count: bestWindow.length,
        year_span_start: winMin,
        year_span_end:   winMax,
        submission_ids:  bestWindow.map(s => s.submissionId),
        signals: { city: cityLabel, sex_counts: sexCounts, total_in_city: subs.length },
      })

      for (const sub of bestWindow) {
        memberRows.push({
          cluster_id: clusterId,
          submission_id: sub.submissionId,
          case_id: missingCaseId,
          confidence: Math.round(confidence * 1000) / 1000,
          confidence_reason: `Runaway/voluntary classification, same city (${cityLabel}, ${state}), within 5-year window`,
          membership_status: 'candidate',
          member_name: sub.name,
          member_doe_id: sub.doeId,
          member_location: sub.location,
          member_date: sub.date,
          member_age: sub.age,
          member_sex: sub.sex,
        })
      }
    }

    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('doe_victimology_clusters' as never)
        .insert(toInsert.slice(i, i + 50) as never)
      if (!error) inserted += Math.min(50, toInsert.length - i)
    }
    for (let i = 0; i < memberRows.length; i += 100) {
      await supabase.from('doe_cluster_members' as never).insert(memberRows.slice(i, i + 100) as never)
    }

    return NextResponse.json({
      action: 'location_runaway_cluster',
      clustersInserted: inserted,
      memberRowsInserted: memberRows.length,
      runawayCases: runaways.length,
      citiesChecked: cityBuckets.size,
    })
  }

  // ── TRANSPORT CORRIDOR CLUSTER ────────────────────────────────────────────────
  // Cases whose circumstances mention a specific major highway; 3+ per corridor = cluster
  if (action === 'corridor_cluster') {
    const parsed = (await fetchAllSubmissions(supabase, missingCaseId)).map(parseSubmission)

    const corridorBuckets = new Map<string, ParsedCase[]>()
    const corridorLabels  = new Map<string, string>()

    for (const p of parsed) {
      // Search circumstances + location text for corridor references
      const text = `${p.circumstances ?? ''} ${p.location ?? ''}`
      for (const corridor of CORRIDORS) {
        if (corridor.patterns.some(pat => pat.test(text))) {
          if (!corridorBuckets.has(corridor.id)) corridorBuckets.set(corridor.id, [])
          corridorBuckets.get(corridor.id)!.push(p)
          corridorLabels.set(corridor.id, corridor.label)
          break // One corridor per case (first match wins)
        }
      }
    }

    await supabase.from('doe_victimology_clusters' as never)
      .delete().eq('case_id', missingCaseId).eq('cluster_type', 'corridor_cluster')

    const toInsert: object[] = []
    const memberRows: object[] = []

    for (const [corridorId, subs] of corridorBuckets) {
      if (subs.length < 3) continue
      const label = corridorLabels.get(corridorId) ?? corridorId
      const years = subs.map(s => s.year).filter(Boolean) as number[]
      const yearMin = years.length ? Math.min(...years) : null
      const yearMax = years.length ? Math.max(...years) : null
      if (yearMin && yearMax && yearMax - yearMin > 25) continue // 25-year cap

      const stateCounts: Record<string, number> = {}
      for (const s of subs) {
        if (s.state) stateCounts[s.state] = (stateCounts[s.state] ?? 0) + 1
      }
      const topState = Object.entries(stateCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null

      const sexCounts: Record<string, number> = {}
      for (const s of subs) {
        const sx = normSex(s.sex) ?? 'unknown'
        sexCounts[sx] = (sexCounts[sx] ?? 0) + 1
      }

      const confidence = Math.min(0.90, 0.60 + subs.length * 0.04)
      const clusterId  = crypto.randomUUID()
      const yearRange  = yearMin && yearMax
        ? (yearMin === yearMax ? String(yearMin) : `${yearMin}–${yearMax}`)
        : ''

      toInsert.push({
        id: clusterId,
        case_id: missingCaseId,
        cluster_label: `${subs.length} cases along ${label}${yearRange ? ` (${yearRange})` : ''}`,
        cluster_type: 'corridor_cluster',
        state: topState,
        case_count: subs.length,
        year_span_start: yearMin,
        year_span_end:   yearMax,
        submission_ids:  subs.map(s => s.submissionId),
        signals: { corridor_id: corridorId, corridor_label: label, state_counts: stateCounts, sex_counts: sexCounts },
      })

      for (const sub of subs) {
        memberRows.push({
          cluster_id: clusterId,
          submission_id: sub.submissionId,
          case_id: missingCaseId,
          confidence: Math.round(confidence * 1000) / 1000,
          confidence_reason: `Circumstances or location mention ${label}`,
          membership_status: 'candidate',
          member_name: sub.name,
          member_doe_id: sub.doeId,
          member_location: sub.location,
          member_date: sub.date,
          member_age: sub.age,
          member_sex: sub.sex,
        })
      }
    }

    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('doe_victimology_clusters' as never)
        .insert(toInsert.slice(i, i + 50) as never)
      if (!error) inserted += Math.min(50, toInsert.length - i)
    }
    for (let i = 0; i < memberRows.length; i += 100) {
      await supabase.from('doe_cluster_members' as never).insert(memberRows.slice(i, i + 100) as never)
    }

    return NextResponse.json({
      action: 'corridor_cluster',
      clustersInserted: inserted,
      memberRowsInserted: memberRows.length,
      corridorsFound: corridorBuckets.size,
      totalCases: parsed.length,
    })
  }

  // ── AGE-BRACKET TIGHT CLUSTER ─────────────────────────────────────────────────
  // 4+ cases in the same sex+state with age SD ≤ 3.5 years spanning 5+ years
  // Signals a possible age-preference offender pattern
  if (action === 'age_bracket_cluster') {
    const parsed = (await fetchAllSubmissions(supabase, missingCaseId)).map(parseSubmission)

    // Group by sex + state
    const buckets = new Map<string, ParsedCase[]>()
    for (const p of parsed) {
      const sex   = normSex(p.sex)   ?? 'unknown'
      const state = p.state          ?? 'unknown'
      const key   = `${sex}|${state}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(p)
    }

    await supabase.from('doe_victimology_clusters' as never)
      .delete().eq('case_id', missingCaseId).eq('cluster_type', 'age_bracket')

    const toInsert: object[] = []
    const memberRows: object[] = []

    for (const [key, subs] of buckets) {
      if (subs.length < 4) continue

      // Get numeric midpoint ages
      const withAge = subs.map(s => {
        const r = parseAgeRange(s.age)
        return r ? { sub: s, midAge: (r[0] + r[1]) / 2 } : null
      }).filter(Boolean) as Array<{ sub: ParsedCase; midAge: number }>

      if (withAge.length < 4) continue

      const years = subs.map(s => s.year).filter(Boolean) as number[]
      if (!years.length) continue
      const yearMin = Math.min(...years)
      const yearMax = Math.max(...years)
      if (yearMax - yearMin < 5) continue  // Must span 5+ years to be meaningful
      if (yearMax - yearMin > 25) continue // Cap at 25 years — unlikely single pattern

      const ages    = withAge.map(x => x.midAge)
      const sd      = calcStdDev(ages)
      if (sd > 3.5) continue // Not tight enough

      const meanAge = ages.reduce((a, b) => a + b, 0) / ages.length
      const [sex, state] = key.split('|')

      const confidence = Math.min(0.92, 0.70 + (3.5 - sd) * 0.05 + subs.length * 0.01)
      const clusterId  = crypto.randomUUID()
      const ageRange   = `${Math.round(meanAge - sd)}–${Math.round(meanAge + sd)}`
      const sexLabel   = sex !== 'unknown' ? `${sex} ` : ''
      const stateLabel = state !== 'unknown' ? `, ${state}` : ''

      toInsert.push({
        id: clusterId,
        case_id: missingCaseId,
        cluster_label: `${withAge.length} ${sexLabel}victims — tight age bracket ${ageRange} (SD ${sd.toFixed(1)}yr)${stateLabel}, ${yearMin}–${yearMax}`,
        cluster_type: 'age_bracket',
        sex:  sex   !== 'unknown' ? sex   : null,
        state: state !== 'unknown' ? state : null,
        case_count: withAge.length,
        year_span_start: yearMin,
        year_span_end:   yearMax,
        submission_ids: withAge.map(x => x.sub.submissionId),
        signals: {
          mean_age:   Math.round(meanAge * 10) / 10,
          std_dev:    Math.round(sd * 10) / 10,
          age_min:    Math.min(...ages),
          age_max:    Math.max(...ages),
          year_span:  yearMax - yearMin,
          pattern:    'age_preference_predator',
        },
      })

      for (const { sub, midAge } of withAge) {
        const withinSd   = Math.abs(midAge - meanAge) <= sd
        const memberConf = withinSd ? confidence : confidence * 0.85

        memberRows.push({
          cluster_id: clusterId,
          submission_id: sub.submissionId,
          case_id: missingCaseId,
          confidence: Math.round(memberConf * 1000) / 1000,
          confidence_reason: `Age ${sub.age ?? 'unknown'} — within ±${sd.toFixed(1)}yr of cluster mean (${Math.round(meanAge)})`,
          membership_status: 'candidate',
          member_name: sub.name,
          member_doe_id: sub.doeId,
          member_location: sub.location,
          member_date: sub.date,
          member_age: sub.age,
          member_sex: sub.sex,
        })
      }
    }

    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('doe_victimology_clusters' as never)
        .insert(toInsert.slice(i, i + 50) as never)
      if (!error) inserted += Math.min(50, toInsert.length - i)
    }
    for (let i = 0; i < memberRows.length; i += 100) {
      await supabase.from('doe_cluster_members' as never).insert(memberRows.slice(i, i + 100) as never)
    }

    return NextResponse.json({
      action: 'age_bracket_cluster',
      clustersInserted: inserted,
      memberRowsInserted: memberRows.length,
      bucketsChecked: buckets.size,
    })
  }

  // ── DEMOGRAPHIC HOTSPOT CLUSTER ───────────────────────────────────────────────
  // City-level statistical anomaly: 5+ people of same sex/race disappearing
  // from the same city in a 10-year window at 2x+ the expected rate.
  // Expected rate is calculated from the dataset itself as the null hypothesis.
  if (action === 'demographic_hotspot') {
    const parsed = (await fetchAllSubmissions(supabase, missingCaseId)).map(s => parseSubmission(s))

    // Delete old hotspot clusters and their members
    const { data: oldClusters } = await supabase
      .from('doe_victimology_clusters' as never)
      .select('id')
      .eq('case_id', missingCaseId)
      .eq('cluster_type', 'demographic_hotspot') as { data: Array<{ id: string }> | null }
    if (oldClusters?.length) {
      const oldIds = oldClusters.map(c => c.id)
      await supabase.from('doe_cluster_members' as never).delete().in('cluster_id', oldIds)
      await supabase.from('doe_victimology_clusters' as never).delete().in('id', oldIds)
    }

    // Extract county (second token) — much denser than city, better anomaly detection
    function extractCounty(loc: string | null): string | null {
      if (!loc) return null
      const parts = loc.split(',')
      // "City, County Name, State" → use county (parts[1])
      // Fall back to city if county absent
      const county = (parts[1] ?? parts[0] ?? '').trim()
        .replace(/\s+county$/i, '').replace(/\s+parish$/i, '').trim()
      if (county.length < 2 || /unknown|unclear|various|anywhere/i.test(county)) return null
      return county.toLowerCase()
    }

    // National demographic rates within this dataset (our null hypothesis)
    const parsedWithDemo = parsed.filter(p => normSex(p.sex) && normRace(p.race))
    const totalWithDemo = parsedWithDemo.length
    if (!totalWithDemo) return NextResponse.json({ error: 'Insufficient demographic data' }, { status: 400 })

    const demoRates = new Map<string, number>()
    for (const p of parsedWithDemo) {
      const key = `${normSex(p.sex)}|${normRace(p.race)}`
      demoRates.set(key, (demoRates.get(key) ?? 0) + 1)
    }
    for (const [key, count] of demoRates) demoRates.set(key, count / totalWithDemo)

    // Add county to each record
    const withCity = parsed
      .filter(p => p.year && normSex(p.sex) && normRace(p.race))
      .map(p => ({ ...p, city: extractCounty(p.location) }))
      .filter(p => p.city !== null) as (ParsedCase & { city: string })[]

    // County totals (denominator for expected calculation)
    const cityTotals = new Map<string, number>()
    for (const p of withCity) cityTotals.set(p.city, (cityTotals.get(p.city) ?? 0) + 1)

    // 10-year window buckets: county + sex + race + decade (age dropped for density)
    const HOTSPOT_WINDOW = 10
    const buckets = new Map<string, (ParsedCase & { city: string })[]>()
    for (const p of withCity) {
      const decade = Math.floor(p.year! / HOTSPOT_WINDOW) * HOTSPOT_WINDOW
      const key = `${p.city}|${normSex(p.sex)}|${normRace(p.race)}|${decade}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(p)
    }

    const toInsertClusters: object[] = []
    const toInsertMembers: object[] = []

    for (const [key, subs] of buckets) {
      if (subs.length < 2) continue
      const [city, sex, race, decadeStr] = key.split('|')
      const decade = parseInt(decadeStr)
      const cityTotal = cityTotals.get(city) ?? 0
      if (cityTotal < 3) continue   // too small a county sample
      const nationalRate = demoRates.get(`${sex}|${race}`) ?? 0
      const expected = cityTotal * nationalRate
      if (expected < 0.3) continue
      const anomalyRatio = subs.length / expected
      if (anomalyRatio < 1.5) continue

      const years = subs.map(s => s.year).filter(Boolean) as number[]
      const yearMin = Math.min(...years)
      const yearMax = Math.max(...years)

      // Summarise age spread for label
      const ageGroups = [...new Set(subs.map(s => ageGroup(s.age)).filter(a => a !== 'unknown'))]
      const agLabel = ageGroups.length === 1 ? (ageGroups[0] + 's') : 'mixed age'
      const ag = ageGroups[0] ?? 'unknown'

      const raceLabel = race === 'unknown' ? 'unknown race' : race
      const label = `${subs.length} ${raceLabel} ${sex} ${agLabel} · ${city} County · ${decade}s · ${anomalyRatio.toFixed(1)}× expected`

      const clusterId = crypto.randomUUID()

      // Collect circumstance co-signals for this group
      const coSignals = new Map<string, number>()
      for (const sub of subs) {
        for (const sig of extractCircumstanceSignals(sub)) {
          coSignals.set(sig, (coSignals.get(sig) ?? 0) + 1)
        }
      }
      const topSignals = [...coSignals.entries()]
        .filter(([, c]) => c >= Math.ceil(subs.length * 0.3))
        .sort(([, a], [, b]) => b - a).slice(0, 5).map(([sig]) => sig)

      toInsertClusters.push({
        id: clusterId,
        case_id: missingCaseId,
        cluster_label: label,
        cluster_type: 'demographic_hotspot',
        sex,
        race,
        age_group: ag === 'unknown' ? null : ag,
        state: subs[0].state ?? null,
        year_span_start: yearMin,
        year_span_end: yearMax,
        case_count: subs.length,
        submission_ids: subs.map(s => s.submissionId),
        signals: {
          city,   // this is actually county name now
          county: city,
          anomaly_ratio: parseFloat(anomalyRatio.toFixed(2)),
          expected_count: parseFloat(expected.toFixed(1)),
          observed_count: subs.length,
          city_total: cityTotal,
          national_rate_pct: parseFloat((nationalRate * 100).toFixed(1)),
          decade,
          top_circumstance_signals: topSignals,
          co_signals: Object.fromEntries(coSignals),
        },
      })

      for (const sub of subs) {
        toInsertMembers.push({
          cluster_id: clusterId,
          case_id: missingCaseId,
          submission_id: sub.submissionId,
          confidence: Math.min(0.99, parseFloat((0.4 + Math.min(anomalyRatio / 10, 0.59)).toFixed(2))),
          confidence_reason: `${anomalyRatio.toFixed(1)}× expected rate — ${subs.length} ${race} ${sex} in ${city} (${decade}s vs ${nationalRate > 0 ? (nationalRate * 100).toFixed(0) : '?'}% national rate)`,
          membership_status: 'candidate',
          member_name: sub.name,
          member_doe_id: sub.doeId,
          member_location: sub.location,
          member_date: sub.date,
          member_age: sub.age,
          member_sex: sub.sex,
          notes: sub.circumstances?.slice(0, 300) ?? null,
        })
      }
    }

    // Sort by anomaly ratio descending
    toInsertClusters.sort((a, b) =>
      (b as { signals: { anomaly_ratio: number } }).signals.anomaly_ratio -
      (a as { signals: { anomaly_ratio: number } }).signals.anomaly_ratio
    )

    let insertedClusters = 0
    for (let i = 0; i < toInsertClusters.length; i += 50) {
      const { error } = await supabase.from('doe_victimology_clusters' as never)
        .insert(toInsertClusters.slice(i, i + 50) as never)
      if (!error) insertedClusters += Math.min(50, toInsertClusters.length - i)
    }
    for (let i = 0; i < toInsertMembers.length; i += 100) {
      await supabase.from('doe_cluster_members' as never)
        .insert(toInsertMembers.slice(i, i + 100) as never)
    }

    return NextResponse.json({
      action: 'demographic_hotspot',
      clustersInserted: insertedClusters,
      membersInserted: toInsertMembers.length,
      totalCasesAnalyzed: withCity.length,
      anomalyThreshold: '1.5×',
    })
  }

  // ── HIGHWAY PROXIMITY CLUSTER ─────────────────────────────────────────────────
  // Cases where the disappearance/discovery city is within ~20 miles of a major
  // interstate corridor — the "radial dumping zone" pattern.
  // Uses city lookup rather than text mention (different from corridor_cluster).
  if (action === 'highway_proximity') {
    const parsed = (await fetchAllSubmissions(supabase, missingCaseId)).map(s => parseSubmission(s))

    // Delete old highway_proximity clusters
    const { data: oldHP } = await supabase
      .from('doe_victimology_clusters' as never).select('id')
      .eq('case_id', missingCaseId).eq('cluster_type', 'highway_proximity') as { data: Array<{ id: string }> | null }
    if (oldHP?.length) {
      await supabase.from('doe_cluster_members' as never).delete().in('cluster_id', oldHP.map(c => c.id))
      await supabase.from('doe_victimology_clusters' as never).delete().in('id', oldHP.map(c => c.id))
    }

    function extractCityHP(loc: string | null): string | null {
      if (!loc) return null
      const city = loc.split(',')[0].trim()
      if (city.length < 2 || /unknown|unclear|various/i.test(city)) return null
      return city
    }

    // Group by corridor
    const corridorBuckets = new Map<string, ParsedCase[]>()

    for (const p of parsed) {
      const city = extractCityHP(p.location)
      if (!city) continue
      // Case-insensitive lookup
      const matchedKey = Object.keys(HIGHWAY_PROXIMITY).find(k =>
        k.toLowerCase() === city.toLowerCase()
      )
      if (!matchedKey) continue
      for (const corridorId of HIGHWAY_PROXIMITY[matchedKey]) {
        if (!corridorBuckets.has(corridorId)) corridorBuckets.set(corridorId, [])
        corridorBuckets.get(corridorId)!.push(p)
      }
    }

    const toInsert: object[] = []
    const memberRows: object[] = []

    for (const [corridorId, subs] of corridorBuckets) {
      if (subs.length < 2) continue
      // Remove duplicate submissions (a case can be near two corridors)
      const unique = Array.from(new Map(subs.map(s => [s.submissionId, s])).values())
      if (unique.length < 2) continue

      const years = unique.map(s => s.year).filter(Boolean) as number[]
      const yearMin = years.length ? Math.min(...years) : null
      const yearMax = years.length ? Math.max(...years) : null
      if (yearMin && yearMax && yearMax - yearMin > 25) continue // 25-year cap

      const stateCounts: Record<string, number> = {}
      for (const s of unique) if (s.state) stateCounts[s.state] = (stateCounts[s.state] ?? 0) + 1

      const sexCounts: Record<string, number> = {}
      for (const s of unique) {
        const sx = normSex(s.sex) ?? 'unknown'
        sexCounts[sx] = (sexCounts[sx] ?? 0) + 1
      }

      const raceCounts: Record<string, number> = {}
      for (const s of unique) {
        const rc = normRace(s.race) ?? 'unknown'
        raceCounts[rc] = (raceCounts[rc] ?? 0) + 1
      }

      const topState = Object.entries(stateCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null
      const yearRange = yearMin && yearMax ? (yearMin === yearMax ? String(yearMin) : `${yearMin}–${yearMax}`) : ''
      const corridorLabel = CORRIDORS.find(c => c.id === corridorId)?.label ?? corridorId
      const confidence = Math.min(0.85, 0.55 + unique.length * 0.03)
      const clusterId = crypto.randomUUID()

      toInsert.push({
        id: clusterId,
        case_id: missingCaseId,
        cluster_label: `${unique.length} cases near ${corridorId} corridor${yearRange ? ` (${yearRange})` : ''}`,
        cluster_type: 'highway_proximity',
        state: topState,
        case_count: unique.length,
        year_span_start: yearMin,
        year_span_end: yearMax,
        submission_ids: unique.map(s => s.submissionId),
        signals: {
          corridor_id: corridorId,
          corridor_label: corridorLabel,
          state_counts: stateCounts,
          sex_counts: sexCounts,
          race_counts: raceCounts,
          note: 'Cases where disappearance city is within ~20 miles of corridor — geographic proximity, not text mention',
        },
      })

      for (const sub of unique) {
        memberRows.push({
          cluster_id: clusterId,
          submission_id: sub.submissionId,
          case_id: missingCaseId,
          confidence: Math.round(confidence * 1000) / 1000,
          confidence_reason: `Disappearance location within ~20 miles of ${corridorId}`,
          membership_status: 'candidate',
          member_name: sub.name,
          member_doe_id: sub.doeId,
          member_location: sub.location,
          member_date: sub.date,
          member_age: sub.age,
          member_sex: sub.sex,
        })
      }
    }

    let insertedClusters = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('doe_victimology_clusters' as never)
        .insert(toInsert.slice(i, i + 50) as never)
      if (!error) insertedClusters += Math.min(50, toInsert.length - i)
    }
    for (let i = 0; i < memberRows.length; i += 100) {
      await supabase.from('doe_cluster_members' as never).insert(memberRows.slice(i, i + 100) as never)
    }

    return NextResponse.json({
      action: 'highway_proximity',
      clustersInserted: insertedClusters,
      membersInserted: memberRows.length,
      corridorsFound: corridorBuckets.size,
      totalCases: parsed.length,
    })
  }

  // ── NATIONAL PARK PROXIMITY CLUSTER ───────────────────────────────────────────
  // Cases where the disappearance/discovery city is near a major national park
  // or wilderness area. Remote terrain delays discovery; clusters here warrant
  // investigator attention for dumping vs. lost hiker pattern.
  if (action === 'national_park_proximity') {
    const parsed = (await fetchAllSubmissions(supabase, missingCaseId)).map(s => parseSubmission(s))

    // Delete old clusters
    const { data: oldNP } = await supabase
      .from('doe_victimology_clusters' as never).select('id')
      .eq('case_id', missingCaseId).eq('cluster_type', 'national_park_proximity') as { data: Array<{ id: string }> | null }
    if (oldNP?.length) {
      await supabase.from('doe_cluster_members' as never).delete().in('cluster_id', oldNP.map(c => c.id))
      await supabase.from('doe_victimology_clusters' as never).delete().in('id', oldNP.map(c => c.id))
    }

    function extractCityNP(loc: string | null): string | null {
      if (!loc) return null
      const city = loc.split(',')[0].trim()
      if (city.length < 2 || /unknown|unclear|various/i.test(city)) return null
      return city
    }

    // Group by park
    const parkBuckets = new Map<string, ParsedCase[]>()

    for (const p of parsed) {
      const city = extractCityNP(p.location)
      if (!city) continue
      const matchedKey = Object.keys(NATIONAL_PARK_PROXIMITY).find(k =>
        k.toLowerCase() === city.toLowerCase()
      )
      if (!matchedKey) continue
      for (const park of NATIONAL_PARK_PROXIMITY[matchedKey]) {
        if (!parkBuckets.has(park)) parkBuckets.set(park, [])
        parkBuckets.get(park)!.push(p)
      }
    }

    const toInsert: object[] = []
    const memberRows: object[] = []

    for (const [park, subs] of parkBuckets) {
      if (subs.length < 2) continue
      const unique = Array.from(new Map(subs.map(s => [s.submissionId, s])).values())
      if (unique.length < 2) continue

      const years = unique.map(s => s.year).filter(Boolean) as number[]
      const yearMin = years.length ? Math.min(...years) : null
      const yearMax = years.length ? Math.max(...years) : null
      if (yearMin && yearMax && yearMax - yearMin > 25) continue // 25-year cap

      const stateCounts: Record<string, number> = {}
      for (const s of unique) if (s.state) stateCounts[s.state] = (stateCounts[s.state] ?? 0) + 1

      const sexCounts: Record<string, number> = {}
      for (const s of unique) {
        const sx = normSex(s.sex) ?? 'unknown'
        sexCounts[sx] = (sexCounts[sx] ?? 0) + 1
      }

      const raceCounts: Record<string, number> = {}
      for (const s of unique) {
        const rc = normRace(s.race) ?? 'unknown'
        raceCounts[rc] = (raceCounts[rc] ?? 0) + 1
      }

      // Flag if high female/minority concentration (pattern signal)
      const totalWithSex = Object.values(sexCounts).reduce((a, b) => a + b, 0)
      const femalePct = totalWithSex ? Math.round(((sexCounts['female'] ?? 0) / totalWithSex) * 100) : null

      const topState = Object.entries(stateCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null
      const yearRange = yearMin && yearMax ? (yearMin === yearMax ? String(yearMin) : `${yearMin}–${yearMax}`) : ''
      const confidence = Math.min(0.80, 0.50 + unique.length * 0.04)
      const clusterId = crypto.randomUUID()

      toInsert.push({
        id: clusterId,
        case_id: missingCaseId,
        cluster_label: `${unique.length} cases near ${park}${yearRange ? ` (${yearRange})` : ''}`,
        cluster_type: 'national_park_proximity',
        state: topState,
        case_count: unique.length,
        year_span_start: yearMin,
        year_span_end: yearMax,
        submission_ids: unique.map(s => s.submissionId),
        signals: {
          park,
          state_counts: stateCounts,
          sex_counts: sexCounts,
          race_counts: raceCounts,
          female_pct: femalePct,
          note: 'Cases near national park/wilderness — remote terrain may delay discovery',
        },
      })

      for (const sub of unique) {
        memberRows.push({
          cluster_id: clusterId,
          submission_id: sub.submissionId,
          case_id: missingCaseId,
          confidence: Math.round(confidence * 1000) / 1000,
          confidence_reason: `Location within ~20 miles of ${park}`,
          membership_status: 'candidate',
          member_name: sub.name,
          member_doe_id: sub.doeId,
          member_location: sub.location,
          member_date: sub.date,
          member_age: sub.age,
          member_sex: sub.sex,
        })
      }
    }

    let insertedClusters = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('doe_victimology_clusters' as never)
        .insert(toInsert.slice(i, i + 50) as never)
      if (!error) insertedClusters += Math.min(50, toInsert.length - i)
    }
    for (let i = 0; i < memberRows.length; i += 100) {
      await supabase.from('doe_cluster_members' as never).insert(memberRows.slice(i, i + 100) as never)
    }

    return NextResponse.json({
      action: 'national_park_proximity',
      clustersInserted: insertedClusters,
      membersInserted: memberRows.length,
      parksFound: parkBuckets.size,
      totalCases: parsed.length,
    })
  }

  // ── SYNTHESIZE ALL CLUSTERS (batch AI with deep-connection flagging) ──────────
  if (action === 'synthesize_all_clusters') {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })

    // Fetch up to 8 un-narrated clusters at a time (fits within 60s maxDuration)
    const { data: rawClusters } = await supabase
      .from('doe_victimology_clusters' as never)
      .select('id, cluster_label, cluster_type, submission_ids, signals')
      .eq('case_id', missingCaseId)
      .is('ai_narrative', null)
      .limit(8) as {
        data: Array<{
          id: string
          cluster_label: string
          cluster_type: string
          submission_ids: string[]
          signals: Record<string, unknown>
        }> | null
      }

    if (!rawClusters?.length) {
      return NextResponse.json({ action: 'synthesize_all_clusters', processed: 0, remaining: 0 })
    }

    const anthropic = new Anthropic({ apiKey, timeout: 45_000 })
    let processed = 0, failed = 0

    for (const cluster of rawClusters) {
      try {
        const subIds = (cluster.submission_ids ?? []).slice(0, 15)
        const { data: subs } = await supabase
          .from('submissions').select('id, raw_text, notes').in('id', subIds)

        const caseSummaries = (subs ?? []).map((s: RawSubmission, i: number) => {
          const p = parseSubmission(s)
          const sigs = extractCircumstanceSignals(p)
          return [
            `Case ${i + 1} [SUB_ID:${s.id}]: ${p.name ?? 'Unknown'}, ${p.sex ?? '?'}, ${p.race ?? '?'}, age ${p.age ?? '?'}, DOE:${p.doeId ?? 'N/A'}`,
            `  Last seen: ${p.location ?? 'unknown'}, ${p.date ?? 'unknown date'}`,
            p.circumstances ? `  Circumstances: ${p.circumstances.slice(0, 400)}` : null,
            sigs.length ? `  Signals: ${sigs.join(', ')}` : null,
          ].filter(Boolean).join('\n')
        }).join('\n\n')

        const totalCount = cluster.submission_ids?.length ?? subIds.length

        const prompt = [
          `You are an analyst assisting investigators reviewing missing persons patterns.`,
          ``,
          `Cluster: "${cluster.cluster_label}" (${totalCount} cases total, showing ${subIds.length})`,
          ``,
          caseSummaries,
          ``,
          `Respond with a JSON object (no other text) with exactly these fields:`,
          `{`,
          `  "narrative": "3–5 sentence investigative analysis. Start with 'This cluster of [N] cases...'. Cover: what the cases share and why the pattern matters; what vulnerability factors or circumstances the signals suggest; what an investigator should verify.",`,
          `  "flagged_ids": ["SUB_ID value", ...],  (0–3 submission IDs from above that show the deepest suspicious connections to each other BEYOND the clustering dimension — shared unusual circumstance details, matching physical descriptions, proximity in time/location not captured by the cluster. Empty array [] if none stand out.)`,
          `  "flag_reason": "One sentence explaining why those specific cases are flagged together. null if flagged_ids is empty.",`,
          `  "urgency": 1-5 integer. How urgently this cluster warrants investigator attention. Use this scale strictly:`,
          `    5 = Immediate — specific cases with matching physical details, shared unusual circumstances, or potential cross-jurisdiction pattern that could yield identifications`,
          `    4 = High — strong pattern with multiple corroborating signals; investigator should review within days`,
          `    3 = Moderate — notable pattern worth investigating; no acute indicators`,
          `    2 = Low — statistical cluster with weak signal; review when time allows`,
          `    1 = Informational — very broad or expected pattern; no specific investigative value`,
          `}`,
          ``,
          `Rules: Do not speculate about perpetrators. Do not state conclusions. Be specific and factual. Reserve urgency 5 for clusters with genuinely specific cross-case signals.`,
        ].join('\n')

        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 700,
          messages: [{ role: 'user', content: prompt }],
        })

        const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : null
        if (!text) { failed++; continue }

        let aiResult: { narrative: string; flagged_ids: string[]; flag_reason: string | null; urgency?: number }
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          aiResult = JSON.parse(jsonMatch ? jsonMatch[0] : text)
        } catch {
          failed++; continue
        }

        const urgency = typeof aiResult.urgency === 'number'
          ? Math.max(1, Math.min(5, Math.round(aiResult.urgency)))
          : (Array.isArray(aiResult.flagged_ids) && aiResult.flagged_ids.length > 0 ? 3 : 2)

        const updatedSignals = {
          ...cluster.signals,
          ai_flagged_ids: Array.isArray(aiResult.flagged_ids) ? aiResult.flagged_ids : [],
          ai_flag_reason: aiResult.flag_reason ?? null,
          ai_urgency: urgency,
        }

        await supabase.from('doe_victimology_clusters' as never).update({
          ai_narrative: aiResult.narrative ?? null,
          ai_generated_at: new Date().toISOString(),
          signals: updatedSignals,
        } as never).eq('id', cluster.id)

        processed++
      } catch {
        failed++
      }
    }

    // Count remaining
    const { count: remaining } = await supabase
      .from('doe_victimology_clusters' as never)
      .select('id', { count: 'exact', head: true })
      .eq('case_id', missingCaseId)
      .is('ai_narrative', null) as { count: number | null }

    return NextResponse.json({
      action: 'synthesize_all_clusters',
      processed,
      failed,
      batch: rawClusters.length,
      remaining: remaining ?? 0,
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// ─── GET — fetch results ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params         = req.nextUrl.searchParams
  const missingCaseId  = params.get('missingCaseId')
  const unidentifiedCaseId = params.get('unidentifiedCaseId')
  const type           = params.get('type') ?? 'matches'
  const grade          = params.get('grade')
  const reviewerStatus = params.get('reviewerStatus')
  const aiVerdict      = params.get('aiVerdict')
  const clusterType    = params.get('clusterType')
  const page           = parseInt(params.get('page') ?? '0')
  const PAGE_SIZE = 50

  if (!missingCaseId) return NextResponse.json({ error: 'missingCaseId required' }, { status: 400 })

  const { data: roleData } = await supabase
    .from('case_user_roles').select('role')
    .eq('case_id', missingCaseId).eq('user_id', user.id).single()
  if (!roleData) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  interface CQ {
    eq:    (col: string, val: string) => CQ
    in:    (col: string, vals: string[]) => CQ
    order: (col: string, opts: object) => CQ
    range: (from: number, to: number) => Promise<{ data: unknown; count: number | null; error: { message: string } | null }>
  }

  if (type === 'submission') {
    const submissionId = params.get('submissionId')
    if (!submissionId) return NextResponse.json({ error: 'submissionId required' }, { status: 400 })
    const { data } = await supabase
      .from('submissions' as never).select('raw_text').eq('id', submissionId).single() as { data: { raw_text: string } | null }
    return NextResponse.json({ raw_text: data?.raw_text ?? null })
  }

  if (type === 'stalls') {
    const stallType = params.get('stallType')
    let q = (supabase
      .from('doe_stall_flags' as never)
      .select('*', { count: 'exact' }) as unknown as CQ)
      .eq('case_id', missingCaseId)
      .order('elapsed_days', { ascending: false })
    if (reviewerStatus) q = q.eq('reviewer_status', reviewerStatus)
    if (stallType)      q = q.eq('stall_type', stallType)
    const { data, count, error } = await q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ stalls: data, total: count, page })
  }

  if (type === 'entities') {
    const entityType = params.get('entityType')
    let q = (supabase
      .from('doe_entity_mentions' as never)
      .select('*', { count: 'exact' }) as unknown as CQ)
      .eq('case_id', missingCaseId)
      .order('match_count', { ascending: false })
    if (entityType) q = q.eq('entity_type', entityType)
    const { data, count, error } = await q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ entities: data, total: count, page })
  }

  if (type === 'compare_cases') {
    const rawIds = params.get('submissionIds') ?? ''
    const ids = rawIds.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6)
    if (!ids.length) return NextResponse.json({ error: 'submissionIds required' }, { status: 400 })
    const unidCaseId = params.get('unidentifiedCaseId')

    const { data, error } = await supabase
      .from('submissions' as never)
      .select('id, raw_text, notes, case_id')
      .in('id', ids as never) as { data: Array<{ id: string; raw_text: string; notes: string | null; case_id: string }> | null; error: { message: string } | null }

    if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })

    const cases = (data ?? []).map(row => {
      const p = parseSubmission({ id: row.id, raw_text: row.raw_text, notes: row.notes })
      return {
        submissionId: row.id,
        caseType: (row.case_id === unidCaseId ? 'unidentified' : 'missing') as 'missing' | 'unidentified',
        doeId:        p.doeId,
        name:         p.name,
        sex:          p.sex,
        race:         p.race,
        age:          p.age,
        height:       p.height,
        weight:       p.weight,
        hair:         p.hair,
        eyes:         p.eyes,
        marks:        p.marks,
        jewelry:      p.jewelry,
        date:         p.date,
        location:     p.location,
        circumstances: p.circumstances,
      }
    })
    return NextResponse.json({ cases })
  }

  // Tattoo/mark keyword search — returns missing persons + unidentified remains that share the keyword
  if (type === 'tattoo_search') {
    const keyword = params.get('keyword')?.toLowerCase().trim()
    if (!keyword || keyword.length < 2) return NextResponse.json({ error: 'keyword required (min 2 chars)' }, { status: 400 })
    const unidCaseId = params.get('unidentifiedCaseId')

    // Search missing persons (raw_text ilike)
    const { data: missingRows } = await supabase
      .from('submissions' as never)
      .select('id, raw_text')
      .eq('case_id', missingCaseId)
      .ilike('raw_text', `%${keyword}%`) as { data: Array<{ id: string; raw_text: string }> | null }

    // Search unidentified remains
    let unidRows: Array<{ id: string; raw_text: string }> = []
    if (unidCaseId) {
      const { data } = await supabase
        .from('submissions' as never)
        .select('id, raw_text')
        .eq('case_id', unidCaseId)
        .ilike('raw_text', `%${keyword}%`) as { data: Array<{ id: string; raw_text: string }> | null }
      unidRows = data ?? []
    }

    function extractTattooContext(rawText: string, kw: string) {
      const p = parseSubmission({ id: '', raw_text: rawText, notes: null })
      // Find the snippet containing the keyword in marks/circumstances
      const searchIn = [p.marks, p.circumstances].filter(Boolean).join(' ')
      const idx = searchIn.toLowerCase().indexOf(kw)
      const snippet = idx >= 0 ? searchIn.slice(Math.max(0, idx - 40), idx + kw.length + 60).trim() : null
      return { doeId: p.doeId, name: p.name, sex: p.sex, race: p.race, age: p.age, date: p.date, state: p.state, snippet }
    }

    return NextResponse.json({
      keyword,
      missing:      (missingRows ?? []).map(r => ({ submissionId: r.id, ...extractTattooContext(r.raw_text, keyword) })),
      unidentified: unidRows.map(r => ({ submissionId: r.id, ...extractTattooContext(r.raw_text, keyword) })),
    })
  }

  if (type === 'cluster_members') {
    const cId = params.get('clusterId')
    if (!cId) return NextResponse.json({ error: 'clusterId required' }, { status: 400 })
    const { data, error } = await supabase
      .from('doe_cluster_members' as never)
      .select('*')
      .eq('cluster_id', cId)
      .order('confidence', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ members: data })
  }

  if (type === 'clusters') {
    let q = (supabase
      .from('doe_victimology_clusters' as never)
      .select('*', { count: 'exact' }) as unknown as CQ)
      .eq('case_id', missingCaseId)
      .order('case_count', { ascending: false })

    if (reviewerStatus) q = q.eq('reviewer_status', reviewerStatus)
    if (clusterType)    q = q.eq('cluster_type', clusterType)

    const { data, count, error } = await q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ clusters: data, total: count, page })
  }

  if (type === 'route_matches') {
    let q = (supabase
      .from('doe_match_candidates' as never)
      .select('*', { count: 'exact' }) as unknown as CQ)
      .eq('missing_case_id', missingCaseId)
      .eq('match_type', 'destination_route_match')
      .order('composite_score', { ascending: false })

    if (grade === 'notable_plus') {
      q = (q as unknown as { in: (col: string, vals: string[]) => CQ }).in('grade', ['notable', 'strong', 'very_strong'])
    } else if (grade) {
      q = q.eq('grade', grade)
    }
    if (reviewerStatus) q = q.eq('reviewer_status', reviewerStatus)

    const { data, count, error } = await q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ matches: data, total: count, page })
  }

  // Match candidates
  let q = (supabase
    .from('doe_match_candidates' as never)
    .select('*', { count: 'exact' }) as unknown as CQ)
    .eq('missing_case_id', missingCaseId)
    .order('composite_score', { ascending: false })

  if (unidentifiedCaseId) q = q.eq('unidentified_case_id', unidentifiedCaseId)
  if (grade === 'notable_plus') {
    q = (q as unknown as { in: (col: string, vals: string[]) => CQ }).in('grade', ['notable', 'strong', 'very_strong'])
  } else if (grade) {
    q = q.eq('grade', grade)
  }
  if (reviewerStatus)     q = q.eq('reviewer_status', reviewerStatus)
  if (aiVerdict === 'reviewed') {
    q = (q as unknown as { not: (col: string, op: string, val: null) => CQ }).not('ai_assessment', 'is', null)
  } else if (aiVerdict === 'strong_plus') {
    // connection_level 4 or 5 (new system), or legacy verdict=plausible with high confidence
    q = (q as unknown as { or: (s: string) => CQ }).or(
      'ai_assessment->>connection_level.gte.4,and(ai_assessment->>verdict.eq.plausible,ai_assessment->>confidence.eq.high)'
    )
  } else if (aiVerdict === 'some') {
    q = q.eq('ai_assessment->>connection_level', '3')
  } else if (aiVerdict === 'ignore') {
    q = (q as unknown as { or: (s: string) => CQ }).or(
      'ai_assessment->>connection_level.lte.2,ai_assessment->>verdict.eq.unlikely'
    )
  } else if (aiVerdict) {
    // legacy fallback
    q = q.eq('ai_assessment->>verdict', aiVerdict)
  }

  const { data, count, error } = await q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ matches: data, total: count, page })
}

// ─── PATCH — review ──────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, type = 'match', reviewerStatus, reviewerNote, membershipStatus, notes } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Cluster member — confirm / reject individual case within a cluster
  if (type === 'cluster_member') {
    if (!membershipStatus) return NextResponse.json({ error: 'membershipStatus required' }, { status: 400 })
    const { error } = await supabase.from('doe_cluster_members' as never).update({
      membership_status: membershipStatus,
      reviewed_by:       user.id,
      reviewed_at:       new Date().toISOString(),
      notes:             notes ?? null,
    } as never).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (!reviewerStatus) return NextResponse.json({ error: 'reviewerStatus required' }, { status: 400 })

  const table =
    type === 'cluster' ? 'doe_victimology_clusters' :
    type === 'stall'   ? 'doe_stall_flags' :
    'doe_match_candidates'
  const { error } = await supabase.from(table as never).update({
    reviewer_status: reviewerStatus,
    reviewed_by:     user.id,
    reviewed_at:     new Date().toISOString(),
    reviewer_note:   reviewerNote ?? null,
  } as never).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
