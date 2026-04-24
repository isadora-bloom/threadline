import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { RESEARCH_MODEL } from '@/lib/ai-models'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { caseId } = await req.json()
  if (!caseId) return NextResponse.json({ error: 'caseId required' }, { status: 400 })

  // Role check — leads and admins only
  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()

  if (!roleData || !['lead_investigator', 'admin'].includes(roleData.role)) {
    return NextResponse.json({ error: 'Requires lead investigator or admin role' }, { status: 403 })
  }

  // ── Fetch case context ──────────────────────────────────────────────────────

  const [caseRes, claimsRes, entitiesRes, flagsRes] = await Promise.all([
    supabase
      .from('cases')
      .select('title, case_type, jurisdiction, notes')
      .eq('id', caseId)
      .single(),

    // Corroborated and confirmed claims — joined through submissions since claims have no direct case_id
    supabase
      .from('claims')
      .select('id, extracted_text, claim_type, source_confidence, content_confidence, verification_status, event_date, event_date_precision, notes, submissions!inner(case_id)')
      .eq('submissions.case_id', caseId)
      .in('verification_status', ['corroborated', 'confirmed', 'unverified'])
      .order('content_confidence', { ascending: false })
      .limit(120),

    supabase
      .from('entities')
      .select('id, entity_type, raw_value, normalized_value, confidence, notes')
      .eq('case_id', caseId)
      .neq('review_state', 'retracted')
      .order('created_at', { ascending: false })
      .limit(60),

    supabase
      .from('pattern_flags')
      .select('id, flag_type, title, description, grade, score, reviewer_status')
      .eq('case_id', caseId)
      .neq('reviewer_status', 'dismissed')
      .order('score', { ascending: false })
      .limit(20),
  ])

  if (caseRes.error || !caseRes.data) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const caseData = caseRes.data
  const claims = claimsRes.data ?? []
  const entities = entitiesRes.data ?? []
  const flags = flagsRes.data ?? []

  if (claims.length === 0 && entities.length === 0) {
    return NextResponse.json({
      error: 'Not enough case data to generate threads. Add and review claims first.',
    }, { status: 422 })
  }

  // ── Build the prompt ────────────────────────────────────────────────────────

  const claimsText = claims.map(c =>
    `[${c.id}] (${c.claim_type}, ${c.content_confidence} confidence, ${c.verification_status})` +
    (c.event_date ? ` [${c.event_date.slice(0, 10)}]` : '') +
    `: ${c.extracted_text}`
  ).join('\n')

  const entitiesText = entities.map(e =>
    `• ${e.entity_type.toUpperCase()}: ${e.normalized_value || e.raw_value}` +
    (e.notes ? ` — ${e.notes}` : '')
  ).join('\n')

  const flagsText = flags.length
    ? flags.map(f =>
        `• [${f.grade?.toUpperCase()}] ${f.title}: ${f.description}`
      ).join('\n')
    : 'No active pattern flags.'

  const prompt = `You are an investigative analysis assistant helping a lead investigator working on a ${caseData.case_type.replace('_', ' ')} case.

CASE: ${caseData.title}
JURISDICTION: ${caseData.jurisdiction ?? 'Unknown'}
CASE TYPE: ${caseData.case_type.replace('_', ' ')}

---

CLAIMS (${claims.length} total — each prefixed with its database UUID):
${claimsText}

---

ENTITIES OF INTEREST (${entities.length} total):
${entitiesText}

---

ACTIVE PATTERN FLAGS:
${flagsText}

---

TASK: Identify the 3-5 most tractable investigative leads and generate a structured investigative thread for each.

CRITICAL RULES:
1. Every thread MUST be labeled as a HYPOTHESIS, not a finding.
2. Never use words like: confirmed, identified, matched, proven, linked, solved.
3. Always use: possible, may indicate, reported, suggests, surfaced for review, warrants investigation.
4. Supporting claims must be referenced by their exact UUID from the list above.
5. Recommended actions must be concrete, specific, and actionable (not generic).
6. Prioritize leads that are: (a) supported by multiple independent claims, (b) actionable with existing resources, (c) potentially resolvable.

Return a JSON object with this exact structure — no markdown fences:

{
  "threads": [
    {
      "hypothesis": "A 2-3 sentence hypothesis statement using careful epistemic language. Must begin with 'Possible hypothesis:' and end with 'Surfaced for investigator review.'",
      "supporting_claim_ids": ["uuid-from-list", "uuid-from-list"],
      "complicating_factors": "1-2 sentences on what makes this thread harder to pursue or what could complicate verification.",
      "recommended_actions": [
        "Specific action 1 — who should do what",
        "Specific action 2",
        "Specific action 3"
      ],
      "external_resources": [
        "Resource name or URL — what it's useful for"
      ]
    }
  ]
}

Limit to 5 threads maximum. Focus on quality over quantity. If fewer than 3 tractable leads exist, return only what is genuinely warranted.`

  // ── Call Claude ─────────────────────────────────────────────────────────────

  let threads: Array<{
    hypothesis: string
    supporting_claim_ids: string[]
    complicating_factors: string | null
    recommended_actions: string[]
    external_resources: string[]
  }>

  try {
    const response = await anthropic.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
    }

    const raw = textBlock.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(raw)
    threads = parsed.threads ?? []

    if (!Array.isArray(threads) || threads.length === 0) {
      return NextResponse.json({ error: 'AI returned no threads' }, { status: 500 })
    }
  } catch (err) {
    console.error('Thread generation error:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
  }

  // Validate claim IDs — only keep ones that actually exist in this case
  const validClaimIds = new Set(claims.map(c => c.id))
  const batchId = randomUUID()

  // ── Save threads to database ────────────────────────────────────────────────

  const rows = threads.map(t => ({
    case_id: caseId,
    generation_batch_id: batchId,
    hypothesis: t.hypothesis,
    supporting_claim_ids: (t.supporting_claim_ids ?? []).filter((id: string) => validClaimIds.has(id)),
    complicating_factors: t.complicating_factors ?? null,
    recommended_actions: t.recommended_actions ?? [],
    external_resources: t.external_resources ?? [],
    status: 'unreviewed',
    generated_by: user.id,
    generation_model: RESEARCH_MODEL,
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('investigative_threads')
    .insert(rows)
    .select()

  if (insertError) {
    console.error('Thread insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save threads' }, { status: 500 })
  }

  // ── Log to audit trail ──────────────────────────────────────────────────────
  // Log one review_action for the generation event
  await supabase.from('review_actions').insert({
    actor_id: user.id,
    action: 'hypothesis_generated',
    target_type: 'case',
    target_id: caseId,
    case_id: caseId,
    notes: `AI generated ${threads.length} investigative thread${threads.length !== 1 ? 's' : ''} (batch ${batchId}). Model: ${RESEARCH_MODEL}. Claims used: ${claims.length}. Entities: ${entities.length}. Pattern flags: ${flags.length}.`,
  })

  return NextResponse.json({
    threads: inserted,
    batchId,
    context: {
      claimsUsed: claims.length,
      entitiesUsed: entities.length,
      flagsUsed: flags.length,
    },
  })
}
