import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
      .select('submission_id,case_id,composite_score,temporal_score,predator_geo_score,victim_geo_score,victim_sex_score,victim_age_score,victim_race_score,mo_score,matched_mo_keywords')
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
      .select('offender_id,composite_score,temporal_score,predator_geo_score,victim_geo_score,victim_sex_score,victim_age_score,victim_race_score,mo_score,matched_mo_keywords')
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
