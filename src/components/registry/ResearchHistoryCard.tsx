'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Brain, ChevronDown, ChevronUp } from 'lucide-react'

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

export function ResearchHistoryCard({ results }: { results: Array<Record<string, unknown>> }) {
  const [showAllRuns, setShowAllRuns] = useState(false)

  const completed = results.filter(r => r.status === 'complete' && r.findings && !(r.findings as Record<string, unknown>)?._parse_error)
  const latest = completed[0] ?? results.find(r => r.status === 'complete') ?? results[0]
  const findings = latest?.findings as Record<string, unknown> | undefined

  const visibleRuns = showAllRuns ? results : results.slice(0, 5)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="h-4 w-4" />
          Research ({results.length} run{results.length !== 1 ? 's' : ''})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Run status summary */}
        <div className="flex gap-1 flex-wrap">
          {visibleRuns.map((r, i) => (
            <Badge key={i} variant="outline" className={`text-[10px] ${
              r.status === 'complete' && !(r.findings as Record<string, unknown>)?._parse_error ? 'text-green-600 border-green-200' :
              r.status === 'complete' ? 'text-amber-600 border-amber-200' :
              r.status === 'running' ? 'text-blue-600 border-blue-200' :
              'text-red-600 border-red-200'
            }`}>
              {r.status === 'complete' && (r.findings as Record<string, unknown>)?._parse_error ? 'truncated' : r.status as string}
              {' · '}
              {new Date(r.created_at as string).toLocaleDateString()}
            </Badge>
          ))}
          {results.length > 5 && (
            <button
              onClick={() => setShowAllRuns(v => !v)}
              className="text-[10px] text-indigo-600 hover:underline font-medium"
            >
              {showAllRuns ? 'Show less' : `+${results.length - 5} more`}
            </button>
          )}
        </div>

        {/* Summary */}
        {latest?.summary && (
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
            <p className="text-xs text-indigo-900 leading-relaxed">{latest.summary as string}</p>
            <div className="text-[10px] text-indigo-500 mt-2">
              {latest.model_used as string} · {new Date(latest.created_at as string).toLocaleDateString()}
            </div>
          </div>
        )}

        {/* Connections found */}
        {findings?.connections && (findings.connections as unknown[]).length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-blue-700 mb-1">Connections Found</h4>
            <ExpandableSection
              items={findings.connections as unknown[]}
              renderItem={(item, i) => {
                const c = item as Record<string, unknown>
                return (
                  <div key={i} className="p-2 bg-blue-50 rounded mb-1 text-xs text-blue-800">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name as string ?? 'Unknown'}</span>
                      {c.confidence && (
                        <span className={`text-[10px] px-1 py-0.5 rounded ${
                          c.confidence === 'high' ? 'bg-blue-200 text-blue-900' :
                          c.confidence === 'medium' ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{c.confidence as string}</span>
                      )}
                    </div>
                    {c.reasoning && <p className="text-blue-700 mt-0.5">{c.reasoning as string}</p>}
                  </div>
                )
              }}
            />
          </div>
        )}

        {/* Next steps */}
        {findings?.next_steps && (findings.next_steps as unknown[]).length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-green-700 mb-1">Recommended Next Steps</h4>
            <ExpandableSection
              items={findings.next_steps as unknown[]}
              renderItem={(item, i) => {
                const s = item as Record<string, unknown>
                return (
                  <div key={i} className="flex items-start gap-2 text-xs text-green-800 mb-1">
                    <span className="text-green-500 font-bold mt-0.5">{i + 1}.</span>
                    <div>
                      <span className="font-medium">{s.action as string}</span>
                      {s.rationale && <p className="text-green-600 text-[10px]">{s.rationale as string}</p>}
                      {s.who && <p className="text-green-500 text-[10px]">For: {s.who as string}</p>}
                    </div>
                  </div>
                )
              }}
            />
          </div>
        )}

        {/* Red flags */}
        {findings?.red_flags && (findings.red_flags as unknown[]).length > 0 && (
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
        {findings?.unanswered_questions && (findings.unanswered_questions as string[]).length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-amber-700 mb-1">Unanswered Questions</h4>
            <ExpandableSection
              items={findings.unanswered_questions as unknown[]}
              renderItem={(item, i) => (
                <p key={i} className="text-xs text-amber-700 mb-1">? {item as string}</p>
              )}
            />
          </div>
        )}

        {/* Web findings */}
        {findings?.web_findings && (findings.web_findings as unknown[]).length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-slate-700 mb-1">Web Sources</h4>
            <ExpandableSection
              items={findings.web_findings as unknown[]}
              renderItem={(item, i) => {
                const w = item as Record<string, unknown>
                return (
                  <div key={i} className="p-2 bg-slate-50 rounded mb-1 text-xs text-slate-700">
                    <span className="font-medium">{w.source as string}</span>
                    {w.finding && <p className="text-slate-600 mt-0.5">{w.finding as string}</p>}
                  </div>
                )
              }}
            />
          </div>
        )}

        {/* Classification review */}
        {findings?.classification_review && (findings.classification_review as Record<string, unknown>)?.assessment && (
          <div className="p-2 bg-amber-50 border border-amber-200 rounded">
            <h4 className="text-xs font-semibold text-amber-800 mb-1">Classification Review</h4>
            <p className="text-xs text-amber-700">{(findings.classification_review as Record<string, unknown>).assessment as string}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
