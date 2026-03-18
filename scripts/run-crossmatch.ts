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
  }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

const DECOMP_WEIGHTS: Record<BodyState, { hair: number; eyes: number; weight: number; marks: number }> = {
  intact:  { hair:1.0, eyes:1.0, weight:1.0, marks:1.0 },
  mild:    { hair:0.9, eyes:0.9, weight:0.8, marks:0.9 },
  moderate:{ hair:0.5, eyes:0.3, weight:0.4, marks:0.6 },
  advanced:{ hair:0.1, eyes:0.0, weight:0.1, marks:0.3 },
  skeletal:{ hair:0.0, eyes:0.0, weight:0.0, marks:0.2 },
  burned:  { hair:0.0, eyes:0.0, weight:0.0, marks:0.1 },
  partial: { hair:0.3, eyes:0.1, weight:0.2, marks:0.4 },
  unknown: { hair:0.8, eyes:0.8, weight:0.8, marks:0.8 },
}
const MAX_SCORES = { sex:15, race:12, age:15, hair:8, eyes:8, height:8, weight:5, marks:8, location:10 }
const MAX_BASE = Object.values(MAX_SCORES).reduce((a,b) => a+b, 0) // 89

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
const MARK_KW = [
  'tattoo','scar','birthmark','piercing','mole','brand','amputation','prosthetic','implant',
  'surgical','surgery','deformity','missing finger','missing tooth','gold tooth',
  'arm','leg','chest','back','neck','hand','shoulder','wrist','ankle','face','forehead','abdomen','torso',
  'eagle','cross','rose','dragon','skull','snake','heart','star','butterfly','anchor',
  'tribal','flag','military','name','initial','letter','number','portrait','angel','devil',
  'wing','sword','knife','gun','flower','tiger','wolf','bear','lion','phoenix','moon','sun',
  'left','right','upper','lower','inner','outer',
  'jeans','pants','shorts','shirt','sweater','jacket','coat','dress','skirt','hoodie','vest',
  'sneakers','boots','shoes','heels','sandals','slippers','loafers',
  'nike','adidas','converse','vans','jordan','reebok','puma','levis','wrangler',
  'torn','ripped','faded','striped','plaid','denim','flannel','polo','camouflage','camo','size',
  'necklace','bracelet','ring','earring','watch','chain','locket','pendant','medallion',
  'choker','bangle','anklet','brooch',
  'gold','silver','diamond','engraved','inscription','initials','monogram',
  'red','blue','green','black','white','gray','grey','brown','pink','purple','yellow','orange','maroon','navy',
]

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
  const sa = normSex(m.sex), sb = normSex(u.sex)
  if (sa && sb && sa !== sb) return { eliminated: true, reason: 'sex_mismatch', composite: 0, grade: 'weak', signals: {} }

  const ma = parseAgeRange(m.age), ua = parseAgeRange(u.age)
  if (ma && ua) {
    let adj = ma as [number,number]
    if (m.year && u.year && u.year > m.year) { const e = u.year - m.year; adj = [ma[0]+e, ma[1]+e] }
    if (adj[0] > ua[1] + 10 || ua[0] > adj[1] + 10) return { eliminated: true, reason: 'age_incompatible', composite: 0, grade: 'weak', signals: {} }
  }

  // Sex
  const sexScore = !sa || !sb ? 0 : sa === sb ? 15 : 0

  // Race — both genuinely unknown gets small partial credit (unknown ≠ mismatch)
  const ra = normRace(m.race), rb = normRace(u.race)
  const raceScore = (!ra && !rb) ? 2 : (!ra || !rb) ? 0 : ra === rb ? 12 : (() => {
    const al = (m.race??'').toLowerCase(), bl = (u.race??'').toLowerCase()
    const gs = Object.keys(RACE_GROUPS)
    const aG = gs.filter(g => RACE_GROUPS[g].some(t => al.includes(t)))
    const bG = gs.filter(g => RACE_GROUPS[g].some(t => bl.includes(t)))
    return aG.some(g => bG.includes(g)) ? 6 : 0
  })()

  // Age
  let ageScore = 0, ageDet = ''
  if (ma && ua) {
    let adj = ma as [number,number]
    if (m.year && u.year && u.year > m.year) { const e = u.year - m.year; adj = [ma[0]+e, ma[1]+e] }
    const diff = Math.abs((adj[0]+adj[1])/2 - (ua[0]+ua[1])/2)
    ageScore = diff <= 3 ? 15 : diff <= 7 ? 10 : diff <= 12 ? 5 : 2
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

  // Marks — combine distinguishing marks + clothing + jewelry
  const norm = (s: string | null) => (s??'').toLowerCase()
  const fullA = [m.marks, m.clothing, m.jewelry].filter(Boolean).join(' ')
  const fullB = [u.marks, u.clothing, u.jewelry].filter(Boolean).join(' ')
  const kA = MARK_KW.filter(k => norm(fullA).includes(k))
  const kB = MARK_KW.filter(k => norm(fullB).includes(k))
  const shared = kA.filter(k => kB.includes(k))
  const marksRaw = shared.length > 0 ? Math.min(8, shared.length*3) : kA.length>0&&kB.length>0 ? 2 : 0

  // Location — bidirectional adjacency check
  const locationScore = !m.state || !u.state ? 0 : m.state===u.state ? 10 :
    (STATE_ADJ[m.state]?.includes(u.state) || STATE_ADJ[u.state]?.includes(m.state)) ? 5 : 0

  // Apply decomp weights
  const w = DECOMP_WEIGHTS[u.bodyState]
  const hair   = Math.round(hairRaw   * w.hair)
  const eyes   = Math.round(eyesRaw   * w.eyes)
  const weight = Math.round(weightRaw * w.weight)
  const marks  = Math.round(marksRaw  * w.marks)

  const deductedMax =
    (1-w.hair)*MAX_SCORES.hair + (1-w.eyes)*MAX_SCORES.eyes +
    (1-w.weight)*MAX_SCORES.weight + (1-w.marks)*MAX_SCORES.marks
  const adjustedMax = Math.max(30, MAX_BASE - Math.round(deductedMax))

  const rawScore = sexScore + raceScore + ageScore + hair + eyes + heightScore + weight + marks + locationScore
  const composite = Math.round(Math.min(100, (Math.max(0, rawScore) / adjustedMax) * 100))
  const grade = composite >= 73 ? 'very_strong' : composite >= 56 ? 'strong' : composite >= 39 ? 'notable' : composite >= 22 ? 'moderate' : 'weak'

  const signals = {
    sex:      { score: sexScore,    match: !sa||!sb ? 'unknown' : sa===sb ? 'exact' : 'mismatch' },
    race:     { score: raceScore,   match: !ra&&!rb ? 'both_unknown' : !ra||!rb ? 'unknown' : ra===rb ? 'exact' : raceScore===6 ? 'partial' : 'no_match' },
    age:      { score: ageScore,    match: ageScore===15?'very_close':ageScore===10?'close':ageScore===5?'possible':ageScore===2?'overlap':'unknown', detail: ageDet },
    hair:     { score: hair,        match: !ha||!hb ? 'unknown' : hairRaw===8 ? 'exact' : hairRaw===3 ? 'adjacent' : 'no_match' },
    eyes:     { score: eyes,        match: !ea||!eb ? 'unknown' : eyesRaw===8 ? 'exact' : eyesRaw===3 ? 'adjacent' : 'no_match' },
    height:   { score: heightScore, match: heightScore===8?'exact':heightScore===6?'very_close':heightScore===4?'close':heightScore===2?'possible':!ia||!ib?'unknown':'no_match' },
    weight:   { score: weight,      match: weightRaw===5?'exact':weightRaw===3?'close':weightRaw===1?'possible':!wa||!wb?'unknown':'no_match' },
    marks:    { score: marks,       match: shared.length>=3?'strong_overlap':shared.length>0?'partial_overlap':kA.length>0&&kB.length>0?'both_have_marks':!m.marks&&!u.marks?'none_mentioned':'one_side_only', keywords: shared },
    location: { score: locationScore, match: !m.state||!u.state?'unknown':m.state===u.state?'same_state':locationScore===5?'adjacent_state':'different_state' },
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
    (signals as Record<string, unknown>).forensic_availability = { note: forensicNotes.join('; ') }
  }

  return { eliminated: false, composite, grade, signals }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nDoe Network Cross-Match Runner')
  console.log('==============================')

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

    // Check existing pairs to avoid re-scoring
    const missingIds = missing.map(p => p.submissionId)
    const { data: existing } = await supabase
      .from('doe_match_candidates')
      .select('missing_submission_id, unidentified_submission_id')
      .in('missing_submission_id', missingIds)

    const existingPairs = new Set(
      ((existing ?? []) as Array<{ missing_submission_id: string; unidentified_submission_id: string }>)
        .map(e => `${e.missing_submission_id}__${e.unidentified_submission_id}`)
    )

    const toInsert: object[] = []
    let eliminated = 0

    for (const m of missing) {
      for (const u of unidentified) {
        if (existingPairs.has(`${m.submissionId}__${u.submissionId}`)) continue
        const r = scoreMatch(m, u)
        if (r.eliminated) { eliminated++; continue }
        if (r.composite < 22) continue
        toInsert.push({
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
          unidentified_marks:         u.marks,
        })
      }
    }

    // Upsert in sub-batches of 100
    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 100) {
      const { error } = await supabase
        .from('doe_match_candidates')
        .upsert(toInsert.slice(i, i + 100) as never, {
          onConflict: 'missing_submission_id,unidentified_submission_id',
          ignoreDuplicates: true,
        })
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
