import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const type = params.get('type') ?? 'list'

  const caseId = params.get('caseId')
  const minScore = parseInt(params.get('minScore') ?? '65')

  // ── List all offenders with match counts (scoped to caseId) ──────────────
  if (type === 'list') {
    if (!caseId) return NextResponse.json({ error: 'caseId required' }, { status: 400 })

    const { data: offenders } = await supabase
      .from('known_offenders')
      .select('id,name,aliases,birth_year,status,conviction_count,suspected_count,active_from,active_to,incarcerated_from,home_states,operation_states,victim_states,victim_sex,victim_races,victim_age_min,victim_age_max,victim_age_typical,mo_keywords,disposal_method,cause_of_death,signature_details,wikipedia_slug')
      .order('suspected_count', { ascending: false })

    // Get match counts scoped to this case and above the score threshold
    const { data: counts } = await supabase
      .from('offender_case_overlaps' as never)
      .select('offender_id')
      .eq('case_id', caseId as never)
      .gte('composite_score', minScore as never) as { data: Array<{ offender_id: string }> | null }

    const countMap = new Map<string, number>()
    for (const row of counts ?? []) {
      countMap.set(row.offender_id, (countMap.get(row.offender_id) ?? 0) + 1)
    }

    return NextResponse.json({
      offenders: (offenders ?? []).map(o => ({
        ...o,
        overlap_count: countMap.get(o.id) ?? 0,
      })),
    })
  }

  // ── Top submissions for a specific offender, scoped to case ──────────────
  if (type === 'offender_cases') {
    const offenderId = params.get('offenderId')
    if (!offenderId) return NextResponse.json({ error: 'offenderId required' }, { status: 400 })
    if (!caseId) return NextResponse.json({ error: 'caseId required' }, { status: 400 })

    const limit = parseInt(params.get('limit') ?? '30')

    let query = supabase
      .from('offender_case_overlaps' as never)
      .select('submission_id,case_id,composite_score,temporal_score,predator_geo_score,victim_geo_score,victim_sex_score,victim_age_score,victim_race_score,mo_score,matched_mo_keywords,resolution_confirmed,reviewer_status,ai_assessment')
      .eq('offender_id', offenderId as never)
      .eq('case_id', caseId as never)
      .gte('composite_score', minScore as never)
      .order('composite_score', { ascending: false })
      .limit(limit)

    const { data: overlaps } = await query as { data: Array<Record<string, unknown>> | null }

    if (!overlaps?.length) return NextResponse.json({ overlaps: [] })

    // Fetch submission details
    const subIds = overlaps.map(o => o.submission_id as string)
    const { data: subs } = await supabase
      .from('submissions')
      .select('id, raw_text')
      .in('id', subIds)

    const subMap = new Map((subs ?? []).map(s => [s.id, s.raw_text]))

    const enriched = overlaps.map(o => {
      const text = subMap.get(o.submission_id as string) ?? ''
      const firstLines = text.split('\n').slice(0, 4).join(' | ')
      return { ...o, preview: firstLines.slice(0, 200) }
    })

    return NextResponse.json({ overlaps: enriched })
  }

  // ── Overlaps for a specific submission ────────────────────────────────────
  if (type === 'submission_overlaps') {
    const submissionId = params.get('submissionId')
    if (!submissionId) return NextResponse.json({ error: 'submissionId required' }, { status: 400 })

    const { data: overlaps } = await supabase
      .from('offender_case_overlaps' as never)
      .select('offender_id,composite_score,temporal_score,predator_geo_score,victim_geo_score,victim_sex_score,victim_age_score,victim_race_score,mo_score,matched_mo_keywords,resolution_confirmed')
      .eq('submission_id', submissionId)
      .order('composite_score', { ascending: false })
      .limit(10) as { data: Array<Record<string, unknown>> | null }

    if (!overlaps?.length) return NextResponse.json({ overlaps: [] })

    const offenderIds = overlaps.map(o => o.offender_id as string)
    const { data: offenders } = await supabase
      .from('known_offenders')
      .select('id,name,aliases,active_from,active_to,conviction_count,suspected_count,victim_sex,victim_age_typical,home_states,operation_states,signature_details,wikipedia_slug')
      .in('id', offenderIds)

    const offMap = new Map((offenders ?? []).map(o => [o.id, o]))

    return NextResponse.json({
      overlaps: overlaps.map(o => ({
        ...o,
        offender: offMap.get(o.offender_id as string) ?? null,
      })),
    })
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
}

// ── Shared AI system prompt ───────────────────────────────────────────────────

const OFFENDER_SYSTEM_PROMPT = `You are a forensic analyst helping investigators assess whether a missing person case might be connected to a known offender.

You will receive: (1) an OFFENDER PROFILE with documented behavioral patterns, geographic range, and victim characteristics; (2) a CASE RECORD; (3) a computed pattern-overlap score and matched MO keywords.

## Connection assessment — rate 1–5

1 — Ignore: no meaningful overlap beyond coincidence, or clear contradictions exist
2 — Slim: surface demographic overlap only (common factors like "sex worker" or "drug use" present in thousands of cases); no specific alignment beyond broad category
3 — Some: partial pattern alignment — a few signals match but key factors (geography, encounter context, or signature) diverge or are absent
4 — Strong: multiple specific signals align — geographic presence, timeline, victim type, AND encounter context are all broadly consistent
5 — Very strong: confirmed geographic presence in region during the period, victim demographics, encounter context, and timeline all closely align, with signature elements present (top 5–10% only)

## Critical weighting rules — read carefully

- Generic vulnerability factors (sex worker, drug user, hitchhiker, bar) appear across thousands of cases. These shared demographics alone CANNOT push a score above 3. You need specificity beyond broad category overlap.
- Geographic alignment requires DOCUMENTED CONFIRMED presence: the offender must have documented activity or known presence in this specific region during this specific time period — not just "operated across multiple states." Absence of documented regional presence is a meaningful negative signal.
- Encounter context is decisive: how did the offender typically encounter victims (bar, street, hitchhiking, truck stop)? How did this victim disappear? A mismatch here — e.g., offender picked up street-level victims but this person disappeared from a family home — is a strong negative signal that outweighs demographic overlap.
- Signature elements (specific cause of death, disposal patterns, distinguishing MO behaviors beyond keywords) carry high weight. If the case shows no evidence of the offender's documented signature and a plausible alternative explanation exists, score lower.
- If the record indicates a strong local suspect, drug debt context, domestic situation, or other specific alternative explanation, factor this in — it should reduce the score even if demographic overlap is high.
- High pattern-match scores from keyword algorithms can be inflated by generic MO terms. Treat the algorithmic score as a starting point, not a ceiling. Your contextual assessment may result in a lower connection_level than the score implies.

## Solvability assessment — independent axis

Also rate solvability — regardless of the offender connection, how resolvable is this case with current or near-future investigative resources?

1 — No path forward: no remains recovered, case dormant for decades, no forensic material mentioned
2 — Remote: limited evidence; identification would require significant new material or technology
3 — Possible: forensic material or investigation pathway indicated; DNA comparison may be achievable with effort
4 — Probable: remains recovered or DNA/dental records documented; targeted forensic effort could yield identification
5 — Strong: DNA already submitted for comparison, active investigation, or recent developments enabling identification

Solvability measures investigative feasibility, not connection strength. A case can be strongly connected but unsolvable (no remains, cold for 40 years), or weakly connected but immediately actionable.

## Response format

Respond with valid JSON only:
{
  "connection_level": 3,
  "solvability_score": 2,
  "summary": "One to two sentences on connection strength and why.",
  "solvability_note": "One sentence on the key solvability factor.",
  "supporting": ["specific detail that supports the connection"],
  "conflicting": ["specific detail arguing against the connection"]
}

This is a signal for investigators, not a conclusion. Never name the case subject as a victim.`

// ── POST: AI review of an offender overlap (single or batch) ─────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // ── Batch: review top unreviewed overlaps for a case ──────────────────────
  if (body.action === 'batch_ai_review') {
    const { caseId, batchSize = 10, minScore: ms = 65 } = body
    if (!caseId) return NextResponse.json({ error: 'caseId required' }, { status: 400 })

    // Pull top-scoring overlaps without ai_assessment, across all offenders
    const { data: pending } = await supabase
      .from('offender_case_overlaps' as never)
      .select('offender_id,submission_id')
      .eq('case_id', caseId as never)
      .is('ai_assessment', null)
      .gte('composite_score', ms as never)
      .order('composite_score', { ascending: false })
      .limit(batchSize) as { data: Array<{ offender_id: string; submission_id: string }> | null }

    if (!pending?.length) return NextResponse.json({ reviewed: 0, hasMore: false, remaining: 0 })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })

    type KnownOffenderRow = { name: string; aliases: string[] | null; active_from: number | null; active_to: number | null; incarcerated_from: number | null; home_states: string[] | null; operation_states: string[] | null; victim_sex: string | null; victim_races: string[] | null; victim_age_typical: number | null; mo_keywords: string[] | null; signature_details: string | null }
    type SubRow = { raw_text: string }
    type OverlapRow = { composite_score: number; matched_mo_keywords: string[] | null }

    let reviewed = 0
    for (const { offender_id, submission_id } of pending) {
      const [{ data: offender }, { data: sub }, { data: overlap }] = await Promise.all([
        supabase.from('known_offenders').select('name,aliases,active_from,active_to,incarcerated_from,home_states,operation_states,victim_sex,victim_races,victim_age_min,victim_age_max,victim_age_typical,mo_keywords,signature_details').eq('id', offender_id).single() as unknown as Promise<{ data: KnownOffenderRow | null }>,
        supabase.from('submissions').select('raw_text').eq('id', submission_id).single() as unknown as Promise<{ data: SubRow | null }>,
        supabase.from('offender_case_overlaps' as never).select('composite_score,matched_mo_keywords').eq('offender_id', offender_id as never).eq('submission_id', submission_id as never).single() as unknown as Promise<{ data: OverlapRow | null }>,
      ])
      if (!offender || !sub || !overlap) continue

      const offenderProfile = [
        `Name: ${offender.name}`,
        offender.aliases?.length ? `Aliases: ${offender.aliases.join(', ')}` : null,
        offender.active_from ? `Active: ${offender.active_from}–${offender.active_to ?? 'unknown'}` : null,
        offender.incarcerated_from ? `Incarcerated: ${offender.incarcerated_from}` : null,
        `Home states: ${(offender.home_states ?? []).join(', ') || 'unknown'}`,
        `Operated in: ${(offender.operation_states ?? []).join(', ') || 'unknown'}`,
        offender.victim_sex ? `Typical victims: ${offender.victim_sex}` : null,
        offender.victim_age_typical ? `Typical victim age: ${offender.victim_age_typical}` : null,
        (offender.victim_races ?? []).length ? `Victim races: ${(offender.victim_races as string[]).join(', ')}` : null,
        (offender.mo_keywords ?? []).length ? `MO: ${(offender.mo_keywords as string[]).join(', ')}` : null,
        offender.signature_details ? `Signature: ${offender.signature_details}` : null,
      ].filter(Boolean).join('\n')

      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const anthropic = new Anthropic({ apiKey })
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system: OFFENDER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `OFFENDER PROFILE:\n${offenderProfile}\n\n---\n\nCASE RECORD:\n${sub.raw_text}\n\n---\n\nPattern overlap score: ${overlap.composite_score}/100. Matched MO keywords: ${(overlap.matched_mo_keywords ?? []).join(', ') || 'none'}.` }],
      })

      let assessment: Record<string, unknown> = { connection_level: 2, summary: 'AI response could not be parsed.', supporting: [], conflicting: [] }
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      try {
        const m = text.match(/\{[\s\S]*\}/)
        if (m) {
          const parsed = JSON.parse(m[0])
          const lvl = parseInt(String(parsed.connection_level ?? 2))
          assessment = { ...parsed, connection_level: Math.max(1, Math.min(5, isNaN(lvl) ? 2 : lvl)) }
        }
      } catch { /* keep default */ }

      const result = { ...assessment, reviewed_at: new Date().toISOString(), model: 'claude-haiku-4-5-20251001' }
      await supabase.from('offender_case_overlaps' as never).update({ ai_assessment: result } as never)
        .eq('offender_id', offender_id as never).eq('submission_id', submission_id as never)
      reviewed++
    }

    // Count remaining
    const { count } = await supabase
      .from('offender_case_overlaps' as never)
      .select('offender_id', { count: 'exact', head: true })
      .eq('case_id', caseId as never)
      .is('ai_assessment', null)
      .gte('composite_score', ms as never) as { count: number | null }

    return NextResponse.json({ reviewed, hasMore: (count ?? 0) > 0, remaining: count ?? 0 })
  }

  // ── Single review ──────────────────────────────────────────────────────────
  const { offenderId, submissionId } = body
  if (!offenderId || !submissionId) return NextResponse.json({ error: 'offenderId and submissionId required' }, { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })

  const [{ data: offender }, { data: sub }, { data: overlap }] = await Promise.all([
    supabase.from('known_offenders').select('name,aliases,active_from,active_to,incarcerated_from,home_states,operation_states,victim_sex,victim_races,victim_age_min,victim_age_max,victim_age_typical,mo_keywords,signature_details').eq('id', offenderId).single(),
    supabase.from('submissions').select('raw_text').eq('id', submissionId).single(),
    supabase.from('offender_case_overlaps' as never).select('id,composite_score,temporal_score,matched_mo_keywords').eq('offender_id', offenderId as never).eq('submission_id', submissionId as never).single() as Promise<{ data: Record<string, unknown> | null }>,
  ])

  if (!offender || !sub || !overlap) return NextResponse.json({ error: 'Records not found' }, { status: 404 })

  const offenderProfile = [
    `Name: ${offender.name}`,
    offender.aliases?.length ? `Aliases: ${offender.aliases.join(', ')}` : null,
    offender.active_from ? `Active: ${offender.active_from}–${offender.active_to ?? 'unknown'}` : null,
    offender.incarcerated_from ? `Incarcerated: ${offender.incarcerated_from}` : null,
    `Home states: ${(offender.home_states ?? []).join(', ') || 'unknown'}`,
    `Operated in: ${(offender.operation_states ?? []).join(', ') || 'unknown'}`,
    offender.victim_sex ? `Typical victims: ${offender.victim_sex}` : null,
    offender.victim_age_typical ? `Typical victim age: ${offender.victim_age_typical}` : null,
    (offender.victim_races ?? []).length ? `Victim races: ${(offender.victim_races as string[]).join(', ')}` : null,
    (offender.mo_keywords ?? []).length ? `MO: ${(offender.mo_keywords as string[]).join(', ')}` : null,
    offender.signature_details ? `Signature: ${offender.signature_details}` : null,
  ].filter(Boolean).join('\n')

  const anthropic = new Anthropic({ apiKey })

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    system: OFFENDER_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `OFFENDER PROFILE:\n${offenderProfile}\n\n---\n\nCASE RECORD:\n${(sub as { raw_text: string }).raw_text}\n\n---\n\nPattern overlap score: ${overlap.composite_score}/100. Matched MO keywords: ${(overlap.matched_mo_keywords as string[] ?? []).join(', ') || 'none'}.`,
    }],
  })

  let assessment: Record<string, unknown> = { connection_level: 2, summary: 'AI response could not be parsed.', supporting: [], conflicting: [] }
  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0])
      const lvl = parseInt(String(parsed.connection_level ?? 2))
      assessment = { ...parsed, connection_level: Math.max(1, Math.min(5, isNaN(lvl) ? 2 : lvl)) }
    }
  } catch { /* keep default */ }

  const result = { ...assessment, reviewed_at: new Date().toISOString(), model: 'claude-haiku-4-5-20251001' }

  await supabase.from('offender_case_overlaps' as never).update({ ai_assessment: result } as never)
    .eq('offender_id', offenderId as never).eq('submission_id', submissionId as never)

  return NextResponse.json({ ok: true, assessment: result })
}

// ── PATCH: Update reviewer_status for an offender overlap ────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { offenderId, submissionId, reviewerStatus } = await req.json()
  if (!offenderId || !submissionId || !reviewerStatus) {
    return NextResponse.json({ error: 'offenderId, submissionId, reviewerStatus required' }, { status: 400 })
  }
  const valid = ['unreviewed', 'worth_investigating', 'confirmed', 'dismissed']
  if (!valid.includes(reviewerStatus)) {
    return NextResponse.json({ error: 'Invalid reviewerStatus' }, { status: 400 })
  }

  await supabase.from('offender_case_overlaps' as never)
    .update({ reviewer_status: reviewerStatus } as never)
    .eq('offender_id', offenderId as never)
    .eq('submission_id', submissionId as never)

  return NextResponse.json({ ok: true })
}
