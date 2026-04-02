'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Brain, ChevronDown, ChevronUp, Loader2, Search, Shield, Users, Sparkles } from 'lucide-react'

const PREVIEW_COUNT = 3

function ExpandableSection({
  items,
  renderItem,
}: {
  items: unknown[]
  renderItem: (item: unknown, index: number) => React.ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, PREVIEW_COUNT)
  const hasMore = items.length > PREVIEW_COUNT

  return (
    <>
      {visible.map((item, i) => renderItem(item, i))}
      {hasMore && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-[10px] text-indigo-600 hover:underline font-medium mt-1 flex items-center gap-0.5"
        >
          {expanded ? (
            <>Show less <ChevronUp className="h-3 w-3" /></>
          ) : (
            <>Show all {items.length} <ChevronDown className="h-3 w-3" /></>
          )}
        </button>
      )}
    </>
  )
}

// Small "Go" button for AI-actionable items
function AiGoButton({
  recordId,
  question,
  searchTerms,
  onComplete,
}: {
  recordId: string
  question: string
  searchTerms?: string
  onComplete: () => void
}) {
  const [running, setRunning] = useState(false)

  const handleGo = async () => {
    setRunning(true)
    try {
      const res = await fetch('/api/deep-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importRecordId: recordId,
          researchType: 'full',
          focusQuestion: question,
          focusSearchTerms: searchTerms,
        }),
      })
      await res.json()
      onComplete()
    } catch {
      // silent
    } finally {
      setRunning(false)
    }
  }

  return (
    <button
      onClick={handleGo}
      disabled={running}
      title="AI will investigate this"
      className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50"
    >
      {running ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="h-3 w-3" />
      )}
      {running ? 'Researching...' : 'Go'}
    </button>
  )
}

function WhoIcon({ who }: { who: string }) {
  if (who === 'law_enforcement') {
    return (
      <span title="Law enforcement action" className="flex items-center gap-0.5 text-[10px] text-slate-400">
        <Shield className="h-3 w-3" /> LE
      </span>
    )
  }
  if (who === 'family') {
    return (
      <span title="Family action" className="flex items-center gap-0.5 text-[10px] text-slate-400">
        <Users className="h-3 w-3" /> Family
      </span>
    )
  }
  if (who === 'researcher') {
    return (
      <span title="Researcher action" className="flex items-center gap-0.5 text-[10px] text-indigo-500">
        <Search className="h-3 w-3" /> Researcher
      </span>
    )
  }
  return null
}

function isAiActionable(who?: string, action?: string): boolean {
  if (who === 'researcher') return true
  if (who === 'law_enforcement' || who === 'family') return false
  if (!action) return false
  const humanKeywords = ['interview', 'obtain', 'request', 'collect', 'visit', 'contact', 'call', 'arrest', 'subpoena', 'testify', 'dna sample']
  const lower = action.toLowerCase()
  return !humanKeywords.some(k => lower.includes(k))
}

// ── Single Run Findings ─────────────────────────────────────────────────────

function RunFindings({
  findings,
  recordId,
  onResearchComplete,
}: {
  findings: Record<string, unknown>
  recordId: string
  onResearchComplete: () => void
}) {
  return (
    <div className="space-y-3">
      {/* Connections */}
      {findings.connections && (findings.connections as unknown[]).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-blue-700 mb-1">Connections Found</h4>
          <ExpandableSection
            items={findings.connections as unknown[]}
            renderItem={(item, i) => {
              const c = item as Record<string, unknown>
              const connectionName = (c.name as string) ?? 'Unknown'
              return (
                <div key={i} className="p-2 bg-blue-50 rounded mb-1 text-xs text-blue-800">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium">{connectionName}</span>
                      {c.confidence && (
                        <span className={`text-[10px] px-1 py-0.5 rounded ${
                          c.confidence === 'high' ? 'bg-blue-200 text-blue-900' :
                          c.confidence === 'medium' ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{c.confidence as string}</span>
                      )}
                    </div>
                    <AiGoButton
                      recordId={recordId}
                      question={`Investigate the connection between this case and ${connectionName}. ${c.reasoning ?? ''}`}
                      searchTerms={`"${connectionName}" missing person unidentified`}
                      onComplete={onResearchComplete}
                    />
                  </div>
                  {c.reasoning && <p className="text-blue-700 mt-0.5">{c.reasoning as string}</p>}
                </div>
              )
            }}
          />
        </div>
      )}

      {/* Next steps */}
      {findings.next_steps && (findings.next_steps as unknown[]).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-green-700 mb-1">Recommended Next Steps</h4>
          <ExpandableSection
            items={findings.next_steps as unknown[]}
            renderItem={(item, i) => {
              const s = item as Record<string, unknown>
              const action = s.action as string
              const who = s.who as string | undefined
              const canAiDo = isAiActionable(who, action)
              return (
                <div key={i} className="flex items-start gap-2 text-xs text-green-800 mb-1.5">
                  <span className="text-green-500 font-bold mt-0.5">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{action}</span>
                    {s.rationale && <p className="text-green-600 text-[10px]">{s.rationale as string}</p>}
                    {who && <div className="mt-0.5"><WhoIcon who={who} /></div>}
                  </div>
                  {canAiDo && (
                    <AiGoButton
                      recordId={recordId}
                      question={action}
                      searchTerms={action.slice(0, 100)}
                      onComplete={onResearchComplete}
                    />
                  )}
                </div>
              )
            }}
          />
        </div>
      )}

      {/* Red flags */}
      {findings.red_flags && (findings.red_flags as unknown[]).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-red-700 mb-1">Red Flags</h4>
          <ExpandableSection
            items={findings.red_flags as unknown[]}
            renderItem={(item, i) => {
              const f = item as Record<string, unknown>
              return (
                <p key={i} className="text-xs text-red-700 mb-1">
                  {(f.flag ?? f.description) as string}
                  {f.severity && <span className={`ml-1 text-[10px] ${f.severity === 'high' ? 'font-bold' : ''}`}>({f.severity as string})</span>}
                </p>
              )
            }}
          />
        </div>
      )}

      {/* Unanswered questions */}
      {findings.unanswered_questions && (findings.unanswered_questions as string[]).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-amber-700 mb-1">Unanswered Questions</h4>
          <ExpandableSection
            items={findings.unanswered_questions as unknown[]}
            renderItem={(item, i) => {
              const question = item as string
              return (
                <div key={i} className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-xs text-amber-700 flex-1">? {question}</p>
                  <AiGoButton
                    recordId={recordId}
                    question={question}
                    searchTerms={question.slice(0, 80)}
                    onComplete={onResearchComplete}
                  />
                </div>
              )
            }}
          />
        </div>
      )}

      {/* Web findings */}
      {findings.web_findings && (findings.web_findings as unknown[]).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-700 mb-1">Web Sources</h4>
          <ExpandableSection
            items={findings.web_findings as unknown[]}
            renderItem={(item, i) => {
              const w = item as Record<string, unknown>
              const source = w.source as string
              const isUrl = source?.startsWith('http')
              return (
                <div key={i} className="p-2 bg-slate-50 rounded mb-1 text-xs text-slate-700">
                  {isUrl ? (
                    <a href={source} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 hover:underline break-all">{source}</a>
                  ) : (
                    <span className="font-medium">{source}</span>
                  )}
                  {w.finding && <p className="text-slate-600 mt-0.5">{w.finding as string}</p>}
                </div>
              )
            }}
          />
        </div>
      )}

      {/* Classification review */}
      {findings.classification_review && (findings.classification_review as Record<string, unknown>)?.assessment && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded">
          <h4 className="text-xs font-semibold text-amber-800 mb-1">Classification Review</h4>
          <p className="text-xs text-amber-700">{(findings.classification_review as Record<string, unknown>).assessment as string}</p>
        </div>
      )}
    </div>
  )
}

// ── Main Card ───────────────────────────────────────────────────────────────

export function ResearchHistoryCard({ results, recordId }: { results: Array<Record<string, unknown>>; recordId: string }) {
  const router = useRouter()
  // Most recent run expanded by default, rest collapsed
  const [expandedRuns, setExpandedRuns] = useState<Record<number, boolean>>({ 0: true })

  const completedRuns = results.filter(
    r => r.status === 'complete' && r.findings && !(r.findings as Record<string, unknown>)?._parse_error
  )
  const failedOrTruncated = results.filter(
    r => r.status !== 'complete' || (r.findings as Record<string, unknown>)?._parse_error
  )

  const handleResearchComplete = () => {
    router.refresh()
  }

  const toggleRun = (index: number) => {
    setExpandedRuns(prev => ({ ...prev, [index]: !prev[index] }))
  }

  if (!completedRuns.length && !failedOrTruncated.length) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="h-4 w-4" />
          Research ({results.length} run{results.length !== 1 ? 's' : ''})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Failed/truncated badges */}
        {failedOrTruncated.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {failedOrTruncated.map((r, i) => (
              <Badge key={`fail-${i}`} variant="outline" className={`text-[10px] ${
                (r.findings as Record<string, unknown>)?._parse_error ? 'text-amber-600 border-amber-200' :
                r.status === 'running' ? 'text-blue-600 border-blue-200' :
                'text-red-600 border-red-200'
              }`}>
                {(r.findings as Record<string, unknown>)?._parse_error ? 'truncated' : r.status as string}
                {' · '}
                {new Date(r.created_at as string).toLocaleDateString()}
              </Badge>
            ))}
          </div>
        )}

        {/* Each completed run as a collapsible section */}
        {completedRuns.map((run, index) => {
          const findings = run.findings as Record<string, unknown>
          const isExpanded = expandedRuns[index] ?? false
          const summary = (run.summary ?? findings.executive_summary ?? '') as string
          const date = new Date(run.created_at as string).toLocaleDateString()
          const model = run.model_used as string

          return (
            <div key={run.id as string ?? index} className="border border-slate-200 rounded-lg overflow-hidden">
              {/* Run header */}
              <button
                onClick={() => toggleRun(index)}
                className="w-full flex items-start justify-between gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge variant="outline" className="text-[10px] text-green-600 border-green-200">
                      Run {completedRuns.length - index}
                    </Badge>
                    <span className="text-[10px] text-slate-400">{model} · {date}</span>
                  </div>
                  <p className="text-xs text-slate-700 line-clamp-2">{summary}</p>
                </div>
                <div className="flex-shrink-0 mt-1">
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </div>
              </button>

              {/* Run findings */}
              {isExpanded && (
                <div className="px-3 py-3 border-t border-slate-200">
                  <RunFindings
                    findings={findings}
                    recordId={recordId}
                    onResearchComplete={handleResearchComplete}
                  />
                </div>
              )}
            </div>
          )
        })}

        {/* Legend */}
        <div className="flex items-center gap-3 pt-1 border-t border-slate-100 text-[10px] text-slate-400">
          <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-indigo-500" /> AI can investigate</span>
          <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> Law enforcement</span>
          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> Family</span>
          <span className="flex items-center gap-1"><Search className="h-3 w-3" /> Researcher</span>
        </div>
      </CardContent>
    </Card>
  )
}
