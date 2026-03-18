import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 120 // Vercel Pro allows up to 300s; this gives the loop room to breathe

const MAX_ROUNDS = 3          // max iterations of the search loop
const QUERIES_PER_ROUND = 5   // initial round
const FOLLOWUPS_PER_ROUND = 3 // follow-up rounds

interface SearchResult {
  title: string
  url: string
  description: string
}

interface ResearchStep {
  round: number
  step: number
  query: string
  finding: string
  confidence: string
  source: string
  dead_end: boolean
  is_followup: boolean
  followup_reason?: string
}

// Extract the first valid JSON object from a Claude response string.
// Handles markdown code blocks, preamble text, and unbalanced stray braces.
function extractJson(text: string): unknown {
  // 1. Try markdown code block first
  const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (mdMatch) {
    try { return JSON.parse(mdMatch[1].trim()) } catch {}
  }
  // 2. Find the first `{"` or `{ "` — start of a real JSON object
  const start = text.search(/\{\s*"/)
  if (start === -1) throw new Error('No JSON object found in response')
  // 3. Walk forward counting balanced braces
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1))
      }
    }
  }
  throw new Error('Unbalanced JSON in response')
}

// Run all queries in a single round concurrently
async function runSearchRound(queries: string[]): Promise<Map<string, SearchResult[]>> {
  const results = await Promise.all(queries.map(q => searchWeb(q)))
  const map = new Map<string, SearchResult[]>()
  queries.forEach((q, i) => map.set(q, results[i]))
  return map
}

async function searchWeb(query: string): Promise<SearchResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) return []
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&safesearch=off`,
      { headers: { Accept: 'application/json', 'X-Subscription-Token': key } }
    )
    const data = await res.json()
    return (data.web?.results ?? []).map((r: { title: string; url: string; description: string }) => ({
      title: r.title,
      url: r.url,
      description: r.description,
    }))
  } catch {
    return []
  }
}

function formatResultsForPrompt(resultsMap: Map<string, SearchResult[]>): string {
  const parts: string[] = []
  for (const [query, results] of resultsMap) {
    if (results.length === 0) {
      parts.push(`SEARCH: "${query}"\n→ No results`)
    } else {
      parts.push(
        `SEARCH: "${query}"\n` +
        results.map(r => `  • ${r.title}\n    ${r.url}\n    ${r.description}`).join('\n')
      )
    }
  }
  return parts.join('\n\n')
}

interface ResearchTask {
  id: string
  case_id: string
  question: string
  context: string | null
  status: string
  started_at: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params

  // Fail fast if the Anthropic API key isn't configured
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[research/run] ANTHROPIC_API_KEY is not set in environment')
    return NextResponse.json({ error: 'AI service not configured — ANTHROPIC_API_KEY missing' }, { status: 503 })
  }

  // Create client inside the handler so a missing key never crashes the module
  const anthropic = new Anthropic({ apiKey, timeout: 60_000 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const deep = body?.deep === true

  const { data: rawTask } = await supabase
    .from('research_tasks')
    .select('*')
    .eq('id', taskId)
    .single()

  const task = rawTask as ResearchTask | null

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (task.status === 'running') return NextResponse.json({ error: 'Already running' }, { status: 409 })
  if (!['queued', 'failed', 'complete', 'awaiting_review'].includes(task.status)) {
    return NextResponse.json({ error: 'Cannot run task in current state' }, { status: 409 })
  }

  const { data: rawRole } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', task.case_id)
    .eq('user_id', user.id)
    .single()
  const roleData = rawRole as { role: string } | null
  if (!roleData || !['lead_investigator', 'admin'].includes(roleData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await supabase
    .from('research_tasks')
    .update({ status: 'running', started_at: new Date().toISOString() } as never)
    .eq('id', taskId)

  // ── Fetch case context ──────────────────────────────────────────────────────

  const [caseRes, claimsRes, entitiesRes] = await Promise.all([
    supabase.from('cases').select('title, case_type, jurisdiction, notes').eq('id', task.case_id).single(),
    supabase
      .from('claims')
      .select('extracted_text, claim_type, verification_status, submissions!inner(case_id)')
      .eq('submissions.case_id', task.case_id)
      .in('verification_status', ['corroborated', 'confirmed'])
      .limit(40),
    supabase
      .from('entities')
      .select('entity_type, raw_value, normalized_value, notes')
      .eq('case_id', task.case_id)
      .neq('review_state', 'retracted')
      .limit(30),
  ])

  const caseData = caseRes.data as { title: string; case_type: string; jurisdiction: string | null; notes: string | null } | null
  const claims = (claimsRes.data ?? []) as Array<{ claim_type: string; extracted_text: string }>
  const entities = (entitiesRes.data ?? []) as Array<{ entity_type: string; raw_value: string; normalized_value: string | null; notes: string | null }>

  const caseContext = `CASE: ${caseData?.title ?? 'Unknown'}
CASE TYPE: ${caseData?.case_type ?? 'Unknown'}
JURISDICTION: ${caseData?.jurisdiction ?? 'Unknown'}

CONFIRMED CASE FACTS:
${claims.slice(0, 20).map(c => `• (${c.claim_type}) ${c.extracted_text}`).join('\n') || 'None'}

ENTITIES OF INTEREST:
${entities.slice(0, 15).map(e => `• ${e.entity_type}: ${e.normalized_value || e.raw_value}${e.notes ? ` — ${e.notes}` : ''}`).join('\n') || 'None'}

RESEARCH QUESTION: ${task.question}
${task.context ? `ADDITIONAL CONTEXT: ${task.context}` : ''}`

  // ── Fast mode (single Sonnet call — thorough reasoning from training knowledge) ─

  if (!deep) {
    let findings = null
    let humanNextSteps: unknown[] = []
    let confidenceSummary = ''
    const researchLog = [{ round: 1, step: 1, query: task.question, finding: 'Synthesised from case data and training knowledge', confidence: 'medium', source: 'training_knowledge', dead_end: false, is_followup: false }]
    const sourcesConsulted = [{ name: 'Case records + AI training knowledge', url: null, type: 'training_knowledge', relevance: task.question }]

    try {
      const resp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', // Fast mode: Haiku completes in ~15s vs Sonnet's 60-90s
        max_tokens: 2048,
        tools: [{
          name: 'submit_research_findings',
          description: 'Submit structured research findings for this investigative question',
          input_schema: {
            type: 'object' as const,
            properties: {
              confirmed: { type: 'array', items: { type: 'string' }, description: '3–6 items max. Each item: one sentence stating the fact plus its source (archive, record group, publication, or training knowledge).' },
              probable: { type: 'array', items: { type: 'string' }, description: '2–4 items max. Each item: one sentence stating the inference plus what would confirm it.' },
              unresolvable_without_human: { type: 'array', items: { type: 'string' }, description: '2–4 items max. Each item: one sentence naming the specific gap and the exact action needed.' },
              human_next_steps: {
                type: 'array',
                description: '3–5 items max, ranked by priority.',
                items: {
                  type: 'object',
                  properties: {
                    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                    action: { type: 'string', description: 'One sentence — specific enough to act on today.' },
                    target: { type: 'string', description: 'Exact institution, record group, database, URL, or contact.' },
                    rationale: { type: 'string', description: 'One sentence — what this could unlock.' },
                  },
                  required: ['priority', 'action', 'target', 'rationale'],
                },
              },
              follow_up_questions: { type: 'array', items: { type: 'string' }, description: '2–4 items max. Specific new questions this research opened.' },
              confidence_summary: { type: 'string', description: '2–3 sentences max: what is established, the key remaining gap, the single highest-priority next action.' },
            },
            required: ['confirmed', 'probable', 'unresolvable_without_human', 'human_next_steps', 'follow_up_questions', 'confidence_summary'],
          },
        }],
        tool_choice: { type: 'tool', name: 'submit_research_findings' },
        messages: [{
          role: 'user',
          content: `You are an investigative research analyst working cold cases. Be specific and actionable — name exact archives, record groups, databases, and contacts. Do not pad responses.

${caseContext}

RESEARCH QUESTION: ${task.question}
${task.context ? `ADDITIONAL CONTEXT: ${task.context}` : ''}

RULES:
- Confirmed: only facts you can source (name the source)
- Probable: reasonable inference (say what would confirm it)
- Unresolvable: gaps only a human can close (say exactly what to do)
- Next steps: specific enough to act on today — name the exact record group, FOIA office, or database
- Never fabricate sources; flag uncertainty explicitly`,
        }],
      })
      const toolUse = resp.content.find(b => b.type === 'tool_use')
      if (toolUse?.type === 'tool_use') {
        const input = toolUse.input as {
          confirmed?: string[]
          probable?: string[]
          unresolvable_without_human?: string[]
          human_next_steps?: unknown[]
          follow_up_questions?: string[]
          confidence_summary?: string
        }
        findings = {
          confirmed: input.confirmed ?? [],
          probable: input.probable ?? [],
          unresolvable_without_human: input.unresolvable_without_human ?? [],
          follow_up_questions: input.follow_up_questions ?? [],
        }
        humanNextSteps = input.human_next_steps ?? []
        confidenceSummary = input.confidence_summary ?? (resp.stop_reason === 'max_tokens' ? '[Response was cut off — findings above are partial. Re-run to get full results.]' : '')
      }
    } catch (err) {
      console.error('[research/run] Fast research error:', err)
      confidenceSummary = 'Research failed. Try again or use Dig Deeper.'
    }

    const { data: updated, error: updateErr } = await supabase
      .from('research_tasks')
      .update({ status: 'awaiting_review', research_log: researchLog, findings, human_next_steps: humanNextSteps, sources_consulted: sourcesConsulted, confidence_summary: confidenceSummary, completed_at: new Date().toISOString() } as never)
      .eq('id', taskId)
      .select()
      .single()

    if (updateErr) {
      console.error('Save error:', updateErr)
      return NextResponse.json({ error: 'Failed to save results' }, { status: 500 })
    }

    return NextResponse.json({ task: updated })
  }

  // ── Deep mode (agentic loop — requires Vercel Pro / maxDuration = 120) ───────

  const researchLog: ResearchStep[] = []
  const sourcesConsulted: Array<{ name: string; url: string | null; type: string; relevance: string }> = []
  const allResultsText: string[] = []
  let stepCounter = 0

  // Round 0: generate initial queries
  let currentQueries: string[] = []
  try {
    const planResp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You are an investigative research assistant. Generate the ${QUERIES_PER_ROUND} most targeted web search queries for this research question. Think beyond the obvious — include lateral angles, adjacent topics, and unexpected connections that a thorough investigator would pursue.

${caseContext}

Return ONLY a JSON array of ${QUERIES_PER_ROUND} search query strings. Most specific and unusual first — don't start with the obvious. No markdown.`,
      }],
    })
    const block = planResp.content.find(b => b.type === 'text')
    if (block?.type === 'text') {
      currentQueries = extractJson(block.text) as string[]
    }
  } catch {
    currentQueries = [task.question]
  }

  // Loop: run queries in parallel, then ask Claude what to follow up
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (!currentQueries.length) break

    // Run this round's queries in parallel
    const roundResults = await runSearchRound(currentQueries)

    // Log results
    for (const [query, results] of roundResults) {
      stepCounter++
      const deadEnd = results.length === 0

      for (const r of results) {
        if (!sourcesConsulted.find(s => s.url === r.url)) {
          sourcesConsulted.push({ name: r.title, url: r.url, type: 'web', relevance: query })
        }
      }

      researchLog.push({
        round,
        step: stepCounter,
        query,
        finding: deadEnd ? 'No results' : results.map(r => r.title).join(' · '),
        confidence: deadEnd ? 'low' : 'medium',
        source: results[0]?.url ?? 'web_search',
        dead_end: deadEnd,
        is_followup: round > 1,
      })
    }

    const roundText = formatResultsForPrompt(roundResults)
    allResultsText.push(`=== ROUND ${round} ===\n${roundText}`)

    // Last round — no more follow-ups, go straight to synthesis
    if (round === MAX_ROUNDS) break

    // Ask Claude: given what we found, what should we follow up on?
    try {
      const followupResp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You are an investigative research assistant. You just ran a round of searches. Review the results and decide if any threads are worth following up.

${caseContext}

SEARCH RESULTS THIS ROUND:
${roundText}

ALL RESULTS SO FAR:
${allResultsText.join('\n\n')}

INSTRUCTIONS:
- Look for unexpected details, partial matches, tangential leads, or anything that surfaced a new angle
- If a result mentions something surprising — a name, a location, a date, a program, an institution — that could be relevant, chase it
- Do NOT repeat queries already run
- If nothing new and promising surfaced, return an empty array

Already searched: ${[...roundResults.keys()].join(', ')}

Return a JSON object:
{
  "follow_ups": [
    { "query": "search query string", "reason": "one sentence on why this thread is worth following" }
  ]
}

Maximum ${FOLLOWUPS_PER_ROUND} follow-ups. If nothing genuinely new surfaced, return { "follow_ups": [] }. No markdown.`,
        }],
      })

      const block = followupResp.content.find(b => b.type === 'text')
      if (block?.type === 'text') {
        const parsed = extractJson(block.text) as Record<string, unknown>
        const followUps: Array<{ query: string; reason: string }> = (parsed.follow_ups as Array<{ query: string; reason: string }>) ?? []

        if (followUps.length === 0) break // Claude says we're done

        currentQueries = followUps.map(f => f.query)

        // Annotate the log with why we're following up
        for (const f of followUps) {
          researchLog
            .filter(l => l.query === f.query)
            .forEach(l => { l.followup_reason = f.reason })
        }
      } else {
        break
      }
    } catch {
      break // If follow-up generation fails, move to synthesis
    }
  }

  // ── Synthesis ───────────────────────────────────────────────────────────────

  const roundsRun = researchLog.length > 0 ? Math.max(...researchLog.map(l => l.round)) : 1
  const synthesisPrompt = `You are an investigative research assistant working on a cold case. You have now completed ${roundsRun} round(s) of research, including follow-up threads on unexpected leads. Synthesize everything into a structured report.

${caseContext}

ALL SEARCH RESULTS (${researchLog.length} queries across ${roundsRun} rounds):
${allResultsText.join('\n\n')}

INSTRUCTIONS — be obsessive:
1. Synthesize EVERYTHING — training knowledge + all search results. Do not stop at surface facts.
2. Be ruthlessly specific. Not "military records may exist" but "NARA RG 92, Entry 1930, Army laundry contract records for Virginia installations 1945–1953."
3. Clearly distinguish: confirmed (sourced) vs. probable (reasoned inference) vs. unresolvable without human action.
4. Cite every finding to its exact source (URL, or specific archive/training knowledge reference).
5. Surface follow-up questions — every thread this research opened that deserves its own investigation.
6. Human next steps must be specific enough to act on TODAY. Include exact record groups, FOIA language, database names, contact addresses where known.
7. NEVER fabricate sources. Flag uncertainty where it exists.

Return JSON only (no preamble, no markdown):
{
  "research_log": [
    { "step": 1, "query": "investigated", "finding": "found or not found", "confidence": "high|medium|low", "source": "URL or training knowledge", "dead_end": false }
  ],
  "findings": {
    "confirmed": ["specific fact — exact source"],
    "probable": ["inference — reasoning and what would confirm it"],
    "unresolvable_without_human": ["specific gap — what a human must do to resolve it"]
  },
  "sources_consulted": [
    { "name": "...", "url": "URL or null", "type": "archive|database|publication|web|training_knowledge", "relevance": "..." }
  ],
  "human_next_steps": [
    { "priority": "high|medium|low", "action": "specific action with enough detail to act on", "target": "exact institution/record group/database/person", "rationale": "what this could unlock" }
  ],
  "follow_up_questions": [
    "Specific question this research raised that warrants its own investigation"
  ],
  "confidence_summary": "2-3 sentences: what is now established, the key remaining uncertainty, the single highest-priority next action"
}`

  let findings = null
  let humanNextSteps: unknown[] = []
  let confidenceSummary = ''

  try {
    const synthResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      tools: [{
        name: 'submit_synthesis',
        description: 'Submit the final synthesized research report',
        input_schema: {
          type: 'object' as const,
          properties: {
            confirmed: { type: 'array', items: { type: 'string' } },
            probable: { type: 'array', items: { type: 'string' } },
            unresolvable_without_human: { type: 'array', items: { type: 'string' } },
            human_next_steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                  action: { type: 'string' },
                  target: { type: 'string' },
                  rationale: { type: 'string' },
                },
                required: ['priority', 'action', 'target', 'rationale'],
              },
            },
            follow_up_questions: { type: 'array', items: { type: 'string' } },
            sources_consulted: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  url: { type: 'string' },
                  type: { type: 'string' },
                  relevance: { type: 'string' },
                },
                required: ['name', 'type', 'relevance'],
              },
            },
            confidence_summary: { type: 'string' },
          },
          required: ['confirmed', 'probable', 'unresolvable_without_human', 'human_next_steps', 'follow_up_questions', 'confidence_summary'],
        },
      }],
      tool_choice: { type: 'tool', name: 'submit_synthesis' },
      messages: [{ role: 'user', content: synthesisPrompt }],
    })
    const toolUse = synthResp.content.find(b => b.type === 'tool_use')
    if (toolUse?.type === 'tool_use') {
      const input = toolUse.input as {
        confirmed: string[]
        probable: string[]
        unresolvable_without_human: string[]
        human_next_steps: unknown[]
        follow_up_questions: string[]
        sources_consulted?: Array<{ name: string; url?: string; type: string; relevance: string }>
        confidence_summary: string
      }
      findings = {
        confirmed: input.confirmed ?? [],
        probable: input.probable ?? [],
        unresolvable_without_human: input.unresolvable_without_human ?? [],
        follow_up_questions: input.follow_up_questions ?? [],
      }
      humanNextSteps = input.human_next_steps ?? []
      confidenceSummary = input.confidence_summary ?? ''
      if (input.sources_consulted?.length) {
        for (const s of input.sources_consulted) {
          if (!sourcesConsulted.find(sc => sc.url === s.url && sc.name === s.name)) {
            sourcesConsulted.push({ name: s.name, url: s.url ?? null, type: s.type, relevance: s.relevance })
          }
        }
      }
    }
  } catch (err) {
    console.error('Synthesis error:', err)
    confidenceSummary = 'Synthesis step failed. Search log preserved below.'
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  const { data: updated, error: updateErr } = await supabase
    .from('research_tasks')
    .update({
      status: 'awaiting_review',
      research_log: researchLog,
      findings,
      human_next_steps: humanNextSteps,
      sources_consulted: sourcesConsulted,
      confidence_summary: confidenceSummary,
      completed_at: new Date().toISOString(),
    } as never)
    .eq('id', taskId)
    .select()
    .single()

  if (updateErr) {
    console.error('Save error:', updateErr)
    return NextResponse.json({ error: 'Failed to save results' }, { status: 500 })
  }

  // Audit log — non-blocking, failure here must not break the response
  supabase.from('review_actions').insert({
    actor_id: user.id,
    action: 'research_completed',
    target_type: 'case',
    target_id: task.case_id,
    case_id: task.case_id,
    note: `Research completed: "${task.question}". ${researchLog.length} queries across ${roundsRun} rounds. Sources: ${sourcesConsulted.length}. Next steps: ${humanNextSteps.length}.`,
  } as never).then(({ error }: { error: { message: string } | null }) => { if (error) console.warn('Audit log failed:', error.message) })

  return NextResponse.json({ task: updated })
}
