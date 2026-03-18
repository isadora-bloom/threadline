/**
 * POST /api/pattern/doe-match/ai-review
 *
 * Actions:
 *   { matchId }      — review a single match candidate
 *   { missingCaseId } — batch-review all very_strong candidates without an AI assessment
 *
 * Uses Claude Haiku. Stores verdict in doe_match_candidates.ai_assessment (JSONB).
 * All AI assessments are signals only — they require investigator review.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

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

interface RawMatch {
  missing_submission_id: string
  unidentified_submission_id: string
}

interface RawSub { raw_text: string }

async function reviewOne(supabase: Awaited<ReturnType<typeof createClient>>, matchId: string) {
  const { data: match } = await supabase
    .from('doe_match_candidates' as never)
    .select('missing_submission_id, unidentified_submission_id')
    .eq('id', matchId)
    .single() as { data: RawMatch | null }

  if (!match) return null

  const [{ data: mRaw }, { data: uRaw }] = await Promise.all([
    supabase.from('submissions' as never).select('raw_text').eq('id', match.missing_submission_id).single() as Promise<{ data: RawSub | null }>,
    supabase.from('submissions' as never).select('raw_text').eq('id', match.unidentified_submission_id).single() as Promise<{ data: RawSub | null }>,
  ])

  if (!mRaw?.raw_text || !uRaw?.raw_text) return null

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `MISSING PERSON:\n${mRaw.raw_text}\n\n---\n\nUNIDENTIFIED REMAINS:\n${uRaw.raw_text}`,
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

  const result = { ...assessment, reviewed_at: new Date().toISOString(), model: 'claude-haiku-4-5-20251001' }

  await supabase
    .from('doe_match_candidates' as never)
    .update({ ai_assessment: result } as never)
    .eq('id', matchId)

  return result
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { matchId, missingCaseId, batchSize = 15 } = body

  // ── Single review ──────────────────────────────────────────────────────────
  if (matchId) {
    const assessment = await reviewOne(supabase, matchId)
    if (!assessment) return NextResponse.json({ error: 'Match or submission not found' }, { status: 404 })
    return NextResponse.json({ ok: true, assessment })
  }

  // ── Batch review — all very_strong without ai_assessment ──────────────────
  if (missingCaseId) {
    const { data: roleData } = await supabase
      .from('case_user_roles' as never).select('role')
      .eq('case_id', missingCaseId).eq('user_id', user.id).single()
    if (!roleData) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { data: pending } = await supabase
      .from('doe_match_candidates' as never)
      .select('id')
      .eq('missing_case_id', missingCaseId)
      .eq('grade', 'very_strong')
      .is('ai_assessment', null)
      .order('composite_score', { ascending: false })
      .limit(batchSize) as { data: Array<{ id: string }> | null }

    if (!pending?.length) {
      return NextResponse.json({ reviewed: 0, hasMore: false, remaining: 0 })
    }

    let reviewed = 0
    for (const { id } of pending) {
      await reviewOne(supabase, id)
      reviewed++
    }

    const { count } = await supabase
      .from('doe_match_candidates' as never)
      .select('id', { count: 'exact', head: true })
      .eq('missing_case_id', missingCaseId)
      .eq('grade', 'very_strong')
      .is('ai_assessment', null) as { count: number | null }

    return NextResponse.json({ reviewed, hasMore: (count ?? 0) > 0, remaining: count ?? 0 })
  }

  return NextResponse.json({ error: 'matchId or missingCaseId required' }, { status: 400 })
}
