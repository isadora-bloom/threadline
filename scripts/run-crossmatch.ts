/**
 * Standalone cross-match runner
 * Uses service role key — bypasses auth/RLS.
 * Finds Doe Network cases by title and runs the full scoring engine.
 *
 * Usage:  npx tsx scripts/run-crossmatch.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ─── Types ────────────────────────────────────────────────────────────────────

type BodyState = 'intact' | 'mild' | 'moderate' | 'advanced' | 'skeletal' | 'burned' | 'partial' | 'unknown'

interface RawSub { id: string; case_id?: string; raw_text: string; notes: string | null }
interface ParsedCase {
  submissionId: string; caseId: string | null; doeId: string | null; name: string | null
  sex: string | null; race: string | null; age: string | null
  height: string | null; weight: string | null; hair: string | null
  eyes: string | null; marks: string | null
  clothing: string | null; jewelry: string | null
  dental: string | null; dna: string | null; fingerprints: string | null
  location: string | null; state: string | null; date: string | null; month: number | null
  year: number | null; circumstances: string | null
  bodyState: BodyState; stateOfRemains: string | null
  childbirth: 'evidence' | 'no_evidence' | 'unknown'
}
interface Sig { score: number; match: string; detail?: string; keywords?: string[] }

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseLine(r: string, ...keys: string[]): string | null {
  for (const k of keys) {
    const m = r.match(new RegExp(`^${k}:\\s*(.+)$`, 'mi'))
    if (m) return m[1].trim()
  }
  return null
}

const US_ABBREVS = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']
const US_STATE_NAMES: Record<string, string> = { 'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','District of Columbia':'DC' }

function extractState(loc: string | null): string | null {
  if (!loc) return null
  const s = loc.toUpperCase()
  for (const a of US_ABBREVS) if (new RegExp(`\\b${a}\\b`).test(s)) return a
  for (const [n, a] of Object.entries(US_STATE_NAMES)) if (loc.toLowerCase().includes(n.toLowerCase())) return a
  return null
}

function parseBodyState(r: string): BodyState {
  const s = (parseLine(r, 'State of Remains', 'Stateofremains', 'Case Classification') ?? '').toLowerCase()
  if (!s) return 'unknown'
  if (s.includes('skeletal') || s.includes('skeleton'))     return 'skeletal'
  if (s.includes('burn') || s.includes('charr'))            return 'burned'
  if (s.includes('partial') || s.includes('fragment'))      return 'partial'
  if (s.includes('mummif') || s.includes('saponif'))        return 'advanced'
  if (s.includes('advanced decomp') || s.includes('severe decomp')) return 'advanced'
  if (s.includes('decomp'))                                  return 'moderate'
  if (s.includes('intact') || s.includes('fresh'))          return 'intact'
  return 'unknown'
}

function parseSubmission(sub: RawSub): ParsedCase {
  const r = sub.raw_text
  const location = parseLine(r, 'Last Seen', 'Location Found', 'Location of Discovery', 'Location Last Seen')
  const dateStr = parseLine(r, 'Date Missing', 'Date Found', 'Estimated Date of Death')
  const doeId = (sub.notes?.match(/Case #(\w+)/)?.[1]) ?? parseLine(r, 'Doe Network ID')
  let month: number | null = null, year: number | null = null
  if (dateStr) {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) { month = d.getMonth() + 1; year = d.getFullYear() }
    else {
      const ym = dateStr.match(/\b(19|20)\d{2}\b/); if (ym) year = parseInt(ym[0])
      const months = ['january','february','march','april','may','june','july','august','september','october','november','december']
      for (let i = 0; i < months.length; i++) if (dateStr.toLowerCase().includes(months[i])) { month = i + 1; break }
    }
  }
  const circMatch = r.match(/^Circumstances:\s*([\s\S]+?)(?:\nInformation Sources:|$)/mi)
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
    submissionId: sub.id, caseId: sub.case_id ?? null, doeId,
    name: parseLine(r, 'Name'), sex: parseLine(r, 'Sex', 'Gender'),
    race: parseLine(r, 'Race/Ethnicity', 'Race'), age: parseLine(r, 'Age'),
    height: parseLine(r, 'Height'), weight: parseLine(r, 'Weight'),
    hair: parseLine(r, 'Hair'), eyes: parseLine(r, 'Eyes'),
    marks: parseLine(r, 'Distinguishing Marks'),
    clothing, jewelry, dental, dna, fingerprints,
    location, state: extractState(location), date: dateStr, month, year,
    circumstances: circMatch ? circMatch[1].trim() : null,
    bodyState: parseBodyState(r), stateOfRemains: parseLine(r, 'State of Remains'),
    childbirth: /no signs of childbirth|nulliparous|never had children|not believed to have (had|given birth)|never gave birth/i.test(r) ? 'no_evidence'
      : /signs of childbirth|parous\b|gave birth|has children|mother of \d|had child|evidence of (pregnancy|childbirth)|was pregnant|evidence of giving birth/i.test(r) ? 'evidence'
      : 'unknown',
  }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

const DECOMP_WEIGHTS: Record<BodyState, { hair: number; eyes: number; weight: number; tattoo: number; body_marks: number }> = {
  intact:  { hair:1.0, eyes:1.0, weight:1.0, tattoo:1.0, body_marks:1.0 },
  mild:    { hair:0.9, eyes:0.9, weight:0.8, tattoo:0.9, body_marks:0.9 },
  moderate:{ hair:0.5, eyes:0.3, weight:0.4, tattoo:0.5, body_marks:0.6 },
  advanced:{ hair:0.1, eyes:0.0, weight:0.1, tattoo:0.2, body_marks:0.3 },
  skeletal:{ hair:0.0, eyes:0.0, weight:0.0, tattoo:0.0, body_marks:0.1 },
  burned:  { hair:0.0, eyes:0.0, weight:0.0, tattoo:0.0, body_marks:0.0 },
  partial: { hair:0.3, eyes:0.1, weight:0.2, tattoo:0.3, body_marks:0.4 },
  unknown: { hair:0.8, eyes:0.8, weight:0.8, tattoo:0.8, body_marks:0.8 },
}
// Jewelry NOT decomp-weighted — physical objects survive decomp better than soft tissue
const MAX_SCORES = { sex:15, race:12, age:15, hair:8, eyes:8, height:8, weight:5, tattoo:15, body_marks:8, jewelry:10, location:15, childbirth:8 }
const MAX_BASE = Object.values(MAX_SCORES).reduce((a,b) => a+b, 0)

const RACE_GROUPS: Record<string, string[]> = {
  white:   ['white','caucasian','european'],
  black:   ['black','african american','african-american'],
  hispanic:['hispanic','latino','latina','latinx','mexican','cuban','puerto rican'],
  asian:   ['asian','pacific islander','hawaiian','filipino','chinese','japanese','korean','vietnamese','indian'],
  native:  ['native american','american indian','alaska native','indigenous'],
}
const HAIR_GROUPS: Record<string, string[]> = {
  black:['black','jet black'], dark_brown:['dark brown','brown black','brunette','chocolate'],
  brown:['brown','medium brown','light brown','chestnut'],
  blonde:['blonde','blond','light blonde','dark blonde','strawberry blonde','golden'],
  red:['red','auburn','ginger','reddish'], gray:['gray','grey','silver','white'],
}
const HAIR_ADJ: [string,string][] = [['black','dark_brown'],['dark_brown','brown'],['brown','blonde'],['red','blonde'],['gray','blonde']]
const EYE_GROUPS: Record<string, string[]> = {
  blue:['blue','light blue'], green:['green','light green'],
  hazel:['hazel','hazel brown','hazel green','greenish brown'],
  brown:['brown','dark brown','light brown'], gray:['gray','grey'], black:['black','very dark'],
}
const EYE_ADJ: [string,string][] = [['blue','gray'],['green','hazel'],['hazel','brown'],['brown','black']]
const STATE_ADJ: Record<string, string[]> = {
  VA:['MD','DC','NC','TN','KY','WV'], MD:['VA','DC','PA','DE','WV'],
  NC:['VA','TN','GA','SC'], SC:['NC','GA'], GA:['FL','AL','TN','NC','SC'], FL:['GA','AL'],
  AL:['FL','GA','TN','MS'], TN:['VA','NC','GA','AL','MS','AR','MO','KY'],
  KY:['VA','WV','TN','MO','IL','IN','OH'], OH:['PA','WV','KY','IN','MI'], IN:['OH','KY','IL','MI'],
  IL:['IN','KY','MO','IA','WI'], MO:['IA','IL','KY','TN','AR','OK','KS','NE'],
  TX:['NM','OK','AR','LA'], CA:['OR','NV','AZ'],
  NY:['NJ','CT','MA','VT','PA'], PA:['NY','NJ','DE','MD','WV','OH'],
  WA:['OR','ID'], OR:['WA','ID','NV','CA'],
}
// Located-mark compound token system — only from marks field, not clothing or jewelry
const MARK_TYPES = ['tattoo','scar','birthmark','brand','piercing','mark','mole']
const BODY_LOCS  = ['shoulder','arm','wrist','forearm','chest','back','neck','leg','thigh','ankle','face','hand','abdomen','torso','rib','hip','calf','forehead','scalp','ear']
const SIDE_WORDS = ['left','right','upper','lower','inner','outer']
const GENERIC_ID_WORDS = new Set([
  'tattoo','scar','mark','left','right','upper','lower','inner','outer','small','large',
  'arm','leg','chest','back','neck','hand','shoulder','wrist','ankle','face','forehead',
  'abdomen','torso','skin','body','unknown','available','not',
])
function extractContentWords(p: ParsedCase): Set<string> {
  // Marks only — clothing and jewelry are scored separately
  const text = (p.marks ?? '').toLowerCase()
  if (!text) return new Set()
  const words = new Set(text.replace(/[^\w\s]/g,' ').split(/\s+/).filter(w => w.length >= 4 && !GENERIC_ID_WORDS.has(w) && !/^\d+$/.test(w)))
  for (const loc of BODY_LOCS) {
    if (!text.includes(loc)) continue
    for (const type of MARK_TYPES) {
      if (!text.includes(type)) continue
      words.add(`${loc}_${type}`)
      for (const side of SIDE_WORDS) {
        if (text.includes(side)) words.add(`${side}_${loc}_${type}`)
      }
    }
  }
  return words
}

// Tattoo imagery — only scored when both sides mention tattoo
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

// Jewelry — specific pieces are strong identifiers; compound tokens for described items
const JEWELRY_ITEMS = ['locket','pendant','medallion','brooch','bracelet','necklace','earring','anklet','choker','bangle','ring','chain','watch']
const JEWELRY_ADJ   = ['heart','cross','diamond','gold','silver','engraved','monogram','pearl','wedding','engagement','initial','rope','link']
function jewelryTokens(text: string): Set<string> {
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
function scoreUniqueId(a: ParsedCase, b: ParsedCase) {
  const wA = extractContentWords(a), wB = extractContentWords(b)
  if (!wA.size || !wB.size) return { score: 0, shared: [] as string[], overrides: false, detail: null as string|null }
  const shared = [...wA].filter(w => wB.has(w))
  if (shared.length >= 5) return { score: 25, shared, overrides: true, detail: `Near-certain identifier match: "${shared.slice(0,6).join(', ')}"` }
  if (shared.length >= 3) return { score: 15, shared, overrides: true, detail: `Strong identifier match: "${shared.join(', ')}" — review for same person or connected case` }
  if (shared.length >= 2) return { score: 5,  shared, overrides: false, detail: `Possible identifier overlap: "${shared.join(', ')}"` }
  return { score: 0, shared: [] as string[], overrides: false, detail: null as string|null }
}


function normRace(r: string | null): string | null {
  if (!r) return null; const l = r.toLowerCase()
  for (const [g, ts] of Object.entries(RACE_GROUPS)) if (ts.some(t => l.includes(t))) return g
  return null
}
function normSex(s: string | null): string | null {
  if (!s) return null; const l = s.toLowerCase()
  if (l.includes('female') || l === 'f') return 'female'
  if (l.includes('male')   || l === 'm') return 'male'
  return null
}
function parseAgeRange(s: string | null): [number,number] | null {
  if (!s) return null
  const r = s.match(/(\d+)\s*[-–to]+\s*(\d+)/)
  if (r) return [parseInt(r[1]), parseInt(r[2])]
  const n = s.match(/(\d+)/)
  if (n) { const v = parseInt(n[1]); return [Math.max(0, v-2), v+2] }
  return null
}

function scoreMatch(m: ParsedCase, u: ParsedCase) {
  // Fast-path eliminations BEFORE expensive unique identifier scoring (~70% of pairs exit here)

  // Chronological impossibility — remains found before person went missing
  if (m.year && u.year) {
    if (u.year < m.year) return { eliminated: true, reason: 'chronologically_impossible', composite: 0, grade: 'weak', signals: {} }
    if (u.year === m.year && m.month && u.month && u.month < m.month)
      return { eliminated: true, reason: 'chronologically_impossible', composite: 0, grade: 'weak', signals: {} }
  }

  // Quick sex check
  const sa = normSex(m.sex), sb = normSex(u.sex)
  const sexMismatch = !!(sa && sb && sa !== sb)

  // Quick age check
  const ma = parseAgeRange(m.age), ua = parseAgeRange(u.age)
  let ageIncompatible = false
  if (ma && ua) {
    let adj = ma as [number,number]
    if (m.year && u.year && u.year > m.year) { const e = u.year - m.year; adj = [ma[0]+e, ma[1]+e] }
    ageIncompatible = adj[0] > ua[1] + 10 || ua[0] > adj[1] + 10
  }

  // Only run expensive unique identifier scoring if needed to override an elimination
  const uniqueId = (sexMismatch || ageIncompatible)
    ? scoreUniqueId(m, u)
    : { overrides: false, score: 0, shared: [] as string[], detail: null as string | null }

  if (sexMismatch && !uniqueId.overrides) return { eliminated: true, reason: 'sex_mismatch', composite: 0, grade: 'weak', signals: {} }
  if (ageIncompatible && !uniqueId.overrides) return { eliminated: true, reason: 'age_incompatible', composite: 0, grade: 'weak', signals: {} }

  // Pair survived — run full unique identifier scoring if we haven't yet
  const fullUniqueId = (sexMismatch || ageIncompatible) ? uniqueId : scoreUniqueId(m, u)

  // Sex
  const sexScore = !sa || !sb ? 0 : sa === sb ? 15 : 0

  // Race — both genuinely unknown gets small partial credit (unknown ≠ mismatch)
  const ra = normRace(m.race), rb = normRace(u.race)
  const raceScore = (!ra && !rb) ? 2 : (!ra || !rb) ? 0 : ra === rb ? 12 : (() => {
    const al = (m.race??'').toLowerCase(), bl = (u.race??'').toLowerCase()
    const gs = Object.keys(RACE_GROUPS)
    const aG = gs.filter(g => RACE_GROUPS[g].some(t => al.includes(t)))
    const bG = gs.filter(g => RACE_GROUPS[g].some(t => bl.includes(t)))
    return aG.some(g => bG.includes(g)) ? 6 : -15  // clear group mismatch → penalise
  })()

  // Age
  let ageScore = 0, ageDet = ''
  if (ma && ua) {
    let adj = ma as [number,number]
    if (m.year && u.year && u.year > m.year) { const e = u.year - m.year; adj = [ma[0]+e, ma[1]+e] }
    const diff = Math.abs((adj[0]+adj[1])/2 - (ua[0]+ua[1])/2)
    ageScore = diff <= 3 ? 15 : diff <= 7 ? 10 : diff <= 12 ? 5 : diff <= 20 ? 0 : -10
    ageDet = `±${Math.round(diff)}yr`
  }

  // Hair
  const normH = (h: string | null) => { if (!h) return null; const l = h.toLowerCase(); for (const [g,ts] of Object.entries(HAIR_GROUPS)) if (ts.some(t => l.includes(t))) return g; return null }
  const ha = normH(m.hair), hb = normH(u.hair)
  const hairRaw = !ha || !hb ? 0 : ha === hb ? 8 : HAIR_ADJ.some(([x,y]) => (ha===x&&hb===y)||(ha===y&&hb===x)) ? 3 : 0

  // Eyes
  const normE = (e: string | null) => { if (!e) return null; const l = e.toLowerCase(); for (const [g,ts] of Object.entries(EYE_GROUPS)) if (ts.some(t => l.includes(t))) return g; return null }
  const ea = normE(m.eyes), eb = normE(u.eyes)
  const eyesRaw = !ea || !eb ? 0 : ea === eb ? 8 : EYE_ADJ.some(([x,y]) => (ea===x&&eb===y)||(ea===y&&eb===x)) ? 3 : 0

  // Height
  const toIn = (s: string | null) => { if (!s) return null; const ft = s.match(/(\d+)[' ]\s*(\d+)?/); if (ft) return parseInt(ft[1])*12+parseInt(ft[2]||'0'); const cm = s.match(/(\d+)\s*cm/i); if (cm) return Math.round(parseInt(cm[1])/2.54); return null }
  const ia = toIn(m.height), ib = toIn(u.height)
  const heightScore = !ia || !ib ? 0 : Math.abs(ia-ib) <= 1 ? 8 : Math.abs(ia-ib) <= 2 ? 6 : Math.abs(ia-ib) <= 3 ? 4 : Math.abs(ia-ib) <= 5 ? 2 : 0

  // Weight
  const toLbs = (s: string | null) => { if (!s) return null; const lb = s.match(/(\d+)\s*(?:lbs?|pounds?)/i); if (lb) return parseInt(lb[1]); const kg = s.match(/(\d+)\s*kg/i); if (kg) return Math.round(parseInt(kg[1])*2.205); const r = s.match(/^(\d{2,3})$/); if (r) return parseInt(r[1]); return null }
  const wa = toLbs(m.weight), wb = toLbs(u.weight)
  const weightRaw = !wa || !wb ? 0 : Math.abs(wa-wb) <= 10 ? 5 : Math.abs(wa-wb) <= 20 ? 3 : Math.abs(wa-wb) <= 30 ? 1 : 0

  // Tattoo imagery — only when both sides mention tattoo
  const mMarksText = (m.marks ?? '').toLowerCase()
  const uMarksText = (u.marks ?? '').toLowerCase()
  const mTattooMotifs = mMarksText.includes('tattoo') ? TATTOO_IMAGERY.filter(t => mMarksText.includes(t)) : []
  const uTattooMotifs = uMarksText.includes('tattoo') ? TATTOO_IMAGERY.filter(t => uMarksText.includes(t)) : []
  const sharedMotifs = mTattooMotifs.filter(t => uTattooMotifs.includes(t))
  const tattooRaw = sharedMotifs.length >= 3 ? 15 : sharedMotifs.length >= 2 ? 10 : sharedMotifs.length >= 1 ? 5 : 0

  // Body marks — scars, birthmarks, amputations, implants
  const mBodyMarks = BODY_MARK_KW.filter(k => mMarksText.includes(k))
  const uBodyMarks = BODY_MARK_KW.filter(k => uMarksText.includes(k))
  const sharedBodyMarks = mBodyMarks.filter(k => uBodyMarks.includes(k))
  const bodyMarksRaw = sharedBodyMarks.length > 0 ? Math.min(8, sharedBodyMarks.length * 4) : 0

  // Jewelry — physical objects, not decomp-weighted
  const mJewelText = (m.jewelry ?? '').toLowerCase()
  const uJewelText = (u.jewelry ?? '').toLowerCase()
  const mJewelTokens = jewelryTokens(mJewelText)
  const uJewelTokens = jewelryTokens(uJewelText)
  const sharedCompoundJewel = [...mJewelTokens].filter(t => t.includes('_') && uJewelTokens.has(t))
  const sharedGenericJewel  = [...mJewelTokens].filter(t => !t.includes('_') && uJewelTokens.has(t))
  const jewelryScore = sharedCompoundJewel.length > 0 ? Math.min(10, sharedCompoundJewel.length * 8)
    : sharedGenericJewel.length > 0 ? Math.min(6, sharedGenericJewel.length * 3) : 0

  // Location — same state +15, adjacent +5, known different -5, unknown 0
  const locationScore = !m.state || !u.state ? 0 : m.state===u.state ? 15 :
    (STATE_ADJ[m.state]?.includes(u.state) || STATE_ADJ[u.state]?.includes(m.state)) ? 5 : -5

  // Apply decomp weights
  const w = DECOMP_WEIGHTS[u.bodyState]
  const hair      = Math.round(hairRaw      * w.hair)
  const eyes      = Math.round(eyesRaw      * w.eyes)
  const weight    = Math.round(weightRaw    * w.weight)
  const tattoo    = Math.round(tattooRaw    * w.tattoo)
  const bodyMarks = Math.round(bodyMarksRaw * w.body_marks)

  const deductedMax =
    (1-w.hair)*MAX_SCORES.hair + (1-w.eyes)*MAX_SCORES.eyes +
    (1-w.weight)*MAX_SCORES.weight + (1-w.tattoo)*MAX_SCORES.tattoo +
    (1-w.body_marks)*MAX_SCORES.body_marks
  const adjustedMax = Math.max(30, MAX_BASE - Math.round(deductedMax))

  // Childbirth / parity — forensic bone analysis or stated history
  const ca = m.childbirth, cb = u.childbirth
  const childbirthScore = (ca === 'unknown' || cb === 'unknown') ? 0
    : ca === cb ? (ca === 'evidence' ? 8 : 5)
    : -20

  const rawScore = sexScore + raceScore + ageScore + hair + eyes + heightScore + weight + tattoo + bodyMarks + jewelryScore + locationScore + childbirthScore
  const composite = Math.round(Math.max(0, Math.min(100, ((rawScore + fullUniqueId.score) / adjustedMax) * 100)))
  const grade = composite >= 73 ? 'very_strong' : composite >= 56 ? 'strong' : composite >= 39 ? 'notable' : composite >= 22 ? 'moderate' : 'weak'

  const signals: Record<string, unknown> = {
    sex:        { score: sexScore,      match: !sa||!sb ? 'unknown' : sa===sb ? 'exact' : 'mismatch' },
    race:       { score: raceScore,     match: !ra&&!rb ? 'both_unknown' : !ra||!rb ? 'unknown' : ra===rb ? 'exact' : raceScore===6 ? 'partial' : 'mismatch' },
    age:        { score: ageScore,      match: ageScore===15?'very_close':ageScore===10?'close':ageScore===5?'possible':ageScore===0?'distant':ageScore===-10?'incompatible':'unknown', detail: ageDet },
    hair:       { score: hair,          match: !ha||!hb ? 'unknown' : hairRaw===8 ? 'exact' : hairRaw===3 ? 'adjacent' : 'no_match' },
    eyes:       { score: eyes,          match: !ea||!eb ? 'unknown' : eyesRaw===8 ? 'exact' : eyesRaw===3 ? 'adjacent' : 'no_match' },
    height:     { score: heightScore,   match: heightScore===8?'exact':heightScore===6?'very_close':heightScore===4?'close':heightScore===2?'possible':!ia||!ib?'unknown':'no_match' },
    weight:     { score: weight,        match: weightRaw===5?'exact':weightRaw===3?'close':weightRaw===1?'possible':!wa||!wb?'unknown':'no_match' },
    tattoo:     { score: tattoo,        match: sharedMotifs.length>=3?'strong_match':sharedMotifs.length>=2?'partial_match':sharedMotifs.length>=1?'possible_match':mTattooMotifs.length>0&&uTattooMotifs.length>0?'both_have_tattoos':!mMarksText.includes('tattoo')&&!uMarksText.includes('tattoo')?'none_mentioned':'one_side_only', keywords: sharedMotifs },
    body_marks: { score: bodyMarks,     match: sharedBodyMarks.length>0?'shared':mBodyMarks.length>0&&uBodyMarks.length>0?'both_have_marks':'none_mentioned', keywords: sharedBodyMarks },
    jewelry:    { score: jewelryScore,  match: sharedCompoundJewel.length>0?'specific_match':sharedGenericJewel.length>0?'generic_match':mJewelTokens.size>0&&uJewelTokens.size>0?'both_have_jewelry':'none_mentioned', keywords: [...sharedCompoundJewel, ...sharedGenericJewel] },
    location:   { score: locationScore, match: !m.state||!u.state?'unknown':m.state===u.state?'same_state':locationScore===5?'adjacent_state':'different_state' },
    childbirth: { score: childbirthScore, match: (ca==='unknown'||cb==='unknown')?'unknown':ca===cb?(ca==='evidence'?'both_parous':'both_nulliparous'):'mismatch' },
    body_state: { state: u.bodyState, note: null, weight_applied: u.bodyState !== 'intact' && u.bodyState !== 'unknown' },
  }

  // Forensic availability note
  const forensicNotes: string[] = []
  if (m.dental?.toLowerCase().includes('available')) forensicNotes.push('Missing: dentals available')
  if (u.dental?.toLowerCase().includes('available')) forensicNotes.push('Unidentified: dentals available')
  if (m.dna && !/not available/i.test(m.dna)) forensicNotes.push(`Missing: DNA — ${m.dna}`)
  if (u.dna && !/not available/i.test(u.dna)) forensicNotes.push(`Unidentified: DNA — ${u.dna}`)
  if (m.fingerprints?.toLowerCase().includes('available')) forensicNotes.push('Missing: prints available')
  if (u.fingerprints?.toLowerCase().includes('available')) forensicNotes.push('Unidentified: prints available')
  if (forensicNotes.length) {
    signals.forensic_availability = { note: forensicNotes.join('; ') }
  }
  if (fullUniqueId.score > 0) {
    signals.unique_identifier = {
      score: fullUniqueId.score, match: fullUniqueId.shared.length >= 5 ? 'near_certain' : fullUniqueId.shared.length >= 3 ? 'strong' : 'possible',
      keywords: fullUniqueId.shared, detail: fullUniqueId.detail,
      overrode_elimination: fullUniqueId.overrides && (sa && sb && sa !== sb),
    }
  }

  return { eliminated: false, composite, grade, signals }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const resume = process.argv.includes('--resume')
  console.log('\nDoe Network Cross-Match Runner')
  console.log('==============================')
  if (resume) console.log('Mode: RESUME (skipping deletion, skipping already-scored pairs)')

  // Find cases by title
  const { data: cases } = await supabase
    .from('cases')
    .select('id, title')
    .ilike('title', '%Doe Network%')

  if (!cases?.length) {
    console.error('No Doe Network cases found. Run the import first.')
    process.exit(1)
  }

  console.log('\nFound cases:')
  cases.forEach(c => console.log(`  ${c.id}  ${c.title}`))

  const missingCase       = cases.find(c => c.title.includes('Missing'))
  const unidentifiedCases = cases.filter(c => c.title.includes('Unidentified') || c.title.includes('Remains'))

  if (!missingCase)            { console.error('Missing persons case not found'); process.exit(1) }
  if (!unidentifiedCases.length) { console.error('Unidentified case not found');  process.exit(1) }

  console.log(`\nMissing:      ${missingCase.id}`)
  unidentifiedCases.forEach(c => console.log(`Unidentified: ${c.id}  (${c.title})`))

  if (resume) {
    console.log('\nResume mode — keeping existing candidates, will skip already-scored pairs.')
  } else {
    // Delete all existing unreviewed match candidates for a clean rescore
    console.log('\nClearing unreviewed match candidates…')
    let deletedTotal = 0
    while (true) {
      const { data: ids } = await supabase
        .from('doe_match_candidates')
        .select('id')
        .eq('missing_case_id', missingCase.id)
        .eq('reviewer_status', 'unreviewed')
        .limit(500)
      if (!ids?.length) break
      const { error } = await supabase
        .from('doe_match_candidates')
        .delete()
        .in('id', ids.map((r: { id: string }) => r.id))
      if (error) { console.error(`  Delete error: ${error.message}`); break }
      deletedTotal += ids.length
      process.stdout.write(`\r  Deleted ${deletedTotal} unreviewed candidates…`)
      if (ids.length < 500) break
    }
    console.log(`\r  Deleted ${deletedTotal} unreviewed candidates. Human-reviewed pairs preserved.`)
  }

  // Load ALL unidentified remains from ALL unidentified cases
  console.log('\nLoading unidentified remains…')
  const unidentified: ReturnType<typeof parseSubmission>[] = []
  for (const uc of unidentifiedCases) {
    const { data: uidRaw } = await supabase
      .from('submissions')
      .select('id, case_id, raw_text, notes')
      .eq('case_id', uc.id)
    const parsed = (uidRaw ?? []).map(s => parseSubmission(s as RawSub))
    console.log(`  ${parsed.length} records from "${uc.title}"`)
    unidentified.push(...parsed)
  }
  console.log(`  ${unidentified.length} total unidentified records loaded`)

  // Process missing persons in batches of 400
  const BATCH = 400
  let offset = 0
  let totalInserted = 0
  let totalEliminated = 0
  let batchNum = 0

  const { count: totalMissingCount } = await supabase
    .from('submissions')
    .select('*', { count: 'exact', head: true })
    .eq('case_id', missingCase.id)
  const totalMissing = totalMissingCount ?? 0
  console.log(`\nProcessing ${totalMissing.toLocaleString()} missing persons in batches of ${BATCH}…`)

  do {
    batchNum++
    const { data: missingRaw } = await supabase
      .from('submissions')
      .select('id, case_id, raw_text, notes')
      .eq('case_id', missingCase.id)
      .range(offset, offset + BATCH - 1)
    const missing = (missingRaw ?? []).map(s => parseSubmission(s as RawSub))
    if (!missing.length) break

    // In resume mode, skip pairs already in the DB
    let existingPairs = new Set<string>()
    if (resume) {
      const missingIds = missing.map(p => p.submissionId)
      const { data: existing } = await supabase
        .from('doe_match_candidates')
        .select('missing_submission_id, unidentified_submission_id')
        .in('missing_submission_id', missingIds) as { data: Array<{ missing_submission_id: string; unidentified_submission_id: string }> | null }
      existingPairs = new Set((existing ?? []).map(e => `${e.missing_submission_id}__${e.unidentified_submission_id}`))
    }

    const toInsert: object[] = []
    let eliminated = 0

    for (const m of missing) {
      const mCandidates: Array<{ composite: number; row: object }> = []
      for (const u of unidentified) {
        if (resume && existingPairs.has(`${m.submissionId}__${u.submissionId}`)) continue
        const r = scoreMatch(m, u)
        if (r.eliminated) { eliminated++; continue }
        if (r.composite < 73) continue  // very_strong only
        mCandidates.push({
          composite: r.composite,
          row: {
            missing_submission_id:      m.submissionId,
            unidentified_submission_id: u.submissionId,
            missing_case_id:            missingCase.id,
            unidentified_case_id:       u.caseId ?? unidentifiedCases[0].id,
            composite_score:            r.composite,
            grade:                      r.grade,
            signals:                    r.signals,
            missing_doe_id:             m.doeId,  missing_name:     m.name,
            missing_sex:                m.sex,    missing_race:     m.race,
            missing_age:                m.age,    missing_location: m.location,
            missing_date:               m.date,   missing_hair:     m.hair,
            missing_eyes:               m.eyes,   missing_marks:    m.marks,
            unidentified_doe_id:        u.doeId,  unidentified_sex:      u.sex,
            unidentified_race:          u.race,   unidentified_age:      u.age,
            unidentified_location:      u.location, unidentified_date:   u.date,
            unidentified_hair:          u.hair,   unidentified_eyes:     u.eyes,
            unidentified_marks:         u.marks,  unidentified_jewelry:  u.jewelry,
            missing_jewelry:            m.jewelry,
          },
        })
      }
      // Keep only top 10 per missing person, sorted by score descending
      mCandidates.sort((a, b) => b.composite - a.composite)
      for (const c of mCandidates.slice(0, 10)) toInsert.push(c.row)
    }

    // Upsert in sub-batches of 100
    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 100) {
      const { error } = await supabase
        .from('doe_match_candidates')
        .insert(toInsert.slice(i, i + 100) as never)
      if (error) {
        process.stdout.write('\n')
        console.error(`  ✗ Upsert error (batch ${i/100+1}): ${error.message}`)
      } else {
        inserted += Math.min(100, toInsert.length - i)
      }
    }

    offset += missing.length
    totalInserted  += inserted
    totalEliminated += eliminated

    const pct = totalMissing ? Math.round((offset / totalMissing) * 100) : 0
    process.stdout.write(`\r  Batch ${batchNum}: ${offset.toLocaleString()}/${totalMissing.toLocaleString()} (${pct}%) — ${totalInserted.toLocaleString()} candidates stored        `)

  } while (offset < totalMissing)

  console.log(`\n\n═══════════════════════════════════════`)
  console.log(`Cross-match complete`)
  console.log(`  Missing persons processed: ${offset.toLocaleString()}`)
  console.log(`  Unidentified compared:     ${unidentified.length.toLocaleString()}`)
  console.log(`  Candidates stored:         ${totalInserted.toLocaleString()}`)
  console.log(`  Eliminated (sex/age):      ${totalEliminated.toLocaleString()}`)
  console.log(`\nResults are in the Patterns → Match tab.`)
}

main().catch(e => { console.error(e); process.exit(1) })
