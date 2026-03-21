/**
 * Dedup Submissions
 *
 * Two types of cleanup:
 *
 * 1. CASE MERGE: "Doe Network Import — Unidentified Persons" is a superseded
 *    import of the same data as "Doe Network Import — Unidentified Remains" (which
 *    was imported 8 hours later with more records). Re-points all match candidates
 *    and cluster members to the newer case, then deletes the old case + submissions.
 *
 * 2. INTRA-CASE DUPE: Finds submissions with the same NamUs ID within the same
 *    case, keeps the oldest, deletes the rest.
 *
 * Run (dry-run):  npx tsx scripts/dedup-submissions.ts --dry-run
 * Run (live):     npx tsx scripts/dedup-submissions.ts
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as readline from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnv(): Record<string, string> {
  const envPath = join(__dirname, '../.env.local')
  if (!existsSync(envPath)) { console.error('✗ .env.local not found'); process.exit(1) }
  return Object.fromEntries(
    readFileSync(envPath, 'utf8').split('\n')
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
}

// Only match NamUs field labels at start of line — avoids false positives from body text
const NAMUS_PATTERNS = [
  /^NamUs\s+MP\s*#?\s*(\d{3,8})\b/im,
  /^NamUs\s+UP\s*#?\s*(\d{3,8})\b/im,
  /^NamUs\s*:\s*(\d{3,8})\b/im,
  /^NamUs\s*#\s*(\d{3,8})\b/im,
]
const PLACEHOLDER_RE = /^(unknown|n\/a|not\s+listed|mp\s+n\/a)$/i

function extractNamusId(rawText: string): string | null {
  for (const pat of NAMUS_PATTERNS) {
    const m = rawText.match(pat)
    if (!m) continue
    const val = m[1].trim()
    if (PLACEHOLDER_RE.test(val)) return null
    return val.toUpperCase()
  }
  return null
}

function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(q, a => { rl.close(); resolve(a) }))
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run')
  const env = loadEnv()
  const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL']
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY']
  if (!supabaseUrl || !serviceRoleKey) { console.error('Missing env vars'); process.exit(1) }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  console.log(`\nThreadline — Submission Deduplicator${isDryRun ? ' (DRY RUN)' : ''}\n`)

  const { data: allCases } = await supabase.from('cases').select('id, title').ilike('title', '%Doe Network%')
  if (!allCases?.length) { console.error('No Doe Network cases found'); process.exit(1) }

  allCases.forEach(c => console.log(`  · ${c.id}  ${c.title}`))

  const missingCase     = allCases.find(c => /missing persons/i.test(c.title))
  const unidPersonsCase = allCases.find(c => /unidentified persons/i.test(c.title))
  const unidRemainsCase = allCases.find(c => /unidentified remains/i.test(c.title))

  // ── STEP 1: Case merge (Unidentified Persons → Unidentified Remains) ──────────

  if (unidPersonsCase && unidRemainsCase) {
    console.log(`\n── Step 1: Retire superseded case ────────────────────────────────`)
    console.log(`  OLD (to retire): ${unidPersonsCase.title}`)
    console.log(`  NEW (to keep):   ${unidRemainsCase.title}`)

    // Count referencing rows
    const { count: matchRefCount } = await supabase
      .from('doe_match_candidates').select('*', { count: 'exact', head: true })
      .eq('unidentified_case_id', unidPersonsCase.id) as { count: number | null }
    const { count: subCount } = await supabase
      .from('submissions').select('*', { count: 'exact', head: true })
      .eq('case_id', unidPersonsCase.id) as { count: number | null }

    console.log(`  Match candidates referencing old case: ${matchRefCount ?? 0}`)
    console.log(`  Submissions to delete: ${subCount ?? 0}`)

    if (!isDryRun) {
      // Re-point match candidates to new case
      if ((matchRefCount ?? 0) > 0) {
        await supabase.from('doe_match_candidates')
          .update({ unidentified_case_id: unidRemainsCase.id } as never)
          .eq('unidentified_case_id', unidPersonsCase.id)
        console.log(`  ✓ Re-pointed ${matchRefCount} match candidates to new case`)
      }

      // Delete old case submissions in batches
      let deleted = 0
      while (true) {
        const { data } = await supabase.from('submissions').select('id').eq('case_id', unidPersonsCase.id).limit(500)
        if (!data?.length) break
        await supabase.from('submissions').delete().in('id', data.map(r => r.id))
        deleted += data.length
        process.stdout.write(`  Deleted ${deleted} old submissions...\r`)
      }
      console.log(`  ✓ Deleted ${deleted} submissions from old case`)

      // Delete old case (and its user_roles etc)
      await supabase.from('case_user_roles').delete().eq('case_id', unidPersonsCase.id)
      await supabase.from('cases').delete().eq('id', unidPersonsCase.id)
      console.log(`  ✓ Deleted old case: ${unidPersonsCase.title}`)
    }
  } else {
    console.log('\n── Step 1: No superseded case found — skipping\n')
  }

  // ── STEP 2: Intra-case dedup ──────────────────────────────────────────────────

  console.log(`\n── Step 2: Intra-case NamUs ID deduplication ─────────────────────`)

  const activeCases = allCases.filter(c => c.id !== unidPersonsCase?.id)
  const caseIds = activeCases.map(c => c.id)

  type SubRow = { id: string; case_id: string; raw_text: string; created_at: string }
  const submissions: SubRow[] = []
  let from = 0
  while (true) {
    const { data } = await supabase.from('submissions').select('id, case_id, raw_text, created_at')
      .in('case_id', caseIds).order('created_at', { ascending: true }).range(from, from + 999)
    if (!data?.length) break
    submissions.push(...(data as SubRow[]))
    if (data.length < 1000) break
    from += 1000
    process.stdout.write(`  Loaded ${submissions.length}...\r`)
  }
  console.log(`  Loaded ${submissions.length} submissions across ${activeCases.length} cases`)

  const groupsByCase = new Map<string, Map<string, SubRow[]>>()
  for (const sub of submissions) {
    const namusId = extractNamusId(sub.raw_text ?? '')
    if (!namusId) continue
    if (!groupsByCase.has(sub.case_id)) groupsByCase.set(sub.case_id, new Map())
    const cg = groupsByCase.get(sub.case_id)!
    if (!cg.has(namusId)) cg.set(namusId, [])
    cg.get(namusId)!.push(sub)
  }

  interface MergeOp { namusId: string; caseId: string; keepId: string; deleteIds: string[] }
  const mergeOps: MergeOp[] = []
  for (const [caseId, namusGroups] of groupsByCase) {
    for (const [namusId, rows] of namusGroups) {
      if (rows.length < 2) continue
      const [keep, ...dupes] = rows
      mergeOps.push({ namusId, caseId, keepId: keep.id, deleteIds: dupes.map(d => d.id) })
    }
  }

  if (mergeOps.length === 0) {
    console.log('  ✓ No intra-case duplicates found.\n')
    return
  }

  console.log(`\n  Found ${mergeOps.length} NamUs IDs with duplicate submissions:\n`)
  for (const op of mergeOps.slice(0, 20)) {
    const caseName = activeCases.find(c => c.id === op.caseId)?.title ?? op.caseId
    console.log(`  NamUs ${op.namusId} [${caseName.slice(-25)}]  keep: ${op.keepId.slice(0,8)}…  delete: ${op.deleteIds.map(d=>d.slice(0,8)+'…').join(', ')}`)
  }
  if (mergeOps.length > 20) console.log(`  … and ${mergeOps.length - 20} more`)

  const allDeleteIds = mergeOps.flatMap(op => op.deleteIds)
  console.log(`\n  Total submissions to delete: ${allDeleteIds.length}`)

  if (isDryRun) {
    console.log('\n[DRY RUN] No changes made. Remove --dry-run to apply.\n')
    return
  }

  if (!process.argv.includes('--force')) {
    const answer = await prompt('\nProceed? Type "yes" to continue (or pass --force to skip): ')
    if (answer.trim().toLowerCase() !== 'yes') { console.log('Aborted.\n'); return }
  } else {
    console.log('\n[--force] Proceeding without confirmation.')
  }

  let reroutedMatch = 0, reroutedCluster = 0, deleted = 0
  for (const op of mergeOps) {
    for (const oldId of op.deleteIds) {
      const r1 = await supabase.from('doe_match_candidates').update({ missing_submission_id: op.keepId } as never).eq('missing_submission_id', oldId)
      const r2 = await supabase.from('doe_match_candidates').update({ unidentified_submission_id: op.keepId } as never).eq('unidentified_submission_id', oldId)
      const r3 = await supabase.from('doe_cluster_members').update({ submission_id: op.keepId } as never).eq('submission_id', oldId)
      reroutedMatch += (r1.count ?? 0) + (r2.count ?? 0)
      reroutedCluster += r3.count ?? 0
      const { error } = await supabase.from('submissions').delete().eq('id', oldId)
      if (!error) deleted++
    }
  }

  console.log('\n─── Summary ──────────────────────────────────────────────────────')
  console.log(`  Duplicate groups merged:    ${mergeOps.length}`)
  console.log(`  Submissions deleted:        ${deleted}`)
  console.log(`  Match candidate rows fixed: ${reroutedMatch}`)
  console.log(`  Cluster member rows fixed:  ${reroutedCluster}`)
  console.log('──────────────────────────────────────────────────────────────────\n')
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1) })
