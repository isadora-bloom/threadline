/**
 * Semantic nearest-neighbor flagger
 *
 * Pairs of records with high embedding similarity that the lexical /
 * 16-signal matchers would miss. Typical example: two cases describe an
 * identical tattoo in different words. Cosine similarity on voyage-3
 * embeddings catches the paraphrase.
 *
 * Uses the nearest_by_marks and nearest_by_circumstances helper functions
 * from migration 037. Runs two passes:
 *
 *   - marks: a marks-similarity above MARKS_HIGH_THRESHOLD on a pair of
 *     missing/remains records is a strong near-identification signal
 *   - circumstances: similarity above CIRC_HIGH_THRESHOLD is a circumstantial
 *     echo — same MO, same setting, same victimology
 *
 * Writes queue_type='entity_crossmatch' with details.kind='semantic_marks'
 * or 'semantic_circumstances'. Idempotent by (pair, kind).
 *
 * Usage: npx tsx scripts/semantic-neighbors.ts [--state VA] [--limit 1000]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const args = process.argv.slice(2)
const stateIdx = args.indexOf('--state')
const STATE_FILTER = stateIdx !== -1 ? args[stateIdx + 1] : null
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 2000

// Thresholds are conservative to keep noise down. Voyage-3 cosine similarity
// on short English text is fairly generous so 0.88+ is where "actually the
// same thing expressed differently" tends to start.
const MARKS_HIGH_THRESHOLD = 0.88
const CIRC_HIGH_THRESHOLD = 0.90

// Neighbors per source record — looked up via the SQL helper. 10 is plenty
// for high-threshold filtering at the top end.
const NEIGHBORS_PER_RECORD = 10

interface Seed {
  id: string
  person_name: string | null
  state: string | null
  record_type: string
  external_id: string
}

async function fetchSeeds(embedColumn: 'circumstances_embedded_at' | 'marks_embedded_at'): Promise<Seed[]> {
  const PAGE = 1000
  const rows: Seed[] = []
  for (let from = 0; ; from += PAGE) {
    if (rows.length >= LIMIT) break
    const take = Math.min(PAGE, LIMIT - rows.length)
    let q = supabase
      .from('import_records')
      .select('id, person_name, state, record_type, external_id')
      .not(embedColumn, 'is', null)
      .range(from, from + take - 1)
    if (STATE_FILTER) q = q.eq('state', STATE_FILTER)
    const { data, error } = await q
    if (error) { console.error('Fetch failed:', error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...(data as Seed[]))
    if (data.length < take) break
  }
  return rows
}

interface Neighbor {
  id: string
  person_name: string | null
  record_type: string
  state: string | null
  similarity: number
}

async function callNeighbor(rpc: 'nearest_by_circumstances' | 'nearest_by_marks', targetId: string): Promise<Neighbor[]> {
  const { data, error } = await supabase.rpc(rpc, { target_id: targetId, match_count: NEIGHBORS_PER_RECORD })
  if (error) {
    console.error(`  rpc ${rpc}(${targetId}) failed: ${error.message}`)
    return []
  }
  return (data ?? []) as Neighbor[]
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

async function alreadyFlagged(kind: string, aId: string, bId: string): Promise<boolean> {
  const { data } = await supabase
    .from('intelligence_queue')
    .select('id, related_import_ids, details')
    .eq('queue_type', 'entity_crossmatch')
    .contains('related_import_ids', [aId])
    .limit(20)
  if (!data) return false
  for (const row of data as Array<{ related_import_ids: string[]; details: Record<string, unknown> | null }>) {
    if (!row.related_import_ids?.includes(bId)) continue
    const d = row.details ?? {}
    if ((d as Record<string, unknown>).kind === kind) return true
  }
  return false
}

async function runPass(
  kind: 'semantic_circumstances' | 'semantic_marks',
) {
  const embedColumn = kind === 'semantic_marks' ? 'marks_embedded_at' : 'circumstances_embedded_at'
  const rpc = kind === 'semantic_marks' ? 'nearest_by_marks' : 'nearest_by_circumstances'
  const threshold = kind === 'semantic_marks' ? MARKS_HIGH_THRESHOLD : CIRC_HIGH_THRESHOLD

  console.log(`\n--- Pass: ${kind} (threshold ${threshold}) ---`)

  const seeds = await fetchSeeds(embedColumn)
  console.log(`Seeds: ${seeds.length}`)

  const seen = new Set<string>()
  let flagged = 0
  let considered = 0

  for (const seed of seeds) {
    const neighbors = await callNeighbor(rpc, seed.id)
    for (const n of neighbors) {
      if (n.similarity < threshold) continue
      const key = pairKey(seed.id, n.id)
      if (seen.has(key)) continue
      seen.add(key)
      considered++

      // Skip if already flagged (by either direction) for this kind.
      if (await alreadyFlagged(kind, seed.id, n.id)) continue

      const priority = Math.min(95, Math.round(50 + (n.similarity - threshold) * 400))
      const grade = priority >= 80 ? 'high' : priority >= 65 ? 'medium' : 'low'

      const typeLabel = kind === 'semantic_marks' ? 'Mark description' : 'Circumstance narrative'
      const title =
        `${typeLabel} near-match: ${seed.person_name ?? seed.external_id} ↔ ${n.person_name ?? n.id} (sim ${n.similarity.toFixed(3)})`
      const summary =
        kind === 'semantic_marks'
          ? `These two records describe distinguishing marks that read as the same description in different words (cosine similarity ${n.similarity.toFixed(3)} on voyage-3 embeddings). Lexical matchers did not link them because word choice differed. Review side by side.`
          : `These two records describe circumstances that match semantically (cosine similarity ${n.similarity.toFixed(3)} on voyage-3 embeddings). Same situation, different phrasing — look for shared MO, setting, or victimology.`

      const { error: insertErr } = await supabase
        .from('intelligence_queue')
        .insert({
          queue_type: 'entity_crossmatch',
          priority_score: priority,
          priority_grade: grade,
          title,
          summary,
          details: {
            kind,
            similarity: n.similarity,
            seed_id: seed.id,
            neighbor_id: n.id,
            model: 'voyage-3',
          },
          related_import_ids: [seed.id, n.id],
          signal_count: 1,
          ai_confidence: n.similarity,
        })
      if (insertErr) {
        console.error(`  Insert failed for ${key}: ${insertErr.message}`)
        continue
      }
      flagged++
    }
  }

  console.log(`${kind}: considered ${considered} unique pairs above threshold, flagged ${flagged}`)
}

async function main() {
  console.log(`=== Semantic Nearest-Neighbor Flagger ===`)
  console.log(`State filter: ${STATE_FILTER ?? 'all'}, Seed limit: ${LIMIT}`)

  await runPass('semantic_marks')
  await runPass('semantic_circumstances')

  console.log('\n=== Done ===')
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
