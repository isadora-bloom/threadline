'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ResearchTaskCard } from './ResearchTaskCard'
import { Microscope, Plus, Loader2, AlertTriangle, Sparkles, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'

interface ResearchTask {
  id: string
  case_id: string
  question: string
  context: string | null
  trigger_type: string
  status: string
  research_log: unknown[] | null
  findings: unknown | null
  human_next_steps: unknown[] | null
  sources_consulted: unknown[] | null
  confidence_summary: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

interface Suggestion {
  question: string
  context: string
  rationale: string
  priority: 'high' | 'medium' | 'low'
  trigger_ref_type: string
}

interface ResearchTaskListProps {
  caseId: string
  canManage: boolean
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'queued', label: 'Queued' },
  { value: 'awaiting_review', label: 'Ready for review' },
  { value: 'complete', label: 'Complete' },
]

const PRIORITY_COLORS = {
  high:   'border-red-200 bg-red-50',
  medium: 'border-amber-200 bg-amber-50',
  low:    'border-slate-200 bg-slate-50',
}

const PRIORITY_BADGE = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-slate-100 text-slate-600',
}

export function ResearchTaskList({ caseId, canManage }: ResearchTaskListProps) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [context, setContext] = useState('')
  const [creating, setCreating] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [queueing, setQueueing] = useState<Set<number>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['research-tasks', caseId],
    queryFn: async () => {
      const res = await fetch(`/api/research?caseId=${caseId}`)
      const json = await res.json()
      return json.tasks as ResearchTask[]
    },
    refetchInterval: (query) => {
      const tasks = query.state.data
      if (tasks?.some((t: ResearchTask) => t.status === 'running')) return 4000
      return false
    },
  })

  const tasks = (data ?? []).filter(t => statusFilter === 'all' || t.status === statusFilter)
  const pendingReview = (data ?? []).filter(t => t.status === 'awaiting_review').length

  async function handleCreate() {
    if (!question.trim()) return
    setCreating(true)
    try {
      await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, question: question.trim(), context: context.trim() || undefined }),
      })
      queryClient.invalidateQueries({ queryKey: ['research-tasks', caseId] })
      setQuestion('')
      setContext('')
      setCreateOpen(false)
    } finally {
      setCreating(false)
    }
  }

  async function handleSuggest() {
    setSuggesting(true)
    setSuggestOpen(true)
    setSuggestions(null)
    try {
      const res = await fetch('/api/research/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId }),
      })
      const json = await res.json()
      setSuggestions(json.suggestions ?? [])
    } catch {
      setSuggestions([])
    } finally {
      setSuggesting(false)
    }
  }

  async function queueSuggestion(suggestion: Suggestion, index: number) {
    setQueueing(prev => new Set(prev).add(index))
    try {
      await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
          question: suggestion.question,
          context: suggestion.context,
          trigger_type: 'ai_suggested',
          trigger_ref_type: suggestion.trigger_ref_type,
        }),
      })
      queryClient.invalidateQueries({ queryKey: ['research-tasks', caseId] })
      // Remove from suggestions list
      setSuggestions(prev => prev?.filter((_, i) => i !== index) ?? null)
    } finally {
      setQueueing(prev => { const next = new Set(prev); next.delete(index); return next })
    }
  }

  async function queueAll() {
    if (!suggestions?.length) return
    setSuggesting(true)
    try {
      await Promise.all(
        suggestions.map(s =>
          fetch('/api/research', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              caseId,
              question: s.question,
              context: s.context,
              trigger_type: 'ai_suggested',
              trigger_ref_type: s.trigger_ref_type,
            }),
          })
        )
      )
      queryClient.invalidateQueries({ queryKey: ['research-tasks', caseId] })
      setSuggestions([])
      setSuggestOpen(false)
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Microscope className="h-4 w-4 text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-900">Research Assistant</h3>
          {pendingReview > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
              {pendingReview}
            </span>
          )}
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={handleSuggest}
              disabled={suggesting}
            >
              {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Suggest tasks
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <Plus className="h-3 w-3" />
                  New task
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="text-sm">Create research task</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">Research question</label>
                    <Textarea
                      placeholder='e.g. "What does the marking &quot;R 9700&quot; mean as a military duffel bag marking from the early 1950s?"'
                      value={question}
                      onChange={e => setQuestion(e.target.value)}
                      className="text-sm min-h-[80px]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">Additional context <span className="font-normal text-slate-400">(optional)</span></label>
                    <Textarea
                      placeholder="Any case-specific context that would help narrow the research..."
                      value={context}
                      onChange={e => setContext(e.target.value)}
                      className="text-sm min-h-[60px]"
                    />
                  </div>
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">
                      The research assistant uses AI and public sources. All findings require investigator evaluation before any action is taken.
                    </p>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!question.trim() || creating}
                    onClick={handleCreate}
                  >
                    {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Create task
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {/* AI Suggestions panel */}
      {suggestOpen && canManage && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/40">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-left"
            onClick={() => setSuggestOpen(o => !o)}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
              <span className="text-xs font-semibold text-indigo-800">
                AI-suggested research tasks
              </span>
              {suggestions && suggestions.length > 0 && (
                <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-medium">
                  {suggestions.length}
                </span>
              )}
            </div>
            {suggestOpen ? <ChevronUp className="h-3.5 w-3.5 text-indigo-400" /> : <ChevronDown className="h-3.5 w-3.5 text-indigo-400" />}
          </button>

          <div className="px-4 pb-4 space-y-3 border-t border-indigo-100">
            {suggesting ? (
              <div className="py-6 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-indigo-400 mx-auto mb-2" />
                <p className="text-xs text-indigo-600">Analysing case and generating research questions...</p>
              </div>
            ) : suggestions === null ? null : suggestions.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-3">All suggested tasks have been queued.</p>
            ) : (
              <>
                <div className="space-y-2 pt-1">
                  {suggestions.map((s, i) => (
                    <div key={i} className={`rounded-lg border p-3 space-y-1.5 ${PRIORITY_COLORS[s.priority] ?? PRIORITY_COLORS.medium}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-slate-900 leading-snug flex-1">{s.question}</p>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 ${PRIORITY_BADGE[s.priority] ?? PRIORITY_BADGE.medium}`}>
                          {s.priority}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 italic">{s.rationale}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] gap-1 mt-1"
                        disabled={queueing.has(i)}
                        onClick={() => queueSuggestion(s, i)}
                      >
                        {queueing.has(i) ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ArrowRight className="h-2.5 w-2.5" />}
                        Queue task
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="w-full h-7 text-xs"
                  disabled={suggesting}
                  onClick={queueAll}
                >
                  Queue all {suggestions.length} tasks
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Epistemic notice */}
      <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <AlertTriangle className="h-3.5 w-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-500">
          The research assistant exhaustively follows public threads and surfaces specific next steps for human action.
          It does not act on leads — it prepares investigators to act. All findings are surfaced for review, not treated as conclusions.
        </p>
      </div>

      {/* Filter tabs */}
      {(data?.length ?? 0) > 0 && (
        <div className="flex gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors
                ${statusFilter === f.value
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
            >
              {f.label}
              {f.value === 'awaiting_review' && pendingReview > 0 && (
                <span className="ml-1 text-amber-400 font-bold">{pendingReview}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Task list */}
      {isLoading ? (
        <div className="py-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <Microscope className="h-8 w-8 text-slate-200 mx-auto" />
          <p className="text-sm text-slate-400">
            {data?.length === 0
              ? 'No research tasks yet. Click "Suggest tasks" to let AI identify the best leads to research.'
              : 'No tasks match this filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <ResearchTaskCard
              key={task.id}
              task={task as Parameters<typeof ResearchTaskCard>[0]['task']}
              canRun={canManage}
            />
          ))}
        </div>
      )}
    </div>
  )
}
