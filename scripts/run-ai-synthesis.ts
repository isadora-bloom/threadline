/**
 * Batch AI synthesis for all victimology clusters.
 *
 * For each cluster without an AI narrative, calls Claude Haiku to:
 *   1. Write a 3–5 sentence investigative analysis
 *   2. Identify 0–3 specific cases with deeper connections beyond the cluster dimension
 *      (shared unusual details, matching physical descriptions, suspicious proximity)
 *
 * Flagged cases appear highlighted in the UI. The flag_reason explains the connection.
 *
 * Processes 80 clusters per batch. Run again to continue if more remain.
 * Safe to re-run — skips clusters that already have a narrative.
 *
 * Usage:  npx tsx scripts/run-ai-synthesis.ts
 *         npx tsx scripts/run-ai-synthesis.ts --url https://your-app.vercel.app
 *         npx tsx scripts/run-ai-synthesis.ts --all    (loop until done)
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const BASE_URL = (() => {
  const urlArg = process.argv.find(a => a.startsWith('--url='))?.split('=')[1]
             ?? process.argv[process.argv.indexOf('--url') + 1]
  if (urlArg && !urlArg.startsWith('--')) return urlArg.replace(/\/$/, '')
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
})()

const LOOP_ALL = process.argv.includes('--all')

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

if (!SERVICE_KEY || !SUPABASE_URL) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function runBatch(missingCaseId: string, attempt = 1): Promise<{ processed: number; failed: number; remaining: number }> {
  try {
    const res = await fetch(`${BASE_URL}/api/pattern/doe-match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': SERVICE_KEY,
      },
      body: JSON.stringify({ action: 'synthesize_all_clusters', missingCaseId }),
      // @ts-expect-error Node 18 fetch supports signal via AbortSignal
      signal: AbortSignal.timeout(300_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      throw new Error(`${res.status}: ${text.slice(0, 200)}`)
    }

    const result = await res.json() as {
      processed: number; failed: number; batch: number; remaining: number
    }
    return result
  } catch (err) {
    if (attempt < 3) {
      await sleep(5000)
      return runBatch(missingCaseId, attempt + 1)
    }
    throw err
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('\nDoe Network — Cluster AI Synthesis')
  console.log('====================================')
  console.log(`Target:  ${BASE_URL}`)
  if (LOOP_ALL) console.log('Mode:    --all (loop until done)')
  console.log()

  // Find missing persons case
  const { data: cases } = await supabase
    .from('cases').select('id, title').ilike('title', '%Doe Network%Missing%')

  if (!cases?.length) {
    console.error('Could not find "Doe Network Import — Missing Persons" case.')
    process.exit(1)
  }

  const missingCaseId = cases[0].id
  console.log(`Case:  ${cases[0].title}`)

  // Count total clusters and already-done
  const { count: total } = await supabase
    .from('doe_victimology_clusters' as never)
    .select('id', { count: 'exact', head: true })
    .eq('case_id', missingCaseId) as { count: number | null }

  const { count: done } = await supabase
    .from('doe_victimology_clusters' as never)
    .select('id', { count: 'exact', head: true })
    .eq('case_id', missingCaseId)
    .not('ai_narrative', 'is', null) as { count: number | null }

  const pending = (total ?? 0) - (done ?? 0)
  console.log(`Clusters:  ${total ?? 0} total · ${done ?? 0} already synthesized · ${pending} pending`)
  console.log()

  if (!pending) {
    console.log('All clusters already have AI narratives.')
    process.exit(0)
  }

  let batchNum = 0
  let totalProcessed = 0
  let totalFailed = 0

  do {
    batchNum++
    process.stdout.write(`Batch ${batchNum}… `)
    const t0 = Date.now()

    const { processed, failed, remaining } = await runBatch(missingCaseId)
    const ms = Date.now() - t0

    totalProcessed += processed
    totalFailed += failed

    console.log(`✓  ${processed} synthesized · ${failed} failed · ${remaining} remaining  (${(ms / 1000).toFixed(1)}s)`)

    if (!LOOP_ALL || remaining === 0) break

    // Brief pause between batches to avoid hammering the API
    if (remaining > 0) await sleep(3000)

  } while (true)

  console.log()
  console.log('═'.repeat(50))
  console.log('AI Synthesis complete')
  console.log(`  Synthesized:  ${totalProcessed}`)
  if (totalFailed) console.log(`  Failed:       ${totalFailed}`)
  console.log()
  console.log('Flagged cases (deeper connections) are now highlighted in')
  console.log('Patterns → Clusters — look for the violet "AI flagged" badge.')
}

main().catch(e => { console.error(e); process.exit(1) })
