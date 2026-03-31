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

  const { importRecordId, researchType = 'full' } = await req.json()
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

    // Run AI analysis
    const prompt = buildResearchPrompt(record, context)

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

    return NextResponse.json({
      status: 'complete',
      summary: findings.executive_summary ?? findings.summary,
      findings,
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

  return {
    connections: connections ?? [],
    similar: similar ?? [],
    offenders: offenders ?? [],
    queueItems: queueItems ?? [],
    solvability,
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
  }
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

## EXISTING FLAGS ON THIS CASE (${context.queueItems.length})
${context.queueItems.length > 0 ? JSON.stringify(context.queueItems, null, 2) : 'None — no automated flags have been raised.'}

## CURRENT SOLVABILITY ASSESSMENT
${context.solvability ? JSON.stringify(context.solvability, null, 2) : 'Not yet scored.'}

---

## YOUR OUTPUT

Produce your analysis as JSON. Be the investigator this case deserves. Be specific. Be honest about what you don't know. Name the databases, the courthouses, the newspaper archives. If you think the classification is wrong, say so and say why. If you think there's a connection to another case, explain the chain of reasoning — don't just cite demographic overlap.

Every assertion needs a confidence tag. "High" means the evidence directly supports it. "Medium" means it's a reasonable inference from available data. "Low" means it's a possibility worth checking but could easily be wrong. If something is speculative, label it speculative. The humans reading this will act on what you write. Do not give them false confidence.

{
  "executive_summary": "The single most important paragraph about this case. What happened? What was missed? What should happen next? Write this as if briefing a detective who has 60 seconds.",

  "known_facts": [
    "List ONLY what is established. Separate fact from assumption. If the database says 'runaway' that is a CLASSIFICATION, not a fact."
  ],

  "working_theory": {
    "primary": "The most plausible explanation given all available evidence. State your reasoning.",
    "alternative": "The explanation that would be true if your primary theory is wrong. Investigators who only pursue one theory miss the truth.",
    "confidence": "low|medium|high"
  },

  "timeline_reconstruction": [
    {
      "date": "YYYY-MM-DD or best estimate",
      "time_of_day": "morning|afternoon|evening|night|unknown",
      "event": "What happened, as specifically as possible",
      "source": "Where this information comes from",
      "confidence": "low|medium|high",
      "gaps": "What's missing between this event and the next? How long is the gap? What should have happened in that gap?"
    }
  ],

  "connections": [
    {
      "name": "Connected case or person",
      "record_id": "UUID if available, null otherwise",
      "connection_strength": 0-100,
      "reasoning": "The specific chain of logic connecting these cases. Not 'both female' — that's noise. What is the actual thread?",
      "independent_signals": ["list each signal that independently supports this connection"],
      "confidence": "low|medium|high",
      "what_would_confirm": "What single piece of evidence would confirm or eliminate this connection?"
    }
  ],

  "offender_analysis": [
    {
      "offender_name": "Name",
      "overlap_strength": 0-100,
      "reasoning": "Detailed reasoning — why this offender, specifically? Walk through their MO, geography, victim profile, timeline.",
      "matching_signals": ["Each matching signal with explanation"],
      "contradicting_signals": ["Each signal that argues AGAINST this match — be honest"],
      "temporal_feasibility": "Was this offender active and free during the relevant period?",
      "confidence": "low|medium|high"
    }
  ],

  "geographic_analysis": {
    "primary_location_significance": "What is significant about where this person was last seen or found? What's nearby? What routes pass through?",
    "corridor_patterns": ["Any highway or travel route patterns involving this and other cases"],
    "terrain_analysis": "If remains: why this specific location? Accessible by vehicle? Remote? Visible from road? Near water?",
    "jurisdiction_note": "Which law enforcement agency has jurisdiction? Are there overlapping jurisdictions that could cause confusion?"
  },

  "classification_review": {
    "current_classification": "What the case is currently classified as",
    "assessment": "Is this classification justified by the evidence? Or was it a convenience?",
    "reclassification_recommended": true/false,
    "recommended_classification": "What it should be, if different",
    "reasoning": "Why the current classification may be wrong — specific evidence"
  },

  "investigative_failures": [
    {
      "failure": "What specifically was not done",
      "impact": "How this failure affected the case",
      "still_recoverable": true/false,
      "recovery_action": "What can still be done to compensate for this failure"
    }
  ],

  "next_steps": [
    {
      "priority": "critical|high|medium|low",
      "action": "Specific, actionable instruction. Name the database. Name the courthouse. Name the type of record.",
      "rationale": "Why this specific action, and what it could reveal",
      "who": "law_enforcement|family|nonprofit|researcher|medical_examiner|journalist",
      "estimated_difficulty": "simple|moderate|requires_authorization",
      "potential_yield": "What finding this information could unlock"
    }
  ],

  "red_flags": [
    {
      "flag": "What is concerning",
      "severity": "critical|high|medium",
      "evidence": "The specific data points that triggered this flag",
      "implication": "What this could mean if true"
    }
  ],

  "public_records_strategy": [
    {
      "source": "Specific database, archive, or record type (e.g., 'Rappahannock County Circuit Court records 1998-2002', 'Newspapers.com for Roanoke Times coverage', 'Virginia Unclaimed Property database')",
      "what_to_search": "Exact search terms or criteria",
      "what_you_might_find": "What a hit would mean for the case"
    }
  ],

  "unanswered_questions": [
    "The specific questions that, if answered, would break this case open. Frame them as questions an investigator would ask."
  ],

  "solvability_assessment": {
    "score": 0-100,
    "grade": "high|moderate|low|uncertain",
    "reasoning": "What makes this case solvable or unsolvable? Be honest.",
    "best_chance": "The single most promising avenue for resolution",
    "biggest_obstacle": "The single biggest thing standing in the way"
  }
}

CRITICAL RULES:
- You are not writing a summary. You are conducting an investigation. Push on every detail.
- When you see "voluntary" or "runaway" for a minor, treat it with extreme skepticism. Question who made that classification and why.
- When you see remains found near a highway, check which offenders operated that corridor.
- When you see a gap in the timeline, ask what filled that gap. Silence is a signal.
- When you see a case with no DNA processing after 2000, flag it. That is a recoverable failure.
- When you see similar cases in the same region and timeframe, name them explicitly. Do not just say "there are similar cases."
- Do not pad your analysis with generic observations. Every sentence should contain information specific to THIS case.
- If you don't have enough data to analyze something, say so directly rather than filling space with speculation.
- Return only the JSON object, no markdown fences.`
}
