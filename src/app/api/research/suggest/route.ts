import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { RESEARCH_MODEL } from '@/lib/ai-models'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { caseId } = await req.json()
  if (!caseId) return NextResponse.json({ error: 'caseId required' }, { status: 400 })

  const { data: role } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()

  if (!role || !['lead_investigator', 'admin'].includes(role.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch full case context
  const [caseRes, claimsRes, entitiesRes, flagsRes, threadsRes, existingTasksRes] = await Promise.all([
    supabase.from('cases').select('title, case_type, jurisdiction, notes').eq('id', caseId).single(),

    supabase
      .from('claims')
      .select('extracted_text, claim_type, verification_status, submissions!inner(case_id)')
      .eq('submissions.case_id', caseId)
      .in('verification_status', ['corroborated', 'confirmed', 'unverified'])
      .order('content_confidence', { ascending: false })
      .limit(60),

    supabase
      .from('entities')
      .select('entity_type, raw_value, normalized_value, notes, flagged_for_review')
      .eq('case_id', caseId)
      .neq('review_state', 'retracted')
      .limit(40),

    supabase
      .from('pattern_flags')
      .select('flag_type, title, description, grade')
      .eq('case_id', caseId)
      .neq('reviewer_status', 'dismissed')
      .order('score', { ascending: false })
      .limit(10),

    supabase
      .from('investigative_threads')
      .select('hypothesis, recommended_actions, status')
      .eq('case_id', caseId)
      .neq('status', 'dismissed')
      .limit(10),

    // Don't re-suggest questions already queued
    supabase
      .from('research_tasks')
      .select('question')
      .eq('case_id', caseId),
  ])

  const caseData = caseRes.data
  const claims = claimsRes.data ?? []
  const entities = entitiesRes.data ?? []
  const flags = flagsRes.data ?? []
  const threads = threadsRes.data ?? []
  const existingQuestions = (existingTasksRes.data ?? []).map(t => t.question)

  const prompt = `You are an investigative research assistant. Analyze this case and identify the most valuable specific research questions — things that could be looked up, traced, or verified using public records, archives, databases, or web sources.

CASE: ${caseData?.title}
TYPE: ${caseData?.case_type?.replace('_', ' ')}
JURISDICTION: ${caseData?.jurisdiction ?? 'Unknown'}
${caseData?.notes ? `NOTES: ${caseData.notes}` : ''}

CLAIMS (${claims.length}):
${claims.slice(0, 40).map(c => `• (${c.claim_type}, ${c.verification_status}) ${c.extracted_text}`).join('\n')}

ENTITIES OF INTEREST:
${entities.map(e => `• ${e.entity_type}: ${e.normalized_value || e.raw_value}${e.flagged_for_review ? ' [FLAGGED]' : ''}${e.notes ? ` — ${e.notes}` : ''}`).join('\n') || 'None'}

ACTIVE PATTERN FLAGS:
${flags.map(f => `• [${f.grade?.toUpperCase()}] ${f.title}: ${f.description}`).join('\n') || 'None'}

INVESTIGATIVE THREADS:
${threads.map(t => `• ${t.hypothesis}`).join('\n') || 'None generated yet'}

${existingQuestions.length ? `ALREADY QUEUED (do not repeat):\n${existingQuestions.map(q => `• ${q}`).join('\n')}` : ''}

Generate 3-5 specific, high-value research questions. Each should be:
- A concrete question that public sources, archives, or databases could answer
- Targeted at a specific gap, lead, or unverified detail in this case
- Actionable — not "investigate the suspect" but "what does marking X mean" or "what records exist for Y"
- Varied — cover different angles (physical evidence, identifiers, geographic, institutional records, etc.)

Prioritize questions about:
- Flagged entities and unresolved identifiers
- Evidence items that haven't been traced (markings, garments, vehicles)
- Institutional records that may document relevant events
- Geographic or temporal details that could be verified

Return JSON (no markdown):
{
  "suggestions": [
    {
      "question": "The specific research question",
      "context": "1-2 sentences of case-specific context that will help the researcher",
      "rationale": "Why this question is worth pursuing — what it could unlock",
      "priority": "high | medium | low",
      "trigger_ref_type": "claim | entity | flag | thread | general"
    }
  ]
}`

  try {
    const response = await anthropic.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = response.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
    }

    const raw = block.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(raw)

    return NextResponse.json({ suggestions: parsed.suggestions ?? [] })
  } catch (err) {
    console.error('Suggest error:', err)
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 })
  }
}
