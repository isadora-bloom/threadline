/**
 * Misclassification candidate flagger
 *
 * Many cold cases aren't cold because they're unsolvable — they're cold
 * because the original classification ("runaway", "voluntary", "suicide") was
 * wrong in a way that killed resources. The AI extractor already notices
 * those mismatches in investigator_notes and in stall_indicators, but none of
 * that signal ever leaves the record. This script surfaces it as its own
 * intelligence_queue queue_type.
 *
 * A record is a misclassification candidate when it has:
 *   - classification ∈ {runaway, voluntary_missing, lost}
 *   - AND at least one risk factor that is incompatible with a voluntary
 *     departure (foul_play_indicators, domestic_violence, forensic_awareness)
 *   - OR the subject was a minor (age < 18) with risk factors present
 *
 * Usage: npx tsx scripts/misclassification-flag.ts
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const VOLUNTARY_CLASSIFICATIONS = new Set(['runaway', 'voluntary_missing', 'lost'])

// Keywords in risk_factors or stall_indicators that contradict a voluntary
// departure classification. These come from the taxonomy that ai-batch-process
// already emits.
const FOUL_PLAY_MARKERS = new Set([
  'foul_play',
  'domestic_violence',
  'restraining_order',
  'stalker',
  'abduction',
  'kidnapping',
  'trafficking',
  'forensic_countermeasure',
  'scene_staging',
  'cleanup',
  'body_disposal',
])

async function fetchAll() {
  const PAGE = 1000
  type Row = {
    id: string
    person_name: string | null
    record_type: string
    state: string | null
    date_missing: string | null
    age_text: string | null
    ai_extraction: Record<string, unknown> | null
  }
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('import_records')
      .select('id, person_name, record_type, state, date_missing, age_text, ai_extraction')
      .eq('ai_processed', true)
      .eq('record_type', 'missing_person')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('Fetch failed:', error.message)
      process.exit(1)
    }
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

async function main() {
  console.log('=== Misclassification Candidate Flagger ===')

  const rows = await fetchAll()
  console.log(`Scanning ${rows.length} AI-processed missing-person records.`)

  let flagged = 0
  for (const row of rows) {
    const extraction = row.ai_extraction
    if (!extraction) continue

    const circumstances = extraction.circumstances as Record<string, unknown> | undefined
    const solvability = extraction.solvability_signals as Record<string, unknown> | undefined
    const behavioral = extraction.behavioral_signals as Record<string, unknown> | undefined

    const classification = circumstances?.classification as string | undefined
    if (!classification || !VOLUNTARY_CLASSIFICATIONS.has(classification)) continue

    const riskFactors = (circumstances?.risk_factors ?? []) as string[]
    const stallIndicators = (solvability?.stall_indicators ?? []) as string[]
    const forensicAwareness = (behavioral?.forensic_awareness ?? []) as string[]
    const moKeywords = (behavioral?.mo_keywords ?? []) as string[]

    const contradictingSignals: string[] = []
    for (const rf of [...riskFactors, ...stallIndicators, ...forensicAwareness, ...moKeywords]) {
      const lower = String(rf).toLowerCase().replace(/\s+/g, '_')
      for (const marker of FOUL_PLAY_MARKERS) {
        if (lower.includes(marker)) {
          contradictingSignals.push(String(rf))
          break
        }
      }
    }

    // Age signal: a minor classified as "voluntary" with any risk factor at all
    const ageNum = row.age_text ? parseInt(row.age_text) : NaN
    const isMinor = !Number.isNaN(ageNum) && ageNum < 18

    const shouldFlag =
      contradictingSignals.length > 0 ||
      (isMinor && (riskFactors.length > 0 || stallIndicators.length > 0))

    if (!shouldFlag) continue

    // Skip if we already flagged this record (idempotency)
    const { data: existing } = await supabase
      .from('intelligence_queue')
      .select('id')
      .eq('queue_type', 'misclassification_candidate')
      .contains('related_import_ids', [row.id])
      .maybeSingle()
    if (existing) continue

    const priority = isMinor && contradictingSignals.length > 0 ? 85
      : contradictingSignals.length >= 2 ? 75
      : contradictingSignals.length === 1 ? 65
      : 55

    const { error: insertErr } = await supabase.from('intelligence_queue').insert({
      queue_type: 'misclassification_candidate',
      priority_score: priority,
      priority_grade: priority >= 75 ? 'high' : 'medium',
      title: `Misclassification candidate: ${row.person_name ?? row.id} filed as ${classification}`,
      summary: `${row.person_name ?? 'Subject'} (${row.age_text ?? '?'}, ${row.state ?? '?'}, ${row.date_missing ?? '?'}) is classified as ${classification} but the extracted record contains signals that contradict voluntary departure${isMinor ? ' AND the subject was a minor' : ''}. Contradictions: ${contradictingSignals.slice(0, 5).join(', ') || '(minor + risk factors)'}. Review may warrant reclassification and resource reassignment.`,
      details: {
        import_record_id: row.id,
        current_classification: classification,
        contradicting_signals: contradictingSignals,
        is_minor: isMinor,
        age_at_disappearance: isMinor ? ageNum : null,
        risk_factors: riskFactors,
        stall_indicators: stallIndicators,
      },
      related_import_ids: [row.id],
      signal_count: contradictingSignals.length + (isMinor ? 1 : 0),
      ai_confidence: Math.min(0.9, 0.5 + contradictingSignals.length * 0.1 + (isMinor ? 0.1 : 0)),
    })
    if (insertErr) {
      console.error(`  Insert failed for ${row.id}: ${insertErr.message}`)
      continue
    }
    flagged++
  }

  console.log(`\n=== Done ===`)
  console.log(`Misclassification candidates flagged: ${flagged}`)
}

main().catch(console.error)
