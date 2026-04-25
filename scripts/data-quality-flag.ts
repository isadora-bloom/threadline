/**
 * Data quality flagger
 *
 * Two passes that turn data-correctness signals into intelligence_queue rows
 * so the Needs Attention page reads from a persisted full-corpus scan instead
 * of running a JS aggregation on a 2k slice every visit (which missed ~95%
 * of the corpus).
 *
 *   1. Stale records  — import_records.stale = true. The scrapers set this
 *      when source data has changed but the record has not been re-imported.
 *
 *   2. Cross-source duplicates — same normalized name + sex + state appearing
 *      in more than one import source. Could be the same case tracked by
 *      multiple registries, or a name collision between different people.
 *      Either way, a human should reconcile.
 *
 * Both write queue_type='contradiction' with details.kind = 'data_quality_stale'
 * or 'data_quality_dupe'. Idempotent per kind+import_record_id.
 *
 * Usage: npx tsx scripts/data-quality-flag.ts [--dry-run]
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

interface BaseRow {
  id: string
  person_name: string | null
  sex: string | null
  state: string | null
  record_type: string
  external_id: string
  source_id: string | null
}

function normalizeKey(personName: string | null, sex: string | null, state: string | null): string | null {
  if (!personName) return null
  const name = personName.toLowerCase().trim()
  if (!name || name === 'unknown' || name === 'unidentified') return null
  return `${name}|${(sex ?? '').toLowerCase()}|${(state ?? '').toLowerCase()}`
}

async function fetchAllMissing(): Promise<BaseRow[]> {
  const PAGE = 1000
  const rows: BaseRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('import_records')
      .select('id, person_name, sex, state, record_type, external_id, source_id')
      .eq('record_type', 'missing_person')
      .not('person_name', 'is', null)
      .order('person_name')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('Fetch failed:', error.message)
      process.exit(1)
    }
    if (!data?.length) break
    rows.push(...(data as BaseRow[]))
    if (data.length < PAGE) break
  }
  return rows
}

async function fetchStale(): Promise<BaseRow[]> {
  const PAGE = 1000
  const rows: BaseRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('import_records')
      .select('id, person_name, sex, state, record_type, external_id, source_id')
      .eq('stale', true)
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('Stale fetch failed:', error.message)
      process.exit(1)
    }
    if (!data?.length) break
    rows.push(...(data as BaseRow[]))
    if (data.length < PAGE) break
  }
  return rows
}

async function alreadyFlaggedDupe(recordIds: string[]): Promise<Set<string>> {
  // Pull every existing data_quality_dupe flag and union all related_import_ids.
  // Cheaper than per-record lookup once data scales.
  const { data } = await supabase
    .from('intelligence_queue')
    .select('related_import_ids, details')
    .eq('queue_type', 'contradiction')
    .limit(5000)
  const seen = new Set<string>()
  for (const row of (data ?? []) as Array<{ related_import_ids: string[] | null; details: Record<string, unknown> | null }>) {
    const kind = (row.details ?? {} as Record<string, unknown>).kind
    if (kind !== 'data_quality_dupe') continue
    for (const id of row.related_import_ids ?? []) seen.add(id)
  }
  void recordIds
  return seen
}

async function alreadyFlaggedStale(): Promise<Set<string>> {
  const { data } = await supabase
    .from('intelligence_queue')
    .select('related_import_ids, details')
    .eq('queue_type', 'contradiction')
    .limit(5000)
  const seen = new Set<string>()
  for (const row of (data ?? []) as Array<{ related_import_ids: string[] | null; details: Record<string, unknown> | null }>) {
    const kind = (row.details ?? {} as Record<string, unknown>).kind
    if (kind !== 'data_quality_stale') continue
    for (const id of row.related_import_ids ?? []) seen.add(id)
  }
  return seen
}

async function runDupePass() {
  console.log('\n--- Pass: cross-source duplicates ---')
  const rows = await fetchAllMissing()
  console.log(`Scanned ${rows.length} missing-person records`)

  const byKey = new Map<string, BaseRow[]>()
  for (const r of rows) {
    const key = normalizeKey(r.person_name, r.sex, r.state)
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(r)
  }

  const dupeGroups: BaseRow[][] = []
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    const sourceIds = new Set(group.map(r => r.source_id))
    if (sourceIds.size < 2) continue // single-source duplicates handled elsewhere
    dupeGroups.push(group)
  }
  // Highest-signal first: more sources or more records means stronger dupe.
  dupeGroups.sort((a, b) => {
    const aSources = new Set(a.map(r => r.source_id)).size
    const bSources = new Set(b.map(r => r.source_id)).size
    if (bSources !== aSources) return bSources - aSources
    return b.length - a.length
  })
  // Cap at 500 to avoid drowning the queue. Triage these first; if the user
  // wants more they can re-run with a future --all flag.
  const DUPE_CAP = 500
  const totalGroups = dupeGroups.length
  const capped = dupeGroups.slice(0, DUPE_CAP)
  console.log(`Cross-source dupe groups: ${totalGroups} found, capping at ${capped.length} highest-signal`)

  if (DRY_RUN) {
    for (const g of capped.slice(0, 5)) {
      console.log(`  ${g[0].person_name} (${g[0].state}) — ${g.length} records across ${new Set(g.map(r => r.source_id)).size} sources`)
    }
    return
  }

  const alreadySeen = await alreadyFlaggedDupe(capped.flatMap(g => g.map(r => r.id)))
  let flagged = 0
  let skipped = 0

  for (const group of capped) {
    const ids = group.map(r => r.id)
    if (ids.some(id => alreadySeen.has(id))) {
      skipped++
      continue
    }
    const sample = group[0]
    const sources = Array.from(new Set(group.map(r => r.source_id)))

    const { error } = await supabase.from('intelligence_queue').insert({
      queue_type: 'contradiction',
      priority_score: 55,
      priority_grade: 'medium',
      title: `Cross-source duplicate: "${sample.person_name}" (${sample.state ?? '?'}) appears in ${sources.length} sources`,
      summary: `Records with the same normalized name, sex, and state are present in ${sources.length} different sources. Could be the same case tracked separately, or a name collision. ${group.length} records: ${group.map(r => r.external_id).join(', ')}.`,
      details: {
        kind: 'data_quality_dupe',
        person_name: sample.person_name,
        sex: sample.sex,
        state: sample.state,
        source_ids: sources,
        external_ids: group.map(r => r.external_id),
      },
      related_import_ids: ids,
      signal_count: group.length,
      ai_confidence: 0.5,
    })
    if (error) {
      console.error(`  Insert failed for ${sample.person_name}: ${error.message}`)
      continue
    }
    flagged++
  }

  console.log(`Dupes: ${flagged} flagged, ${skipped} skipped (already)`)
}

async function runStalePass() {
  console.log('\n--- Pass: stale records ---')
  const rows = await fetchStale()
  console.log(`Scanned ${rows.length} stale records`)
  if (DRY_RUN) {
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.person_name ?? r.external_id} (${r.state})`)
    }
    return
  }

  const alreadySeen = await alreadyFlaggedStale()
  let flagged = 0
  let skipped = 0

  for (const r of rows) {
    if (alreadySeen.has(r.id)) { skipped++; continue }
    const { error } = await supabase.from('intelligence_queue').insert({
      queue_type: 'contradiction',
      priority_score: 40,
      priority_grade: 'medium',
      title: `Stale record: ${r.person_name ?? r.external_id} (${r.state ?? '?'})`,
      summary: `${r.person_name ?? r.external_id} has changed in the source database since last import. Re-import to sync.`,
      details: {
        kind: 'data_quality_stale',
        external_id: r.external_id,
      },
      related_import_ids: [r.id],
      signal_count: 1,
      ai_confidence: 0.9,
    })
    if (error) {
      console.error(`  Insert failed for ${r.id}: ${error.message}`)
      continue
    }
    flagged++
  }

  console.log(`Stale: ${flagged} flagged, ${skipped} skipped (already)`)
}

async function main() {
  console.log('=== Data Quality Flagger ===')
  console.log(`Dry run: ${DRY_RUN}`)

  await runStalePass()
  await runDupePass()

  console.log('\n=== Done ===')
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
