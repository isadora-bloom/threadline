'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ResearchTaskCard } from './ResearchTaskCard'
import { Microscope, Plus, Loader2, AlertTriangle } from 'lucide-react'

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

export function ResearchTaskList({ caseId, canManage }: ResearchTaskListProps) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [context, setContext] = useState('')
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['research-tasks', caseId],
    queryFn: async () => {
      const res = await fetch(`/api/research?caseId=${caseId}`)
      const json = await res.json()
      return json.tasks as ResearchTask[]
    },
    refetchInterval: (query) => {
      // Poll while any task is running
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
        )}
      </div>

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
              ? 'No research tasks yet. Create one to start tracking a specific lead.'
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
