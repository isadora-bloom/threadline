/**
 * Negative-space jurisdiction flagger
 *
 * Looks for states whose missing-person count, per million residents, sits
 * meaningfully below the national mean. The interpretation is intentionally
 * cautious: a low rate could mean genuinely safer demographics, but it could
 * also mean a sheriff's office that does not enter cases into NamUs. Either
 * way, a websleuth or journalist can use the flag as a starting point for
 * jurisdictional investigation.
 *
 * State-level only — county-level requires a Census lookup that is not in
 * this repo yet. State counts use 2020 census-era populations baked in
 * below; precision matters less than order of magnitude.
 *
 * Writes one queue_type='geographic_cluster' row per under-reporting state
 * with details.kind='under_reported_state'. Idempotent via per-state
 * existence check.
 *
 * Usage: npx tsx scripts/negative-space-flag.ts [--threshold 0.5] [--dry-run]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const args = process.argv.slice(2)
const thresholdIdx = args.indexOf('--threshold')
const RATIO_THRESHOLD = thresholdIdx !== -1 ? parseFloat(args[thresholdIdx + 1]) : 0.5
const DRY_RUN = args.includes('--dry-run')

// 2020 US Census state populations in thousands. Approximate; precision
// matters less than order of magnitude here. Includes DC and PR. Territories
// like Guam are intentionally omitted — too small to compute a meaningful
// per-million rate.
const STATE_POP_THOUSANDS: Record<string, number> = {
  Alabama: 5024, Alaska: 733, Arizona: 7152, Arkansas: 3011,
  California: 39538, Colorado: 5773, Connecticut: 3605, Delaware: 989,
  'District of Columbia': 689, Florida: 21538, Georgia: 10711, Hawaii: 1455,
  Idaho: 1839, Illinois: 12812, Indiana: 6785, Iowa: 3190,
  Kansas: 2937, Kentucky: 4505, Louisiana: 4657, Maine: 1362,
  Maryland: 6177, Massachusetts: 7029, Michigan: 10077, Minnesota: 5706,
  Mississippi: 2961, Missouri: 6154, Montana: 1084, Nebraska: 1961,
  Nevada: 3104, 'New Hampshire': 1377, 'New Jersey': 9288, 'New Mexico': 2117,
  'New York': 20201, 'North Carolina': 10439, 'North Dakota': 779, Ohio: 11799,
  Oklahoma: 3959, Oregon: 4237, Pennsylvania: 13002, 'Rhode Island': 1097,
  'South Carolina': 5118, 'South Dakota': 886, Tennessee: 6910, Texas: 29145,
  Utah: 3271, Vermont: 643, Virginia: 8631, Washington: 7705,
  'West Virginia': 1793, Wisconsin: 5893, Wyoming: 577,
  'Puerto Rico': 3286,
}

// Small-population threshold — below this, the per-million rate fluctuates
// too wildly to flag confidently.
const MIN_POP_THOUSANDS = 1000 // 1M residents

interface StateStats {
  state: string
  population: number
  observedMissing: number
  perMillion: number
}

async function fetchObservedCounts(): Promise<Map<string, number>> {
  // Pull all missing-person records grouped by state. We do client-side
  // counting to avoid SQL group-by which is awkward through PostgREST.
  const PAGE = 1000
  const counts = new Map<string, number>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('import_records')
      .select('state')
      .eq('record_type', 'missing_person')
      .not('state', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) { console.error('Fetch failed:', error.message); process.exit(1) }
    if (!data?.length) break
    for (const row of data as Array<{ state: string }>) {
      const k = row.state.trim().replace(/\.$/, '') // strip trailing periods that some imports carry
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    if (data.length < PAGE) break
  }
  return counts
}

async function alreadyFlagged(state: string): Promise<boolean> {
  const { data } = await supabase
    .from('intelligence_queue')
    .select('id, details')
    .eq('queue_type', 'geographic_cluster')
    .limit(500)
  for (const row of (data ?? []) as Array<{ details: Record<string, unknown> | null }>) {
    const d = row.details ?? {}
    if ((d as Record<string, unknown>).kind === 'under_reported_state'
      && (d as Record<string, unknown>).state === state) return true
  }
  return false
}

async function main() {
  console.log('=== Negative-space jurisdiction flagger ===')
  console.log(`Ratio threshold: ${RATIO_THRESHOLD} (states below this fraction of national rate will flag)`)

  const observed = await fetchObservedCounts()
  console.log(`Observed-counted states: ${observed.size}`)

  // Compute national rate using only states we have populations for.
  let totalCount = 0
  let totalPop = 0
  const stateStats: StateStats[] = []
  for (const [state, count] of observed.entries()) {
    const popK = STATE_POP_THOUSANDS[state]
    if (!popK) continue
    totalCount += count
    totalPop += popK
    stateStats.push({
      state,
      population: popK * 1000,
      observedMissing: count,
      perMillion: count / (popK / 1000),
    })
  }

  if (stateStats.length === 0) {
    console.log('No states matched population table — check your record `state` values.')
    return
  }

  const nationalPerMillion = totalCount / (totalPop / 1000)
  console.log(`National mean: ${nationalPerMillion.toFixed(1)} missing per million (over ${totalCount} records / ${totalPop.toLocaleString()} thousand population)`)

  stateStats.sort((a, b) => a.perMillion - b.perMillion)

  console.log('\nLowest per-million states:')
  for (const s of stateStats.slice(0, 10)) {
    const ratio = s.perMillion / nationalPerMillion
    console.log(`  ${s.state.padEnd(22)} ${s.observedMissing.toString().padStart(6)} cases  ${s.perMillion.toFixed(1).padStart(6)}/M  ratio ${ratio.toFixed(2)}`)
  }

  let flagged = 0
  let skipped = 0

  for (const s of stateStats) {
    if (s.population < MIN_POP_THOUSANDS * 1000) continue
    const ratio = s.perMillion / nationalPerMillion
    if (ratio >= RATIO_THRESHOLD) continue
    if (DRY_RUN) {
      console.log(`  [dry] would flag ${s.state} — ratio ${ratio.toFixed(2)}`)
      flagged++
      continue
    }
    if (await alreadyFlagged(s.state)) { skipped++; continue }

    const priority = ratio < 0.3 ? 70 : ratio < 0.4 ? 60 : 50
    const expectedCount = Math.round(nationalPerMillion * (s.population / 1_000_000))
    const gap = expectedCount - s.observedMissing

    const { error } = await supabase.from('intelligence_queue').insert({
      queue_type: 'geographic_cluster',
      priority_score: priority,
      priority_grade: priority >= 65 ? 'high' : 'medium',
      title: `Possible under-reporting: ${s.state} has ${s.perMillion.toFixed(1)} missing-person records per million (${(ratio * 100).toFixed(0)}% of national rate)`,
      summary: `${s.state} has ${s.observedMissing.toLocaleString()} missing-person records in our combined registries (NamUs + Doe Network + Charley Project). At the national rate of ${nationalPerMillion.toFixed(1)} per million, we would expect roughly ${expectedCount.toLocaleString()}. The gap is ${gap.toLocaleString()} cases. Plausible explanations: a sheriff's office not entering cases into NamUs, a state with a separate registry not yet imported, or a genuinely lower demographic rate. A journalist or oversight body could investigate which.`,
      details: {
        kind: 'under_reported_state',
        state: s.state,
        population: s.population,
        observed: s.observedMissing,
        expected: expectedCount,
        per_million: s.perMillion,
        national_per_million: nationalPerMillion,
        ratio,
      },
      related_import_ids: [],
      signal_count: 1,
      ai_confidence: 0.4, // low — many alternative explanations exist
    })
    if (error) {
      console.error(`  Insert failed for ${s.state}: ${error.message}`)
      continue
    }
    flagged++
  }

  console.log('\n=== Done ===')
  console.log(`Flagged: ${flagged}`)
  console.log(`Skipped (already flagged): ${skipped}`)
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
