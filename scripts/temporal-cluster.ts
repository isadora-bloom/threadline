/**
 * Temporal cluster detector
 *
 * A seasoned detective treats seasonality as its own axis of evidence. Five
 * disappearances from the same region all in December across different years
 * signal something structural (hunting season, college breaks, holiday
 * isolation) that single-case analysis will miss. Day-of-week clustering
 * catches routes and rituals: truck-stop abductions cluster Thursday–Sunday.
 *
 * This script buckets missing-person records by (month, state) and
 * (weekday, state) and flags any bucket with at least MIN_CLUSTER records.
 * Same state is required because a national calendar pattern is almost
 * always a reporting artifact.
 *
 * Writes one intelligence_queue row per bucket that survives the floor.
 *
 * Usage: npx tsx scripts/temporal-cluster.ts [--min-cluster 4]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const args = process.argv.slice(2)
const minIdx = args.indexOf('--min-cluster')
const MIN_CLUSTER = minIdx !== -1 ? parseInt(args[minIdx + 1]) : 4

interface Row {
  id: string
  person_name: string | null
  state: string | null
  date_missing: string | null
  record_type: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

async function fetchAll(): Promise<Row[]> {
  const PAGE = 1000
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('import_records')
      .select('id, person_name, state, date_missing, record_type')
      .eq('record_type', 'missing_person')
      .not('date_missing', 'is', null)
      .not('state', 'is', null)
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
  console.log('=== Temporal Cluster Detector ===')
  console.log(`Min cluster: ${MIN_CLUSTER}`)

  const rows = await fetchAll()
  console.log(`Scanning ${rows.length} missing-person records with known date and state.`)

  // Bucket by (state, month) and (state, weekday)
  const monthBuckets = new Map<string, Row[]>()
  const weekdayBuckets = new Map<string, Row[]>()

  for (const row of rows) {
    const d = new Date(row.date_missing as string)
    if (Number.isNaN(d.getTime())) continue
    const month = d.getUTCMonth() // 0-11
    const weekday = d.getUTCDay() // 0-6

    const mKey = `${row.state}|${month}`
    const wKey = `${row.state}|${weekday}`

    if (!monthBuckets.has(mKey)) monthBuckets.set(mKey, [])
    if (!weekdayBuckets.has(wKey)) weekdayBuckets.set(wKey, [])
    monthBuckets.get(mKey)!.push(row)
    weekdayBuckets.get(wKey)!.push(row)
  }

  // Expected uniform share is 1/12 for months, 1/7 for weekdays. We want
  // clusters that are BOTH numerous (≥ MIN_CLUSTER) and skewed well above
  // what chance would produce in a given state.
  const stateTotal = new Map<string, number>()
  for (const row of rows) {
    if (!row.state) continue
    stateTotal.set(row.state, (stateTotal.get(row.state) ?? 0) + 1)
  }

  type Cluster = { key: string; bucket: 'month' | 'weekday'; state: string; label: string; records: Row[]; lift: number }
  const clusters: Cluster[] = []

  for (const [key, records] of monthBuckets) {
    if (records.length < MIN_CLUSTER) continue
    const [state, monthStr] = key.split('|')
    const total = stateTotal.get(state) ?? records.length
    const expected = total / 12
    const lift = records.length / Math.max(1, expected)
    // Require at least 1.6x over chance. Otherwise it's just raw volume.
    if (lift < 1.6) continue
    clusters.push({
      key,
      bucket: 'month',
      state,
      label: MONTHS[parseInt(monthStr)],
      records,
      lift,
    })
  }

  for (const [key, records] of weekdayBuckets) {
    if (records.length < MIN_CLUSTER) continue
    const [state, weekdayStr] = key.split('|')
    const total = stateTotal.get(state) ?? records.length
    const expected = total / 7
    const lift = records.length / Math.max(1, expected)
    if (lift < 1.5) continue
    clusters.push({
      key,
      bucket: 'weekday',
      state,
      label: WEEKDAYS[parseInt(weekdayStr)],
      records,
      lift,
    })
  }

  console.log(`Found ${clusters.length} significant temporal clusters.`)

  // Sort by lift × count so the most skewed high-volume buckets land first
  clusters.sort((a, b) => (b.lift * b.records.length) - (a.lift * a.records.length))

  let flagged = 0
  let skippedDuplicate = 0
  for (const cluster of clusters) {
    const priority = Math.min(
      90,
      Math.round(40 + (cluster.lift - 1) * 20 + Math.min(cluster.records.length - MIN_CLUSTER, 10) * 2)
    )
    if (priority < 45) continue

    const sample = cluster.records.slice(0, 5).map(r => r.person_name ?? r.id).join(', ')
    const more = cluster.records.length > 5 ? `, +${cluster.records.length - 5} more` : ''

    const title =
      cluster.bucket === 'month'
        ? `Month cluster: ${cluster.records.length} ${cluster.state} disappearances in ${cluster.label} (${cluster.lift.toFixed(1)}× expected)`
        : `Weekday cluster: ${cluster.records.length} ${cluster.state} disappearances on ${cluster.label} (${cluster.lift.toFixed(1)}× expected)`

    // Idempotency: skip if we already flagged this exact cluster in a previous run.
    const { data: existing } = await supabase
      .from('intelligence_queue')
      .select('id')
      .eq('queue_type', 'temporal_pattern')
      .eq('title', title)
      .maybeSingle()
    if (existing) {
      skippedDuplicate++
      continue
    }

    // Use the existing 'temporal_pattern' queue_type — intelligence_queue has
    // a CHECK constraint that only allows a fixed enum set.
    const { error: insertErr } = await supabase.from('intelligence_queue').insert({
      queue_type: 'temporal_pattern',
      priority_score: priority,
      priority_grade: priority >= 75 ? 'high' : 'medium',
      title,
      summary: `${cluster.records.length} missing-person records in ${cluster.state} share the same ${cluster.bucket} (${cluster.label}), which is ${cluster.lift.toFixed(1)}× the uniform expectation for that state. Sample: ${sample}${more}. A seasoned investigator would ask whether a recurring event, route, or offender behavior ties them.`,
      details: {
        bucket: cluster.bucket,
        state: cluster.state,
        label: cluster.label,
        count: cluster.records.length,
        lift: cluster.lift,
        record_ids: cluster.records.map(r => r.id),
      },
      related_import_ids: cluster.records.map(r => r.id),
      signal_count: cluster.records.length,
      ai_confidence: Math.min(0.9, 0.4 + (cluster.lift - 1) * 0.15),
    })
    if (insertErr) {
      console.error(`  Insert failed for ${cluster.key}: ${insertErr.message}`)
      continue
    }
    flagged++
  }

  console.log(`\n=== Done ===`)
  console.log(`Clusters flagged: ${flagged}`)
  console.log(`Skipped (already flagged): ${skippedDuplicate}`)
  console.log(`Skipped (below priority floor): ${clusters.length - flagged - skippedDuplicate}`)
}

main().catch(console.error)
