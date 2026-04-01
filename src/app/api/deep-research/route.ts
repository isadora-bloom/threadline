import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { importRecordId, researchType = 'full', focusQuestion, focusSearchTerms } = await req.json()
  if (!importRecordId) return NextResponse.json({ error: 'importRecordId required' }, { status: 400 })

  const serviceClient = await createServiceClient()

  // Fetch the target record
  const { data: record } = await serviceClient
    .from('import_records')
    .select('*, source:import_sources(display_name)')
    .eq('id', importRecordId)
    .single()

  if (!record) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

  // Create research task record
  const { data: researchTask, error: taskError } = await serviceClient
    .from('deep_research')
    .insert({
      import_record_id: importRecordId,
      research_type: researchType,
      status: 'running',
      started_at: new Date().toISOString(),
      requested_by: user.id,
    })
    .select()
    .single()

  if (taskError) {
    console.error('Failed to create research task:', taskError)
    return NextResponse.json({ error: 'Failed to start research' }, { status: 500 })
  }

  try {
    // Gather context for AI
    const context = await gatherResearchContext(serviceClient, record, importRecordId)

    // Web search — if Brave API key is available, search for additional context
    const webResults = await runWebSearch(record, focusSearchTerms)

    // Build prompt — add focus question if this is a follow-up
    let prompt = buildResearchPrompt(record, context, webResults)
    if (focusQuestion) {
      prompt += `\n\n## FOCUS QUESTION\nThis is a follow-up investigation. Focus your analysis specifically on:\n"${focusQuestion}"\n${focusSearchTerms ? `Search terms suggested: ${focusSearchTerms}` : ''}\nStill return the same JSON format, but weight your analysis toward answering this specific question.`
    }

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }).catch(err => {
      console.error('Anthropic API error:', err.message ?? err)
      throw new Error('AI service error: ' + (err.message ?? 'unknown'))
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No AI response')
    }

    let raw = textBlock.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')

    // Fix truncated JSON — Haiku may cut off mid-response
    let findings: Record<string, unknown>
    try {
      findings = JSON.parse(raw)
    } catch {
      // Try to salvage truncated JSON by closing open brackets
      let fixed = raw
      const openBraces = (fixed.match(/\{/g) ?? []).length
      const closeBraces = (fixed.match(/\}/g) ?? []).length
      const openBrackets = (fixed.match(/\[/g) ?? []).length
      const closeBrackets = (fixed.match(/\]/g) ?? []).length

      // Remove trailing incomplete value
      fixed = fixed.replace(/,\s*"[^"]*"?\s*:?\s*[^}\]]*$/, '')
      // Close arrays then objects
      for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']'
      for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}'

      try {
        findings = JSON.parse(fixed)
      } catch {
        // Last resort: extract what we can as plain text summary
        const summaryMatch = raw.match(/"(?:executive_summary|summary)"\s*:\s*"([^"]*)"/)
        findings = {
          executive_summary: summaryMatch?.[1] ?? raw.slice(0, 500),
          _parse_error: true,
          _raw_truncated: raw.slice(0, 1000),
        }
      }
    }

    // Update research task
    await serviceClient
      .from('deep_research')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        summary: findings.executive_summary ?? findings.summary ?? '',
        findings,
        model_used: 'claude-haiku-4-5',
        tokens_used: response.usage?.output_tokens ?? 0,
      })
      .eq('id', researchTask.id)

    // Create individual trackable leads from the findings
    const leads: Array<{ queue_type: string; priority_score: number; priority_grade: string; title: string; summary: string; details: Record<string, unknown>; related_import_ids: string[] }> = []

    // Connections → leads
    for (const conn of (findings.connections ?? []) as Array<Record<string, unknown>>) {
      if (!conn.reasoning && !conn.name) continue
      leads.push({
        queue_type: 'new_lead',
        priority_score: Math.min(100, (conn.connection_strength as number) ?? 50),
        priority_grade: ((conn.connection_strength as number) ?? 0) >= 70 ? 'high' : 'medium',
        title: `Connection: ${(record.person_name as string) ?? 'Unknown'} ↔ ${conn.name ?? 'Unknown'}`,
        summary: (conn.reasoning as string) ?? '',
        details: { type: 'research_connection', research_id: researchTask.id, ...conn },
        related_import_ids: [importRecordId],
      })
    }

    // Next steps → leads
    for (const step of (findings.next_steps ?? []) as Array<Record<string, unknown>>) {
      if (!step.action) continue
      leads.push({
        queue_type: 'new_lead',
        priority_score: step.priority === 'critical' ? 90 : step.priority === 'high' ? 75 : 50,
        priority_grade: step.priority === 'critical' || step.priority === 'high' ? 'high' : 'medium',
        title: `Action: ${(step.action as string).slice(0, 100)}`,
        summary: `${step.action}${step.rationale ? '\n\nWhy: ' + step.rationale : ''}${step.who ? '\n\nWho: ' + step.who : ''}`,
        details: { type: 'research_action', research_id: researchTask.id, ...step },
        related_import_ids: [importRecordId],
      })
    }

    // Red flags → leads
    for (const flag of (findings.red_flags ?? []) as Array<Record<string, unknown>>) {
      if (!flag.flag && !flag.description) continue
      leads.push({
        queue_type: 'new_lead',
        priority_score: flag.severity === 'critical' ? 95 : flag.severity === 'high' ? 80 : 60,
        priority_grade: flag.severity === 'critical' || flag.severity === 'high' ? 'high' : 'medium',
        title: `Red flag: ${((flag.flag ?? flag.description) as string).slice(0, 100)}`,
        summary: `${flag.flag ?? flag.description}${flag.implication ? '\n\nImplication: ' + flag.implication : ''}`,
        details: { type: 'research_red_flag', research_id: researchTask.id, ...flag },
        related_import_ids: [importRecordId],
      })
    }

    // Unanswered questions → leads
    for (const q of (findings.unanswered_questions ?? []) as string[]) {
      if (!q || typeof q !== 'string') continue
      leads.push({
        queue_type: 'new_lead',
        priority_score: 40,
        priority_grade: 'medium',
        title: `Question: ${q.slice(0, 100)}`,
        summary: q,
        details: { type: 'research_question', research_id: researchTask.id },
        related_import_ids: [importRecordId],
      })
    }

    // Insert leads into intelligence queue
    if (leads.length > 0) {
      for (const lead of leads.slice(0, 20)) { // cap at 20 leads per research
        await serviceClient.from('intelligence_queue').insert({
          ...lead,
          ai_reasoning: lead.summary,
          signal_count: 1,
          ai_confidence: 0.7,
        })
      }
    }

    return NextResponse.json({
      status: 'complete',
      summary: findings.executive_summary ?? findings.summary,
      findings,
      leads_created: Math.min(leads.length, 20),
    })

  } catch (err) {
    console.error('Deep research error:', err)

    await serviceClient
      .from('deep_research')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
      })
      .eq('id', researchTask.id)

    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: errMsg, status: 'failed', summary: 'Research failed: ' + errMsg }, { status: 500 })
  }
}

// ── Web Search via Brave ─────────────────────────────────────────────────────

interface WebResult {
  query: string
  results: Array<{ title: string; url: string; description: string }>
}

async function runWebSearch(record: Record<string, unknown>, focusTerms?: string): Promise<WebResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) return [] // no key = skip web search

  const name = record.person_name as string | null
  const state = record.state as string | null
  const city = record.city as string | null
  const dateMissing = record.date_missing as string | null

  // Build targeted search queries
  const queries: string[] = []

  // If this is a follow-up with specific search terms, use those first
  if (focusTerms) {
    queries.push(focusTerms)
    if (name) queries.push(`"${name}" ${focusTerms}`)
  }

  if (name) {
    queries.push(`"${name}" missing person`)
    if (state) queries.push(`"${name}" ${state} missing`)
  }
  if (name && dateMissing) {
    const year = dateMissing.split('-')[0]
    queries.push(`"${name}" missing ${year}`)
  }

  const results: WebResult[] = []

  for (const query of queries.slice(0, 4)) { // max 4 searches per research
    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&safesearch=off`,
        { headers: { Accept: 'application/json', 'X-Subscription-Token': key } }
      )
      if (!res.ok) continue
      const data = await res.json()
      const webResults = (data.web?.results ?? []).slice(0, 5).map((r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url,
        description: r.description,
      }))
      if (webResults.length > 0) {
        results.push({ query, results: webResults })
      }
    } catch {
      // silent — don't break research if search fails
    }
  }

  return results
}

// ── Context Gathering ────────────────────────────────────────────────────────

async function gatherResearchContext(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  record: Record<string, unknown>,
  recordId: string
) {
  // 1. Find connections
  const { data: connections } = await supabase
    .from('global_connections')
    .select('*, record_a:import_records!global_connections_record_a_id_fkey(*), record_b:import_records!global_connections_record_b_id_fkey(*)')
    .or(`record_a_id.eq.${recordId},record_b_id.eq.${recordId}`)
    .order('composite_score', { ascending: false })
    .limit(15)

  // 2. Find similar records by state and demographics (lightweight fields only)
  const { data: similar } = await supabase
    .from('import_records')
    .select('id, person_name, record_type, sex, age_text, race, state, city, date_missing, date_found, circumstances_summary, classification')
    .eq('state', record.state as string)
    .neq('id', recordId)
    .limit(15)

  // 3. Check known offenders (limit to 25 most relevant)
  const { data: offenders } = await supabase
    .from('known_offenders')
    .select('id, name, status, victim_states, operation_states, travel_corridors, victim_sex, victim_age_min, victim_age_max, victim_races, mo_keywords, disposal_method, cause_of_death, active_from, active_to, incarcerated_from, incarcerated_to')
    .limit(25)

  // 4. Intelligence queue items mentioning this record
  const { data: queueItems } = await supabase
    .from('intelligence_queue')
    .select('*')
    .contains('related_import_ids', [recordId])
    .limit(10)

  // 5. Solvability score
  const { data: solvability } = await supabase
    .from('solvability_scores')
    .select('*')
    .eq('import_record_id', recordId)
    .single()

  // 6. DOE match candidates (the real 16-signal matches)
  const submissionId = record.submission_id as string | null
  let doeMatches: unknown[] = []
  if (submissionId) {
    const isMissing = record.record_type === 'missing_person'
    const col = isMissing ? 'missing_submission_id' : 'unidentified_submission_id'
    const { data } = await supabase
      .from('doe_match_candidates')
      .select('composite_score, grade, missing_name, missing_location, missing_date, missing_marks, unidentified_location, unidentified_date, unidentified_marks, ai_assessment')
      .eq(col, submissionId)
      .order('composite_score', { ascending: false })
      .limit(10)
    doeMatches = data ?? []
  }

  // 7. Tattoo/mark matches from intelligence queue
  const { data: tattooMatches } = await supabase
    .from('intelligence_queue')
    .select('title, summary, priority_score, details')
    .eq('queue_type', 'entity_crossmatch')
    .neq('status', 'dismissed')
    .contains('related_submission_ids', submissionId ? [submissionId] : [])
    .order('priority_score', { ascending: false })
    .limit(10)

  // 8. Offender overlaps for this submission
  let offenderOverlaps: unknown[] = []
  if (submissionId) {
    const { data } = await supabase
      .from('offender_case_overlaps')
      .select('composite_score, matched_mo_keywords, ai_assessment, offender_id')
      .eq('submission_id', submissionId)
      .gte('composite_score', 65)
      .order('composite_score', { ascending: false })
      .limit(5)
    offenderOverlaps = data ?? []
  }

  return {
    connections: connections ?? [],
    similar: similar ?? [],
    offenders: offenders ?? [],
    queueItems: queueItems ?? [],
    solvability,
    doeMatches,
    tattooMatches: tattooMatches ?? [],
    offenderOverlaps,
  }
}

function buildResearchPrompt(
  record: Record<string, unknown>,
  context: {
    connections: unknown[]
    similar: unknown[]
    offenders: unknown[]
    queueItems: unknown[]
    solvability: unknown
    doeMatches: unknown[]
    tattooMatches: unknown[]
    offenderOverlaps: unknown[]
  },
  webResults: WebResult[] = [],
) {
  const isMissing = record.record_type === 'missing_person'
  const extraction = record.ai_extraction as Record<string, unknown> | null

  return `You are Threadline — a case intelligence engine built for one purpose: to see what volume hides.

You think like a seasoned homicide detective with thirty years of cold case experience, the procedural discipline of an FBI analyst, and the obsessive pattern recognition of a forensic genealogist. You do not accept the official narrative at face value. You look at what IS there, then you ask what SHOULD be there but isn't. The absence of evidence is itself evidence — of a gap in the investigation, a misclassification, or a deliberate concealment.

You are analyzing a single ${isMissing ? 'missing person' : 'unidentified remains'} case. Your job is to produce the analysis that a brilliant investigator would produce after spending a week with this case file and the full database of related cases.

## YOUR ANALYTICAL FRAMEWORK

Work through these layers in order. Each layer informs the next.

### Layer 1: What do we actually know?
Separate verified facts from assumptions. The original database entry may contain errors, outdated information, or investigator bias. A "runaway" classification from 1998 tells you what someone BELIEVED in 1998, not what actually happened. A listed age may be an estimate. A listed location may be where the report was filed, not where the event occurred. Be precise about what is established vs. assumed.

### Layer 2: What is the story of this person's last hours?
Reconstruct the timeline from every available data point. Where were they? Who were they with? What was the weather? What was the terrain? What were the roads? If they were traveling, what route would they logically take? If remains were found, how did they get there — by vehicle? on foot? dumped? Walk through it physically. Does the location make sense for the circumstances?

### Layer 3: Who benefits from this person disappearing?
This is not accusation — it is structured elimination. In cases of foul play, the perpetrator is almost always someone known to the victim. Domestic partners, family members, employers, people who owed debts or held secrets. The data won't name them directly, but circumstances, timing, and classification choices often point toward who was asking questions and who wasn't.

### Layer 4: What does the pattern tell us?
Zoom out. This case exists in a database of tens of thousands. A single disappearance from a truck stop on I-35 is a tragedy. Five disappearances from truck stops on I-35 in a three-year window is a pattern. Look for: geographic clustering, temporal clustering, victim demographic similarity, MO repetition, highway corridor patterns, and shared circumstances. A serial offender doesn't announce themselves — they hide in the noise of unconnected cases.

### Layer 5: What went wrong in the investigation?
This is the most important layer. Most cold cases aren't cold because they're unsolvable — they're cold because something went wrong early. Common failures:
- Premature classification (runaway, voluntary, suicide) that killed resources
- Jurisdiction confusion (county vs. city vs. tribal vs. federal)
- Failure to enter the case in national databases (NamUs, NCIC, ViCAP)
- No DNA collection or processing
- Witness leads that were never followed up
- Related cases in neighboring jurisdictions that were never connected
- Tunnel vision on a single theory that excluded alternatives

Identify what should have been done. Then identify what still CAN be done.

## TARGET CASE

Name: ${record.person_name ?? 'Unidentified'}
Type: ${record.record_type}
External ID: ${record.external_id}
Sex: ${record.sex ?? 'Unknown'}
Age: ${record.age_text ?? 'Unknown'}
Race: ${record.race ?? 'Unknown'}
State: ${record.state ?? 'Unknown'}
City: ${record.city ?? 'Unknown'}
Date Missing: ${record.date_missing ?? 'Unknown'}
Date Found: ${record.date_found ?? 'Unknown'}

Full extraction data:
${extraction ? JSON.stringify(extraction, null, 2) : 'No AI extraction available — work with structured fields only.'}

## DATABASE CONNECTIONS (${context.connections.length} found by automated matching)
${context.connections.length > 0 ? JSON.stringify(context.connections.slice(0, 10), null, 2) : 'None — this case has no automated connections yet. Consider why. Is it genuinely isolated, or is it missing data that would surface connections?'}

## OTHER CASES IN THIS REGION (${context.similar.length})
${context.similar.length > 0 ? JSON.stringify(context.similar.slice(0, 15).map((s: Record<string, unknown>) => ({
    name: s.person_name,
    type: s.record_type,
    sex: s.sex,
    age: s.age_text,
    race: s.race,
    state: s.state,
    city: s.city,
    date: s.date_missing ?? s.date_found,
    extraction_summary: (s.ai_extraction as Record<string, unknown>)?.summary,
    mo: (s.ai_extraction as Record<string, unknown>)?.mo_keywords,
    disposal: (s.ai_extraction as Record<string, unknown>)?.disposal_indicators,
    marks: (s.ai_extraction as Record<string, unknown>)?.distinguishing_marks,
  })), null, 2) : 'None in database for this region.'}

## KNOWN SERIAL OFFENDERS (${context.offenders.length} in database)
For each offender, consider: Did their active period overlap with this case? Did their geographic range include this area? Does their victim profile match? Does their MO match the circumstances? Be rigorous — a state overlap alone means nothing. You need 3+ independent signals before an offender flag is worth raising.
${context.offenders.length > 0 ? JSON.stringify(context.offenders.slice(0, 25).map((o: Record<string, unknown>) => ({
    name: o.name,
    status: o.status,
    victim_states: o.victim_states,
    operation_states: o.operation_states,
    travel_corridors: o.travel_corridors,
    victim_sex: o.victim_sex,
    victim_age_range: [o.victim_age_min, o.victim_age_max],
    victim_races: o.victim_races,
    mo_keywords: o.mo_keywords,
    disposal_method: o.disposal_method,
    cause_of_death: o.cause_of_death,
    active_period: [o.active_from, o.active_to],
    incarcerated: [o.incarcerated_from, o.incarcerated_to],
  })), null, 2) : 'None in database.'}

## DOE MATCH CANDIDATES (${context.doeMatches.length} from 16-signal matcher)
${context.doeMatches.length > 0 ? JSON.stringify(context.doeMatches, null, 2) : 'No DOE matches found for this case.'}

## TATTOO/MARK MATCHES (${context.tattooMatches.length})
${context.tattooMatches.length > 0 ? JSON.stringify(context.tattooMatches.map((t: Record<string, unknown>) => ({
    score: t.priority_score,
    title: t.title,
    shared_keywords: (t.details as Record<string, unknown>)?.shared_keywords,
    location_match: (t.details as Record<string, unknown>)?.location_match,
    missing_mark: (t.details as Record<string, unknown>)?.missing_mark,
    unidentified_mark: (t.details as Record<string, unknown>)?.unidentified_mark,
  })), null, 2) : 'No tattoo matches found.'}

## OFFENDER OVERLAPS FOR THIS CASE (${context.offenderOverlaps.length})
${context.offenderOverlaps.length > 0 ? JSON.stringify(context.offenderOverlaps, null, 2) : 'No offender overlaps for this case.'}

## EXISTING FLAGS ON THIS CASE (${context.queueItems.length})
${context.queueItems.length > 0 ? JSON.stringify(context.queueItems, null, 2) : 'None — no automated flags have been raised.'}

## CURRENT SOLVABILITY ASSESSMENT
${context.solvability ? JSON.stringify(context.solvability, null, 2) : 'Not yet scored.'}

${webResults.length > 0 ? `## WEB SEARCH RESULTS
We searched the web for information about this case. Here is what we found:

${webResults.map(wr => `Search: "${wr.query}"
${wr.results.map(r => `- ${r.title} (${r.url})\n  ${r.description}`).join('\n')}`).join('\n\n')}

Use these web results to enrich your analysis. Cite specific sources when referencing external information. Note any contradictions between web sources and database records.` : '## WEB SEARCH\nNo web search results available (Brave API key not configured or no relevant results found).'}

---

## YOUR OUTPUT

Produce your analysis as JSON. Be specific. Be honest. The humans reading this will act on what you write.

IMPORTANT: Keep the JSON compact. Do not write long paragraphs in each field. Be concise — 1-2 sentences per item.

{
  "executive_summary": "What happened, what was missed, what should happen next. 3-4 sentences max.",

  "connections": [
    { "name": "case or person", "reasoning": "why connected — specific evidence", "confidence": "low|medium|high" }
  ],

  "next_steps": [
    { "priority": "critical|high|medium", "action": "specific instruction", "who": "law_enforcement|family|researcher" }
  ],

  "red_flags": [
    { "flag": "what is concerning", "severity": "high|medium" }
  ],

  "unanswered_questions": ["specific questions that would break the case"],

  "classification_review": {
    "assessment": "Is the classification justified?",
    "recommendation": "what it should be if wrong"
  },

  "web_findings": [
    { "source": "url or source name", "finding": "what was found" }
  ],

  "dig_deeper": [
    { "title": "short title for the investigation", "question": "specific research question the AI would investigate next", "search_terms": "what to search for" }
  ]
}

The dig_deeper array is REQUIRED — always include exactly 3 items. Each should be a specific, actionable follow-up investigation that would yield new information about this case. Examples:
- "Search for news coverage of disappearance in local Raleigh newspapers 1985-1986"
- "Check if NamUs UP55089 tattoo matches this person's known tattoo description"
- "Search court records for restraining orders involving the stepfather"

Keep all arrays to 3-5 items max. 1-2 sentences per item.
Do NOT include fields with no data — omit them entirely (except dig_deeper which is required).
Return ONLY the JSON, no markdown fences.

CRITICAL RULES:
- Reference tattoo/mark matches from the data above in connections.
- Cite web search results in web_findings.
- Flag classification issues.
- Every sentence specific to THIS case.`
}
