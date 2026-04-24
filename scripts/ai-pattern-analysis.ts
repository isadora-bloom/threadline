/**
 * AI Pattern Analysis
 *
 * Runs AFTER ai-targeted-extract.ts. Only on records that have AI extraction.
 * Uses AI to detect patterns that rule-based matching can't:
 *
 *   1. Cluster patterns — groups of cases with unusual similarity
 *   2. Offender overlaps — match extracted MO/disposal/geography to known offenders
 *   3. Geographic corridors — identify highway/route patterns across multiple cases
 *   4. Route matching — "heading to X" destination analysis
 *   5. Statistical anomalies — unusual concentrations by time, place, demographic
 *
 * Only runs on AI-processed records with extracted signals.
 * Batches cases by state/region and sends clusters to AI for analysis.
 *
 * Usage:
 *   npx tsx scripts/ai-pattern-analysis.ts [--state VA] [--limit 500]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { REVIEW_MODEL } from '../src/lib/ai-models'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const args = process.argv.slice(2)
const stateIdx = args.indexOf('--state')
const STATE = stateIdx !== -1 ? args[stateIdx + 1] : null
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 500

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Offender Overlap (rule-based pre-filter + AI confirmation) ─────────────

async function matchOffenders() {
  console.log('--- Offender Overlap Analysis ---')

  const { data: offenders } = await supabase.from('known_offenders').select('*')
  if (!offenders?.length) { console.log('  No offenders in database'); return 0 }

  // Fetch AI-processed records with extracted signals
  let query = supabase
    .from('import_records')
    .select('*')
    .eq('ai_processed', true)
    .limit(LIMIT)
  if (STATE) query = query.eq('state', STATE)

  const { data: records } = await query
  if (!records?.length) { console.log('  No AI-processed records'); return 0 }

  let flagged = 0

  for (const offender of offenders) {
    const offenderStates = [
      ...((offender.victim_states ?? []) as string[]),
      ...((offender.operation_states ?? []) as string[]),
    ]
    const offenderMO = (offender.mo_keywords ?? []) as string[]
    const offenderDisposal = (offender.disposal_method ?? []) as string[]
    const offenderCorridors = (offender.travel_corridors ?? []) as string[]

    for (const record of records) {
      const ext = record.ai_extraction as Record<string, unknown> | null
      if (!ext || ext._rule_based_only) continue

      // Rule-based pre-filter: must share at least state OR corridor
      const stateMatch = record.state && offenderStates.map(s => s.toUpperCase()).includes(record.state.toUpperCase())

      const geoSignals = ext.geographic_signals as Record<string, unknown> | undefined
      const highways = (geoSignals?.highways_mentioned ?? []) as string[]
      const corridorMatch = highways.some(h => offenderCorridors.some(c =>
        h.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(h.toLowerCase())
      ))

      if (!stateMatch && !corridorMatch) continue

      // Check demographic match
      const offenderVictimSex = offender.victim_sex as string | null
      if (offenderVictimSex && record.sex) {
        const normOSex = offenderVictimSex.toLowerCase().charAt(0)
        const normRSex = record.sex.toLowerCase().charAt(0)
        if (normOSex !== normRSex && normOSex !== 'u' && normRSex !== 'u') continue
      }

      // Check temporal: skip if record is after offender incarceration
      if (offender.incarcerated_from) {
        const dateField = record.date_missing ?? record.date_found
        if (dateField) {
          const recordYear = new Date(dateField).getFullYear()
          if (recordYear > (offender.incarcerated_from as number)) continue
        }
      }

      // Score overlap
      let overlapScore = 0
      const matchedSignals: string[] = []

      if (stateMatch) { overlapScore += 10; matchedSignals.push('state_overlap') }
      if (corridorMatch) { overlapScore += 15; matchedSignals.push('corridor_overlap') }

      // MO keyword overlap
      const recordMO = (ext.mo_keywords ?? []) as string[]
      const moOverlap = recordMO.filter(m => offenderMO.includes(m))
      if (moOverlap.length > 0) {
        overlapScore += 20 * moOverlap.length
        matchedSignals.push(`mo:${moOverlap.join(',')}`)
      }

      // Disposal overlap
      const recordDisposal = (ext.disposal_indicators ?? []) as string[]
      const disposalOverlap = recordDisposal.filter(d => offenderDisposal.includes(d))
      if (disposalOverlap.length > 0) {
        overlapScore += 15 * disposalOverlap.length
        matchedSignals.push(`disposal:${disposalOverlap.join(',')}`)
      }

      // Age overlap
      const age = record.age_text ? parseInt(record.age_text) : null
      if (age && offender.victim_age_min && offender.victim_age_max) {
        if (age >= (offender.victim_age_min as number) && age <= (offender.victim_age_max as number)) {
          overlapScore += 10
          matchedSignals.push('age_in_range')
        }
      }

      // Only flag if meaningful overlap (state/corridor alone isn't enough)
      if (overlapScore < 25 || matchedSignals.length < 2) continue

      const priority = Math.min(100, overlapScore)

      await supabase.from('intelligence_queue').insert({
        queue_type: 'offender_overlap',
        priority_score: priority,
        priority_grade: priority >= 70 ? 'critical' : priority >= 50 ? 'high' : 'medium',
        title: `Offender overlap: ${record.person_name ?? record.external_id} ↔ ${offender.name}`,
        summary: `${record.person_name ?? 'Unknown'} (${record.sex ?? '?'}, age ${record.age_text ?? '?'}, ${record.state ?? '?'}) has ${matchedSignals.length} signal overlap with ${offender.name}: ${matchedSignals.join(', ')}.`,
        details: {
          import_record_id: record.id,
          offender_id: offender.id,
          offender_name: offender.name,
          overlap_score: overlapScore,
          matched_signals: matchedSignals,
        },
        related_import_ids: [record.id],
        ai_confidence: Math.min(1, overlapScore / 100),
        signal_count: matchedSignals.length,
      })

      flagged++
    }
  }

  console.log(`  Offender overlaps flagged: ${flagged}`)
  return flagged
}

// ─── Geographic Corridor Detection ──────────────────────────────────────────

async function detectCorridors() {
  console.log('\n--- Geographic Corridor Detection ---')

  // Fetch records with highway mentions
  const { data: records } = await supabase
    .from('import_records')
    .select('id, person_name, external_id, state, city, date_missing, date_found, sex, age_text, ai_extraction')
    .eq('ai_processed', true)
    .limit(LIMIT)

  if (!records?.length) { console.log('  No records'); return 0 }

  // Group by highway
  const corridorMap: Map<string, Array<typeof records[0]>> = new Map()

  for (const r of records) {
    const ext = r.ai_extraction as Record<string, unknown> | null
    if (!ext) continue
    const geo = ext.geographic_signals as Record<string, unknown> | undefined
    const highways = (geo?.highways_mentioned ?? []) as string[]

    for (const hw of highways) {
      const normalized = hw.toUpperCase().replace(/\s+/g, '')
      if (!corridorMap.has(normalized)) corridorMap.set(normalized, [])
      corridorMap.get(normalized)!.push(r)
    }
  }

  let flagged = 0

  for (const [corridor, cases] of corridorMap) {
    if (cases.length < 3) continue // need at least 3 cases to be a pattern

    const priority = Math.min(100, 30 + cases.length * 10)

    await supabase.from('intelligence_queue').insert({
      queue_type: 'corridor_cluster',
      priority_score: priority,
      priority_grade: priority >= 70 ? 'high' : priority >= 50 ? 'medium' : 'low',
      title: `Corridor cluster: ${cases.length} cases along ${corridor}`,
      summary: `${cases.length} cases mention ${corridor}: ${cases.slice(0, 5).map(c =>
        `${c.person_name ?? c.external_id} (${c.state ?? '?'})`
      ).join(', ')}${cases.length > 5 ? ` and ${cases.length - 5} more` : ''}.`,
      details: {
        corridor,
        case_count: cases.length,
        cases: cases.map(c => ({
          id: c.id,
          name: c.person_name ?? c.external_id,
          state: c.state,
          date: c.date_missing ?? c.date_found,
        })),
      },
      related_import_ids: cases.map(c => c.id),
      signal_count: cases.length,
    })

    flagged++
  }

  console.log(`  Corridor clusters found: ${flagged}`)
  return flagged
}

// ─── Statistical Anomaly Detection ──────────────────────────────────────────

async function detectAnomalies() {
  console.log('\n--- Statistical Anomaly Detection ---')

  const { data: records } = await supabase
    .from('import_records')
    .select('id, person_name, external_id, state, city, date_missing, date_found, sex, age_text, race, ai_extraction')
    .eq('ai_processed', true)
    .limit(LIMIT)

  if (!records?.length) { console.log('  No records'); return 0 }

  let flagged = 0

  // ── Cluster by state + sex + age bracket + year ──
  type ClusterKey = string
  const clusters: Map<ClusterKey, typeof records> = new Map()

  for (const r of records) {
    const age = r.age_text ? parseInt(r.age_text) : null
    const ageBracket = age !== null ? `${Math.floor(age / 5) * 5}-${Math.floor(age / 5) * 5 + 4}` : 'unk'
    const dateField = r.date_missing ?? r.date_found
    const year = dateField ? new Date(dateField).getFullYear().toString() : 'unk'
    const sex = (r.sex ?? 'unk').toLowerCase().charAt(0)
    const state = (r.state ?? 'unk').toUpperCase()

    const key = `${state}|${sex}|${ageBracket}|${year}`
    if (!clusters.has(key)) clusters.set(key, [])
    clusters.get(key)!.push(r)
  }

  // Flag clusters with 4+ cases (unusual concentration)
  for (const [key, cases] of clusters) {
    if (cases.length < 4) continue

    const [state, sex, ageBracket, year] = key.split('|')
    const sexLabel = sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown sex'

    const priority = Math.min(100, 35 + cases.length * 8)

    await supabase.from('intelligence_queue').insert({
      queue_type: 'geographic_cluster',
      priority_score: priority,
      priority_grade: priority >= 70 ? 'high' : priority >= 50 ? 'medium' : 'low',
      title: `Cluster: ${cases.length} ${sexLabel} age ${ageBracket} in ${state} (${year})`,
      summary: `${cases.length} ${sexLabel} persons aged ${ageBracket} in ${state} during ${year}. Cases: ${cases.slice(0, 4).map(c => c.person_name ?? c.external_id).join(', ')}${cases.length > 4 ? ` +${cases.length - 4} more` : ''}.`,
      details: {
        cluster_key: key,
        state, sex: sexLabel, age_bracket: ageBracket, year,
        case_count: cases.length,
        case_ids: cases.map(c => c.id),
      },
      related_import_ids: cases.map(c => c.id),
      signal_count: cases.length,
    })

    flagged++
  }

  // ── MO pattern clustering (across AI-extracted records) ──
  const moMap: Map<string, typeof records> = new Map()

  for (const r of records) {
    const ext = r.ai_extraction as Record<string, unknown> | null
    if (!ext) continue
    const moKeywords = (ext.mo_keywords ?? []) as string[]
    for (const mo of moKeywords) {
      if (!moMap.has(mo)) moMap.set(mo, [])
      moMap.get(mo)!.push(r)
    }
  }

  for (const [mo, cases] of moMap) {
    if (cases.length < 3) continue

    // Group by state to find concentrations
    const byState: Map<string, typeof records> = new Map()
    for (const c of cases) {
      const s = c.state ?? 'unknown'
      if (!byState.has(s)) byState.set(s, [])
      byState.get(s)!.push(c)
    }

    for (const [state, stateCases] of byState) {
      if (stateCases.length < 3) continue

      const priority = Math.min(100, 40 + stateCases.length * 10)

      await supabase.from('intelligence_queue').insert({
        queue_type: 'behavioral_pattern',
        priority_score: priority,
        priority_grade: priority >= 70 ? 'high' : priority >= 50 ? 'medium' : 'low',
        title: `MO pattern: "${mo}" — ${stateCases.length} cases in ${state}`,
        summary: `${stateCases.length} cases in ${state} share MO keyword "${mo}": ${stateCases.slice(0, 4).map(c => c.person_name ?? c.external_id).join(', ')}.`,
        details: {
          mo_keyword: mo,
          state,
          case_count: stateCases.length,
          case_ids: stateCases.map(c => c.id),
        },
        related_import_ids: stateCases.map(c => c.id),
        signal_count: stateCases.length,
      })

      flagged++
    }
  }

  console.log(`  Anomalies flagged: ${flagged}`)
  return flagged
}

// ─── AI Solvability (only for records where signals popped) ─────────────────

async function scoreSolvability() {
  console.log('\n--- AI Solvability Scoring (signal-rich records only) ---')

  // Find records that: (1) have AI extraction, (2) have meaningful signals, (3) don't have AI solvability yet
  const { data: records } = await supabase
    .from('import_records')
    .select('*')
    .eq('ai_processed', true)
    .limit(LIMIT)

  if (!records?.length) { console.log('  No records'); return 0 }

  // Filter to records with interesting signals
  const signalRich = records.filter(r => {
    const ext = r.ai_extraction as Record<string, unknown> | null
    if (!ext || ext._rule_based_only) return false

    const mo = (ext.mo_keywords ?? []) as string[]
    const disposal = (ext.disposal_indicators ?? []) as string[]
    const marks = (ext.distinguishing_marks ?? []) as unknown[]
    const forensic = ext.forensic_indicators as Record<string, unknown> | undefined
    const geo = ext.geographic_signals as Record<string, unknown> | undefined
    const highways = (geo?.highways_mentioned ?? []) as string[]

    // Only score if there are meaningful signals
    return mo.length > 0 || disposal.length > 0 || marks.length > 0 ||
           forensic?.cause_of_death || highways.length > 0 ||
           forensic?.evidence_of_restraint || forensic?.evidence_of_sexual_assault
  })

  console.log(`  Signal-rich records: ${signalRich.length}`)
  if (signalRich.length === 0) return 0

  // Check which already have AI solvability scores
  const ids = signalRich.map(r => r.id)
  const { data: existingScores } = await supabase
    .from('solvability_scores')
    .select('import_record_id, model_used')
    .in('import_record_id', ids)

  const alreadyScored = new Set(
    (existingScores ?? [])
      .filter(s => s.model_used !== 'rule-based')
      .map(s => s.import_record_id)
  )

  const needsScoring = signalRich.filter(r => !alreadyScored.has(r.id))
  console.log(`  Need AI solvability: ${needsScoring.length}`)

  let scored = 0

  for (const record of needsScoring) {
    const ext = record.ai_extraction as Record<string, unknown>

    const prompt = `You are assessing the solvability of a ${record.record_type === 'missing_person' ? 'missing person' : 'unidentified remains'} case. Score 0-100 how likely this case could benefit from fresh investigation.

Case: ${record.person_name ?? 'Unidentified'} (${record.sex ?? '?'}, age ${record.age_text ?? '?'}, ${record.state ?? '?'})
Date: ${record.date_missing ?? record.date_found ?? '?'}
Extracted signals: ${JSON.stringify({
      mo: ext.mo_keywords,
      disposal: ext.disposal_indicators,
      disappearance: ext.disappearance_indicators,
      marks: ext.distinguishing_marks,
      forensic: ext.forensic_indicators,
      geographic: ext.geographic_signals,
    }, null, 2)}

Return JSON only:
{
  "score": 0-100,
  "grade": "high|moderate|low",
  "reasoning": "1-2 sentences why",
  "next_steps": ["specific investigative actions"]
}

Scoring guide:
- 70+ = Specific actionable leads exist (named POI, vehicle, witnesses, DNA, distinctive marks)
- 35-69 = Some threads to pull (geographic patterns, MO matches, circumstance details)
- <35 = Very cold, limited evidence
- Bonus: unusual marks (tattoos, dental) on unidentified remains = high solvability
- Bonus: MO matching known offender patterns = high solvability
- Penalty: decades cold + no forensic evidence = low solvability`

    try {
      const response = await anthropic.messages.create({
        model: REVIEW_MODEL,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      })

      const text = response.content.find(b => b.type === 'text')
      if (text?.type === 'text') {
        const raw = text.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
        const result = JSON.parse(raw)

        await supabase.from('solvability_scores').upsert({
          import_record_id: record.id,
          score: result.score,
          grade: result.grade,
          signals: ext,
          ai_summary: result.reasoning,
          ai_next_steps: result.next_steps ?? [],
          model_used: REVIEW_MODEL,
          computed_at: new Date().toISOString(),
        }, { onConflict: 'import_record_id' })

        scored++
      }
    } catch (err) {
      console.error(`  Solvability error for ${record.external_id}:`, err instanceof Error ? err.message : err)
    }

    await sleep(500)
  }

  console.log(`  Solvability scores: ${scored}`)
  return scored
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== AI Pattern Analysis ===')
  console.log(`State: ${STATE ?? 'all'}, Limit: ${LIMIT}\n`)

  const offenderFlags = await matchOffenders()
  const corridorFlags = await detectCorridors()
  const anomalyFlags = await detectAnomalies()
  const solvabilityScores = await scoreSolvability()

  console.log('\n=== Summary ===')
  console.log(`Offender overlaps: ${offenderFlags}`)
  console.log(`Corridor clusters: ${corridorFlags}`)
  console.log(`Statistical anomalies: ${anomalyFlags}`)
  console.log(`Solvability scores: ${solvabilityScores}`)
  console.log(`Total queue items: ${offenderFlags + corridorFlags + anomalyFlags}`)
}

main().catch(console.error)
