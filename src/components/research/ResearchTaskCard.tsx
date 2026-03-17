'use client'

import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Microscope,
  ChevronDown,
  ChevronUp,
  Play,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  ExternalLink,
  ArrowRight,
  BookOpen,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface ResearchStep {
  round: number
  step: number
  query: string
  finding: string
  confidence: 'high' | 'medium' | 'low'
  source: string
  dead_end: boolean
  is_followup: boolean
  followup_reason?: string
}

interface NextStep {
  priority: 'high' | 'medium' | 'low'
  action: string
  target: string
  rationale: string
}

interface Source {
  name: string
  url: string | null
  type: string
  relevance: string
}

interface ResearchTask {
  id: string
  case_id: string
  question: string
  context: string | null
  trigger_type: string
  status: string
  research_log: ResearchStep[] | null
  findings: {
    confirmed: string[]
    probable: string[]
    unresolvable_without_human: string[]
  } | null
  human_next_steps: NextStep[] | null
  sources_consulted: Source[] | null
  confidence_summary: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  queued:           { label: 'Queued',          color: 'bg-slate-100 text-slate-600',   icon: Clock },
  running:          { label: 'Running...',       color: 'bg-blue-100 text-blue-700',     icon: Loader2 },
  awaiting_review:  { label: 'Ready for review', color: 'bg-amber-100 text-amber-700',  icon: BookOpen },
  complete:         { label: 'Complete',          color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  failed:           { label: 'Failed',            color: 'bg-red-100 text-red-700',      icon: AlertCircle },
}

const PRIORITY_COLORS = {
  high:   'bg-red-50 border-red-200 text-red-800',
  medium: 'bg-amber-50 border-amber-200 text-amber-800',
  low:    'bg-slate-50 border-slate-200 text-slate-700',
}

interface ResearchTaskCardProps {
  task: ResearchTask
  canRun: boolean
}

export function ResearchTaskCard({ task, canRun }: ResearchTaskCardProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(task.status === 'awaiting_review')
  const [logOpen, setLogOpen] = useState(false)

  // Auto-open when results arrive after a run
  useEffect(() => {
    if (task.status === 'awaiting_review') setOpen(true)
  }, [task.status])

  const runMutation = useMutation({
    mutationFn: async (deep = false) => {
      const res = await fetch(`/api/research/${task.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deep }),
      })
      if (!res.ok) {
        let msg = 'Run failed'
        try { const err = await res.json(); msg = err.error ?? msg } catch {}
        throw new Error(msg)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-tasks', task.case_id] })
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['research-tasks', task.case_id] })
    },
  })

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/research/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'complete' }),
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-tasks', task.case_id] })
    },
  })

  const statusCfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.queued
  const StatusIcon = statusCfg.icon

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={`rounded-lg border ${task.status === 'awaiting_review' ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white'}`}>
        {/* Header */}
        <CollapsibleTrigger className="w-full text-left p-4">
          <div className="flex items-start gap-3">
            <Microscope className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${statusCfg.color}`}>
                  <StatusIcon className={`h-2.5 w-2.5 ${task.status === 'running' ? 'animate-spin' : ''}`} />
                  {statusCfg.label}
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wide">{task.trigger_type.replace('_', ' ')}</span>
                <span className="text-[10px] text-slate-400">{formatDate(task.created_at)}</span>
              </div>
              <p className="text-sm font-medium text-slate-900 leading-snug">{task.question}</p>
              {task.confidence_summary && (
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{task.confidence_summary}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {canRun && task.status === 'queued' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={runMutation.isPending}
                  onClick={e => { e.stopPropagation(); runMutation.mutate(false) }}
                >
                  {runMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Run
                </Button>
              )}
              {canRun && ['failed', 'complete', 'awaiting_review'].includes(task.status) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-slate-500"
                  disabled={runMutation.isPending}
                  onClick={e => { e.stopPropagation(); runMutation.mutate(false) }}
                >
                  {runMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Re-run
                </Button>
              )}
              {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-4">

            {/* Findings */}
            {task.findings && (
              <div className="space-y-3">
                {task.findings.confirmed.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Confirmed findings
                    </p>
                    <ul className="space-y-1">
                      {task.findings.confirmed.map((f, i) => (
                        <li key={i} className="text-xs text-slate-700 bg-emerald-50 border border-emerald-100 rounded px-2 py-1.5">{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {task.findings.probable.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-amber-700 mb-1.5 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> Probable — inference, not confirmed
                    </p>
                    <ul className="space-y-1">
                      {task.findings.probable.map((f, i) => (
                        <li key={i} className="text-xs text-slate-700 bg-amber-50 border border-amber-100 rounded px-2 py-1.5 italic">{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {task.findings.unresolvable_without_human.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-1.5">Requires human action to resolve</p>
                    <ul className="space-y-1">
                      {task.findings.unresolvable_without_human.map((f, i) => (
                        <li key={i} className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Human next steps */}
            {task.human_next_steps && task.human_next_steps.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">Recommended next steps</p>
                <div className="space-y-2">
                  {task.human_next_steps.map((step, i) => (
                    <div
                      key={i}
                      className={`rounded border p-2.5 ${PRIORITY_COLORS[step.priority] ?? PRIORITY_COLORS.medium}`}
                    >
                      <div className="flex items-start gap-2">
                        <ArrowRight className="h-3 w-3 flex-shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <p className="text-xs font-medium">{step.action}</p>
                          <p className="text-[11px] opacity-80">→ {step.target}</p>
                          <p className="text-[11px] opacity-70 italic">{step.rationale}</p>
                        </div>
                        <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded
                          ${step.priority === 'high' ? 'bg-red-100 text-red-700' : step.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                          {step.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Research log + sources */}
            {(task.research_log?.length || task.sources_consulted?.length) ? (
              <Collapsible open={logOpen} onOpenChange={setLogOpen}>
                <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700">
                  {logOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {task.research_log?.length ?? 0} queries · {task.sources_consulted?.length ?? 0} sources
                  {(task.research_log as ResearchStep[] | null)?.some(l => l.is_followup) && (
                    <span className="ml-1 text-[10px] bg-indigo-100 text-indigo-600 px-1 rounded">followed rabbit holes</span>
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 space-y-2">
                    {/* Group log by round */}
                    {[1, 2, 3].map(round => {
                      const roundSteps = (task.research_log as ResearchStep[] | null)?.filter(l => l.round === round) ?? []
                      if (!roundSteps.length) return null
                      return (
                        <div key={round}>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                            {round === 1 ? 'Round 1 — initial queries' : `Round ${round} — follow-up threads`}
                          </p>
                          <div className="space-y-1">
                            {roundSteps.map((step, i) => (
                              <div key={i} className={`text-xs rounded px-2 py-1 ${step.dead_end ? 'bg-slate-50 text-slate-400' : step.is_followup ? 'bg-indigo-50 text-slate-700' : 'bg-slate-50 text-slate-700'}`}>
                                <p className="font-medium">{step.query}</p>
                                {step.followup_reason && <p className="text-[11px] text-indigo-600 italic">↪ {step.followup_reason}</p>}
                                {step.dead_end && <p className="text-[11px] text-slate-400">Dead end</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}

                    {/* Sources */}
                    {task.sources_consulted && task.sources_consulted.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Sources</p>
                        {task.sources_consulted.map((s, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-slate-600 py-0.5">
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-1 rounded uppercase flex-shrink-0">{s.type}</span>
                            {s.url ? (
                              <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-indigo-600 hover:underline">
                                {s.name} <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            ) : (
                              <span>{s.name}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : null}

            {/* Error */}
            {task.error_message && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                {task.error_message}
              </p>
            )}

            {/* Dig deeper + mark complete */}
            {canRun && ['awaiting_review', 'complete'].includes(task.status) && (
              <Button
                size="sm"
                variant="outline"
                className="w-full h-7 text-xs gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                disabled={runMutation.isPending}
                onClick={() => runMutation.mutate(true)}
              >
                {runMutation.isPending
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Microscope className="h-3 w-3" />}
                Dig deeper — run full agentic search loop
              </Button>
            )}
            {task.status === 'awaiting_review' && canRun && (
              <Button
                size="sm"
                variant="outline"
                className="w-full h-7 text-xs"
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Mark as reviewed &amp; complete
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
