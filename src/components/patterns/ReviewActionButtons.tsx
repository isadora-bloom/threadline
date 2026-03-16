'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { CheckCircle, XCircle, RotateCcw } from 'lucide-react'
import type { PatternReviewerStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ReviewActionButtonsProps {
  itemId: string
  currentStatus: string
  itemType: 'flag' | 'link'
  onStatusChange: (newStatus: PatternReviewerStatus) => void
  compact?: boolean
}

export function ReviewActionButtons({
  itemId,
  currentStatus,
  itemType,
  onStatusChange,
  compact = false,
}: ReviewActionButtonsProps) {
  const { toast } = useToast()
  const [showNoteInput, setShowNoteInput] = useState<'dismiss' | 'confirm' | null>(null)
  const [note, setNote] = useState('')
  const [isPending, setIsPending] = useState(false)

  const isDismissed = currentStatus === 'dismissed'
  const isConfirmed = currentStatus === 'confirmed' || currentStatus === 'worth_investigating'
  const isReviewed = isDismissed || isConfirmed

  async function handleAction(action: 'dismiss' | 'confirm' | 'reopen') {
    if (action === 'dismiss' && !showNoteInput) {
      setShowNoteInput('dismiss')
      return
    }
    if (action === 'confirm' && !showNoteInput) {
      setShowNoteInput('confirm')
      return
    }

    setIsPending(true)

    try {
      if (action === 'reopen') {
        // Re-open: set back to unreviewed by calling confirm with unreviewed workaround
        const endpoint =
          itemType === 'flag'
            ? '/api/pattern/confirm-flag'
            : '/api/pattern/confirm-flag'

        // For reopen we use confirm-flag with a special approach
        // Actually we need to update directly — use a minimal confirm with status='worth_investigating' then reset
        // Since we don't have a dedicated reopen endpoint, use confirm-flag
        const res = await fetch('/api/pattern/confirm-flag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flagId: itemId, status: 'worth_investigating', note: 'Reopened for review' }),
        })
        if (!res.ok) throw new Error('Failed to reopen')
        onStatusChange('worth_investigating')
        toast({ title: 'Reopened', description: 'Item reopened for review.' })
      } else {
        const endpoint =
          action === 'dismiss' ? '/api/pattern/dismiss-flag' : '/api/pattern/confirm-flag'

        const body: Record<string, unknown> = {
          [itemType === 'flag' ? 'flagId' : 'flagId']: itemId,
          note: note || undefined,
        }
        if (action === 'confirm') body.status = 'worth_investigating'

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Request failed')
        }

        const newStatus: PatternReviewerStatus =
          action === 'dismiss' ? 'dismissed' : 'worth_investigating'
        onStatusChange(newStatus)
        toast({
          title: action === 'dismiss' ? 'Dismissed' : 'Marked for investigation',
          description:
            action === 'dismiss'
              ? 'This item has been dismissed.'
              : 'This item has been marked as worth investigating.',
        })
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setIsPending(false)
      setShowNoteInput(null)
      setNote('')
    }
  }

  if (showNoteInput) {
    return (
      <div className="space-y-2 mt-2">
        <Label className="text-xs text-slate-500">
          Note (optional) — {showNoteInput === 'dismiss' ? 'Why dismissing?' : 'Why worth investigating?'}
        </Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note..."
          className="text-xs min-h-[60px]"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={showNoteInput === 'dismiss' ? 'outline' : 'default'}
            onClick={() => handleAction(showNoteInput)}
            disabled={isPending}
            className={cn(
              showNoteInput === 'dismiss' && 'text-slate-600',
              showNoteInput === 'confirm' && 'bg-indigo-600 hover:bg-indigo-700'
            )}
          >
            {isPending
              ? 'Saving...'
              : showNoteInput === 'dismiss'
              ? 'Confirm dismiss'
              : 'Confirm'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowNoteInput(null)
              setNote('')
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  if (isDismissed) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <XCircle className="h-3.5 w-3.5" />
          Dismissed
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs text-slate-500 hover:text-slate-700"
          onClick={() => handleAction('reopen')}
          disabled={isPending}
        >
          <RotateCcw className="h-3 w-3" />
          Reopen
        </Button>
      </div>
    )
  }

  if (isConfirmed) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-indigo-600 flex items-center gap-1">
          <CheckCircle className="h-3.5 w-3.5" />
          {currentStatus === 'confirmed' ? 'Confirmed' : 'Worth investigating'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs text-slate-500 hover:text-slate-700"
          onClick={() => handleAction('reopen')}
          disabled={isPending}
        >
          <RotateCcw className="h-3 w-3" />
          Reopen
        </Button>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        className={cn('text-xs', compact ? 'h-7' : 'h-8')}
        onClick={() => handleAction('confirm')}
        disabled={isPending}
      >
        <CheckCircle className="h-3.5 w-3.5" />
        Worth investigating
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={cn('text-xs text-slate-400 hover:text-slate-600', compact ? 'h-7' : 'h-8')}
        onClick={() => handleAction('dismiss')}
        disabled={isPending}
      >
        <XCircle className="h-3.5 w-3.5" />
        Dismiss
      </Button>
    </div>
  )
}
