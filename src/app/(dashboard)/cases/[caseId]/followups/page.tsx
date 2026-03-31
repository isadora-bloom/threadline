'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useParams } from 'next/navigation'
import {
  CheckSquare,
  Square,
  Plus,
  Trash2,
  ArrowRight,
  Calendar,
  Loader2,
  CheckCircle2,
  ClipboardList,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FollowUp {
  id: string
  case_id: string
  submission_id: string | null
  claim_id: string | null
  text: string
  status: 'open' | 'done'
  due_date: string | null
  created_at: string
  completed_at: string | null
  creator: { full_name: string | null } | null
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FollowUpsPage() {
  const params = useParams()
  const caseId = params?.caseId as string
  const qc = useQueryClient()

  const [newText, setNewText] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open')
  const [adding, setAdding] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['follow-ups', caseId],
    queryFn: async () => {
      const res = await fetch(`/api/followups?caseId=${caseId}`)
      const json = await res.json()
      return json.followUps as FollowUp[]
    },
    enabled: !!caseId,
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'open' | 'done' }) => {
      await fetch('/api/followups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['follow-ups', caseId] })
      const prev = qc.getQueryData<FollowUp[]>(['follow-ups', caseId])
      qc.setQueryData<FollowUp[]>(['follow-ups', caseId], old =>
        old?.map(f => f.id === id ? { ...f, status } : f) ?? []
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['follow-ups', caseId], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['follow-ups', caseId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/followups?id=${id}`, { method: 'DELETE' })
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['follow-ups', caseId] })
      const prev = qc.getQueryData<FollowUp[]>(['follow-ups', caseId])
      qc.setQueryData<FollowUp[]>(['follow-ups', caseId], old => old?.filter(f => f.id !== id) ?? [])
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['follow-ups', caseId], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['follow-ups', caseId] }),
  })

  async function addFollowUp() {
    if (!newText.trim()) return
    setAdding(true)
    try {
      await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
          text: newText.trim(),
          dueDate: newDueDate || null,
        }),
      })
      setNewText('')
      setNewDueDate('')
      qc.invalidateQueries({ queryKey: ['follow-ups', caseId] })
    } finally {
      setAdding(false)
    }
  }

  const allItems = data ?? []
  const filtered = filter === 'all' ? allItems : allItems.filter(f => f.status === filter)
  const openCount = allItems.filter(f => f.status === 'open').length
  const doneCount = allItems.filter(f => f.status === 'done').length

  // Group open items by whether they're overdue
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const isOverdue = (f: FollowUp) =>
    f.status === 'open' && f.due_date && new Date(f.due_date) < today

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-indigo-500" />
          Follow-ups
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Action items and open questions attached to this case
        </p>
      </div>

      {/* Add new */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-5">
        <p className="text-xs font-semibold text-slate-600 mb-2">Add follow-up</p>
        <textarea
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="e.g. Call witness back to clarify sighting date / Verify against police report 2019-0342 / Ask family about this person…"
          className="w-full text-sm border border-slate-200 rounded p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-800 placeholder:text-slate-400"
          rows={2}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addFollowUp()
          }}
        />
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="date"
              value={newDueDate}
              onChange={e => setNewDueDate(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300 text-slate-600"
            />
          </div>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={addFollowUp}
            disabled={!newText.trim() || adding}
            className="h-7 text-xs gap-1"
          >
            {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-4">
        {([
          { value: 'open',  label: `Open (${openCount})` },
          { value: 'done',  label: `Done (${doneCount})` },
          { value: 'all',   label: `All (${allItems.length})` },
        ] as const).map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              filter === tab.value
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center gap-2 p-8 justify-center text-slate-400 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
          <CheckCircle2 className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-500">
            {filter === 'open' ? 'No open follow-ups' : filter === 'done' ? 'Nothing marked done yet' : 'No follow-ups yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const overdue = isOverdue(item)
            return (
              <div
                key={item.id}
                className={`flex items-start gap-3 bg-white border rounded-lg p-3 group transition-colors ${
                  item.status === 'done'
                    ? 'border-slate-150 opacity-60'
                    : overdue
                    ? 'border-red-200 bg-red-50/30'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleMutation.mutate({ id: item.id, status: item.status === 'done' ? 'open' : 'done' })}
                  className="mt-0.5 flex-shrink-0 text-slate-400 hover:text-indigo-600 transition-colors"
                >
                  {item.status === 'done'
                    ? <CheckSquare className="h-4 w-4 text-indigo-400" />
                    : <Square className="h-4 w-4" />
                  }
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${item.status === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                    {item.text}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {item.due_date && (
                      <span className={`text-[10px] flex items-center gap-1 ${
                        overdue ? 'text-red-600 font-semibold' : 'text-slate-400'
                      }`}>
                        <Calendar className="h-2.5 w-2.5" />
                        {overdue ? 'Overdue · ' : ''}
                        {new Date(item.due_date).toLocaleDateString()}
                      </span>
                    )}
                    {item.submission_id && (
                      <Link
                        href={`/cases/${caseId}/submissions/${item.submission_id}`}
                        className="text-[10px] text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5"
                      >
                        View submission <ArrowRight className="h-2.5 w-2.5" />
                      </Link>
                    )}
                    {item.creator?.full_name && (
                      <span className="text-[10px] text-slate-400">{item.creator.full_name}</span>
                    )}
                    <span className="text-[10px] text-slate-300">
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Delete */}
                <button
                  onClick={() => deleteMutation.mutate(item.id)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-400 mt-0.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
