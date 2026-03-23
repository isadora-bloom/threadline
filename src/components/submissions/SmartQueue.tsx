'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { formatDate, labelForObservationMode, truncate } from '@/lib/utils'
import {
  Inbox,
  AlertTriangle,
  Paperclip,
  User,
  ChevronRight,
  CheckSquare,
  Clock,
  CheckCircle2,
  EyeOff,
} from 'lucide-react'
import Link from 'next/link'
import type { NoveltyFlag, QueueStats, UserRole } from '@/lib/types'
import type { Submission } from '@/lib/types'

type EnrichedSub = Submission & {
  file_count: number
  claim_count: number
  novelty_flags: NoveltyFlag[]
}

interface SmartQueueProps {
  submissions: EnrichedSub[]
  caseId: string
  initialTab: string
  queueStats: QueueStats
  userRole: UserRole
}

type TabId = 'priority' | 'corroboration' | 'quick_wins'

type DiscardReason = 'off_topic' | 'duplicate' | 'spam' | 'insufficient_detail'

const DISCARD_REASONS: { value: DiscardReason; label: string }[] = [
  { value: 'off_topic', label: 'Off-topic' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'spam', label: 'Spam' },
  { value: 'insufficient_detail', label: 'Insufficient detail' },
]

function PriorityBadge({ level }: { level: string }) {
  const cls =
    level === 'high'
      ? 'bg-red-100 text-red-700 border border-red-300'
      : level === 'medium'
      ? 'bg-amber-100 text-amber-700 border border-amber-300'
      : 'bg-slate-100 text-slate-600 border border-slate-200'
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide ${cls}`}>
      {level}
    </span>
  )
}

function TriageBadge({ status }: { status: string }) {
  if (status === 'claimed')
    return <span className="text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">Claimed</span>
  if (status === 'deferred')
    return <span className="text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">Deferred</span>
  if (status === 'discarded')
    return <span className="text-[11px] font-medium text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 line-through">Discarded</span>
  return null
}

function NoveltyChips({ flags }: { flags: NoveltyFlag[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {flags.map((flag, i) => {
        if (flag.type === 'new_entity') {
          return (
            <span key={i} className="text-[11px] bg-green-100 text-green-700 rounded px-1.5 py-0.5">
              New entity: {flag.label}
            </span>
          )
        }
        if (flag.type === 'corroboration') {
          return (
            <span key={i} className="text-[11px] bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">
              Corroborates: {flag.label}{flag.count ? `, ${flag.count}x` : ''}
            </span>
          )
        }
        if (flag.type === 'contradiction') {
          return (
            <span key={i} className="text-[11px] bg-red-100 text-red-700 rounded px-1.5 py-0.5">
              Possible contradiction
            </span>
          )
        }
        if (flag.type === 'duplicate') {
          return (
            <span key={i} className="text-[11px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">
              Possible duplicate {flag.similarity ? `(${flag.similarity}% similar)` : ''}
            </span>
          )
        }
        return null
      })}
    </div>
  )
}

function SubmissionQueueCard({
  submission,
  caseId,
  selected,
  onSelect,
  onTriage,
  triaging,
}: {
  submission: EnrichedSub
  caseId: string
  selected: boolean
  onSelect: (id: string, checked: boolean) => void
  onTriage: (id: string, action: 'claim' | 'defer' | 'discard', reason?: DiscardReason) => Promise<void>
  triaging: boolean
}) {
  const [showDiscardMenu, setShowDiscardMenu] = useState(false)
  const [discardReason, setDiscardReason] = useState<DiscardReason>('off_topic')

  const isDiscarded = submission.triage_status === 'discarded'
  const hasSoftDelete = !!(submission as EnrichedSub & { discarded_at?: string | null }).discarded_at

  return (
    <Card className={`border-slate-200 transition-shadow ${isDiscarded || hasSoftDelete ? 'opacity-50' : 'hover:shadow-sm'}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelect(submission.id, !!checked)}
            className="mt-1 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <PriorityBadge level={submission.priority_level ?? 'medium'} />
              {submission.triage_status !== 'untriaged' && (
                <TriageBadge status={submission.triage_status ?? 'untriaged'} />
              )}
              {submission.firsthand && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-500">
                  <User className="h-3 w-3" />
                  Firsthand
                </span>
              )}
              {submission.interpretation_text && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  Interpretation included
                </span>
              )}
              <span className="text-[11px] text-slate-400 ml-auto">
                Score: {submission.priority_score ?? 0}
              </span>
            </div>

            <p className={`text-sm text-slate-700 font-mono bg-slate-50 rounded p-2 border border-slate-100 leading-relaxed ${hasSoftDelete ? 'line-through text-slate-400' : ''}`}>
              {truncate(submission.raw_text, 220)}
            </p>

            {submission.novelty_flags && submission.novelty_flags.length > 0 && (
              <NoveltyChips flags={submission.novelty_flags} />
            )}

            <div className="mt-2 flex items-center gap-4 text-xs text-slate-500 flex-wrap">
              <span>{formatDate(submission.intake_date, true)}</span>
              <span>{labelForObservationMode(submission.observation_mode)}</span>
              {submission.entity_count_step6 > 0 && (
                <span>{submission.entity_count_step6} identifier{submission.entity_count_step6 !== 1 ? 's' : ''} submitted</span>
              )}
              {submission.word_count > 0 && (
                <span>{submission.word_count} words</span>
              )}
              {submission.file_count > 0 && (
                <span className="flex items-center gap-0.5">
                  <Paperclip className="h-3 w-3" />
                  {submission.file_count} file{submission.file_count !== 1 ? 's' : ''}
                </span>
              )}
              {submission.claim_count > 0 && (
                <span>{submission.claim_count} claim{submission.claim_count !== 1 ? 's' : ''} extracted</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {submission.triage_status === 'untriaged' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                  onClick={() => onTriage(submission.id, 'claim')}
                  disabled={triaging}
                >
                  Claim
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-slate-500"
                  onClick={() => onTriage(submission.id, 'defer')}
                  disabled={triaging}
                >
                  Defer
                </Button>
                <div className="relative">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-slate-400 hover:text-slate-600"
                    onClick={() => setShowDiscardMenu(v => !v)}
                    disabled={triaging}
                  >
                    Discard ▾
                  </Button>
                  {showDiscardMenu && (
                    <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-md shadow-lg p-2 w-48">
                      <p className="text-xs text-slate-500 mb-1.5 px-1">Reason</p>
                      {DISCARD_REASONS.map(r => (
                        <button
                          key={r.value}
                          className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-slate-50 ${discardReason === r.value ? 'text-indigo-700 font-medium' : 'text-slate-700'}`}
                          onClick={() => setDiscardReason(r.value)}
                        >
                          {r.label}
                        </button>
                      ))}
                      <div className="border-t border-slate-100 mt-2 pt-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="w-full h-7 text-xs"
                          onClick={async () => {
                            setShowDiscardMenu(false)
                            await onTriage(submission.id, 'discard', discardReason)
                          }}
                          disabled={triaging}
                        >
                          Confirm discard
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <Link href={`/cases/${caseId}/submissions/${submission.id}`}>
                Review
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function SmartQueue({
  submissions,
  caseId,
  initialTab,
  queueStats,
  userRole,
}: SmartQueueProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<TabId>(
    (initialTab as TabId) ?? 'priority'
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [triaging, setTriaging] = useState(false)
  const [batchAction, setBatchAction] = useState<'deferred' | 'discarded'>('deferred')
  const [batchDiscardReason, setBatchDiscardReason] = useState<DiscardReason>('off_topic')
  const [showDiscarded, setShowDiscarded] = useState(false)

  const isLeadOrAdmin = userRole === 'lead_investigator' || userRole === 'admin'

  // Filter out soft-deleted submissions unless lead/admin has toggled them on
  const visibleSubmissions = submissions.filter(s =>
    showDiscarded ? true : !(s as EnrichedSub & { discarded_at?: string | null }).discarded_at
  )

  // Tab-filtered lists
  const priorityTab = [...visibleSubmissions].sort((a, b) => {
    const levelOrder: Record<string, number> = { high: 3, medium: 2, low: 1 }
    const la = levelOrder[a.priority_level ?? 'medium'] ?? 2
    const lb = levelOrder[b.priority_level ?? 'medium'] ?? 2
    if (lb !== la) return lb - la
    const sa = a.priority_score ?? 0
    const sb = b.priority_score ?? 0
    if (sb !== sa) return sb - sa
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const corroborationTab = visibleSubmissions
    .filter(s => s.novelty_flags?.some(f => f.type === 'corroboration'))
    .sort((a, b) => {
      const ca = a.novelty_flags?.filter(f => f.type === 'corroboration').reduce((n, f) => n + (f.count ?? 1), 0) ?? 0
      const cb = b.novelty_flags?.filter(f => f.type === 'corroboration').reduce((n, f) => n + (f.count ?? 1), 0) ?? 0
      return cb - ca
    })

  const quickWinsTab = visibleSubmissions
    .filter(s => s.triage_status === 'untriaged' && (s.word_count ?? 0) < 200 && (s.entity_count_step6 ?? 0) >= 2)
    .sort((a, b) => (b.entity_count_step6 ?? 0) - (a.entity_count_step6 ?? 0))

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'priority', label: 'Priority', count: priorityTab.length },
    { id: 'corroboration', label: 'Corroboration', count: corroborationTab.length },
    { id: 'quick_wins', label: 'Quick wins', count: quickWinsTab.length },
  ]

  const activeList =
    activeTab === 'priority'
      ? priorityTab
      : activeTab === 'corroboration'
      ? corroborationTab
      : quickWinsTab

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleTriage = useCallback(async (
    id: string,
    action: 'claim' | 'defer' | 'discard',
    reason?: DiscardReason
  ) => {
    setTriaging(true)
    try {
      const res = await fetch('/api/submissions/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: id,
          action,
          discardReason: reason,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast({ variant: 'destructive', title: 'Triage failed', description: data.error })
      } else {
        router.refresh()
      }
    } catch {
      toast({ variant: 'destructive', title: 'Triage failed', description: 'Network error' })
    } finally {
      setTriaging(false)
    }
  }, [router, toast])

  const handleBatchTriage = async () => {
    if (selected.size === 0) return
    setTriaging(true)

    const action = batchAction === 'deferred' ? 'defer' : 'discard'
    const promises = [...selected].map(id =>
      fetch('/api/submissions/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: id,
          action,
          discardReason: action === 'discard' ? batchDiscardReason : undefined,
        }),
      })
    )

    await Promise.all(promises)
    setSelected(new Set())
    setTriaging(false)
    toast({ title: `${selected.size} submission${selected.size !== 1 ? 's' : ''} ${batchAction}` })
    router.refresh()
  }

  if (submissions.length === 0) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
        <Inbox className="h-12 w-12 text-slate-300 mx-auto mb-3" />
        <p className="font-semibold text-slate-700">No submissions yet</p>
        <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
          Add submissions manually using Quick Capture in the sidebar, or share a public submission link with witnesses and tip providers.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Queue stats bar */}
      <div className="flex items-center gap-6 py-3 px-4 bg-white border border-slate-200 rounded-lg text-sm flex-wrap">
        <div className="flex items-center gap-2 text-slate-600">
          <Inbox className="h-4 w-4 text-slate-400" />
          <span>
            <span className="font-semibold text-slate-900">{queueStats.untriaged}</span>
            {' '}untriaged
            {queueStats.untriaged > 0 && (
              <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white">
                !
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <Clock className="h-4 w-4 text-slate-400" />
          <span>
            <span className="font-semibold text-slate-900">{queueStats.in_review}</span>
            {' '}in review
          </span>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <CheckCircle2 className="h-4 w-4 text-slate-400" />
          <span>
            <span className="font-semibold text-slate-900">{queueStats.reviewed_today}</span>
            {' '}reviewed today
          </span>
        </div>
        {isLeadOrAdmin && (
          <button
            onClick={() => setShowDiscarded(v => !v)}
            className={`ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors ${
              showDiscarded
                ? 'bg-slate-100 border-slate-300 text-slate-700'
                : 'border-slate-200 text-slate-400 hover:text-slate-600'
            }`}
          >
            <EyeOff className="h-3.5 w-3.5" />
            {showDiscarded ? 'Hiding discarded' : 'Show discarded'}
          </button>
        )}
      </div>

      {/* Batch triage bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-sm">
          <CheckSquare className="h-4 w-4 text-indigo-600" />
          <span className="text-indigo-800 font-medium">{selected.size} selected</span>
          <span className="text-indigo-500">—</span>
          <span className="text-indigo-700">Mark as:</span>
          <Select
            value={batchAction}
            onValueChange={(v) => setBatchAction(v as typeof batchAction)}
          >
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="deferred">Deferred</SelectItem>
              <SelectItem value="discarded">Discarded</SelectItem>
            </SelectContent>
          </Select>
          {batchAction === 'discarded' && (
            <Select
              value={batchDiscardReason}
              onValueChange={(v) => setBatchDiscardReason(v as DiscardReason)}
            >
              <SelectTrigger className="h-7 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISCARD_REASONS.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleBatchTriage}
            disabled={triaging}
          >
            Apply
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-slate-500"
            onClick={() => setSelected(new Set())}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <Badge variant="muted" className="ml-1.5 text-[10px]">
                {tab.count}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Tab descriptions */}
      <div className="text-xs text-slate-500">
        {activeTab === 'priority' && 'Sorted by priority level and score — highest quality submissions first.'}
        {activeTab === 'corroboration' && 'Submissions that mention entities already seen in this case. Review these to add supporting detail.'}
        {activeTab === 'quick_wins' && 'Short, structured submissions with multiple identifiers. Fast to review.'}
      </div>

      {/* List */}
      <div className="space-y-2.5">
        {activeList.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
            <Inbox className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="font-medium text-slate-600">No submissions in this view</p>
            <p className="text-sm text-slate-400 mt-1">
              {activeTab === 'corroboration'
                ? 'No submissions have surfaced corroborating entities yet.'
                : activeTab === 'quick_wins'
                ? 'No untriaged submissions match the quick wins criteria.'
                : 'No submissions found.'}
            </p>
          </div>
        ) : (
          activeList.map(s => (
            <SubmissionQueueCard
              key={s.id}
              submission={s}
              caseId={caseId}
              selected={selected.has(s.id)}
              onSelect={handleSelect}
              onTriage={handleTriage}
              triaging={triaging}
            />
          ))
        )}
      </div>
    </div>
  )
}
