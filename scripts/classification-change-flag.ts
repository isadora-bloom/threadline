/**
 * Classification-change flagger
 *
 * Reads import_record_changes rows captured by the trigger in migration 036
 * and promotes the investigatively significant ones to intelligence_queue.
 *
 * Significance rules (a case changing from X to Y):
 *   - voluntary/lost → endangered/homicide/foul_play  (HIGH — someone finally
 *     believed the family)
 *   - anything → resolved_*                            (INFO — case closed)
 *   - date_missing changed                             (MED — timeline shifted)
 *   - case_status open ↔ cold                          (MED — investigator note)
 *   - classification flipped more than once for the same record ever
 *                                                      (HIGH — indecision
 *     signal; the official narrative is unstable)
 *
 * Each change row is marked flagged_at + queue_item_id after processing so
 * reruns are idempotent.
 *
 * Usage: npx tsx scripts/classification-change-flag.ts
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Values that signal "case is actively dangerous".
const SERIOUS = new Set([
  'endangered',
  'endangered_missing',
  'homicide',
  'foul_play',
  'abduction',
  'stranger_abduction',
  'family_abduction',
  'trafficking',
])

// Values that downgrade or dismiss.
const DISMISSIVE = new Set([
  'runaway',
  'voluntary_missing',
  'voluntary',
  'lost',
  'unknown',
])

// Values that indicate resolution.
const RESOLVED_PREFIX = 'resolved'

function normalize(v: string | null | undefined): string {
  return (v ?? '').toLowerCase().trim().replace(/\s+/g, '_')
}

interface ChangeRow {
  id: string
  import_record_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_at: string
}

async function fetchUnflagged(): Promise<ChangeRow[]> {
  const PAGE = 1000
  const rows: ChangeRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('import_record_changes')
      .select('id, import_record_id, field, old_value, new_value, changed_at')
      .is('flagged_at', null)
      .order('changed_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('Fetch failed:', error.message)
      process.exit(1)
    }
    if (!data?.length) break
    rows.push(...(data as ChangeRow[]))
    if (data.length < PAGE) break
  }
  return rows
}

async function fetchRecord(id: string) {
  const { data } = await supabase
    .from('import_records')
    .select('person_name, state, external_id, date_missing, record_type')
    .eq('id', id)
    .single()
  return data
}

async function countPriorClassificationChanges(recordId: string, beforeId: string): Promise<number> {
  const { count } = await supabase
    .from('import_record_changes')
    .select('id', { count: 'exact', head: true })
    .eq('import_record_id', recordId)
    .eq('field', 'classification')
    .neq('id', beforeId)
  return count ?? 0
}

interface Judgment {
  priority: number
  grade: 'high' | 'medium' | 'low'
  title: string
  summary: string
  extraSignals: number
}

async function judge(change: ChangeRow, record: { person_name: string | null; state: string | null; external_id: string }): Promise<Judgment | null> {
  const who = record.person_name ?? record.external_id
  const where = record.state ? ` (${record.state})` : ''

  if (change.field === 'classification') {
    const oldN = normalize(change.old_value)
    const newN = normalize(change.new_value)
    const wasDismissive = DISMISSIVE.has(oldN)
    const nowSerious = SERIOUS.has(newN)
    const nowResolved = newN.startsWith(RESOLVED_PREFIX)
    const priorChanges = await countPriorClassificationChanges(change.import_record_id, change.id)

    if (wasDismissive && nowSerious) {
      return {
        priority: 90,
        grade: 'high',
        title: `Classification upgraded: ${who}${where} went from ${oldN} to ${newN}`,
        summary: `${who}${where} was previously classified as ${oldN}; the source data now reflects ${newN}. Historically this shift means investigators or family surfaced new evidence that the case was not voluntary. Review the record for what prompted the change and whether earlier leads were abandoned under the old classification.`,
        extraSignals: priorChanges,
      }
    }

    if (priorChanges >= 1) {
      // Record has flipped classification before — unstable narrative.
      return {
        priority: 75,
        grade: 'high',
        title: `Unstable classification: ${who}${where} changed to ${newN} (${priorChanges + 1} changes on record)`,
        summary: `${who}${where} has had its classification changed ${priorChanges + 1} times (latest: ${oldN} → ${newN}). Repeated official reclassification usually signals contested evidence or an evolving investigation — the current label may not reflect the strongest interpretation of the facts.`,
        extraSignals: priorChanges,
      }
    }

    if (nowResolved) {
      return {
        priority: 55,
        grade: 'medium',
        title: `Resolved: ${who}${where} marked ${newN}`,
        summary: `${who}${where} has been marked ${newN}. Verify the resolution downstream (dismiss match candidates, note in watchlists).`,
        extraSignals: 0,
      }
    }

    // Other classification changes — still informative but lower priority.
    return {
      priority: 50,
      grade: 'medium',
      title: `Classification changed: ${who}${where} from ${oldN} to ${newN}`,
      summary: `${who}${where} had its official classification changed from ${oldN} to ${newN}. Low-severity signal but worth glancing at.`,
      extraSignals: 0,
    }
  }

  if (change.field === 'case_status') {
    const oldN = normalize(change.old_value)
    const newN = normalize(change.new_value)
    if (newN === 'cold') {
      return {
        priority: 50,
        grade: 'medium',
        title: `Case went cold: ${who}${where}`,
        summary: `${who}${where} was marked cold (previously ${oldN || 'unknown'}). Consider whether the investigator wound down appropriately or whether the case was abandoned under wrong assumptions.`,
        extraSignals: 0,
      }
    }
    if (oldN === 'cold' && newN && newN !== 'cold') {
      return {
        priority: 65,
        grade: 'medium',
        title: `Cold case reopened: ${who}${where} moved from cold to ${newN}`,
        summary: `${who}${where} moved from cold to ${newN}. Someone surfaced something that warranted reopening.`,
        extraSignals: 0,
      }
    }
    return null
  }

  if (change.field === 'date_missing') {
    return {
      priority: 45,
      grade: 'medium',
      title: `Date missing corrected: ${who}${where}`,
      summary: `${who}${where} had its date_missing changed from ${change.old_value ?? 'null'} to ${change.new_value ?? 'null'}. Timeline-dependent match scores for this record should be rescored.`,
      extraSignals: 0,
    }
  }

  // date_found and key_flags changes are too noisy to flag individually —
  // they still live in import_record_changes for later audit.
  return null
}

async function main() {
  console.log('=== Classification-Change Flagger ===')
  const changes = await fetchUnflagged()
  console.log(`Unflagged change rows: ${changes.length}`)

  let flagged = 0
  let skipped = 0
  for (const change of changes) {
    const record = await fetchRecord(change.import_record_id)
    if (!record) {
      skipped++
      continue
    }

    const judgment = await judge(change, record)
    if (!judgment) {
      // Mark as processed anyway so we do not keep re-evaluating noise.
      await supabase
        .from('import_record_changes')
        .update({ flagged_at: new Date().toISOString() } as never)
        .eq('id', change.id)
      skipped++
      continue
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('intelligence_queue')
      .insert({
        queue_type: 'contradiction',
        priority_score: judgment.priority,
        priority_grade: judgment.grade,
        title: judgment.title,
        summary: judgment.summary,
        details: {
          kind: 'classification_change',
          field: change.field,
          old_value: change.old_value,
          new_value: change.new_value,
          changed_at: change.changed_at,
          import_record_id: change.import_record_id,
          prior_classification_changes: judgment.extraSignals,
        },
        related_import_ids: [change.import_record_id],
        signal_count: 1 + judgment.extraSignals,
        ai_confidence: 0.8,
      })
      .select('id')
      .single()

    if (insertErr) {
      console.error(`  Insert failed for change ${change.id}: ${insertErr.message}`)
      continue
    }

    await supabase
      .from('import_record_changes')
      .update({
        flagged_at: new Date().toISOString(),
        queue_item_id: inserted?.id ?? null,
      } as never)
      .eq('id', change.id)

    flagged++
  }

  console.log(`\n=== Done ===`)
  console.log(`Flagged to intelligence_queue: ${flagged}`)
  console.log(`Skipped (low signal or missing record): ${skipped}`)
}

main().catch(console.error)
