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

// ── POST: AI review of an offender overlap ───────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { offenderId, submissionId } = await req.json()
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
    max_tokens: 512,
    system: `You are a forensic analyst helping investigators assess whether a missing person case shares patterns with a known offender's profile.

Rate the strength of the possible connection on a scale of 1–5:
1 — Ignore: no meaningful overlap, coincidental similarity
2 — Slim connection: surface-level geographic or demographic overlap only
3 — Some connection: partial pattern alignment, worth noting
4 — Strong connection: multiple signals align with offender profile, warrants investigative attention
5 — Very strong connection: specific MO, geography, demographics, and timeline all align closely (top 5–10% only)

Respond with valid JSON only:
{
  "connection_level": 3,
  "summary": "One or two sentences explaining your assessment",
  "supporting": ["specific overlap detail"],
  "conflicting": ["specific reason against connection"]
}

This is a signal for investigators, not a conclusion. Never name the case subject as a victim.`,
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
