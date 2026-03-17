'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import {
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  UserPlus,
  RotateCcw,
  AlertTriangle,
  ExternalLink,
  FileText,
  ClipboardList,
  Link2,
} from 'lucide-react'

interface InvestigativeThread {
  id: string
  case_id: string
  generation_batch_id: string
  hypothesis: string
  supporting_claim_ids: string[]
  complicating_factors: string | null
  recommended_actions: string[]
  external_resources: string[]
  status: 'unreviewed' | 'active' | 'dismissed' | 'exported_to_handoff'
  status_reason: string | null
  assigned_to: string | null
  generated_by: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  generation_model: string | null
  created_at: string
}

interface Props {
  caseId: string
  canGenerate: boolean
}

const STATUS_CONFIG = {
  unreviewed: { label: 'Unreviewed', color: 'bg-slate-100 text-slate-600' },
  active: { label: 'Active', color: 'bg-green-100 text-green-700' },
  dismissed: { label: 'Dismissed', color: 'bg-slate-100 text-slate-400' },
  exported_to_handoff: { label: 'Exported', color: 'bg-indigo-100 text-indigo-700' },
}

function ThreadCard({
  thread,
  onAction,
}: {
  thread: InvestigativeThread
  onAction: (threadId: string, action: string, extra?: Record<string, string>) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(thread.status === 'unreviewed')
  const [actioning, setActioning] = useState(false)
  const [dismissReason, setDismissReason] = useState('')
  const [showDismissInput, setShowDismissInput] = useState(false)

  const statusCfg = STATUS_CONFIG[thread.status] ?? STATUS_CONFIG.unreviewed
  const isDismissed = thread.status === 'dismissed'

  const handleAction = async (action: string, extra?: Record<string, string>) => {
    setActioning(true)
    try {
      await onAction(thread.id, action, extra)
    } finally {
      setActioning(false)
      setShowDismissInput(false)
      setDismissReason('')
    }
  }

  return (
    <div className={`border rounded-lg overflow-hidden transition-opacity ${isDismissed ? 'opacity-50' : 'bg-white border-slate-200'}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-50 transition-colors"
      >
        <Sparkles className="h-4 w-4 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusCfg.color}`}>
              {statusCfg.label}
            </span>
            <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded font-medium">
              HYPOTHESIS — surfaced for review
            </span>
          </div>
          <p className="text-sm text-slate-800 leading-snug line-clamp-2">{thread.hypothesis}</p>
          {thread.supporting_claim_ids.length > 0 && (
            <p className="text-xs text-slate-400 mt-1">
              {thread.supporting_claim_ids.length} supporting claim{thread.supporting_claim_ids.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
        )}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-100">
          {/* Full hypothesis */}
          <div className="pt-3">
            <p className="text-sm text-slate-700 leading-relaxed">{thread.hypothesis}</p>
          </div>

          {/* Supporting claims */}
          {thread.supporting_claim_ids.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Link2 className="h-3 w-3" />
                Supporting claims ({thread.supporting_claim_ids.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {thread.supporting_claim_ids.map(id => (
                  <code key={id} className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 rounded px-1.5 py-0.5 font-mono">
                    {id.slice(0, 8)}…
                  </code>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Review these claim IDs in the Claims tab to verify supporting evidence.
              </p>
            </div>
          )}

          {/* Complicating factors */}
          {thread.complicating_factors && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Complicating factors
              </p>
              <p className="text-sm text-slate-600 leading-relaxed bg-amber-50 border border-amber-100 rounded p-2.5">
                {thread.complicating_factors}
              </p>
            </div>
          )}

          {/* Recommended actions */}
          {thread.recommended_actions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <ClipboardList className="h-3 w-3" />
                Recommended actions
              </p>
              <ol className="space-y-1.5">
                {thread.recommended_actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 text-[10px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    {action}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* External resources */}
          {thread.external_resources.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <ExternalLink className="h-3 w-3" />
                External resources
              </p>
              <ul className="space-y-1">
                {thread.external_resources.map((res, i) => (
                  <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                    <span className="text-slate-300 mt-0.5">•</span>
                    {res}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Status note for dismissed threads */}
          {thread.status === 'dismissed' && thread.status_reason && (
            <div className="text-xs text-slate-500 bg-slate-50 rounded p-2 border border-slate-200">
              Dismissed: {thread.status_reason}
            </div>
          )}

          {/* Actions */}
          {thread.status !== 'exported_to_handoff' && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              {actioning ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              ) : (
                <>
                  {thread.status !== 'active' && !isDismissed && (
                    <Button
                      size="sm"
                      onClick={() => handleAction('accept')}
                      className="h-7 text-xs gap-1"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Accept
                    </Button>
                  )}

                  {!isDismissed && (
                    showDismissInput ? (
                      <div className="flex-1 flex items-center gap-2">
                        <Textarea
                          placeholder="Reason for dismissal (optional)"
                          value={dismissReason}
                          onChange={e => setDismissReason(e.target.value)}
                          className="h-8 min-h-0 text-xs py-1 resize-none"
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs shrink-0"
                          onClick={() => handleAction('dismiss', dismissReason ? { reason: dismissReason } : undefined)}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs shrink-0"
                          onClick={() => { setShowDismissInput(false); setDismissReason('') }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowDismissInput(true)}
                        className="h-7 text-xs gap-1 text-slate-500"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Dismiss
                      </Button>
                    )
                  )}

                  {isDismissed && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAction('reopen')}
                      className="h-7 text-xs gap-1 text-slate-500"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reopen
                    </Button>
                  )}

                  {thread.status === 'active' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAction('export')}
                      className="h-7 text-xs gap-1 ml-auto"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Add to handoff
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function InvestigativeThreads({ caseId, canGenerate }: Props) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [generating, setGenerating] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all_active')

  const { data: threads, isLoading } = useQuery({
    queryKey: ['investigative-threads', caseId],
    queryFn: async (): Promise<InvestigativeThread[]> => {
      const { data, error } = await supabase
        .from('investigative_threads')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const filtered = (threads ?? []).filter(t => {
    if (statusFilter === 'all_active') return t.status !== 'dismissed'
    if (statusFilter === 'unreviewed') return t.status === 'unreviewed'
    if (statusFilter === 'active') return t.status === 'active'
    if (statusFilter === 'dismissed') return t.status === 'dismissed'
    return true
  })

  const counts = {
    unreviewed: (threads ?? []).filter(t => t.status === 'unreviewed').length,
    active: (threads ?? []).filter(t => t.status === 'active').length,
    dismissed: (threads ?? []).filter(t => t.status === 'dismissed').length,
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/threads/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Generation failed')

      toast({
        title: 'Threads generated',
        description: `${data.threads.length} investigative thread${data.threads.length !== 1 ? 's' : ''} surfaced for review.`,
      })
      queryClient.invalidateQueries({ queryKey: ['investigative-threads', caseId] })
      setStatusFilter('unreviewed')
    } catch (err) {
      toast({
        variant: 'destructive',
        description: err instanceof Error ? err.message : 'Generation failed',
      })
    } finally {
      setGenerating(false)
    }
  }

  async function handleThreadAction(threadId: string, action: string, extra?: Record<string, string>) {
    const res = await fetch(`/api/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ variant: 'destructive', description: data.error ?? 'Action failed' })
      return
    }
    queryClient.invalidateQueries({ queryKey: ['investigative-threads', caseId] })
    const actionLabels: Record<string, string> = {
      accept: 'Thread added to active investigation.',
      dismiss: 'Thread dismissed.',
      reopen: 'Thread reopened.',
      export: 'Thread marked for handoff package.',
    }
    toast({ description: actionLabels[action] ?? 'Updated.' })
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-600 leading-relaxed">
            AI-generated investigative leads based on case claims, entities, and pattern flags.
            Every thread is a hypothesis only — human judgment required before any action is taken.
          </p>
          {threads && threads.length > 0 && (
            <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
              <span>{counts.unreviewed} unreviewed</span>
              <span>·</span>
              <span>{counts.active} active</span>
              <span>·</span>
              <span>{counts.dismissed} dismissed</span>
            </div>
          )}
        </div>
        {canGenerate && (
          <Button
            onClick={handleGenerate}
            disabled={generating}
            size="sm"
            className="shrink-0 gap-1.5"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generating ? 'Generating…' : 'Generate threads'}
          </Button>
        )}
      </div>

      {/* Epistemic notice */}
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 leading-relaxed">
          All threads are AI-generated hypotheses surfaced for investigator review. They are not
          conclusions, findings, or evidence. Supporting claim IDs reference reported information —
          not verified facts. Investigator judgment is required before any action.
        </p>
      </div>

      {/* Filter tabs */}
      {threads && threads.length > 0 && (
        <div className="flex gap-1">
          {[
            { value: 'all_active', label: 'All active' },
            { value: 'unreviewed', label: `Unreviewed${counts.unreviewed > 0 ? ` (${counts.unreviewed})` : ''}` },
            { value: 'active', label: 'Accepted' },
            { value: 'dismissed', label: 'Dismissed' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                statusFilter === opt.value
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Thread list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-lg">
          <Sparkles className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          {threads && threads.length > 0 ? (
            <>
              <p className="font-medium text-slate-600">No threads match this filter</p>
              <p className="text-sm text-slate-400 mt-1">Try a different filter above.</p>
            </>
          ) : canGenerate ? (
            <>
              <p className="font-medium text-slate-600">No threads yet</p>
              <p className="text-sm text-slate-400 mt-1 mb-4">
                Generate investigative threads from case claims, entities, and pattern flags.
              </p>
              <Button size="sm" onClick={handleGenerate} disabled={generating} className="gap-1.5">
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generating ? 'Generating…' : 'Generate threads'}
              </Button>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-600">No threads yet</p>
              <p className="text-sm text-slate-400 mt-1">
                A lead investigator or admin can generate investigative threads.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">{filtered.length} thread{filtered.length !== 1 ? 's' : ''}</p>
          {filtered.map(thread => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onAction={handleThreadAction}
            />
          ))}
        </div>
      )}
    </div>
  )
}
