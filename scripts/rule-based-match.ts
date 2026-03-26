/**
 * Rule-Based Matching & Filtering
 *
 * Step 1 of the pipeline. Uses ONLY structured fields from import_records
 * (already populated by scrapers). No AI. No API costs. Pure math.
 *
 * Does:
 *   1. Missing ↔ Unidentified matching (sex, age, race, state, date)
 *   2. Stalled case detection (runaway/voluntary + years cold)
 *   3. Pre-solvability scoring (has vehicle? has named POI? has witnesses?)
 *   4. Flags records that need AI extraction (has narrative text worth analyzing)
 *
 * Populates: global_connections, intelligence_queue, marks records for AI
 *
 * Usage: npx tsx scripts/rule-based-match.ts [--state VA] [--limit 5000]
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const args = process.argv.slice(2)
const stateIdx = args.indexOf('--state')
const STATE = stateIdx !== -1 ? args[stateIdx + 1] : null
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 5000

// ─── Helpers ────────────────────────────────────────────────────────────────

function normSex(s: string | null): string {
  if (!s) return 'unknown'
  const l = s.toLowerCase().trim()
  if (l === 'male' || l === 'm') return 'male'
  if (l === 'female' || l === 'f') return 'female'
  return 'unknown'
}

function normRace(r: string | null): string {
  if (!r) return 'unknown'
  const l = r.toLowerCase().trim()
  if (l.includes('white') || l.includes('caucasian')) return 'white'
  if (l.includes('black') || l.includes('african')) return 'black'
  if (l.includes('hispanic') || l.includes('latino') || l.includes('latina')) return 'hispanic'
  if (l.includes('asian')) return 'asian'
  if (l.includes('native') || l.includes('indian') || l.includes('indigenous')) return 'native'
  if (l.includes('pacific') || l.includes('hawaiian')) return 'pacific_islander'
  return l
}

function parseAge(ageText: string | null): { min: number; max: number } | null {
  if (!ageText) return null
  const range = ageText.match(/(\d+)\s*[-–]\s*(\d+)/)
  if (range) return { min: parseInt(range[1]), max: parseInt(range[2]) }
  const single = ageText.match(/(\d+)/)
  if (single) {
    const a = parseInt(single[1])
    return { min: a - 3, max: a + 3 } // ±3 year window for single age
  }
  return null
}

function daysBetween(d1: string | null, d2: string | null): number | null {
  if (!d1 || !d2) return null
  const t1 = new Date(d1).getTime()
  const t2 = new Date(d2).getTime()
  if (isNaN(t1) || isNaN(t2)) return null
  return Math.floor(Math.abs(t1 - t2) / (86400000))
}

function yearsSince(d: string | null): number | null {
  if (!d) return null
  const t = new Date(d).getTime()
  if (isNaN(t)) return null
  return Math.floor((Date.now() - t) / (365.25 * 86400000))
}

interface Record {
  id: string
  record_type: string
  person_name: string | null
  age_text: string | null
  sex: string | null
  race: string | null
  state: string | null
  city: string | null
  date_missing: string | null
  date_found: string | null
  raw_data: unknown
  external_id: string
}

// ─── Scoring ────────────────────────────────────────────────────────────────

function scoreMatch(missing: Record, remains: Record): {
  score: number
  signals: Record<string, number>
  days_apart: number | null
  dominated: boolean // true = hard eliminate, don't store
} {
  const signals: { [k: string]: number } = {}
  let score = 0

  // ── Sex (hard eliminate on mismatch) ──
  const mSex = normSex(missing.sex)
  const rSex = normSex(remains.sex)
  if (mSex !== 'unknown' && rSex !== 'unknown') {
    if (mSex === rSex) {
      signals.sex_match = 15
      score += 15
    } else {
      return { score: -1, signals: { sex_mismatch: -1 }, days_apart: null, dominated: true }
    }
  }

  // ── Race (hard eliminate on clear mismatch) ──
  const mRace = normRace(missing.race)
  const rRace = normRace(remains.race)
  if (mRace !== 'unknown' && rRace !== 'unknown') {
    if (mRace === rRace) {
      signals.race_match = 10
      score += 10
    } else {
      return { score: -1, signals: { race_mismatch: -1 }, days_apart: null, dominated: true }
    }
  }

  // ── Temporal (hard eliminate if remains found BEFORE person missing) ──
  if (missing.date_missing && remains.date_found) {
    if (new Date(remains.date_found) < new Date(missing.date_missing)) {
      return { score: -1, signals: { temporal_impossible: -1 }, days_apart: null, dominated: true }
    }
  }

  // ── Age overlap ──
  const mAge = parseAge(missing.age_text)
  const rAge = parseAge(remains.age_text)
  if (mAge && rAge) {
    const overlap = Math.min(mAge.max, rAge.max) - Math.max(mAge.min, rAge.min)
    if (overlap >= 0) {
      signals.age_overlap = Math.min(20, 5 + overlap * 2)
      score += signals.age_overlap
    } else {
      const gap = -overlap
      if (gap > 10) {
        return { score: -1, signals: { age_mismatch: -1 }, days_apart: null, dominated: true }
      }
      if (gap > 5) {
        signals.age_distant = -5
        score -= 5
      }
    }
  }

  // ── Same state ──
  if (missing.state && remains.state) {
    if (missing.state.toUpperCase() === remains.state.toUpperCase()) {
      signals.same_state = 15
      score += 15
    }
    // Different state is not a penalty — people travel
  }

  // ── Temporal proximity (if not eliminated above) ──
  const days = daysBetween(missing.date_missing, remains.date_found)
  if (days !== null) {
    if (days <= 30) { signals.temporal_very_close = 20; score += 20 }
    else if (days <= 180) { signals.temporal_close = 12; score += 12 }
    else if (days <= 365) { signals.temporal_moderate = 6; score += 6 }
    else if (days <= 1095) { signals.temporal_wide = 2; score += 2 }
  }

  score = Math.max(0, Math.min(100, score))

  return {
    score,
    signals: signals as unknown as Record<string, number>,
    days_apart: days,
    dominated: false,
  }
}

function gradeScore(score: number): string {
  if (score >= 86) return 'very_strong'
  if (score >= 66) return 'strong'
  if (score >= 41) return 'notable'
  if (score >= 21) return 'moderate'
  return 'weak'
}

// ─── Stalled Case Detection ─────────────────────────────────────────────────

const STALL_KEYWORDS = [
  'runaway', 'voluntary', 'voluntarily', 'left on own',
  'walked away', 'ran away', 'self-initiated',
]

function detectStall(record: Record): {
  isStalled: boolean
  reasons: string[]
  yearsCold: number | null
  isMinor: boolean
} {
  const yearsCold = yearsSince(record.date_missing)
  const age = record.age_text ? parseInt(record.age_text) : null
  const isMinor = age !== null && age < 18

  const reasons: string[] = []

  // Check raw_data for stall keywords
  const rawStr = JSON.stringify(record.raw_data ?? {}).toLowerCase()
  for (const kw of STALL_KEYWORDS) {
    if (rawStr.includes(kw)) {
      reasons.push(`Text contains "${kw}"`)
      break
    }
  }

  // Minor + 2+ years = stall flag regardless
  if (isMinor && yearsCold !== null && yearsCold >= 2) {
    reasons.push(`Minor (age ${age}) missing for ${yearsCold} years`)
  }

  // Any case 5+ years with no resolution
  if (yearsCold !== null && yearsCold >= 5) {
    reasons.push(`${yearsCold} years with no resolution`)
  }

  return {
    isStalled: reasons.length > 0 && (yearsCold ?? 0) >= 2,
    reasons,
    yearsCold,
    isMinor,
  }
}

// ─── Needs AI? ──────────────────────────────────────────────────────────────

function needsAI(record: Record): { needs: boolean; reasons: string[] } {
  const rawStr = JSON.stringify(record.raw_data ?? {})
  const reasons: string[] = []

  // Has substantial narrative text (not just structured fields)
  if (rawStr.length > 500) {
    // Check for tattoo/scar mentions
    const lower = rawStr.toLowerCase()
    if (lower.includes('tattoo') || lower.includes('scar') || lower.includes('piercing') ||
        lower.includes('birthmark') || lower.includes('prosthe') || lower.includes('dental')) {
      reasons.push('distinguishing_marks')
    }

    // Check for circumstance text that might reveal MO/disposal/disappearance patterns
    if (lower.includes('found') || lower.includes('discovered') || lower.includes('recovered') ||
        lower.includes('remains') || lower.includes('body')) {
      reasons.push('disposal_indicators')
    }
    if (lower.includes('last seen') || lower.includes('hitchhik') || lower.includes('truck') ||
        lower.includes('highway') || lower.includes('interstate') || lower.includes('i-') ||
        lower.includes('route ') || lower.includes('corridor')) {
      reasons.push('disappearance_indicators')
    }
    if (lower.includes('strangl') || lower.includes('stab') || lower.includes('shot') ||
        lower.includes('blunt') || lower.includes('asphyxia') || lower.includes('ligature') ||
        lower.includes('bound') || lower.includes('restrain')) {
      reasons.push('mo_keywords')
    }
  }

  return { needs: reasons.length > 0, reasons }
}

// ─── Pre-Solvability (rule-based) ───────────────────────────────────────────

function preSolvability(record: Record): { score: number; signals: string[] } {
  const rawStr = JSON.stringify(record.raw_data ?? {}).toLowerCase()
  let score = 0
  const signals: string[] = []

  // Has name (for missing persons)
  if (record.person_name && record.record_type === 'missing_person') {
    score += 5
    signals.push('has_name')
  }

  // Has specific location
  if (record.city) { score += 10; signals.push('has_city') }
  if (record.state) { score += 5; signals.push('has_state') }

  // Has date
  if (record.date_missing || record.date_found) { score += 10; signals.push('has_date') }

  // Narrative mentions investigative leads
  if (rawStr.includes('vehicle') || rawStr.includes('car ') || rawStr.includes('truck') || rawStr.includes('van ')) {
    score += 15; signals.push('has_vehicle_mention')
  }
  if (rawStr.includes('suspect') || rawStr.includes('person of interest') || rawStr.includes('poi')) {
    score += 20; signals.push('has_poi_mention')
  }
  if (rawStr.includes('witness') || rawStr.includes('seen by') || rawStr.includes('reported seeing')) {
    score += 10; signals.push('has_witness_mention')
  }
  if (rawStr.includes('dna') || rawStr.includes('fingerprint') || rawStr.includes('dental record')) {
    score += 15; signals.push('has_forensic_evidence')
  }
  if (rawStr.includes('tattoo') || rawStr.includes('scar') || rawStr.includes('birthmark')) {
    score += 10; signals.push('has_distinguishing_marks')
  }

  return { score: Math.min(100, score), signals }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Rule-Based Match & Filter ===')
  console.log(`State filter: ${STATE ?? 'all'}, Limit: ${LIMIT}\n`)

  // ── Fetch records ──
  let missingQuery = supabase
    .from('import_records')
    .select('id, record_type, person_name, age_text, sex, race, state, city, date_missing, date_found, raw_data, external_id')
    .eq('record_type', 'missing_person')
    .limit(LIMIT)
  if (STATE) missingQuery = missingQuery.eq('state', STATE)

  let remainsQuery = supabase
    .from('import_records')
    .select('id, record_type, person_name, age_text, sex, race, state, city, date_missing, date_found, raw_data, external_id')
    .eq('record_type', 'unidentified_remains')
    .limit(LIMIT)
  if (STATE) remainsQuery = remainsQuery.eq('state', STATE)

  const [{ data: missing }, { data: remains }] = await Promise.all([missingQuery, remainsQuery])

  console.log(`Missing persons: ${missing?.length ?? 0}`)
  console.log(`Unidentified remains: ${remains?.length ?? 0}`)

  if (!missing?.length || !remains?.length) {
    console.log('Need both types to match. Run scrapers first.')
    return
  }

  // ── Phase 1: Match missing ↔ remains ──
  console.log('\n--- Phase 1: Missing ↔ Remains Matching ---')
  let connectionsStored = 0
  let eliminated = 0
  let queueItems = 0
  const BATCH: Array<{
    record_a_id: string
    record_b_id: string
    connection_type: string
    composite_score: number
    grade: string
    signals: unknown
    days_apart: number | null
    generated_at: string
  }> = []

  for (let i = 0; i < missing.length; i++) {
    const m = missing[i] as unknown as Record
    if (i % 200 === 0 && i > 0) {
      console.log(`  Processed ${i}/${missing.length} missing persons (${connectionsStored} connections, ${eliminated} eliminated)`)
    }

    for (const r of remains as unknown as Record[]) {
      const result = scoreMatch(m, r)

      if (result.dominated) {
        eliminated++
        continue
      }

      // Only store moderate+ (score >= 21)
      if (result.score < 21) continue

      BATCH.push({
        record_a_id: m.id,
        record_b_id: r.id,
        connection_type: 'composite',
        composite_score: result.score,
        grade: gradeScore(result.score),
        signals: result.signals,
        days_apart: result.days_apart,
        generated_at: new Date().toISOString(),
      })

      // Flush batch
      if (BATCH.length >= 200) {
        const { error } = await supabase.from('global_connections').upsert(BATCH, { onConflict: 'record_a_id,record_b_id' })
        if (error) console.error('  Batch upsert error:', error.message)
        connectionsStored += BATCH.length
        BATCH.length = 0
      }
    }
  }

  // Flush remaining
  if (BATCH.length > 0) {
    const { error } = await supabase.from('global_connections').upsert(BATCH, { onConflict: 'record_a_id,record_b_id' })
    if (error) console.error('  Final batch error:', error.message)
    connectionsStored += BATCH.length
  }

  console.log(`  Connections stored: ${connectionsStored}`)
  console.log(`  Hard eliminated: ${eliminated}`)

  // ── Phase 2: Surface notable+ connections to intelligence queue ──
  console.log('\n--- Phase 2: Queue Notable Connections ---')
  const { data: notableConns } = await supabase
    .from('global_connections')
    .select('*, record_a:import_records!global_connections_record_a_id_fkey(id, person_name, sex, age_text, state, date_missing, external_id), record_b:import_records!global_connections_record_b_id_fkey(id, person_name, sex, age_text, state, date_found, external_id)')
    .gte('composite_score', 41)
    .eq('reviewer_status', 'unreviewed')
    .limit(500)

  if (notableConns) {
    for (const conn of notableConns) {
      const a = conn.record_a as unknown as Record | null
      const b = conn.record_b as unknown as Record | null
      if (!a || !b) continue

      const aName = a.person_name ?? `NamUs ${a.external_id}`
      const bName = b.person_name ?? `Unidentified (${(b as Record).state ?? '??'})`

      await supabase.from('intelligence_queue').upsert({
        queue_type: 'possible_match',
        priority_score: conn.composite_score,
        priority_grade: conn.composite_score >= 70 ? 'high' : conn.composite_score >= 50 ? 'medium' : 'low',
        title: `Possible match: ${aName} ↔ ${bName}`,
        summary: buildMatchSummary(a, b, conn.signals as { [k: string]: number }),
        details: { connection_id: conn.id, missing_id: a.id, remains_id: b.id },
        related_import_ids: [a.id, b.id],
        signal_count: Object.keys(conn.signals as object).filter((k: string) => !(k as string).includes('mismatch')).length,
        ai_confidence: conn.composite_score / 100,
      }, { onConflict: 'id' }) // upsert by generated id

      queueItems++
    }
  }

  console.log(`  Queue items created: ${queueItems}`)

  // ── Phase 3: Stalled case detection ──
  console.log('\n--- Phase 3: Stalled Case Detection ---')
  let stalledCount = 0

  for (const m of missing as unknown as Record[]) {
    const stall = detectStall(m)
    if (!stall.isStalled) continue

    const priority = stall.isMinor ? 75 : (stall.yearsCold ?? 0) >= 10 ? 60 : 45

    await supabase.from('intelligence_queue').insert({
      queue_type: 'stalled_case',
      priority_score: priority,
      priority_grade: priority >= 70 ? 'high' : priority >= 40 ? 'medium' : 'low',
      title: `Stalled: ${m.person_name ?? m.external_id} — ${stall.yearsCold}yr cold`,
      summary: `${m.person_name ?? 'Unknown'} (${m.sex ?? '?'}, age ${m.age_text ?? '?'}, ${m.state ?? '?'}). Missing since ${m.date_missing ?? '?'}. ${stall.reasons.join('. ')}.`,
      details: {
        import_record_id: m.id,
        years_cold: stall.yearsCold,
        is_minor: stall.isMinor,
        stall_reasons: stall.reasons,
      },
      related_import_ids: [m.id],
      signal_count: stall.reasons.length,
    })

    stalledCount++
  }

  console.log(`  Stalled cases flagged: ${stalledCount}`)

  // ── Phase 4: Mark records that need AI ──
  console.log('\n--- Phase 4: AI Triage ---')
  let needsAiCount = 0
  let noAiCount = 0
  const allRecords = [...(missing as unknown as Record[]), ...(remains as unknown as Record[])]

  for (const record of allRecords) {
    const ai = needsAI(record)
    const solv = preSolvability(record)

    // Store pre-solvability
    if (solv.score > 0) {
      await supabase.from('solvability_scores').upsert({
        import_record_id: record.id,
        score: solv.score,
        grade: solv.score >= 70 ? 'high' : solv.score >= 35 ? 'moderate' : 'low',
        signals: { rule_based: true, pre_signals: solv.signals },
        ai_summary: `Rule-based pre-score: ${solv.signals.join(', ')}`,
        ai_next_steps: [],
        model_used: 'rule-based',
        computed_at: new Date().toISOString(),
      }, { onConflict: 'import_record_id' })
    }

    if (ai.needs) {
      // Mark for AI processing
      await supabase.from('import_records').update({
        ai_processed: false, // ensure it's in the AI queue
        ai_extraction: { _needs_ai: true, _ai_reasons: ai.reasons },
      }).eq('id', record.id)

      needsAiCount++
    } else {
      // Mark as "processed" (rule-based only, no AI needed)
      await supabase.from('import_records').update({
        ai_processed: true,
        ai_processed_at: new Date().toISOString(),
        ai_extraction: { _rule_based_only: true, _no_ai_needed: true },
      }).eq('id', record.id)

      noAiCount++
    }
  }

  console.log(`  Needs AI extraction: ${needsAiCount}`)
  console.log(`  No AI needed: ${noAiCount}`)

  // ── Summary ──
  console.log('\n=== Summary ===')
  console.log(`Connections: ${connectionsStored} stored, ${eliminated} eliminated`)
  console.log(`Queue items: ${queueItems} matches + ${stalledCount} stalled`)
  console.log(`AI triage: ${needsAiCount} need AI, ${noAiCount} rule-based only`)
  console.log(`Estimated AI cost (Haiku): ~$${(needsAiCount * 0.009).toFixed(2)}`)
}

function buildMatchSummary(a: Record, b: Record, signals: { [k: string]: number }): string {
  const parts: string[] = []
  parts.push(`${a.person_name ?? a.external_id} (${a.sex ?? '?'}, age ${a.age_text ?? '?'}, ${a.state ?? '?'})`)
  parts.push(`missing since ${a.date_missing ?? '?'}`)
  parts.push(`may match unidentified remains in ${(b as Record).state ?? '?'} found ${(b as Record).date_found ?? '?'}.`)

  const matchSignals: string[] = []
  if (signals.sex_match) matchSignals.push('sex matches')
  if (signals.age_overlap) matchSignals.push('age overlaps')
  if (signals.race_match) matchSignals.push('race matches')
  if (signals.same_state) matchSignals.push('same state')
  if (signals.temporal_very_close) matchSignals.push('dates within 30 days')
  else if (signals.temporal_close) matchSignals.push('dates within 6 months')

  if (matchSignals.length) parts.push(`Signals: ${matchSignals.join(', ')}.`)

  return parts.join(' ')
}

main().catch(console.error)
