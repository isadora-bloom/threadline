/**
 * Runs the destination route match analysis.
 *
 * Scans all missing person circumstances for destination phrases
 * ("heading to X", "en route to X", etc.) then scores unidentified
 * remains found in/near that destination against the full physical
 * description (same scoring as cross_match).
 *
 * Requires:  add_destination_route_matches.sql migration applied in Supabase.
 * Safe to re-run: clears old destination_route_match rows first.
 *
 * Usage:  npx tsx scripts/run-route-match.ts
 *         npx tsx scripts/run-route-match.ts --url https://your-app.vercel.app
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

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

if (!SERVICE_KEY || !SUPABASE_URL) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function main() {
  console.log('\nDoe Network — Destination Route Match')
  console.log('======================================')
  console.log(`Target:  ${BASE_URL}`)
  console.log()

  // Find both cases
  const { data: allCases } = await supabase
    .from('cases').select('id, title')
    .or('title.ilike.%Doe Network%Missing%,title.ilike.%Doe Network%Unidentified%')

  const missingCase = allCases?.find(c => /missing/i.test(c.title))
  const unidentifiedCase = allCases?.find(c => /unidentified/i.test(c.title))

  if (!missingCase) {
    console.error('Could not find "Doe Network Import — Missing Persons" case.')
    process.exit(1)
  }
  if (!unidentifiedCase) {
    console.error('Could not find "Doe Network Import — Unidentified" case.')
    process.exit(1)
  }

  const missingCaseId = missingCase.id
  const unidentifiedCaseId = unidentifiedCase.id
  console.log(`Missing:      ${missingCase.title}`)
  console.log(`Unidentified: ${unidentifiedCase.title}`)

  const { count: subCount } = await supabase
    .from('submissions').select('*', { count: 'exact', head: true }).eq('case_id', missingCaseId)
  console.log(`Missing subs: ${(subCount ?? 0).toLocaleString()} records`)
  console.log()
  console.log('Scanning for destination phrases and matching against unidentified remains…')
  console.log('(This may take a few minutes)')

  const t0 = Date.now()
  const res = await fetch(`${BASE_URL}/api/pattern/doe-match`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': SERVICE_KEY,
    },
    body: JSON.stringify({ action: 'destination_route_match', missingCaseId, unidentifiedCaseId }),
  })

  const ms = Date.now() - t0

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    console.error(`✗  ${res.status}: ${text.slice(0, 200)}  (${ms}ms)`)
    process.exit(1)
  }

  const result = await res.json() as Record<string, unknown>
  console.log(`✓  Done in ${(ms / 1000).toFixed(1)}s`)
  console.log()

  if (result.destinationsFound !== undefined)
    console.log(`  Destinations extracted:  ${result.destinationsFound}`)
  if (result.candidatesInserted !== undefined)
    console.log(`  Match candidates stored:  ${result.candidatesInserted}`)
  if (result.totalMissingScanned !== undefined)
    console.log(`  Missing persons scanned:  ${result.totalMissingScanned}`)

  console.log()
  console.log('Results visible in Patterns → DOE Match → Route Matches tab.')
}

main().catch(e => { console.error(e); process.exit(1) })
