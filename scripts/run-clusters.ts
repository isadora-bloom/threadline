/**
 * Standalone cluster runner
 * Runs all 9 victimology cluster analyses against the Doe Network missing persons case.
 * Uses the service role key via X-Internal-Key header — bypasses cookie auth.
 *
 * Usage:
 *   npx tsx scripts/run-clusters.ts
 *   npx tsx scripts/run-clusters.ts --url https://your-app.vercel.app   (against deployed)
 *   npx tsx scripts/run-clusters.ts --only corridor_cluster,demographic_hotspot
 *
 * Safe to re-run: each cluster type clears its own old rows before inserting fresh ones.
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const BASE_URL = (() => {
  const fromFlag = process.argv.find(a => a.startsWith('--url='))?.split('=')[1]
  const idx = process.argv.indexOf('--url')
  const fromNext = idx !== -1 ? process.argv[idx + 1] : null
  const urlArg = fromFlag ?? (fromNext && !fromNext.startsWith('--') ? fromNext : null)
  if (urlArg) return urlArg.replace(/\/$/, '')
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
})()

const ONLY_ARG = (() => {
  const onlyArg = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]
               ?? (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null)
  if (onlyArg && !onlyArg.startsWith('--')) return new Set(onlyArg.split(',').map(s => s.trim()))
  return null
})()

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

if (!SERVICE_KEY || !SUPABASE_URL) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ─── All cluster steps ────────────────────────────────────────────────────────

const CLUSTER_STEPS: Array<{
  action: string
  label: string
  description: string
}> = [
  {
    action: 'cluster',
    label: 'Demographic / temporal',
    description: 'Groups by sex + race + age bracket + state, flags decade spikes',
  },
  {
    action: 'circumstance_cluster',
    label: 'Circumstance signals',
    description: 'Foster care, hitchhiking, truck stop, sex work, runaway patterns',
  },
  {
    action: 'same_date_cluster',
    label: 'Same-date proximity',
    description: 'Multiple disappearances on same date in same state',
  },
  {
    action: 'location_runaway_cluster',
    label: 'Location runaway',
    description: '3+ runaway/voluntary cases from same city within a 5-year window',
  },
  {
    action: 'corridor_cluster',
    label: 'Corridor (text mention)',
    description: 'Circumstances or location text mentions a major US highway',
  },
  {
    action: 'highway_proximity',
    label: 'Highway proximity (geographic)',
    description: 'Disappearance city is within ~20 miles of a major interstate',
  },
  {
    action: 'national_park_proximity',
    label: 'Wilderness / national park',
    description: 'Disappearance city is within ~20 miles of a national park or wilderness area',
  },
  {
    action: 'age_bracket_cluster',
    label: 'Age-bracket tight cluster',
    description: '4+ cases, same sex+state, age SD ≤ 3.5yr, spanning 5+ years',
  },
  {
    action: 'demographic_hotspot',
    label: 'Demographic hotspot (anomaly)',
    description: 'City × decade × demographic combinations with ≥2× expected rate',
  },
  {
    action: 'destination_route_match',
    label: 'Destination route match',
    description: 'Score unidentified remains in stated destination state against full physical description',
  },
]

// ─── API caller ────────────────────────────────────────────────────────────────

async function callCluster(
  action: string,
  missingCaseId: string,
  extraBody?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/api/pattern/doe-match`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': SERVICE_KEY,
    },
    body: JSON.stringify({ action, missingCaseId, ...extraBody }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`${res.status}: ${text.slice(0, 200)}`)
  }

  return res.json() as Promise<Record<string, unknown>>
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function pad(s: string, n: number) { return s.padEnd(n).slice(0, n) }
function commas(n: number | null | undefined) { return (n ?? 0).toLocaleString() }

function summarise(action: string, result: Record<string, unknown>): string {
  const parts: string[] = []

  const clusters = (result.clustersInserted as number) ?? (result.inserted as number) ?? null
  const members  = (result.membersInserted as number) ?? (result.memberRowsInserted as number) ?? null
  const total    = (result.totalCasesAnalyzed as number) ?? (result.totalCases as number) ?? null

  if (clusters !== null) parts.push(`${commas(clusters)} clusters`)
  if (members  !== null) parts.push(`${commas(members)} members`)
  if (total    !== null) parts.push(`from ${commas(total)} cases`)

  if (action === 'corridor_cluster' || action === 'highway_proximity') {
    const found = result.corridorsFound as number | undefined
    if (found !== undefined) parts.push(`${found} corridors hit`)
  }
  if (action === 'national_park_proximity') {
    const found = result.parksFound as number | undefined
    if (found !== undefined) parts.push(`${found} parks/areas hit`)
  }
  if (action === 'demographic_hotspot') {
    const threshold = result.anomalyThreshold as string | undefined
    if (threshold) parts.push(`threshold ${threshold}`)
  }

  return parts.join(' · ') || 'done'
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nDoe Network Cluster Runner')
  console.log('==========================')
  console.log(`Target:  ${BASE_URL}`)
  if (ONLY_ARG) console.log(`Filter:  ${[...ONLY_ARG].join(', ')}`)
  console.log()

  // Find both Doe Network cases
  const { data: allDoe } = await supabase
    .from('cases')
    .select('id, title')
    .ilike('title', '%Doe Network%')

  const missingCase     = allDoe?.find(c => /missing/i.test(c.title))
  const unidentifiedCase = allDoe?.find(c => /unidentified/i.test(c.title))

  if (!missingCase) {
    console.error('Could not find "Doe Network Import — Missing Persons" case.')
    console.error('Run the import script first, or check your Supabase connection.')
    process.exit(1)
  }

  const missingCaseId      = missingCase.id
  const unidentifiedCaseId = unidentifiedCase?.id ?? null
  console.log(`Case:  ${missingCase.title}`)
  console.log(`ID:    ${missingCaseId}`)
  if (unidentifiedCaseId) console.log(`Unid:  ${unidentifiedCase!.title}`)

  // Count submissions so we know the dataset size
  const { count: subCount } = await supabase
    .from('submissions')
    .select('*', { count: 'exact', head: true })
    .eq('case_id', missingCaseId)

  console.log(`Subs:  ${commas(subCount)} missing persons records`)
  console.log()

  const steps = ONLY_ARG
    ? CLUSTER_STEPS.filter(s => ONLY_ARG.has(s.action))
    : CLUSTER_STEPS

  if (!steps.length) {
    console.error('No matching steps for --only filter.')
    process.exit(1)
  }

  const WIDTH = 34
  let totalErrors = 0
  const results: Array<{ label: string; summary: string; ms: number; ok: boolean }> = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const prefix = `[${i + 1}/${steps.length}]`
    process.stdout.write(`${prefix} ${pad(step.label, WIDTH)} … `)

    const t0 = Date.now()
    try {
      const extra = step.action === 'destination_route_match' && unidentifiedCaseId
        ? { unidentifiedCaseId }
        : undefined
      if (step.action === 'destination_route_match' && !unidentifiedCaseId) {
        throw new Error('Unidentified case not found — skipping')
      }
      const result = await callCluster(step.action, missingCaseId, extra)
      const ms = Date.now() - t0
      const summary = summarise(step.action, result)
      console.log(`✓  ${summary}  (${ms}ms)`)
      results.push({ label: step.label, summary, ms, ok: true })
    } catch (err) {
      const ms = Date.now() - t0
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`✗  ${msg.slice(0, 80)}  (${ms}ms)`)
      results.push({ label: step.label, summary: `ERROR: ${msg.slice(0, 60)}`, ms, ok: false })
      totalErrors++
    }
  }

  // Final summary
  const totalMs = results.reduce((a, r) => a + r.ms, 0)
  const succeeded = results.filter(r => r.ok).length

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Cluster run complete`)
  console.log(`  Steps:     ${steps.length}`)
  console.log(`  Succeeded: ${succeeded}`)
  if (totalErrors) console.log(`  Errors:    ${totalErrors}`)
  console.log(`  Total time: ${(totalMs / 1000).toFixed(1)}s`)
  console.log()

  if (totalErrors) {
    console.log('Failed steps:')
    results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.label}: ${r.summary}`))
    console.log()
  }

  console.log('Results visible in Patterns → Clusters tab.')

  if (totalErrors) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
