/**
 * POST /api/pattern/doe-match/ai-review
 *
 * Actions:
 *   { matchId }                        — review a single match candidate
 *   { missingCaseId }                  — batch-review very_strong candidates without an AI assessment
 *   { missingCaseId, routeMatches: true } — batch-review destination_route_match candidates
 *
 * Uses Claude Haiku. Stores assessment in doe_match_candidates.ai_assessment (JSONB).
 * Universal connection_level rating: 1=ignore, 2=slim, 3=some, 4=strong, 5=very_strong (top 5–10% only).
 * All AI assessments are signals only — they require investigator review.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { REVIEW_MODEL } from '@/lib/ai-models'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM_PROMPT = `You are a forensic case analyst assisting investigators in a missing persons identification database.

You will receive two records: a MISSING PERSON report and an UNIDENTIFIED REMAINS report. Read both carefully and assess the strength of the possible connection.

Pay close attention to:
- Physical descriptors (height, weight, hair, eyes, age, race, sex)
- Distinguishing marks, tattoos, scars, piercings
- Clothing and personal effects
- Geographic location and time period
- Circumstances and any narrative details

Rate the connection on a scale of 1–5:
1 — Ignore: clear contradictions make this pair implausible
2 — Slim connection: surface-level similarity only, unlikely to be the same individual
3 — Some connection: partial alignment, worth a passive note but low investigative priority
4 — Strong connection: descriptions broadly consistent across multiple signals, warrants active investigative attention
5 — Very strong connection: descriptions closely align across multiple specific signals including distinguishing details — top-tier priority

Reserve 5 only for the clearest possible matches where multiple specific details (tattoos, scars, precise physical marks, clothing items) align precisely. A 5 should represent the top 5–10% of all possible connections.

Respond with valid JSON only, in this exact format:
{
  "connection_level": 1,
  "summary": "One or two sentences explaining your assessment",
  "supporting": ["specific detail that supports a match"],
  "conflicting": ["specific detail that argues against a match"]
}

Be conservative. Never speculate beyond what the records state. This is a signal for investigators, not a conclusion.`

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
    model: REVIEW_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `MISSING PERSON:\n${mRaw.raw_text}\n\n---\n\nUNIDENTIFIED REMAINS:\n${uRaw.raw_text}`,
    }],
  })

  let assessment: Record<string, unknown> = {
    connection_level: 2,
    summary: 'AI response could not be parsed.',
    supporting: [], conflicting: [],
  }

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0])
      // Normalise connection_level to integer 1–5
      const lvl = parseInt(String(parsed.connection_level ?? 2))
      assessment = { ...parsed, connection_level: Math.max(1, Math.min(5, isNaN(lvl) ? 2 : lvl)) }
    }
  } catch { /* keep default */ }

  const result = { ...assessment, reviewed_at: new Date().toISOString(), model: REVIEW_MODEL }

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
  const { matchId, missingCaseId, batchSize = 15, routeMatches = false } = body

  // ── Tattoo match AI review ─────────────────────────────────────────────────
  if (body.tattooReview) {
    const { missingText, unidentifiedText, sharedKeywords, locationMatch, queueItemId } = body

    const tattooPrompt = `You are reviewing a potential match between a missing person and unidentified remains based on their distinguishing marks (tattoos, scars, piercings, birthmarks).

Shared keywords detected: ${(sharedKeywords ?? []).join(', ')}
Body location match: ${locationMatch ? 'YES — same body region' : 'No — different or unknown locations'}

Assess whether these mark descriptions could belong to the same person. Consider:
- Do the specific designs match (not just the category)?
- Could differences be explained by decomposition, fading, or imprecise descriptions?
- Are there contradicting marks (one person has something the other definitely doesn't)?

Rate 1-5:
1 = Clear mismatch (different designs, contradicting details)
2 = Generic overlap only ("cross" is very common — need more specificity)
3 = Plausible — descriptions are compatible but not distinctive enough to confirm
4 = Strong — specific design elements match (e.g., "heart with dagger" on both)
5 = Very strong — highly specific match (e.g., "rose tattoo with name 'Maria' on left shoulder blade")

Respond with JSON only:
{
  "connection_level": 1-5,
  "summary": "Assessment explaining your reasoning",
  "supporting": ["specific matching details"],
  "conflicting": ["specific contradictions or concerns"]
}`

    try {
      const msg = await anthropic.messages.create({
        model: REVIEW_MODEL,
        max_tokens: 512,
        system: tattooPrompt,
        messages: [{
          role: 'user',
          content: `MISSING PERSON:\n${missingText}\n\n---\n\nUNIDENTIFIED REMAINS:\n${unidentifiedText}`,
        }],
      })

      let assessment: Record<string, unknown> = { connection_level: 2, summary: 'Could not parse', supporting: [], conflicting: [] }
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      try {
        const m = text.match(/\{[\s\S]*\}/)
        if (m) {
          const parsed = JSON.parse(m[0])
          const lvl = parseInt(String(parsed.connection_level ?? 2))
          assessment = { ...parsed, connection_level: Math.max(1, Math.min(5, isNaN(lvl) ? 2 : lvl)) }
        }
      } catch { /* keep default */ }

      const result = { ...assessment, reviewed_at: new Date().toISOString(), model: REVIEW_MODEL }

      // Store reasoning on queue item
      if (queueItemId) {
        await supabase
          .from('intelligence_queue' as never)
          .update({ ai_reasoning: result.summary } as never)
          .eq('id', queueItemId)
      }

      return NextResponse.json({ ok: true, assessment: result })
    } catch (err) {
      return NextResponse.json({ error: 'AI review failed' }, { status: 500 })
    }
  }

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

    let candidateQuery = supabase
      .from('doe_match_candidates' as never)
      .select('id')
      .eq('missing_case_id', missingCaseId)
      .is('ai_assessment', null)
      .order('composite_score', { ascending: false })
      .limit(batchSize)

    if (routeMatches) {
      candidateQuery = candidateQuery.eq('match_type', 'destination_route_match') as typeof candidateQuery
    } else {
      candidateQuery = candidateQuery.eq('grade', 'very_strong') as typeof candidateQuery
    }

    const { data: pending } = await candidateQuery as { data: Array<{ id: string }> | null }

    if (!pending?.length) {
      return NextResponse.json({ reviewed: 0, hasMore: false, remaining: 0 })
    }

    let reviewed = 0
    for (const { id } of pending) {
      await reviewOne(supabase, id)
      reviewed++
    }

    let remainingQuery = supabase
      .from('doe_match_candidates' as never)
      .select('id', { count: 'exact', head: true })
      .eq('missing_case_id', missingCaseId)
      .is('ai_assessment', null)

    if (routeMatches) {
      remainingQuery = remainingQuery.eq('match_type', 'destination_route_match') as typeof remainingQuery
    } else {
      remainingQuery = remainingQuery.eq('grade', 'very_strong') as typeof remainingQuery
    }

    const { count } = await remainingQuery as { count: number | null }

    return NextResponse.json({ reviewed, hasMore: (count ?? 0) > 0, remaining: count ?? 0 })
  }

  return NextResponse.json({ error: 'matchId or missingCaseId required' }, { status: 400 })
}
