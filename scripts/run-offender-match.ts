/**
 * Offender Pattern Match
 *
 * Scores every Doe Network submission against all 100 known offenders.
 * Stores results in offender_case_overlaps where composite >= MIN_SCORE.
 *
 * Scoring (100 pts total):
 *   Temporal          20  — active period + birth-year floor (hard eliminate if after incarceration)
 *   Predator geo      25  — submission state in offender home/travel/operation states
 *   Victim geo        20  — submission state in offender's known victim states
 *   Sex               15  — victim sex match
 *   Age               10  — decay curve from victim_age_typical (±3yr=full, ±7=half, ±12=low, else 0)
 *   Race               5  — victim race match
 *   MO keywords        5  — circumstances text hits offender MO keywords
 *
 * Run: npx tsx scripts/run-offender-match.ts
 * Dry: npx tsx scripts/run-offender-match.ts --dry-run
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const isDryRun = process.argv.includes('--dry-run')
const MIN_SCORE = 65

// ── Helpers ──────────────────────────────────────────────────────────────────

const US_STATES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',
  KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',
  MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',
  NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',
  NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  BC:'British Columbia',NSW:'New South Wales',
}
const STATE_FULL_TO_ABBR = Object.fromEntries(
  Object.entries(US_STATES).map(([a, f]) => [f.toLowerCase(), a])
)

function extractStateAbbr(text: string): string | null {
  if (!text) return null
  const t = text.toLowerCase()
  for (const [full, abbr] of Object.entries(STATE_FULL_TO_ABBR)) {
    if (t.includes(full)) return abbr
  }
  const abbrRe = /\b([A-Z]{2})\b/g
  let m: RegExpExecArray | null
  while ((m = abbrRe.exec(text)) !== null) {
    if (US_STATES[m[1]]) return m[1]
  }
  return null
}

function extractYear(text: string): number | null {
  const m = text.match(/\b(19[5-9]\d|20[012]\d)\b/)
  return m ? parseInt(m[1]) : null
}

function extractSex(text: string): string | null {
  const t = text.toLowerCase()
  if (/\bfemale\b|\bwoman\b|\bgirl\b|\bshe\b|\bher\b/.test(t)) return 'female'
  if (/\bmale\b|\bman\b|\bboy\b|\bhe\b|\bhim\b/.test(t)) return 'male'
  return null
}

function extractRace(text: string): string | null {
  const t = text.toLowerCase()
  if (/\bwhite\b|\bcaucasian\b/.test(t)) return 'white'
  if (/\bblack\b|\bafrican\b/.test(t)) return 'black'
  if (/\bhispanic\b|\blatino\b|\blatina\b/.test(t)) return 'hispanic'
  if (/\basian\b/.test(t)) return 'asian'
  if (/\bnative american\b|\bindian\b|\bindigenous\b/.test(t)) return 'native_american'
  return null
}

function extractAge(text: string): number | null {
  const patterns = [
    /age[:\s]+(\d{1,2})/i,
    /(\d{1,2})[- ]year[s]?[- ]old/i,
    /(\d{1,2})\s*(?:yoa|y\.o\.)/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) { const a = parseInt(m[1]); if (a >= 1 && a <= 100) return a }
  }
  return null
}

const MO_KEYWORD_MAP: Record<string, string[]> = {
  hitchhiker:       ['hitchhik', 'thumb', 'picked up', 'getting a ride', 'accepting ride'],
  sex_worker:       ['prostitut', 'sex work', 'escort', 'streetwalker', 'working girl'],
  truck_stop:       ['truck stop', 'trucker', 'semi', 'rest area', 'travel plaza'],
  long_haul_trucker:['trucker', 'truck driver', 'semi', 'long haul', 'freight'],
  highway_abduction:['highway', 'interstate', 'roadside', 'along i-', 'along the road'],
  college_campus:   ['college', 'university', 'campus', 'student', 'dorm'],
  home_invasion:    ['home invasion', 'broke into', 'entered the home', 'found at home', 'at her residence'],
  runaway:          ['runaway', 'ran away', 'run away', 'left home voluntarily'],
  bar:              [' bar ', 'tavern', 'nightclub', 'last seen at a bar', 'drinking'],
  drifter:          ['drifter', 'transient', 'homeless', 'no fixed address', 'vagrant'],
  children:         ['child', 'juvenile', 'minor', 'elementary', 'playground'],
  national_park:    ['national park', 'state park', 'trail', 'hiking', 'campsite', 'forest'],
  stalking:         ['stalking', 'stalked', 'following', 'surveilling'],
  modeling_ruse:    ['model', 'photograp', 'audition', 'talent'],
  rail:             ['railroad', 'rail', 'freight train', 'hobo'],
}

function scoreMoKeywords(text: string, moKeywords: string[]): { score: number; matched: string[] } {
  if (!text || !moKeywords.length) return { score: 0, matched: [] }
  const t = text.toLowerCase()
  const matched: string[] = []
  for (const kw of moKeywords) {
    const patterns = MO_KEYWORD_MAP[kw] ?? [kw.replace(/_/g, ' ')]
    if (patterns.some(p => t.includes(p.toLowerCase()))) matched.push(kw)
  }
  // 1 match = 10, 2 = 16, 3+ = 22 (max)
  const score = matched.length === 0 ? 0 : matched.length === 1 ? 10 : matched.length === 2 ? 16 : 22
  return { score, matched }
}

interface Offender {
  id: string
  name: string
  birth_year: number | null
  active_from: number | null
  active_to: number | null
  incarcerated_from: number | null
  home_states: string[]
  travel_corridors: string[]
  operation_states: string[]
  victim_states: string[]
  victim_sex: string | null
  victim_races: string[]
  victim_age_min: number | null
  victim_age_max: number | null
  victim_age_typical: number | null
  mo_keywords: string[]
}

function scoreSubmission(
  sub: { state: string | null; year: number | null; sex: string | null; race: string | null; age: number | null; text: string },
  off: Offender,
): { composite: number; temporal: number; predGeo: number; vicGeo: number; sexScore: number; ageScore: number; raceScore: number; moScore: number; matchedMo: string[] } | null {

  // ── Temporal hard eliminate ───────────────────────────────────────────────
  let temporal = 0
  if (sub.year !== null) {
    // Born too recently to have been active
    if (off.birth_year && sub.year < off.birth_year + 14) return null
    // Victim disappeared after confirmed incarceration
    if (off.incarcerated_from && sub.year > off.incarcerated_from + 1) return null

    if (off.active_from && off.active_to) {
      const buffer = 3 // allow 3-year window either side
      if (sub.year >= off.active_from - buffer && sub.year <= off.active_to + buffer) {
        temporal = sub.year >= off.active_from && sub.year <= off.active_to ? 15 : 8
      } else {
        temporal = 0
      }
    } else if (off.active_from) {
      temporal = sub.year >= off.active_from ? 12 : 4
    } else {
      temporal = 8
    }
  } else {
    temporal = 8 // unknown year — partial credit
  }

  // ── Geographic scores ─────────────────────────────────────────────────────
  let predGeo = 0
  let vicGeo = 0
  if (sub.state) {
    const homeStates   = off.home_states ?? []
    const opStates     = off.operation_states ?? []
    const victimStates = off.victim_states ?? []
    const homeMatch    = homeStates.includes(sub.state)
    const opMatch      = opStates.includes(sub.state)
    const victimMatch  = victimStates.includes(sub.state)

    predGeo = homeMatch ? 20 : opMatch ? 12 : 0
    vicGeo  = victimMatch ? 15 : opMatch ? 6 : 0
  }

  // ── Sex ───────────────────────────────────────────────────────────────────
  let sexScore = 0
  if (sub.sex && off.victim_sex) {
    if (off.victim_sex === 'both') sexScore = 10
    else if (off.victim_sex === sub.sex) sexScore = 15
    else return null // sex mismatch — hard eliminate
  } else {
    sexScore = 6 // unknown
  }

  // ── Age decay curve ───────────────────────────────────────────────────────
  let ageScore = 0
  if (sub.age !== null && off.victim_age_typical !== null) {
    const diff = Math.abs(sub.age - off.victim_age_typical)
    ageScore = diff <= 3 ? 8 : diff <= 7 ? 5 : diff <= 12 ? 2 : diff <= 18 ? 1 : 0
  } else if (sub.age !== null && off.victim_age_min !== null && off.victim_age_max !== null) {
    const inRange = sub.age >= off.victim_age_min - 5 && sub.age <= off.victim_age_max + 5
    ageScore = inRange ? 5 : 0
  } else {
    ageScore = 3 // unknown age
  }

  // ── Race ──────────────────────────────────────────────────────────────────
  let raceScore = 0
  if (sub.race && off.victim_races.length > 0) {
    raceScore = off.victim_races.includes(sub.race) ? 5 : 0
  } else {
    raceScore = 2 // unknown
  }

  // ── MO keywords ───────────────────────────────────────────────────────────
  const { score: moScore, matched: matchedMo } = scoreMoKeywords(sub.text, off.mo_keywords)

  // Require predator geographic signal — victim-state-only matches are too weak
  if (predGeo === 0) return null

  const composite = temporal + predGeo + vicGeo + sexScore + ageScore + raceScore + moScore
  return { composite, temporal, predGeo, vicGeo, sexScore, ageScore, raceScore, moScore, matchedMo }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nOffender Pattern Match${isDryRun ? ' (DRY RUN)' : ''}\n`)

  // Load offenders
  const { data: offenders, error: offErr } = await supabase
    .from('known_offenders')
    .select('id,name,birth_year,active_from,active_to,incarcerated_from,home_states,travel_corridors,operation_states,victim_states,victim_sex,victim_races,victim_age_min,victim_age_max,victim_age_typical,mo_keywords') as { data: Offender[] | null; error: unknown }
  if (offErr || !offenders?.length) { console.error('Could not load offenders:', offErr); process.exit(1) }
  console.log(`Loaded ${offenders.length} offenders`)

  // Find Doe Network cases — include resolution fields (with graceful fallback if migrations not yet run)
  let cases: Array<{ id: string; title: string; resolution_type: string | null; convicted_offender_id: string | null }> | null = null

  const { data: casesWithRes, error: resErr } = await supabase
    .from('cases')
    .select('id, title, resolution_type, convicted_offender_id')
    .ilike('title', '%Doe Network%') as {
      data: Array<{ id: string; title: string; resolution_type: string | null; convicted_offender_id: string | null }> | null
      error: { message?: string } | null
    }

  if (resErr) {
    // Migrations 017/018 not yet run — fall back to base columns
    console.warn(`  Note: resolution columns not found (${resErr.message}) — run migrations 017 & 018 in Supabase to enable resolution-aware matching`)
    const { data: casesBase } = await supabase
      .from('cases')
      .select('id, title')
      .ilike('title', '%Doe Network%')
    cases = (casesBase ?? []).map(c => ({ ...c, resolution_type: null, convicted_offender_id: null }))
  } else {
    cases = casesWithRes
  }

  if (!cases?.length) { console.error('No Doe Network cases found'); process.exit(1) }

  // Cases where matching is meaningless — person found alive or duplicate entry
  const SKIP_RESOLUTIONS = new Set(['found_alive', 'duplicate_case'])
  const activeCases    = cases.filter(c => !SKIP_RESOLUTIONS.has(c.resolution_type ?? ''))
  const skippedCases   = cases.filter(c =>  SKIP_RESOLUTIONS.has(c.resolution_type ?? ''))

  activeCases.forEach(c => console.log(`  · ${c.title}${c.resolution_type ? ` [${c.resolution_type}]` : ''}`))
  if (skippedCases.length) {
    console.log(`  Skipping ${skippedCases.length} case(s) — resolved as found_alive or duplicate:`)
    skippedCases.forEach(c => console.log(`    - ${c.title}`))
  }

  // Build map: caseId → convicted_offender_id (for confirmed flagging)
  const convictedMap = new Map<string, string>()
  for (const c of activeCases) {
    if (c.convicted_offender_id) convictedMap.set(c.id, c.convicted_offender_id)
  }

  const allCaseIds = cases.map(c => c.id)
  const activeCaseIds = activeCases.map(c => c.id)

  // Clear existing overlaps for ALL these cases
  if (!isDryRun) {
    await supabase.from('offender_case_overlaps' as never).delete().in('case_id', allCaseIds as never)
    console.log('Cleared existing overlaps')
  }

  // Resolution types that mean the submission-level person was found/resolved — skip matching
  const SKIP_SUB_RESOLUTIONS = new Set(['found_alive', 'duplicate_case'])

  // Process submissions in batches (active cases only)
  let totalProcessed = 0, totalMatches = 0, totalConfirmed = 0, totalSubSkipped = 0, from = 0
  const toInsert: Record<string, unknown>[] = []
  const caseIds = activeCaseIds

  while (true) {
    // Fetch with submission-level resolution fields (graceful if migration 019 not yet run)
    let subs: Array<{ id: string; case_id: string; raw_text: string; resolution_type?: string | null; convicted_offender_id?: string | null }> | null = null

    const { data: subsWithRes, error: subResErr } = await supabase
      .from('submissions')
      .select('id, case_id, raw_text, resolution_type, convicted_offender_id')
      .in('case_id', caseIds)
      .range(from, from + 499) as {
        data: Array<{ id: string; case_id: string; raw_text: string; resolution_type: string | null; convicted_offender_id: string | null }> | null
        error: { message?: string } | null
      }

    if (subResErr) {
      // Migration 019 not yet applied — fall back without resolution columns
      const { data: subsBase } = await supabase
        .from('submissions')
        .select('id, case_id, raw_text')
        .in('case_id', caseIds)
        .range(from, from + 499)
      subs = (subsBase ?? []).map(s => ({ ...s, resolution_type: null, convicted_offender_id: null }))
    } else {
      subs = subsWithRes
    }

    if (!subs?.length) break

    for (const sub of subs) {
      // Skip if this individual person was found alive or is a duplicate
      if (SKIP_SUB_RESOLUTIONS.has(sub.resolution_type ?? '')) {
        totalSubSkipped++
        continue
      }

      const text = sub.raw_text ?? ''
      const parsed = {
        state: extractStateAbbr(text),
        year:  extractYear(text),
        sex:   extractSex(text),
        race:  extractRace(text),
        age:   extractAge(text),
        text,
      }

      for (const off of offenders) {
        const scores = scoreSubmission(parsed, off)
        if (!scores || scores.composite < MIN_SCORE) continue

        // Confirmed if: case-level link OR submission-level link matches this offender
        const isConfirmed =
          convictedMap.get(sub.case_id) === off.id ||
          sub.convicted_offender_id === off.id

        toInsert.push({
          offender_id:              off.id,
          submission_id:            sub.id,
          case_id:                  sub.case_id,
          composite_score:          scores.composite,
          temporal_score:           scores.temporal,
          predator_geo_score:       scores.predGeo,
          victim_geo_score:         scores.vicGeo,
          victim_sex_score:         scores.sexScore,
          victim_age_score:         scores.ageScore,
          victim_race_score:        scores.raceScore,
          mo_score:                 scores.moScore,
          matched_mo_keywords:      scores.matchedMo,
          resolution_confirmed:     isConfirmed,
        })
        totalMatches++
        if (isConfirmed) totalConfirmed++
      }
      totalProcessed++
    }

    // Flush inserts in batches of 200
    if (!isDryRun && toInsert.length >= 200) {
      await supabase.from('offender_case_overlaps' as never).insert(toInsert.splice(0, 200) as never)
    }

    process.stdout.write(`  Processed ${totalProcessed} subs · ${totalMatches} overlaps found...\r`)
    if (subs.length < 500) break
    from += 500
  }

  // Flush remaining
  if (!isDryRun && toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 200) {
      await supabase.from('offender_case_overlaps' as never).insert(toInsert.slice(i, i + 200) as never)
    }
  }

  console.log(`\n\n── Results ────────────────────────────────────────────────────────`)
  console.log(`  Cases processed:       ${activeCases.length} (${skippedCases.length} skipped — resolved)`)
  console.log(`  Submissions processed: ${totalProcessed.toLocaleString()} (${totalSubSkipped} skipped — resolved individuals)`)
  console.log(`  Overlaps found (≥${MIN_SCORE}): ${totalMatches.toLocaleString()}`)
  console.log(`  Confirmed connections: ${totalConfirmed.toLocaleString()}`)
  if (isDryRun) console.log('\n[DRY RUN] No rows written.')
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
