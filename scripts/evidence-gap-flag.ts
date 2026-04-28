/**
 * Evidence-gap flagger
 *
 * For each AI-processed record, look at solvability_signals.evidence_status.
 * When dental, DNA, or fingerprints are reported as exists_not_entered,
 * that is one of the highest-leverage findings in cold-case work — the
 * record exists locally but was never uploaded to NCIC / CODIS / AFIS.
 * Most cold cases that get solved this way are matched in days once the
 * evidence is finally entered. Surfacing this gap turns a cold case into
 * an immediate next-step.
 *
 * Writes one queue_type='stalled_case' row per record with at least one
 * exists_not_entered evidence type. Priority scales with severity:
 *   - DNA not entered:        +35 (most powerful identification path)
 *   - Dental not entered:     +25
 *   - Fingerprints not entered: +15
 *   - Multiple types missing: cumulative
 *
 * Idempotent: skips records already flagged with kind='evidence_gap'.
 *
 * Usage: npx tsx scripts/evidence-gap-flag.ts [--dry-run]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

interface Row {
  id: string
  person_name: string | null
  external_id: string
  state: string | null
  date_missing: string | null
  date_found: string | null
  ai_extraction: Record<string, unknown> | null
}

async function fetchAll(): Promise<Row[]> {
  const PAGE = 1000
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('import_records')
      .select('id, person_name, external_id, state, date_missing, date_found, ai_extraction')
      .eq('ai_processed', true)
      .range(from, from + PAGE - 1)
    if (error) { console.error('Fetch failed:', error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...(data as Row[]))
    if (data.length < PAGE) break
  }
  return rows
}

async function alreadyFlaggedSet(): Promise<Set<string>> {
  // Pull all existing evidence_gap flags in one shot. evidence_gap is a
  // queue type only this script writes, so the set is small.
  const PAGE = 1000
  const seen = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from('intelligence_queue')
      .select('related_import_ids, details')
      .eq('queue_type', 'stalled_case')
      .range(from, from + PAGE - 1)
    if (!data?.length) break
    for (const row of data as Array<{ related_import_ids: string[] | null; details: Record<string, unknown> | null }>) {
      if ((row.details ?? {} as Record<string, unknown>).kind !== 'evidence_gap') continue
      for (const id of row.related_import_ids ?? []) seen.add(id)
    }
    if (data.length < PAGE) break
  }
  return seen
}

interface Severity {
  weight: number
  missing: string[]
}

function evaluateRecord(row: Row): Severity | null {
  const ext = row.ai_extraction
  if (!ext) return null
  const sol = ext.solvability_signals as Record<string, unknown> | undefined
  if (!sol) return null
  const status = sol.evidence_status as Record<string, unknown> | undefined
  if (!status) return null

  let weight = 0
  const missing: string[] = []
  if (status.dna === 'exists_not_entered') { weight += 35; missing.push('DNA') }
  if (status.dental === 'exists_not_entered') { weight += 25; missing.push('dental') }
  if (status.fingerprints === 'exists_not_entered') { weight += 15; missing.push('fingerprints') }

  if (missing.length === 0) return null
  return { weight, missing }
}

async function main() {
  console.log('=== Evidence-gap flagger ===')
  console.log('Looking for cases where evidence exists locally but was not entered into NCIC/CODIS/AFIS.')

  const rows = await fetchAll()
  console.log(`AI-processed records scanned: ${rows.length}`)

  const seen = DRY_RUN ? new Set<string>() : await alreadyFlaggedSet()
  let flagged = 0
  let skipped = 0
  let candidates = 0

  for (const row of rows) {
    const sev = evaluateRecord(row)
    if (!sev) continue
    candidates++

    if (seen.has(row.id)) { skipped++; continue }

    const priority = Math.min(95, 50 + sev.weight)
    const grade = priority >= 80 ? 'high' : priority >= 60 ? 'medium' : 'low'
    const who = row.person_name ?? row.external_id
    const where = row.state ? ` (${row.state})` : ''
    const date = row.date_missing ?? row.date_found ?? '?'

    if (DRY_RUN) {
      console.log(`  [dry] ${who}${where} ${date} — gap: ${sev.missing.join(', ')} — priority ${priority}`)
      flagged++
      continue
    }

    const { error } = await supabase.from('intelligence_queue').insert({
      queue_type: 'stalled_case',
      priority_score: priority,
      priority_grade: grade,
      title: `Evidence gap: ${who}${where} — ${sev.missing.join(' + ')} not entered into national database`,
      summary: `${who}${where}, ${date}. The source record indicates that ${sev.missing.join(', ')} ${sev.missing.length > 1 ? 'records exist' : 'records exist'} locally but were not entered into NCIC / CODIS / AFIS. This is one of the highest-leverage gaps in cold-case work — when the evidence is finally entered, matches often surface within days. Recommend asking the investigating agency whether the records have since been uploaded.`,
      details: {
        kind: 'evidence_gap',
        missing_uploads: sev.missing,
        import_record_id: row.id,
      },
      related_import_ids: [row.id],
      signal_count: sev.missing.length,
      ai_confidence: 0.7,
    })

    if (error) {
      console.error(`  Insert failed for ${row.id}: ${error.message}`)
      continue
    }
    flagged++
  }

  console.log('\n=== Done ===')
  console.log(`Candidates with evidence gap: ${candidates}`)
  console.log(`Flagged: ${flagged}`)
  console.log(`Skipped (already flagged): ${skipped}`)
  if (candidates === 0) {
    console.log('\nNote: this flagger needs the new evidence_status field, which is only populated by ai-batch-process runs after the prompt update. Re-run npm run ai:batch on records you want re-extracted.')
  }
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
