'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { truncate, formatDate, labelForObservationMode } from '@/lib/utils'
import { AlertTriangle, User, ArrowLeft, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import type { Submission, NoveltyFlag } from '@/lib/types'

type TriageSub = Submission & {
  novelty_flags: NoveltyFlag[]
}

interface TriageModeProps {
  submissions: TriageSub[]
  caseId: string
  totalCount: number
}

type DiscardReason = 'off_topic' | 'duplicate' | 'spam' | 'insufficient_detail'

const DISCARD_REASONS: { value: DiscardReason; label: string }[] = [
  { value: 'off_topic', label: 'Off-topic' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'spam', label: 'Spam' },
  { value: 'insufficient_detail', label: 'Insufficient detail' },
]

function PriorityBadge({ level, score }: { level: string; score: number }) {
  const cls =
    level === 'high'
      ? 'bg-red-100 text-red-700 border border-red-300'
      : level === 'medium'
      ? 'bg-amber-100 text-amber-700 border border-amber-300'
      : 'bg-slate-100 text-slate-600 border border-slate-200'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${cls}`}>
      {level}
      <span className="font-normal opacity-60 normal-case">({score})</span>
    </span>
  )
}

export function TriageMode({ submissions, caseId, totalCount }: TriageModeProps) {
  const router = useRouter()
  const { toast } = useToast()

  const [cursor, setCursor] = useState(0)
  const [triaged, setTriaged] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showDiscard, setShowDiscard] = useState(false)
  const [discardReason, setDiscardReason] = useState<DiscardReason>('off_topic')
  const [discardIdx, setDiscardIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [claimed, setClaimed] = useState(0)

  const current = submissions[cursor]

  const doTriage = useCallback(async (
    id: string,
    action: 'claim' | 'defer' | 'discard',
    reason?: DiscardReason
  ) => {
    setLoading(true)
    try {
      const res = await fetch('/api/submissions/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: id, action, discardReason: reason }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast({ variant: 'destructive', title: 'Triage failed', description: data.error })
        return
      }
      if (action === 'claim') setClaimed(c => c + 1)
      setTriaged(t => t + 1)
      if (cursor + 1 >= submissions.length) {
        setDone(true)
      } else {
        setCursor(c => c + 1)
        setShowDiscard(false)
      }
    } catch {
      toast({ variant: 'destructive', title: 'Network error' })
    } finally {
      setLoading(false)
    }
  }, [cursor, submissions.length, toast])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!current || loading) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'c' || e.key === 'C') {
        doTriage(current.id, 'claim')
      } else if (e.key === 'd' || e.key === 'D') {
        doTriage(current.id, 'defer')
      } else if (e.key === 'x' || e.key === 'X') {
        if (showDiscard) {
          doTriage(current.id, 'discard', discardReason)
        } else {
          setShowDiscard(true)
        }
      } else if (e.key === ' ' && showDiscard) {
        e.preventDefault()
        setDiscardIdx(i => {
          const next = (i + 1) % DISCARD_REASONS.length
          setDiscardReason(DISCARD_REASONS[next].value)
          return next
        })
      } else if (e.key === 'Enter' && showDiscard) {
        doTriage(current.id, 'discard', discardReason)
      } else if (e.key === 'Escape') {
        setShowDiscard(false)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [current, loading, showDiscard, discardReason, discardIdx, doTriage])

  if (done || submissions.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            {submissions.length === 0 ? 'Queue is clear' : 'Triage complete'}
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            {submissions.length === 0
              ? 'No untriaged submissions in this case.'
              : `You triaged ${triaged} submission${triaged !== 1 ? 's' : ''} and claimed ${claimed} for full review.`}
          </p>
          <Button asChild variant="outline">
            <Link href={`/cases/${caseId}/submissions`}>
              <ArrowLeft className="h-4 w-4" />
              Back to queue
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  const remaining = submissions.length - cursor
  const progressPct = submissions.length > 0 ? (triaged / submissions.length) * 100 : 0

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/cases/${caseId}/submissions`}
            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Exit triage mode
          </Link>
          <span className="text-slate-300">|</span>
          <span className="text-sm text-slate-600 font-medium">Triage mode</span>
        </div>
        <div className="text-sm text-slate-500">
          <span className="font-semibold text-slate-900">{triaged}</span> of{' '}
          <span className="font-semibold text-slate-900">{submissions.length}</span> triaged
          {' '}— {remaining} remaining
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-slate-200">
        <div
          className="h-full bg-indigo-500 transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8">
        <p className="text-xs text-slate-400 mb-6 text-center">
          Review each submission and decide quickly. Claim, defer, or discard.
          <span className="ml-2 font-mono">C = Claim · D = Defer · X = Discard</span>
        </p>

        {/* Main card */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-5">
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <PriorityBadge
                level={current.priority_level ?? 'medium'}
                score={current.priority_score ?? 0}
              />
              {current.firsthand && (
                <span className="inline-flex items-center gap-0.5 text-xs text-slate-500">
                  <User className="h-3 w-3" />
                  Firsthand
                </span>
              )}
              {current.interpretation_text && (
                <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  Interpretation included
                </span>
              )}
              <span className="text-xs text-slate-400 ml-auto">{formatDate(current.intake_date, true)}</span>
            </div>

            <p className="text-sm text-slate-800 leading-relaxed bg-slate-50 rounded-md p-3 border border-slate-100 font-mono mb-3">
              {truncate(current.raw_text, 300)}
              {current.raw_text.length > 300 && (
                <span className="text-slate-400 text-xs"> [truncated — full text in review]</span>
              )}
            </p>

            <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap">
              <span>{labelForObservationMode(current.observation_mode)}</span>
              {(current.entity_count_step6 ?? 0) > 0 && (
                <span>{current.entity_count_step6} identifier{current.entity_count_step6 !== 1 ? 's' : ''} submitted</span>
              )}
              {(current.word_count ?? 0) > 0 && (
                <span>{current.word_count} words</span>
              )}
            </div>

            {/* Novelty flags */}
            {current.novelty_flags && current.novelty_flags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {current.novelty_flags.map((flag, i) => {
                  if (flag.type === 'new_entity') {
                    return <span key={i} className="text-[11px] bg-green-100 text-green-700 rounded px-1.5 py-0.5">New entity: {flag.label}</span>
                  }
                  if (flag.type === 'corroboration') {
                    return <span key={i} className="text-[11px] bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">Corroborates: {flag.label}</span>
                  }
                  if (flag.type === 'duplicate') {
                    return <span key={i} className="text-[11px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">Possible duplicate {flag.similarity ? `(${flag.similarity}%)` : ''}</span>
                  }
                  return null
                })}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="border-t border-slate-100 p-4 bg-slate-50">
            {!showDiscard ? (
              <div className="flex items-center gap-3">
                <Button
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={() => doTriage(current.id, 'claim')}
                  disabled={loading}
                >
                  <span className="mr-2 text-xs opacity-60">[C]</span>
                  Claim this
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => doTriage(current.id, 'defer')}
                  disabled={loading}
                >
                  <span className="mr-2 text-xs opacity-60">[D]</span>
                  Defer
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 text-slate-500"
                  onClick={() => setShowDiscard(true)}
                  disabled={loading}
                >
                  <span className="mr-2 text-xs opacity-60">[X]</span>
                  Discard ▾
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 font-medium">Select discard reason:</p>
                <div className="grid grid-cols-2 gap-2">
                  {DISCARD_REASONS.map(r => (
                    <button
                      key={r.value}
                      className={`text-xs px-3 py-2 rounded border transition-colors ${
                        discardReason === r.value
                          ? 'border-red-300 bg-red-50 text-red-700 font-medium'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                      onClick={() => setDiscardReason(r.value)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => doTriage(current.id, 'discard', discardReason)}
                    disabled={loading}
                  >
                    Confirm discard
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowDiscard(false)}
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 text-center">
          <Link
            href={`/cases/${caseId}/submissions/${current.id}`}
            className="text-xs text-slate-400 hover:text-slate-600 underline"
          >
            Open full submission to decide
          </Link>
        </div>
      </div>
    </div>
  )
}
