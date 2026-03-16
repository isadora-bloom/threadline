import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EpistemicBadge, getEpistemicType } from '@/components/shared/EpistemicBadge'
import { ConfidenceBadge } from '@/components/shared/ConfidenceBadge'
import {
  labelForClaimType,
  labelForEntityType,
  labelForReviewStatus,
  formatDate,
  truncate,
} from '@/lib/utils'
import { AlertTriangle, ArrowUpRight, Activity, GitCompare } from 'lucide-react'
import type { ClaimWithLinks } from '@/lib/types'

const BEHAVIORAL_CATEGORY_LABELS: Record<string, string> = {
  method_of_approach: 'Method of approach',
  method_of_control: 'Method of control',
  method_of_disposal: 'Method of disposal',
  signature_behavior: 'Signature behavior',
  forensic_awareness: 'Forensic awareness',
  staging: 'Scene staging',
  unknown: 'Unknown behavioral',
}

interface ClaimCardProps {
  claim: ClaimWithLinks & {
    behavioral_category?: string | null
    behavioral_consistency_flag?: boolean
    link_score_count?: number
  }
  caseId: string
}

function reviewStatusVariant(status: string) {
  const map: Record<string, string> = {
    unverified: 'muted',
    under_review: 'info',
    corroborated: 'default',
    confirmed: 'success',
    disputed: 'destructive',
    retracted: 'muted',
  }
  return (map[status] ?? 'muted') as never
}

export function ClaimCard({ claim, caseId }: ClaimCardProps) {
  const epistemicType = getEpistemicType(
    claim.verification_status,
    claim.claim_type,
    claim.interpretation_flag
  )

  const submissionId = claim.submission_id

  return (
    <Card className="border-slate-200 hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-3">
            {/* Header badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <EpistemicBadge type={epistemicType} />
              <Badge variant="outline" className="text-xs">
                {labelForClaimType(claim.claim_type)}
              </Badge>
              <Badge variant={reviewStatusVariant(claim.verification_status)} className="text-xs">
                {labelForReviewStatus(claim.verification_status)}
              </Badge>
              {claim.interpretation_flag && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                  <AlertTriangle className="h-3 w-3" />
                  INTERPRETATION
                </span>
              )}
            </div>

            {/* Extracted text */}
            <p className="text-sm text-slate-700 font-mono bg-slate-50 rounded-md p-3 border border-slate-100 leading-relaxed">
              &ldquo;{truncate(claim.extracted_text, 300)}&rdquo;
            </p>

            {/* Confidence — always shown as two separate indicators */}
            <ConfidenceBadge
              sourceConfidence={claim.source_confidence}
              contentConfidence={claim.content_confidence}
            />

            {/* Linked entities */}
            {claim.entities && claim.entities.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {claim.entities.map((link) => {
                  const entity = link.entity
                  return (
                    <Link
                      key={link.entity_id}
                      href={`/cases/${caseId}/entities/${link.entity_id}`}
                      className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 rounded px-2 py-0.5 border border-slate-200 hover:bg-slate-200 transition-colors"
                    >
                      <span className="text-slate-400">{labelForEntityType(entity.entity_type)}</span>
                      <span className="font-medium">{entity.normalized_value ?? entity.raw_value}</span>
                    </Link>
                  )
                })}
              </div>
            )}

            {/* Behavioral metadata */}
            {(claim.behavioral_category || claim.behavioral_consistency_flag) && (
              <div className="flex flex-wrap gap-1.5">
                {claim.behavioral_category && claim.behavioral_category !== 'unknown' && (
                  <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 border border-purple-100 rounded px-2 py-0.5">
                    <Activity className="h-3 w-3" />
                    {BEHAVIORAL_CATEGORY_LABELS[claim.behavioral_category] ?? claim.behavioral_category}
                  </span>
                )}
                {claim.behavioral_consistency_flag && (
                  <span className="inline-flex items-center gap-1 text-xs bg-orange-50 text-orange-700 border border-orange-100 rounded px-2 py-0.5">
                    <GitCompare className="h-3 w-3" />
                    Consistent behavior flagged
                  </span>
                )}
              </div>
            )}

            {/* Link score count */}
            {typeof claim.link_score_count === 'number' && claim.link_score_count > 0 && (
              <div>
                <Link
                  href={`/cases/${caseId}/patterns?tab=links&claim=${claim.id}`}
                  className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700"
                >
                  <GitCompare className="h-3 w-3" />
                  Appears in {claim.link_score_count} link score{claim.link_score_count !== 1 ? 's' : ''}
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-3 text-xs text-slate-400">
              {claim.event_date && (
                <span>Event: {formatDate(claim.event_date)}</span>
              )}
              <span>Extracted {formatDate(claim.created_at)}</span>
              <Link
                href={`/cases/${caseId}/submissions/${submissionId}`}
                className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700"
              >
                Source submission
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
