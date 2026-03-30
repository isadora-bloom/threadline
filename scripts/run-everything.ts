/**
 * Run Everything
 *
 * Full pipeline: all cross-matches across all case pairs, all cluster analysis,
 * all stall detection, entity extraction, name dedup, corridors, highways.
 *
 * This is the "go away and let it cook" script.
 *
 * Usage: npx tsx scripts/run-everything.ts
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const BASE = process.env.API_BASE ?? 'http://localhost:3001'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// All case IDs
const CASES = {
  NAMUS_MISSING:        '51a14fde-81b8-4d0e-9f14-a731602f77d0',
  NAMUS_UNIDENTIFIED:   '6b82cf6e-bb31-4335-a3b9-e29d59af5500',
  DOE_MISSING:          '920fa7c7-16bd-43a6-9700-60cecefcbf59',
  DOE_UID_PERSONS:      'c815abc2-8541-4d15-961a-8b332bbc6a15',
  DOE_UID_REMAINS:      '4838c55f-a4cd-49f8-8011-22536a2ea75e',
  CHARLEY_MISSING:      '560b3c82-c258-4b43-a52b-3b5438d5411f',
}

async function call(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': SERVICE_KEY },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function crossMatch(label: string, missingId: string, unidentifiedId: string) {
  console.log(`\n=== ${label} ===`)
  let offset = 0, totalMatches = 0, batch = 0
  while (true) {
    batch++
    const data = await call('/api/pattern/doe-match', {
      action: 'cross_match', missingCaseId: missingId, unidentifiedCaseId: unidentifiedId,
      offset, limit: 400,
    }) as Record<string, unknown>

    if (data.error) { console.log('  Error:', data.error); break }
    totalMatches += (data.newMatches as number) ?? 0
    const processed = data.processed as number
    const total = data.total as number
    if (batch % 5 === 0 || !data.hasMore) {
      console.log(`  ${processed}/${total} — ${totalMatches} total matches`)
    }
    if (!data.hasMore) break
    offset = (data.nextOffset as number) ?? offset + 400
  }
  console.log(`  DONE: ${totalMatches} matches`)
  return totalMatches
}

async function runAction(label: string, missingId: string, action: string) {
  process.stdout.write(`  ${label}... `)
  const data = await call('/api/pattern/doe-match', { action, missingCaseId: missingId }) as Record<string, unknown>
  if (data.error) { console.log('ERROR:', data.error); return }
  console.log('OK')
}

async function runOffenderOverlaps(label: string, caseId: string) {
  console.log(`\n--- Offender overlaps: ${label} ---`)
  const data = await call('/api/pattern/offenders', {
    action: 'batch_ai_review', caseId, batchSize: 10, minScore: 65,
  }) as Record<string, unknown>
  if (data.error) console.log('  Error:', data.error)
  else console.log(`  Reviewed: ${data.reviewed ?? 0}`)
}

async function main() {
  console.log('===================================================')
  console.log('  THREADLINE — FULL ANALYSIS PIPELINE')
  console.log('===================================================')
  console.log(`Server: ${BASE}`)
  console.log(`Started: ${new Date().toLocaleString()}`)

  // Verify server
  try {
    await fetch(BASE, { redirect: 'manual' })
  } catch {
    console.error('Dev server not running! Start with: cd threadline && PORT=3001 npx next dev --port 3001')
    process.exit(1)
  }

  // ── PHASE 1: Cross-matching ──
  console.log('\n\n========== PHASE 1: CROSS-MATCHING ==========')

  // NamUs missing ↔ all unidentified sources
  await crossMatch('NamUs Missing ↔ NamUs Unidentified', CASES.NAMUS_MISSING, CASES.NAMUS_UNIDENTIFIED)
  await crossMatch('NamUs Missing ↔ Doe Network UID Remains', CASES.NAMUS_MISSING, CASES.DOE_UID_REMAINS)
  await crossMatch('NamUs Missing ↔ Doe Network UID Persons', CASES.NAMUS_MISSING, CASES.DOE_UID_PERSONS)

  // Doe Network missing ↔ all unidentified sources
  await crossMatch('Doe Network Missing ↔ NamUs Unidentified', CASES.DOE_MISSING, CASES.NAMUS_UNIDENTIFIED)
  await crossMatch('Doe Network Missing ↔ Doe Network UID Remains', CASES.DOE_MISSING, CASES.DOE_UID_REMAINS)
  await crossMatch('Doe Network Missing ↔ Doe Network UID Persons', CASES.DOE_MISSING, CASES.DOE_UID_PERSONS)

  // Charley Project missing ↔ all unidentified sources
  await crossMatch('Charley Missing ↔ NamUs Unidentified', CASES.CHARLEY_MISSING, CASES.NAMUS_UNIDENTIFIED)
  await crossMatch('Charley Missing ↔ Doe Network UID Remains', CASES.CHARLEY_MISSING, CASES.DOE_UID_REMAINS)
  await crossMatch('Charley Missing ↔ Doe Network UID Persons', CASES.CHARLEY_MISSING, CASES.DOE_UID_PERSONS)

  // ── PHASE 2: Route matching ──
  console.log('\n\n========== PHASE 2: ROUTE MATCHING ==========')
  for (const [label, id] of [
    ['NamUs', CASES.NAMUS_MISSING],
    ['Doe Network', CASES.DOE_MISSING],
    ['Charley', CASES.CHARLEY_MISSING],
  ]) {
    for (const [uidLabel, uidId] of [
      ['NamUs UID', CASES.NAMUS_UNIDENTIFIED],
      ['Doe UID Remains', CASES.DOE_UID_REMAINS],
    ]) {
      process.stdout.write(`  ${label} ↔ ${uidLabel} route match... `)
      const data = await call('/api/pattern/doe-match', {
        action: 'destination_route_match', missingCaseId: id, unidentifiedCaseId: uidId,
        offset: 0, limit: 200,
      }) as Record<string, unknown>
      console.log(`${data.newMatches ?? 0} matches`)
    }
  }

  // ── PHASE 3: Cluster analysis (on each missing case) ──
  console.log('\n\n========== PHASE 3: CLUSTER ANALYSIS ==========')
  for (const [label, id] of [
    ['NamUs Missing', CASES.NAMUS_MISSING],
    ['Doe Network Missing', CASES.DOE_MISSING],
    ['Charley Missing', CASES.CHARLEY_MISSING],
  ]) {
    console.log(`\n--- ${label} ---`)
    await runAction('Demographic clusters', id, 'cluster')
    await runAction('Circumstance clusters', id, 'circumstance_cluster')
    await runAction('Same-date clusters', id, 'same_date_cluster')
    await runAction('Detect stalls', id, 'detect_stalls')
    await runAction('Location runaway clusters', id, 'location_runaway_cluster')
    await runAction('Corridor clusters', id, 'corridor_cluster')
    await runAction('Highway proximity', id, 'highway_proximity')
    await runAction('National park proximity', id, 'national_park_proximity')
    await runAction('Age bracket clusters', id, 'age_bracket_cluster')
    await runAction('Extract entities', id, 'extract_entities')
    await runAction('Name dedup', id, 'name_dedup')
  }

  console.log('\n\n===================================================')
  console.log('  PIPELINE COMPLETE')
  console.log(`  Finished: ${new Date().toLocaleString()}`)
  console.log('===================================================')
}

main().catch(console.error)
