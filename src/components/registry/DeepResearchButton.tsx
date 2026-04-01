'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Brain, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function DeepResearchButton({ recordId, isWatching = false }: { recordId: string; isWatching?: boolean }) {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [watchPrompt, setWatchPrompt] = useState(false)
  const [existingResearch, setExistingResearch] = useState<{ summary: string; created_at: string } | null>(null)
  const [checkedExisting, setCheckedExisting] = useState(false)
  const [result, setResult] = useState<{
    status: string
    summary?: string
    findings?: Record<string, unknown>
  } | null>(null)
  const [open, setOpen] = useState(false)

  const runResearch = async () => {
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/deep-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importRecordId: recordId, researchType: 'full' }),
      })

      const data = await res.json()

      if (!res.ok) {
        setResult({ status: 'failed', summary: data.error ?? 'Research failed' })
        return
      }

      setResult(data)
    } catch (err) {
      setResult({ status: 'failed', summary: 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Brain className="h-4 w-4" />
          Threadline AI
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-indigo-600" />
            Threadline AI — Deep Research
          </DialogTitle>
          <DialogDescription>
            AI will analyze this case, search for connections across the entire registry,
            check offender overlaps, and generate a research report with next steps.
          </DialogDescription>
        </DialogHeader>

        {/* Check for existing research on open */}
        {open && !checkedExisting && (() => {
          supabase.from('deep_research').select('summary, created_at')
            .eq('import_record_id', recordId).eq('status', 'complete')
            .order('created_at', { ascending: false }).limit(1)
            .then(({ data }) => {
              setCheckedExisting(true)
              if (data?.[0]) setExistingResearch(data[0] as { summary: string; created_at: string })
            })
          return null
        })()}

        {existingResearch && !result && !loading && (
          <div className="space-y-3">
            <div className="rounded-lg border border-green-200 bg-green-50 p-3">
              <p className="text-xs font-semibold text-green-800 mb-1">Research already completed</p>
              <p className="text-sm text-green-900">{existingResearch.summary}</p>
              <p className="text-[10px] text-green-600 mt-2">
                Completed {new Date(existingResearch.created_at).toLocaleDateString()} — visible to all watchers of this case
              </p>
            </div>
            {isWatching && (
              <Button variant="outline" onClick={runResearch} className="w-full text-xs">
                Run new research (updates will be shared with all watchers)
              </Button>
            )}
          </div>
        )}

        {!result && !loading && !isWatching && !existingResearch && (
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <p className="font-medium mb-1">Add this case to your watchlist first</p>
              <p className="text-xs">
                Deep research is available for cases you&apos;re watching. This ensures you&apos;re invested in
                the results and can follow up on what the AI finds.
              </p>
            </div>
          </div>
        )}

        {!result && !loading && isWatching && !existingResearch && (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              This will use AI to analyze all available data. Results are suggestions, not conclusions.
            </div>
            <Button onClick={runResearch} className="w-full">
              <Brain className="h-4 w-4" />
              Run Deep Research
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center py-12 gap-3">
            <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
            <p className="text-sm text-slate-500">Analyzing case data, searching registry, checking patterns...</p>
            <p className="text-xs text-slate-400">This may take 30-60 seconds.</p>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {result.status === 'failed' ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm text-red-800">{result.summary}</p>
              </div>
            ) : (
              <>
                {result.summary && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 mb-2">Summary</h3>
                    <p className="text-sm text-slate-700 leading-relaxed">{result.summary}</p>
                  </div>
                )}

                {result.findings && (
                  <>
                    {/* Connections */}
                    {(result.findings.connections as unknown[])?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900 mb-2">Possible Connections</h3>
                        <div className="space-y-2">
                          {(result.findings.connections as Array<{ name?: string; reason?: string; score?: number }>).map((c, i) => (
                            <div key={i} className="p-2 bg-slate-50 rounded-md text-sm">
                              <span className="font-medium">{c.name ?? 'Unknown'}</span>
                              {c.score && <span className="text-xs text-slate-400 ml-2">Score: {c.score}</span>}
                              {c.reason && <p className="text-xs text-slate-600 mt-0.5">{c.reason}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Next Steps */}
                    {(result.findings.next_steps as unknown[])?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900 mb-2">Recommended Next Steps</h3>
                        <div className="space-y-1.5">
                          {(result.findings.next_steps as Array<{ priority?: string; action?: string; rationale?: string }>).map((step, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm">
                              <span className="text-indigo-500 font-bold mt-0.5">{i + 1}.</span>
                              <div>
                                <span className="font-medium text-slate-800">{step.action}</span>
                                {step.rationale && <p className="text-xs text-slate-500">{step.rationale}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Red Flags */}
                    {(result.findings.red_flags as unknown[])?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-red-700 mb-2">Red Flags</h3>
                        <div className="space-y-1">
                          {(result.findings.red_flags as Array<{ description?: string; severity?: string }>).map((flag, i) => (
                            <p key={i} className="text-sm text-red-700">
                              ⚠ {flag.description}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Dig Deeper — follow-up investigations */}
                {result.findings?.dig_deeper && (result.findings.dig_deeper as unknown[]).length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-indigo-900 mb-2">Dig Deeper</h3>
                    <div className="space-y-2">
                      {(result.findings.dig_deeper as Array<{ title?: string; question?: string; search_terms?: string }>).map((item, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 bg-indigo-50 border border-indigo-200 rounded-md">
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-indigo-900">{item.title ?? `Follow-up ${i + 1}`}</p>
                            <p className="text-xs text-indigo-700 mt-0.5">{item.question}</p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] border-indigo-300 text-indigo-700 hover:bg-indigo-100 flex-shrink-0"
                            disabled={loading}
                            onClick={async () => {
                              setLoading(true)
                              setResult(null)
                              try {
                                const res = await fetch('/api/deep-research', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    importRecordId: recordId,
                                    researchType: 'full',
                                    focusQuestion: item.question,
                                    focusSearchTerms: item.search_terms,
                                  }),
                                })
                                const data = await res.json()
                                if (!res.ok) {
                                  setResult({ status: 'failed', summary: data.error ?? 'Research failed' })
                                } else {
                                  setResult(data)
                                }
                              } catch {
                                setResult({ status: 'failed', summary: 'Network error' })
                              } finally {
                                setLoading(false)
                              }
                            }}
                          >
                            Go
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Web findings */}
                {result.findings?.web_findings && (result.findings.web_findings as unknown[]).length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 mb-2">Web Sources</h3>
                    <div className="space-y-1">
                      {(result.findings.web_findings as Array<{ source?: string; finding?: string }>).map((wf, i) => (
                        <div key={i} className="text-xs text-slate-600">
                          <span className="font-medium text-slate-700">{wf.source}:</span> {wf.finding}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  AI-generated research — all findings require human verification before action.
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
