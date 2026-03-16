'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { GradeBadge } from './GradeBadge'
import { SignalsBreakdown } from './SignalsBreakdown'
import { ReviewActionButtons } from './ReviewActionButtons'
import { ChevronDown, ChevronUp, Calendar, Hash } from 'lucide-react'
import { FLAG_LABELS, type PatternFlagWithClaims, type PatternReviewerStatus } from '@/lib/types'
import { formatDate, truncate } from '@/lib/utils'

interface PatternFlagCardProps {
  flag: PatternFlagWithClaims
  caseId: string
}

function ReviewerStatusBadge({ status, reviewedAt, reviewerNote }: {
  status: string
  reviewedAt?: string | null
  reviewerNote?: string | null
}) {
  const map: Record<string, { label: string; className: string }> = {
    worth_investigating: { label: 'Worth investigating', className: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
    confirmed: { label: 'Confirmed', className: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
    dismissed: { label: 'Dismissed', className: 'text-slate-400 bg-slate-50 border-slate-200' },
  }
  const s = map[status]
  if (!s) return null

  return (
    <div className="space-y-1">
      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded border font-medium ${s.className}`}>
        {s.label}
      </span>
      {reviewedAt && (
        <p className="text-xs text-slate-400">Reviewed {formatDate(reviewedAt)}</p>
      )}
      {reviewerNote && (
        <p className="text-xs text-slate-500 italic">&ldquo;{reviewerNote}&rdquo;</p>
      )}
    </div>
  )
}

export function PatternFlagCard({ flag, caseId }: PatternFlagCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(flag.reviewer_status)

  const flagLabel = FLAG_LABELS[flag.flag_type] ?? flag.flag_type.replace(/_/g, ' ')
  const signals = (flag.signals ?? {}) as Record<string, unknown>
  const hasSignals = Object.keys(signals).length > 0
  const isDismissed = currentStatus === 'dismissed'

  return (
    <Card className={`border-slate-200 transition-all ${isDismissed ? 'opacity-60' : ''}`}>
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <GradeBadge grade={flag.grade} score={flag.score} />
              <span className="text-xs text-slate-500 font-medium">{flagLabel}</span>
              {currentStatus !== 'unreviewed' && (
                <ReviewerStatusBadge
                  status={currentStatus}
                  reviewedAt={flag.reviewed_at}
                  reviewerNote={flag.reviewer_note}
                />
              )}
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-slate-400 hover:text-slate-600 flex-shrink-0 mt-0.5"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          {/* Title */}
          <p className="text-sm font-medium text-slate-800">{flag.title}</p>

          {/* Description */}
          <p className="text-xs text-slate-500 leading-relaxed">{flag.description}</p>

          {/* Involved claims preview */}
          {flag.involved_claims && flag.involved_claims.length > 0 && (
            <div className="space-y-1.5">
              {flag.involved_claims.slice(0, expanded ? undefined : 2).map((claim) => (
                <div
                  key={claim.id}
                  className="flex items-start gap-2 bg-slate-50 rounded-md p-2.5 border border-slate-100"
                >
                  <Hash className="h-3.5 w-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-slate-700 leading-relaxed">
                      &ldquo;{truncate(claim.extracted_text, 120)}&rdquo;
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {claim.event_date && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(claim.event_date)}
                        </span>
                      )}
                      <Link
                        href={`/cases/${caseId}/patterns?claim=${claim.id}`}
                        className="text-[10px] text-indigo-500 hover:text-indigo-700"
                      >
                        View in patterns
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
              {!expanded && flag.involved_claims.length > 2 && (
                <button
                  onClick={() => setExpanded(true)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  +{flag.involved_claims.length - 2} more claims
                </button>
              )}
            </div>
          )}

          {/* Signals breakdown — only when expanded */}
          {expanded && hasSignals && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
                Signals
              </p>
              <SignalsBreakdown signals={signals} />
            </div>
          )}

          {/* Review actions */}
          <div className="border-t border-slate-100 pt-3">
            <ReviewActionButtons
              itemId={flag.id}
              currentStatus={currentStatus}
              itemType="flag"
              onStatusChange={(status: PatternReviewerStatus) => setCurrentStatus(status)}
              compact
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
