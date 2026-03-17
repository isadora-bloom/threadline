import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  const { submissionId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get the submission + its claims
  const { data: submission } = await supabase
    .from('submissions')
    .select('id, case_id')
    .eq('id', submissionId)
    .single()

  if (!submission) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

  const { data: role } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', submission.case_id)
    .eq('user_id', user.id)
    .single()
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: newClaims } = await supabase
    .from('claims')
    .select('id, extracted_text, claim_type')
    .eq('submission_id', submissionId)

  if (!newClaims?.length) return NextResponse.json({ corroborations: [], contradictions: [] })

  // Get existing claims from all OTHER submissions in this case
  const { data: existingClaims } = await supabase
    .from('claims')
    .select('id, extracted_text, claim_type, verification_status, submissions!inner(case_id)')
    .eq('submissions.case_id', submission.case_id)
    .neq('submission_id', submissionId)
    .in('verification_status', ['corroborated', 'confirmed', 'unverified'])
    .limit(80)

  if (!existingClaims?.length) return NextResponse.json({ corroborations: [], contradictions: [] })

  // Ask Claude to identify corroborations and contradictions
  const prompt = `You are analyzing new claims from a submission against existing case claims to identify corroborations and contradictions.

NEW CLAIMS (from this submission — prefixed with their ID):
${newClaims.map(c => `[${c.id}] (${c.claim_type}): ${c.extracted_text}`).join('\n')}

EXISTING CASE CLAIMS (prefixed with their ID):
${existingClaims.map(c => `[${c.id}] (${c.claim_type}, ${c.verification_status}): ${c.extracted_text}`).join('\n')}

For each new claim, determine:
1. Does it corroborate an existing claim? (same or very similar factual content)
2. Does it contradict an existing claim? (same topic/entity but different fact)
3. Is it novel? (no meaningful match)

RULES:
- Only flag genuine corroborations (same specific fact, not just same topic)
- Contradictions must be about the SAME specific fact (e.g., two claims about the same person's age that differ)
- Be precise — do not over-match

Return JSON (no markdown):
{
  "corroborations": [
    {
      "new_claim_id": "uuid",
      "existing_claim_id": "uuid",
      "similarity_score": 0.0-1.0,
      "match_type": "entity_match | text_similarity | ai_assessed",
      "summary": "one sentence explaining the match"
    }
  ],
  "contradictions": [
    {
      "new_claim_id": "uuid",
      "existing_claim_id": "uuid",
      "contradiction_detail": "one sentence explaining what contradicts what"
    }
  ]
}`

  let corroborations: Array<{ new_claim_id: string; existing_claim_id: string; similarity_score: number; match_type: string; summary: string }> = []
  let contradictions: Array<{ new_claim_id: string; existing_claim_id: string; contradiction_detail: string }> = []

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = response.content.find(b => b.type === 'text')
    if (block?.type === 'text') {
      const raw = block.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
      const parsed = JSON.parse(raw)
      corroborations = parsed.corroborations ?? []
      contradictions = parsed.contradictions ?? []
    }
  } catch (err) {
    console.error('Corroboration analysis error:', err)
    return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 })
  }

  // Save to claim_corroborations
  const rows = [
    ...corroborations.map(c => ({
      claim_id: c.new_claim_id,
      corroborated_by_claim_id: c.existing_claim_id,
      case_id: submission.case_id,
      similarity_score: c.similarity_score,
      match_type: c.match_type,
      is_contradiction: false,
    })),
    ...contradictions.map(c => ({
      claim_id: c.new_claim_id,
      corroborated_by_claim_id: c.existing_claim_id,
      case_id: submission.case_id,
      similarity_score: null,
      match_type: 'ai_assessed',
      is_contradiction: true,
      contradiction_detail: c.contradiction_detail,
    })),
  ]

  if (rows.length) {
    const { error: insertErr } = await supabase
      .from('claim_corroborations')
      .insert(rows)
      .select()
    if (insertErr) console.error('Corroboration insert error:', insertErr.message)
  }

  // Auto-update verification_status to 'corroborated' for matched claims
  if (corroborations.length) {
    await supabase
      .from('claims')
      .update({ verification_status: 'corroborated' })
      .in('id', corroborations.map(c => c.new_claim_id))
  }

  return NextResponse.json({
    corroborations: corroborations.length,
    contradictions: contradictions.length,
    details: { corroborations, contradictions },
  })
}
