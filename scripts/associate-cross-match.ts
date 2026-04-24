/**
 * Associate cross-match
 *
 * The batch extractor (ai-batch-process) already pulls `entities` out of each
 * case and tags them with role=associate / witness / poi / vehicle_seen. Those
 * are named people (or vehicles) tied to individual cases. Nothing ever
 * cross-indexes them. If the same stepfather name shows up across three
 * teen-disappearance cases in the same state, that's the thread — and right
 * now it's invisible.
 *
 * This script builds a name→records inverted index over ai_extraction.entities
 * where the entity looks like a named person or vehicle, and writes one
 * intelligence_queue row per high-value cluster (≥ 2 records sharing a
 * non-trivial entity in the same state).
 *
 * Usage: npx tsx scripts/associate-cross-match.ts [--min-shared 2] [--state VA]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const args = process.argv.slice(2)
const minSharedIdx = args.indexOf('--min-shared')
const MIN_SHARED = minSharedIdx !== -1 ? parseInt(args[minSharedIdx + 1]) : 2
const stateIdx = args.indexOf('--state')
const STATE_FILTER = stateIdx !== -1 ? args[stateIdx + 1] : null

interface EntityRef {
  recordId: string
  state: string | null
  personName: string | null
  recordType: string
}

// Words that alone aren't investigative signals — common given names, generic
// role words, color/place words that end up in a lot of case files. The
// heuristic is crude but meaningful: a shared associate named "John" across
// three cases is noise; a shared "Randall Ekhart" is a lead.
const TRIVIAL_NAMES = new Set([
  'unknown', 'unnamed', 'unidentified', 'the boyfriend', 'the husband', 'the wife',
  'friend', 'friends', 'family', 'mother', 'father', 'brother', 'sister', 'uncle',
  'aunt', 'cousin', 'son', 'daughter', 'stepfather', 'stepmother', 'grandfather',
  'grandmother', 'neighbor', 'roommate', 'coworker', 'driver', 'employer',
  'suspect', 'witness', 'police', 'the car', 'a car', 'vehicle', 'truck', 'van',
])

function normalizeEntity(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  if (trimmed.length < 4) return null // single letters / initials are noise
  if (TRIVIAL_NAMES.has(trimmed)) return null
  // Collapse whitespace, strip trailing punctuation
  return trimmed.replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '')
}

async function main() {
  console.log('=== Associate Cross-Match ===')
  console.log(`Min shared: ${MIN_SHARED}, State: ${STATE_FILTER ?? 'all'}`)

  // Paginate — the corpus is ~60k and Supabase's default limit is 1000 per
  // select. Without this loop the script silently ignored 97% of the data.
  const PAGE = 1000
  const records: Array<{ id: string; person_name: string | null; record_type: string; state: string | null; ai_extraction: Record<string, unknown> | null }> = []
  for (let from = 0; ; from += PAGE) {
    let page = supabase
      .from('import_records')
      .select('id, person_name, record_type, state, ai_extraction')
      .eq('ai_processed', true)
      .not('ai_extraction', 'is', null)
      .range(from, from + PAGE - 1)
    if (STATE_FILTER) page = page.eq('state', STATE_FILTER)
    const { data, error } = await page
    if (error) {
      console.error('Fetch failed:', error.message)
      process.exit(1)
    }
    if (!data?.length) break
    records.push(...data)
    if (data.length < PAGE) break
  }

  if (!records.length) {
    console.log('No AI-processed records.')
    return
  }

  console.log(`Scanning ${records.length} records...`)

  // Invert: normalized entity value → list of records that mention it
  const index = new Map<string, { type: string; refs: EntityRef[] }>()

  for (const record of records) {
    const extraction = record.ai_extraction as Record<string, unknown> | null
    const entities = (extraction?.entities ?? []) as Array<Record<string, unknown>>
    if (!entities.length) continue

    for (const entity of entities) {
      const entityType = entity.entity_type as string | undefined
      const rawValue = entity.raw_value as string | undefined
      const role = entity.role as string | undefined

      // Only cross-match people and vehicles — location names and organizations
      // are too noisy at this scale.
      if (entityType !== 'person' && entityType !== 'vehicle') continue
      if (!rawValue) continue

      // Skip the subject of the case itself (they're not an "associate").
      if (role === 'subject') continue

      const norm = normalizeEntity(rawValue)
      if (!norm) continue

      const key = `${entityType}:${norm}`
      if (!index.has(key)) index.set(key, { type: entityType, refs: [] })
      index.get(key)!.refs.push({
        recordId: record.id,
        state: record.state,
        personName: record.person_name,
        recordType: record.record_type,
      })
    }
  }

  // Only keep entities that appear across multiple records. Deduplicate by
  // record_id — the same record mentioning the same associate twice doesn't
  // count.
  const clusters: Array<{ key: string; type: string; normValue: string; refs: EntityRef[] }> = []
  for (const [key, { type, refs }] of index.entries()) {
    const uniqueByRecord = Array.from(
      new Map(refs.map(r => [r.recordId, r])).values()
    )
    if (uniqueByRecord.length < MIN_SHARED) continue
    clusters.push({
      key,
      type,
      normValue: key.split(':').slice(1).join(':'),
      refs: uniqueByRecord,
    })
  }

  console.log(`Found ${clusters.length} shared-entity clusters.`)

  // Sort by recency × breadth: most references first
  clusters.sort((a, b) => b.refs.length - a.refs.length)

  let flagged = 0
  for (const cluster of clusters) {
    // Same-state clusters are much stronger signals than cross-country ones.
    const states = new Set(cluster.refs.map(r => r.state).filter(Boolean))
    const sameStateConcentration = states.size === 1 && cluster.refs.length >= 2

    const priority = sameStateConcentration
      ? Math.min(90, 50 + cluster.refs.length * 10)
      : Math.min(70, 30 + cluster.refs.length * 5)

    // Skip weak ones — too much noise.
    if (priority < 45) continue

    const typeLabel = cluster.type === 'person' ? 'person' : 'vehicle'
    const stateSummary = sameStateConcentration
      ? `all in ${Array.from(states)[0]}`
      : `across ${states.size} state${states.size === 1 ? '' : 's'}`
    const peopleLine = cluster.refs
      .slice(0, 5)
      .map(r => r.personName ?? '(unidentified)')
      .join(', ')
    const more = cluster.refs.length > 5 ? `, +${cluster.refs.length - 5} more` : ''

    await supabase.from('intelligence_queue').insert({
      queue_type: 'shared_associate',
      priority_score: priority,
      priority_grade: priority >= 75 ? 'high' : 'medium',
      title: `Shared ${typeLabel}: "${cluster.normValue}" appears in ${cluster.refs.length} cases`,
      summary: `A ${typeLabel} entity "${cluster.normValue}" is mentioned in ${cluster.refs.length} cases (${stateSummary}): ${peopleLine}${more}. Could be a shared associate, witness, or vehicle — or could be name collision. Requires human review.`,
      details: {
        entity_type: cluster.type,
        entity_value: cluster.normValue,
        state_concentration: sameStateConcentration,
        states: Array.from(states),
        records: cluster.refs.map(r => ({
          import_record_id: r.recordId,
          person_name: r.personName,
          record_type: r.recordType,
          state: r.state,
        })),
      },
      related_import_ids: cluster.refs.map(r => r.recordId),
      signal_count: cluster.refs.length,
      ai_confidence: sameStateConcentration ? 0.7 : 0.4,
    })
    flagged++
  }

  console.log(`\n=== Done ===`)
  console.log(`Clusters flagged: ${flagged}`)
  console.log(`Skipped (below priority floor): ${clusters.length - flagged}`)
}

main().catch(console.error)
