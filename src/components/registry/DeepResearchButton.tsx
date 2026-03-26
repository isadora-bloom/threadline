'use client'

import { useState } from 'react'
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

export function DeepResearchButton({ recordId }: { recordId: string }) {
  const [loading, setLoading] = useState(false)
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

        {!result && !loading && (
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
