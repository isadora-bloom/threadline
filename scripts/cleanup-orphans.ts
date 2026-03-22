/**
 * Cleanup orphaned rows after the dedup deletion.
 * - Removes match candidates referencing non-existent submissions
 * - Removes cluster members referencing non-existent submissions
 * - Removes empty clusters
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function getAllIds(table: string, column: string): Promise<Set<string>> {
  const ids = new Set<string>()
  let from = 0
  while (true) {
    const { data } = await supabase.from(table as never).select(column).range(from, from + 999)
    if (!data?.length) break
    for (const row of data as Record<string, string>[]) ids.add(row[column])
    if (data.length < 1000) break
    from += 1000
  }
  return ids
}

async function main() {
  console.log('\nThreadline — Orphan Cleanup\n')

  // ── Load all valid submission IDs ────────────────────────────────────────────
  process.stdout.write('Loading submission IDs...')
  const validSubIds = await getAllIds('submissions', 'id')
  console.log(` ${validSubIds.size.toLocaleString()} submissions`)

  // ── 1. Orphaned match candidates ─────────────────────────────────────────────
  console.log('\n── Match candidates ──────────────────────────────────────────────')
  const { data: candidates } = await supabase
    .from('doe_match_candidates')
    .select('id, missing_submission_id, unidentified_submission_id') as { data: Array<{ id: string; missing_submission_id: string; unidentified_submission_id: string }> | null }

  const orphanCandidateIds = (candidates ?? [])
    .filter(c => !validSubIds.has(c.missing_submission_id) || !validSubIds.has(c.unidentified_submission_id))
    .map(c => c.id)

  console.log(`  Total:   ${(candidates ?? []).length}`)
  console.log(`  Orphans: ${orphanCandidateIds.length}`)

  if (orphanCandidateIds.length > 0) {
    for (let i = 0; i < orphanCandidateIds.length; i += 200) {
      await supabase.from('doe_match_candidates').delete().in('id', orphanCandidateIds.slice(i, i + 200))
    }
    console.log(`  ✓ Deleted ${orphanCandidateIds.length} orphaned match candidates`)
  } else {
    console.log('  ✓ No orphans found')
  }

  // ── 2. Orphaned cluster members ──────────────────────────────────────────────
  console.log('\n── Cluster members ───────────────────────────────────────────────')
  const { data: members } = await supabase
    .from('doe_cluster_members' as never)
    .select('id, submission_id') as { data: Array<{ id: string; submission_id: string }> | null }

  const orphanMemberIds = (members ?? [])
    .filter(m => !validSubIds.has(m.submission_id))
    .map(m => m.id)

  console.log(`  Total:   ${(members ?? []).length}`)
  console.log(`  Orphans: ${orphanMemberIds.length}`)

  if (orphanMemberIds.length > 0) {
    for (let i = 0; i < orphanMemberIds.length; i += 200) {
      await supabase.from('doe_cluster_members' as never).delete().in('id', orphanMemberIds.slice(i, i + 200) as never)
    }
    console.log(`  ✓ Deleted ${orphanMemberIds.length} orphaned cluster members`)
  } else {
    console.log('  ✓ No orphans found')
  }

  // ── 3. Empty clusters ────────────────────────────────────────────────────────
  console.log('\n── Empty clusters ────────────────────────────────────────────────')
  const { data: allClusters } = await supabase
    .from('doe_victimology_clusters' as never)
    .select('id') as { data: Array<{ id: string }> | null }

  const { data: activeMembers } = await supabase
    .from('doe_cluster_members' as never)
    .select('cluster_id') as { data: Array<{ cluster_id: string }> | null }

  const activeClusters = new Set((activeMembers ?? []).map(m => m.cluster_id))
  const emptyClusters = (allClusters ?? []).filter(c => !activeClusters.has(c.id)).map(c => c.id)

  console.log(`  Total clusters:  ${(allClusters ?? []).length}`)
  console.log(`  Empty clusters:  ${emptyClusters.length}`)

  if (emptyClusters.length > 0) {
    for (let i = 0; i < emptyClusters.length; i += 200) {
      await supabase.from('doe_victimology_clusters' as never).delete().in('id', emptyClusters.slice(i, i + 200) as never)
    }
    console.log(`  ✓ Deleted ${emptyClusters.length} empty clusters`)
  } else {
    console.log('  ✓ No empty clusters')
  }

  console.log('\n── Done ──────────────────────────────────────────────────────────\n')
}

main().catch(e => { console.error(e); process.exit(1) })
