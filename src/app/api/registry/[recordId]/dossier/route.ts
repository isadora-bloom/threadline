import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/registry/[recordId]/dossier
 *
 * Aggregates everything we know about a person across import_records,
 * ai_extraction, deep_research, global_connections, doe_match_candidates,
 * offender_case_overlaps, community_notes, and record_siblings into a
 * single Markdown document the user can save offline, print, or hand to
 * an investigator.
 *
 * Returns text/markdown with a Content-Disposition: attachment header so
 * browsers download rather than render.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> },
) {
  const { recordId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  type RecordRow = Record<string, unknown> & {
    id: string
    person_name: string | null
    record_type: string
    external_id: string
    external_url: string | null
    sex: string | null
    age_text: string | null
    race: string | null
    state: string | null
    city: string | null
    date_missing: string | null
    date_found: string | null
    classification: string | null
    case_status: string | null
    circumstances_summary: string | null
    submission_id: string | null
    ai_extraction: Record<string, unknown> | null
    raw_data: Record<string, unknown> | null
    source: { display_name: string; slug: string; base_url: string | null } | null
  }

  const { data: rec } = await supabase
    .from('import_records')
    .select('*, source:import_sources(display_name, slug, base_url)')
    .eq('id', recordId)
    .single() as unknown as { data: RecordRow | null }

  if (!rec) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

  const submissionId = rec.submission_id

  const [
    solvabilityRes,
    connectionsRes,
    doeMatchesRes,
    offenderOverlapsRes,
    communityNotesRes,
    researchRes,
    siblingsLinksRes,
  ] = await Promise.all([
    supabase.from('solvability_scores').select('*').eq('import_record_id', recordId).maybeSingle(),
    supabase
      .from('global_connections')
      .select('composite_score, grade, signals, ai_summary, days_apart, distance_miles, record_a_id, record_b_id, record_a:import_records!global_connections_record_a_id_fkey(id, person_name, record_type, state), record_b:import_records!global_connections_record_b_id_fkey(id, person_name, record_type, state)')
      .or(`record_a_id.eq.${recordId},record_b_id.eq.${recordId}`)
      .order('composite_score', { ascending: false })
      .limit(20),
    submissionId
      ? supabase
          .from('doe_match_candidates')
          .select('composite_score, grade, missing_name, missing_location, missing_date, unidentified_location, unidentified_date, ai_assessment')
          .or(`missing_submission_id.eq.${submissionId},unidentified_submission_id.eq.${submissionId}`)
          .order('composite_score', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    submissionId
      ? supabase
          .from('offender_case_overlaps')
          .select('composite_score, matched_mo_keywords, ai_assessment, offender:known_offenders(name, status, victim_states, mo_keywords)')
          .eq('submission_id', submissionId)
          .gte('composite_score', 50)
          .order('composite_score', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    supabase
      .from('community_notes')
      .select('note_type, content, ai_extraction, created_at, user:user_profiles(full_name)')
      .eq('import_record_id', recordId)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('deep_research')
      .select('summary, findings, model_used, created_at, status')
      .eq('import_record_id', recordId)
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('record_siblings')
      .select('record_a_id, record_b_id, link_type, confidence')
      .or(`record_a_id.eq.${recordId},record_b_id.eq.${recordId}`),
  ])

  // Resolve sibling records.
  const siblingLinks = ((siblingsLinksRes.data ?? []) as Array<{ record_a_id: string; record_b_id: string; link_type: string; confidence: number }>)
  const siblingIds = siblingLinks.map(l => (l.record_a_id === recordId ? l.record_b_id : l.record_a_id))
  type SiblingFull = { id: string; person_name: string | null; circumstances_summary: string | null; raw_data: Record<string, unknown> | null; source: { display_name: string } | null }
  let siblings: Array<SiblingFull & { link_type: string; confidence: number }> = []
  if (siblingIds.length > 0) {
    const { data: siblingRecs } = await supabase
      .from('import_records')
      .select('id, person_name, circumstances_summary, raw_data, source:import_sources(display_name)')
      .in('id', siblingIds) as unknown as { data: SiblingFull[] | null }
    const byId = new Map((siblingRecs ?? []).map(r => [r.id, r]))
    siblings = siblingLinks
      .map(l => {
        const otherId = l.record_a_id === recordId ? l.record_b_id : l.record_a_id
        const other = byId.get(otherId)
        if (!other) return null
        return { ...other, link_type: l.link_type, confidence: l.confidence }
      })
      .filter((s): s is SiblingFull & { link_type: string; confidence: number } => !!s)
  }

  const md = buildMarkdown({
    record: rec,
    solvability: (solvabilityRes.data ?? null) as Record<string, unknown> | null,
    connections: (connectionsRes.data ?? []) as Array<Record<string, unknown>>,
    doeMatches: (doeMatchesRes.data ?? []) as Array<Record<string, unknown>>,
    offenderOverlaps: (offenderOverlapsRes.data ?? []) as Array<Record<string, unknown>>,
    communityNotes: (communityNotesRes.data ?? []) as Array<Record<string, unknown>>,
    research: (researchRes.data ?? []) as Array<Record<string, unknown>>,
    siblings,
  })

  const safeName = (rec.person_name ?? rec.external_id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
  const filename = `threadline-dossier-${safeName}.md`

  return new NextResponse(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=0, no-store',
    },
  })
}

interface DossierInput {
  record: Record<string, unknown> & {
    person_name: string | null
    record_type: string
    external_id: string
    external_url: string | null
    sex: string | null
    age_text: string | null
    race: string | null
    state: string | null
    city: string | null
    date_missing: string | null
    date_found: string | null
    classification: string | null
    case_status: string | null
    circumstances_summary: string | null
    ai_extraction: Record<string, unknown> | null
    raw_data: Record<string, unknown> | null
    source: { display_name: string; slug: string; base_url: string | null } | null
  }
  solvability: Record<string, unknown> | null
  connections: Array<Record<string, unknown>>
  doeMatches: Array<Record<string, unknown>>
  offenderOverlaps: Array<Record<string, unknown>>
  communityNotes: Array<Record<string, unknown>>
  research: Array<Record<string, unknown>>
  siblings: Array<{
    id: string
    person_name: string | null
    circumstances_summary: string | null
    raw_data: Record<string, unknown> | null
    source: { display_name: string } | null
    link_type: string
    confidence: number
  }>
}

function h2(title: string) { return `\n## ${title}\n` }
function h3(title: string) { return `\n### ${title}\n` }
function field(label: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  return `- **${label}:** ${value}\n`
}

function buildMarkdown(input: DossierInput): string {
  const r = input.record
  const isMissing = r.record_type === 'missing_person'
  const headline = r.person_name ?? `Unidentified — ${r.external_id}`
  const sourceName = r.source?.display_name ?? 'Unknown source'

  const parts: string[] = []
  parts.push(`# ${headline}`)
  parts.push(`*${isMissing ? 'Missing person' : 'Unidentified remains'} · ${sourceName} · ${r.external_id}*`)
  parts.push('')
  parts.push(`> Generated by Threadline on ${new Date().toISOString().slice(0, 10)}.`)
  parts.push(`> Threadline aggregates publicly available registry data and AI-extracted signals.`)
  parts.push(`> Every claim below should be independently verified before action.`)

  // Identity
  parts.push(h2('Identity'))
  parts.push(field('Name', r.person_name))
  parts.push(field('Sex', r.sex))
  parts.push(field('Age', r.age_text))
  parts.push(field('Race', r.race))
  parts.push(field('Source ID', r.external_id))
  if (r.external_url) parts.push(field('Source URL', r.external_url))

  // Location and timeline
  parts.push(h2('Location and timeline'))
  parts.push(field('City', r.city))
  parts.push(field('State', r.state))
  parts.push(field('Date missing', r.date_missing))
  parts.push(field('Date found', r.date_found))
  parts.push(field('Classification', r.classification))
  parts.push(field('Case status', r.case_status))

  // Circumstances
  if (r.circumstances_summary) {
    parts.push(h2('Circumstances'))
    parts.push(r.circumstances_summary)
  }

  // AI extraction (chunks of it)
  const ai = r.ai_extraction
  if (ai) {
    const demo = ai.demographics as Record<string, unknown> | undefined
    const circ = ai.circumstances as Record<string, unknown> | undefined
    const beh = ai.behavioral_signals as Record<string, unknown> | undefined
    const sol = ai.solvability_signals as Record<string, unknown> | undefined
    const entities = (ai.entities ?? []) as Array<Record<string, unknown>>
    const claims = (ai.claims ?? []) as Array<Record<string, unknown>>

    parts.push(h2('AI extraction (unverified)'))
    if (demo) {
      parts.push(h3('Physical'))
      parts.push(field('Height', demo.height_inches ? `${demo.height_inches}"` : null))
      parts.push(field('Weight', demo.weight_lbs ? `${demo.weight_lbs} lbs` : null))
      parts.push(field('Hair', demo.hair_color))
      parts.push(field('Eyes', demo.eye_color))
      const marks = (demo.distinguishing_marks ?? []) as string[]
      if (marks.length > 0) {
        parts.push(field('Distinguishing marks', marks.join('; ')))
      }
    }
    if (circ?.classification) parts.push(field('Classification (AI)', circ.classification))
    if (circ?.detailed) {
      parts.push(h3('Detailed circumstances (AI)'))
      parts.push(String(circ.detailed))
    }
    const riskFactors = (circ?.risk_factors ?? []) as string[]
    if (riskFactors.length > 0) parts.push(field('Risk factors', riskFactors.join(', ')))
    const moKeywords = (beh?.mo_keywords ?? []) as string[]
    if (moKeywords.length > 0) parts.push(field('MO keywords', moKeywords.join(', ')))
    const stallIndicators = (sol?.stall_indicators ?? []) as string[]
    if (stallIndicators.length > 0) parts.push(field('Stall indicators', stallIndicators.join('; ')))

    if (entities.length > 0) {
      parts.push(h3('Extracted entities'))
      for (const e of entities.slice(0, 50)) {
        parts.push(`- **${e.entity_type ?? 'entity'}** · ${e.raw_value ?? ''}${e.role ? ` (${e.role})` : ''}${e.notes ? ` — ${e.notes}` : ''}`)
      }
    }

    if (claims.length > 0) {
      parts.push(h3('Extracted claims'))
      for (const c of claims.slice(0, 50)) {
        parts.push(`- *(${c.type ?? 'claim'}, ${c.confidence ?? 'unknown'})* ${c.text ?? ''}`)
      }
    }
  }

  // Sibling records
  if (input.siblings.length > 0) {
    parts.push(h2('Same case in other registries'))
    for (const s of input.siblings) {
      parts.push(h3(`${s.source?.display_name ?? 'Other source'} — ${s.link_type === 'explicit_id' ? 'explicit cross-reference' : 'fuzzy match (verify)'}`))
      const raw = (s.raw_data ?? {}) as Record<string, unknown>
      const detail = (raw.details_of_disappearance as string | undefined) ?? s.circumstances_summary
      if (detail) parts.push(detail)
      const distChars = raw.distinguishing_characteristics as string | undefined
      if (distChars) parts.push(`\n*Distinguishing characteristics:* ${distChars}`)
      const agency = raw.investigating_agency as string | undefined
      if (agency) parts.push(`\n*Investigating agency:* ${agency}`)
    }
  }

  // Solvability
  if (input.solvability) {
    parts.push(h2('Solvability assessment'))
    parts.push(field('Score', `${input.solvability.score} / 100`))
    parts.push(field('Grade', input.solvability.grade))
    if (input.solvability.ai_summary) parts.push(`\n${input.solvability.ai_summary}\n`)
    const nextSteps = (input.solvability.ai_next_steps ?? []) as string[]
    if (nextSteps.length > 0) {
      parts.push(h3('Investigative gaps the AI flagged'))
      for (const step of nextSteps) parts.push(`- ${step}`)
    }
  }

  // DOE match candidates
  if (input.doeMatches.length > 0) {
    parts.push(h2('16-signal cross-reference matches'))
    for (const m of input.doeMatches.slice(0, 10)) {
      parts.push(`- **${m.grade ?? '?'} (${m.composite_score ?? '?'})** ${m.missing_name ?? '?'} (${m.missing_location ?? '?'}, ${m.missing_date ?? '?'}) ↔ remains found ${m.unidentified_location ?? '?'} on ${m.unidentified_date ?? '?'}`)
      const ai = m.ai_assessment as Record<string, unknown> | null
      if (ai?.assessment) parts.push(`  > ${ai.assessment}`)
    }
  }

  // Connections
  if (input.connections.length > 0) {
    parts.push(h2('Database connections'))
    for (const c of input.connections.slice(0, 10)) {
      const a = c.record_a as { id: string; person_name: string | null } | null
      const b = c.record_b as { id: string; person_name: string | null } | null
      const otherName = c.record_a_id === input.record.id ? b?.person_name : a?.person_name
      parts.push(`- **${c.grade} (${c.composite_score})** ↔ ${otherName ?? 'Unknown'}`)
      if (c.ai_summary) parts.push(`  > ${c.ai_summary}`)
    }
  }

  // Offender overlaps
  if (input.offenderOverlaps.length > 0) {
    parts.push(h2('Known-offender overlaps'))
    parts.push('*Statistical only — never an accusation.*\n')
    for (const o of input.offenderOverlaps) {
      const off = o.offender as { name: string; status: string; victim_states: string[] | null; mo_keywords: string[] | null } | null
      if (!off) continue
      parts.push(`- **${off.name}** (${off.status ?? 'status unknown'}) — score ${o.composite_score}`)
      const matched = (o.matched_mo_keywords ?? []) as string[]
      if (matched.length > 0) parts.push(`  - matched MO: ${matched.join(', ')}`)
    }
  }

  // Deep research
  if (input.research.length > 0) {
    parts.push(h2('AI deep research history'))
    for (const r of input.research) {
      const date = r.created_at ? new Date(String(r.created_at)).toISOString().slice(0, 10) : ''
      parts.push(h3(`${date} · ${r.model_used}`))
      if (r.summary) parts.push(String(r.summary))
      const findings = r.findings as Record<string, unknown> | null
      if (findings) {
        const flags = (findings.red_flags ?? []) as Array<Record<string, unknown>>
        if (flags.length > 0) {
          parts.push('\n**Red flags:**')
          for (const f of flags) parts.push(`- ${f.flag ?? f.description ?? ''}`)
        }
        const next = (findings.next_steps ?? []) as Array<Record<string, unknown>>
        if (next.length > 0) {
          parts.push('\n**Next steps:**')
          for (const s of next) parts.push(`- ${s.action ?? ''}${s.who ? ` (${s.who})` : ''}`)
        }
      }
    }
  }

  // Community notes
  if (input.communityNotes.length > 0) {
    parts.push(h2('Community notes'))
    for (const n of input.communityNotes) {
      const u = n.user as { full_name: string | null } | null
      const date = n.created_at ? new Date(String(n.created_at)).toISOString().slice(0, 10) : ''
      parts.push(`\n**${u?.full_name ?? 'Anonymous'}** · ${date} · *${n.note_type}*`)
      parts.push(String(n.content))
    }
  }

  parts.push(h2('Methodology and limitations'))
  parts.push(`This dossier aggregates registry data, automated 16-signal matching, AI extraction, and community contributions. None of it constitutes identification. Verify before acting. The official source for this case is ${sourceName} (${r.external_url ?? 'no public URL'}).`)

  return parts.join('\n')
}
