import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface SearchResult {
  title: string
  url: string
  description: string
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

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: task } = await supabase
    .from('research_tasks')
    .select('*')
    .eq('id', taskId)
    .single()

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (task.status === 'running') return NextResponse.json({ error: 'Already running' }, { status: 409 })

  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', task.case_id)
    .eq('user_id', user.id)
    .single()
  if (!roleData || !['lead_investigator', 'admin'].includes(roleData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Mark running
  await supabase
    .from('research_tasks')
    .update({ status: 'running', started_at: new Date().toISOString() })
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

  const caseData = caseRes.data
  const claims = claimsRes.data ?? []
  const entities = entitiesRes.data ?? []

  // ── Phase 1: Generate search queries ────────────────────────────────────────

  const planPrompt = `You are an investigative research assistant. Given the research question and case context, generate the 5 most targeted web search queries that would surface relevant public information.

CASE: ${caseData?.title ?? 'Unknown'}
CASE TYPE: ${caseData?.case_type ?? 'Unknown'}
JURISDICTION: ${caseData?.jurisdiction ?? 'Unknown'}

CONFIRMED CASE FACTS:
${claims.slice(0, 20).map(c => `• ${c.extracted_text}`).join('\n') || 'None available'}

KEY ENTITIES:
${entities.slice(0, 15).map(e => `• ${e.entity_type}: ${e.normalized_value || e.raw_value}`).join('\n') || 'None'}

RESEARCH QUESTION: ${task.question}
${task.context ? `ADDITIONAL CONTEXT: ${task.context}` : ''}

Return ONLY a JSON array of 5 search query strings, most specific first. No markdown.`

  let searchQueries: string[] = []
  try {
    const planResp = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: planPrompt }],
    })
    const block = planResp.content.find(b => b.type === 'text')
    if (block?.type === 'text') {
      const raw = block.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
      searchQueries = JSON.parse(raw)
    }
  } catch {
    searchQueries = [task.question]
  }

  // ── Phase 2: Execute searches ───────────────────────────────────────────────

  const researchLog: Array<{
    step: number
    query: string
    finding: string
    confidence: string
    source: string
    dead_end: boolean
  }> = []

  const sourcesConsulted: Array<{ name: string; url: string; type: string; relevance: string }> = []

  const searchSummaries: string[] = []

  for (let i = 0; i < searchQueries.length; i++) {
    const query = searchQueries[i]
    const results = await searchWeb(query)

    if (results.length === 0) {
      researchLog.push({
        step: i + 1,
        query,
        finding: 'No web search results (search unavailable or no results)',
        confidence: 'low',
        source: 'web_search',
        dead_end: true,
      })
      continue
    }

    for (const r of results) {
      sourcesConsulted.push({ name: r.title, url: r.url, type: 'web', relevance: query })
    }

    const resultText = results.map(r => `Title: ${r.title}\nURL: ${r.url}\nSummary: ${r.description}`).join('\n\n')
    searchSummaries.push(`SEARCH: "${query}"\n${resultText}`)

    researchLog.push({
      step: i + 1,
      query,
      finding: results.map(r => r.title).join('; '),
      confidence: 'medium',
      source: results[0]?.url ?? 'web_search',
      dead_end: false,
    })
  }

  // ── Phase 3: Synthesize ─────────────────────────────────────────────────────

  const synthesisPrompt = `You are an investigative research assistant working on a cold case. Synthesize all available information into a structured research report.

CASE: ${caseData?.title ?? 'Unknown'}
RESEARCH QUESTION: ${task.question}
${task.context ? `CONTEXT: ${task.context}` : ''}

CONFIRMED CASE FACTS:
${claims.slice(0, 20).map(c => `• (${c.claim_type}) ${c.extracted_text}`).join('\n') || 'None'}

ENTITIES OF INTEREST:
${entities.slice(0, 15).map(e => `• ${e.entity_type}: ${e.normalized_value || e.raw_value}${e.notes ? ` — ${e.notes}` : ''}`).join('\n') || 'None'}

WEB SEARCH RESULTS:
${searchSummaries.join('\n\n---\n\n') || 'No web search results were available. Use your training knowledge only.'}

INSTRUCTIONS:
1. Work through EVERYTHING you know about this question — training knowledge + search results
2. Distinguish clearly: confirmed facts vs. strong inferences vs. speculation
3. For each finding, cite the source (URL, archive, database, or "training knowledge")
4. Track dead ends explicitly
5. Human next steps must be SPECIFIC and actionable — not "contact authorities" but "Submit FOIA request to National Archives, Record Group 92 (Office of the Quartermaster General), requesting Korean War-era Army laundry contract records"
6. NEVER fabricate sources or present inference as confirmed fact

Return JSON (no markdown):
{
  "research_log": [
    { "step": 1, "query": "what I investigated", "finding": "what I found or didn't find", "confidence": "high|medium|low", "source": "URL or 'training knowledge' or 'web search'", "dead_end": false }
  ],
  "findings": {
    "confirmed": ["specific confirmed fact with source"],
    "probable": ["inference with reasoning"],
    "unresolvable_without_human": ["specific gap that requires human action"]
  },
  "sources_consulted": [
    { "name": "source name", "url": "URL or null", "type": "archive|database|publication|web|training_knowledge", "relevance": "why consulted" }
  ],
  "human_next_steps": [
    { "priority": "high|medium|low", "action": "specific action", "target": "specific institution, person, or database", "rationale": "why this step" }
  ],
  "confidence_summary": "2-3 sentence overall assessment of what is known, what is uncertain, and what the most promising next step is"
}`

  let findings = null
  let humanNextSteps: unknown[] = []
  let confidenceSummary = ''
  const fullLog = [...researchLog]

  try {
    const synthResp = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: synthesisPrompt }],
    })
    const block = synthResp.content.find(b => b.type === 'text')
    if (block?.type === 'text') {
      const raw = block.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
      const parsed = JSON.parse(raw)
      findings = parsed.findings ?? null
      humanNextSteps = parsed.human_next_steps ?? []
      confidenceSummary = parsed.confidence_summary ?? ''
      // Merge research logs
      if (parsed.research_log?.length) {
        for (const step of parsed.research_log) {
          if (!fullLog.find(l => l.step === step.step)) fullLog.push(step)
        }
      }
      // Merge sources
      if (parsed.sources_consulted?.length) {
        for (const s of parsed.sources_consulted) {
          if (!sourcesConsulted.find(sc => sc.url === s.url && sc.name === s.name)) {
            sourcesConsulted.push(s)
          }
        }
      }
    }
  } catch (err) {
    console.error('Synthesis error:', err)
    await supabase
      .from('research_tasks')
      .update({ status: 'failed', error_message: 'Synthesis failed', completed_at: new Date().toISOString() })
      .eq('id', taskId)
    return NextResponse.json({ error: 'Research synthesis failed' }, { status: 500 })
  }

  // ── Save results ────────────────────────────────────────────────────────────

  const { data: updated, error: updateErr } = await supabase
    .from('research_tasks')
    .update({
      status: 'awaiting_review',
      research_log: fullLog,
      findings,
      human_next_steps: humanNextSteps,
      sources_consulted: sourcesConsulted,
      confidence_summary: confidenceSummary,
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: 'Failed to save results' }, { status: 500 })
  }

  // Audit log
  await supabase.from('review_actions').insert({
    actor_id: user.id,
    action: 'research_completed',
    target_type: 'case',
    target_id: task.case_id,
    case_id: task.case_id,
    note: `Research task completed: "${task.question}". Sources: ${sourcesConsulted.length}. Next steps: ${humanNextSteps.length}.`,
  })

  return NextResponse.json({ task: updated })
}
