/**
 * Run Full Analysis Pipeline
 *
 * Triggers the DOE matcher and all cluster/pattern analysis on NamUs data
 * via the API endpoints. Requires dev server running on localhost:3000.
 *
 * Usage: npx tsx scripts/run-full-analysis.ts
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const BASE = process.env.API_BASE ?? 'http://localhost:3001'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// NamUs case IDs (created by import-records-to-submissions.ts)
const NAMUS_MISSING = '51a14fde-81b8-4d0e-9f14-a731602f77d0'
const NAMUS_UNIDENTIFIED = '6b82cf6e-bb31-4335-a3b9-e29d59af5500'

// Doe Network case IDs (original imports)
const DOE_MISSING = '920fa7c7-16bd-43a6-9700-60cecefcbf59'
const DOE_UNIDENTIFIED_PERSONS = 'c815abc2-8541-4d15-961a-8b332bbc6a15'
const DOE_UNIDENTIFIED_REMAINS = '4838c55f-a4cd-49f8-8011-22536a2ea75e'

async function callApi(action: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BASE}/api/pattern/doe-match`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': SERVICE_KEY,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) {
    console.error(`  ERROR (${res.status}):`, data.error ?? data)
    return null
  }
  return data
}

async function runCrossMatch(
  label: string,
  missingCaseId: string,
  unidentifiedCaseId: string,
  batchSize = 400,
) {
  console.log(`\n=== Cross-Match: ${label} ===`)
  let offset = 0
  let totalMatches = 0
  let totalEliminated = 0
  let batch = 0

  while (true) {
    batch++
    console.log(`  Batch ${batch} (offset ${offset}, limit ${batchSize})...`)

    const result = await callApi('cross_match', {
      action: 'cross_match',
      missingCaseId,
      unidentifiedCaseId,
      offset,
      limit: batchSize,
    }) as { processed?: number; total?: number; hasMore?: boolean; newMatches?: number; eliminated?: number; nextOffset?: number } | null

    if (!result) {
      console.log('  Failed — stopping this match pair')
      break
    }

    totalMatches += result.newMatches ?? 0
    totalEliminated += result.eliminated ?? 0
    console.log(`  Processed ${result.processed}/${result.total} — ${result.newMatches} new matches, ${result.eliminated} eliminated`)

    if (!result.hasMore) break
    offset = result.nextOffset ?? offset + batchSize
  }

  console.log(`  TOTAL: ${totalMatches} matches, ${totalEliminated} eliminated`)
  return totalMatches
}

async function runAction(label: string, action: string, missingCaseId: string) {
  console.log(`\n--- ${label} ---`)
  const result = await callApi(action, { action, missingCaseId })
  if (result) console.log(' ', JSON.stringify(result).slice(0, 200))
  return result
}

async function main() {
  console.log('=== Full Analysis Pipeline ===')
  console.log('Dev server:', BASE)
  console.log('')

  // Verify server is running
  try {
    const res = await fetch(BASE, { redirect: 'manual' })
    console.log('Server status:', res.status, '(OK)')
  } catch {
    console.error('Dev server not running! Start with: npm run dev')
    process.exit(1)
  }

  // ── Phase 1: Cross-matching ──
  // NamUs missing vs NamUs unidentified
  await runCrossMatch(
    'NamUs Missing ↔ NamUs Unidentified',
    NAMUS_MISSING,
    NAMUS_UNIDENTIFIED,
  )

  // NamUs missing vs Doe Network unidentified (both UID cases)
  await runCrossMatch(
    'NamUs Missing ↔ Doe Network Unidentified Persons',
    NAMUS_MISSING,
    DOE_UNIDENTIFIED_PERSONS,
  )

  await runCrossMatch(
    'NamUs Missing ↔ Doe Network Unidentified Remains',
    NAMUS_MISSING,
    DOE_UNIDENTIFIED_REMAINS,
  )

  // Doe Network missing vs NamUs unidentified
  await runCrossMatch(
    'Doe Network Missing ↔ NamUs Unidentified',
    DOE_MISSING,
    NAMUS_UNIDENTIFIED,
  )

  // ── Phase 2: Cluster analysis (on NamUs missing) ──
  await runAction('Demographic clusters', 'cluster', NAMUS_MISSING)
  await runAction('Circumstance clusters', 'circumstance_cluster', NAMUS_MISSING)
  await runAction('Detect stalls', 'detect_stalls', NAMUS_MISSING)
  await runAction('Extract entities', 'extract_entities', NAMUS_MISSING)
  await runAction('Name dedup', 'name_dedup', NAMUS_MISSING)
  await runAction('Corridor clusters', 'corridor_cluster', NAMUS_MISSING)
  await runAction('Highway proximity', 'highway_proximity', NAMUS_MISSING)
  await runAction('Age bracket clusters', 'age_bracket_cluster', NAMUS_MISSING)

  console.log('\n=== Pipeline Complete ===')
}

main().catch(console.error)
