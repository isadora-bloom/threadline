/**
 * Standalone AI review runner
 * Reviews all very_strong match candidates that don't yet have an AI assessment.
 * Uses service role key — bypasses auth/RLS.
 *
 * Usage:  npx tsx scripts/run-ai-review.ts
 * Resume: npx tsx scripts/run-ai-review.ts  (safe to re-run; skips already-reviewed)
 */

import { createClient } from '@supabase/supabase-js'
import { REVIEW_MODEL } from '../src/lib/ai-models'
import Anthropic from '@anthropic-ai/sdk'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM_PROMPT = `You are a forensic case analyst assisting investigators in a missing persons identification database.

You will receive two records: a MISSING PERSON report and an UNIDENTIFIED REMAINS report. Read both carefully and assess whether they could refer to the same individual.

Pay close attention to:
- Physical descriptors (height, weight, hair, eyes, age, race, sex)
- Distinguishing marks, tattoos, scars, piercings
- Clothing and personal effects
- Geographic location and time period
- Circumstances and any narrative details

Respond with valid JSON only, in this exact format:
{
  "verdict": "plausible" | "unlikely" | "uncertain",
  "confidence": "high" | "medium" | "low",
  "summary": "One or two sentences explaining your assessment",
  "supporting": ["specific detail that supports a match", ...],
  "conflicting": ["specific detail that argues against a match", ...]
}

Definitions:
- "plausible": descriptions are broadly consistent — this pair warrants investigator attention
- "unlikely": clear descriptive contradictions make this match improbable
- "uncertain": insufficient detail, or mixed signals that require human judgment

Be conservative. Prefer "uncertain" over "unlikely" when in doubt. Never speculate beyond what the records state. This is a signal for investigators, not a conclusion.`

const BATCH = 20

async function reviewOne(matchId: string, missingText: string, unidentifiedText: string) {
  const msg = await anthropic.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `MISSING PERSON:\n${missingText}\n\n---\n\nUNIDENTIFIED REMAINS:\n${unidentifiedText}`,
    }],
  })

  let assessment: Record<string, unknown> = {
    verdict: 'uncertain', confidence: 'low',
    summary: 'AI response could not be parsed.',
    supporting: [], conflicting: [],
  }

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) assessment = JSON.parse(m[0])
  } catch { /* keep default */ }

  const result = { ...assessment, reviewed_at: new Date().toISOString(), model: REVIEW_MODEL }

  const { error } = await supabase
    .from('doe_match_candidates')
    .update({ ai_assessment: result })
    .eq('id', matchId)

  if (error) throw new Error(`Update failed for ${matchId}: ${error.message}`)
  return result as { verdict: string; confidence: string }
}

async function main() {
  console.log('\nDoe Network AI Review Runner')
  console.log('============================')

  // Find the Missing Persons case
  const { data: cases } = await supabase
    .from('cases')
    .select('id, title')
    .ilike('title', '%Doe Network%Missing%')

  if (!cases?.length) {
    console.error('Missing Persons case not found.')
    process.exit(1)
  }

  const missingCaseId = cases[0].id
  console.log(`Case: ${cases[0].title}`)
  console.log(`ID:   ${missingCaseId}`)

  // Count total pending
  const { count: totalPending } = await supabase
    .from('doe_match_candidates')
    .select('*', { count: 'exact', head: true })
    .eq('missing_case_id', missingCaseId)
    .eq('grade', 'very_strong')
    .is('ai_assessment', null)

  if (!totalPending) {
    console.log('\nAll very_strong candidates already have AI assessments.')
    process.exit(0)
  }

  console.log(`\nPending: ${totalPending.toLocaleString()} candidates to review`)
  console.log(`Batch:   ${BATCH} per round\n`)

  let totalReviewed = 0
  let totalErrors   = 0
  const verdictCounts: Record<string, number> = { plausible: 0, uncertain: 0, unlikely: 0 }

  while (true) {
    // Fetch a batch of unreviewed candidates with their submission IDs
    const { data: batch } = await supabase
      .from('doe_match_candidates')
      .select('id, missing_submission_id, unidentified_submission_id, missing_name, composite_score')
      .eq('missing_case_id', missingCaseId)
      .eq('grade', 'very_strong')
      .is('ai_assessment', null)
      .order('composite_score', { ascending: false })
      .limit(BATCH) as {
        data: Array<{
          id: string
          missing_submission_id: string
          unidentified_submission_id: string
          missing_name: string | null
          composite_score: number
        }> | null
      }

    if (!batch?.length) break

    // Fetch all submission texts for this batch in parallel
    const subIds = [
      ...batch.map(b => b.missing_submission_id),
      ...batch.map(b => b.unidentified_submission_id),
    ]
    const { data: subs } = await supabase
      .from('submissions')
      .select('id, raw_text')
      .in('id', subIds) as { data: Array<{ id: string; raw_text: string }> | null }

    const subMap = new Map((subs ?? []).map(s => [s.id, s.raw_text]))

    for (const candidate of batch) {
      const missingText      = subMap.get(candidate.missing_submission_id)
      const unidentifiedText = subMap.get(candidate.unidentified_submission_id)

      if (!missingText || !unidentifiedText) {
        totalErrors++
        process.stdout.write(`\r  [${totalReviewed + totalErrors}/${totalPending}] ✗ Missing text for ${candidate.id.slice(0, 8)}`)
        continue
      }

      try {
        const result = await reviewOne(candidate.id, missingText, unidentifiedText)
        totalReviewed++
        verdictCounts[result.verdict] = (verdictCounts[result.verdict] ?? 0) + 1
        const pct = Math.round((totalReviewed / totalPending) * 100)
        const name = candidate.missing_name ?? 'Unknown'
        process.stdout.write(
          `\r  [${totalReviewed}/${totalPending}] ${pct}%  — ${result.verdict.padEnd(9)} (${result.confidence}) — score ${candidate.composite_score}  "${name.slice(0, 30)}"        `
        )
      } catch (err) {
        totalErrors++
        const msg = err instanceof Error ? err.message : String(err)
        process.stdout.write(`\n  ✗ Error on ${candidate.id.slice(0, 8)}: ${msg}\n`)
        // Back off on errors
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }

  console.log(`\n\n═══════════════════════════════════════`)
  console.log(`AI review complete`)
  console.log(`  Reviewed:  ${totalReviewed.toLocaleString()}`)
  console.log(`  Errors:    ${totalErrors}`)
  console.log(`  Plausible: ${verdictCounts.plausible ?? 0}`)
  console.log(`  Uncertain: ${verdictCounts.uncertain ?? 0}`)
  console.log(`  Unlikely:  ${verdictCounts.unlikely ?? 0}`)
  console.log(`\nResults visible in Patterns → Match tab. Filter by "Plausible" to start.`)
}

main().catch(e => { console.error(e); process.exit(1) })
