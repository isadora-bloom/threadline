'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { GradeBadge } from './GradeBadge'
import { SignalsBreakdown } from './SignalsBreakdown'
import { ReviewActionButtons } from './ReviewActionButtons'
import { ChevronDown, ChevronUp, MapPin, Calendar } from 'lucide-react'
import type { LinkScoreWithClaims, PatternReviewerStatus } from '@/lib/types'
import { formatDate, truncate } from '@/lib/utils'

interface LinkCardProps {
  linkScore: LinkScoreWithClaims
  caseId: string
}

function ClaimSnippet({
  claim,
  label,
  caseId,
  submissionId,
}: {
  claim: LinkScoreWithClaims['claim_a']
  label: string
  caseId: string
  submissionId?: string
}) {
  if (!claim) return null

  return (
    <div className="bg-slate-50 rounded-md p-3 border border-slate-100 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        {claim.event_date && (
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(claim.event_date)}
          </span>
        )}
        {claim.content_confidence === 'low' && (
          <span className="text-[10px] text-red-500 bg-red-50 border border-red-100 rounded px-1 py-0">
            Low confidence
          </span>
        )}
      </div>
      <p className="text-xs font-mono text-slate-700 leading-relaxed">
        &ldquo;{truncate(claim.extracted_text, 180)}&rdquo;
      </p>
      {submissionId && (
        <Link
          href={`/cases/${caseId}/submissions/${submissionId}`}
          className="text-[10px] text-indigo-500 hover:text-indigo-700"
        >
          Source submission
        </Link>
      )}
    </div>
  )
}

export function LinkCard({ linkScore, caseId }: LinkCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(linkScore.reviewer_status ?? 'unreviewed')
  const isDismissed = currentStatus === 'dismissed'
  const signals = (linkScore.signals ?? {}) as Record<string, unknown>

  return (
    <Card className={`border-slate-200 transition-all ${isDismissed ? 'opacity-60' : ''}`}>
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <GradeBadge grade={linkScore.grade} score={linkScore.score} />
              <span className="text-xs text-slate-500">Surfaced for review</span>
              {linkScore.distance_miles != null && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {linkScore.distance_miles.toFixed(1)} mi apart
                </span>
              )}
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-slate-400 hover:text-slate-600 flex-shrink-0"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          {/* Claims */}
          <div className="space-y-2">
            <ClaimSnippet
              claim={linkScore.claim_a}
              label="Claim A"
              caseId={caseId}
              submissionId={undefined}
            />
            <ClaimSnippet
              claim={linkScore.claim_b}
              label="Claim B"
              caseId={caseId}
              submissionId={undefined}
            />
          </div>

          {/* Signals breakdown */}
          {expanded && Object.keys(signals).length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
                Signals breakdown
              </p>
              <SignalsBreakdown
                signals={signals}
                distanceMiles={linkScore.distance_miles ?? undefined}
              />
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">Total score</span>
                <span className="text-xs font-mono font-semibold text-slate-700">
                  {linkScore.score}
                </span>
              </div>
            </div>
          )}

          {/* Reviewer status if already reviewed */}
          {currentStatus !== 'unreviewed' && linkScore.reviewer_note && (
            <div className="text-xs text-slate-500 italic bg-slate-50 rounded p-2 border border-slate-100">
              &ldquo;{linkScore.reviewer_note}&rdquo;
              {linkScore.reviewed_at && (
                <span className="block text-[10px] text-slate-400 mt-1 not-italic">
                  {formatDate(linkScore.reviewed_at)}
                </span>
              )}
            </div>
          )}

          {/* Review actions */}
          <div className="border-t border-slate-100 pt-3">
            <ReviewActionButtons
              itemId={linkScore.id}
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
