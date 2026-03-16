import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDate, labelForReviewStatus, labelForObservationMode, truncate } from '@/lib/utils'
import { Paperclip, AlertTriangle, User, ChevronRight } from 'lucide-react'
import type { Submission } from '@/lib/types'

interface SubmissionCardProps {
  submission: Submission & {
    file_count?: number
    entity_count?: number
    claim_count?: number
  }
  caseId: string
}

function reviewStatusVariant(status: string) {
  const map: Record<string, string> = {
    unverified: 'warning',
    under_review: 'info',
    corroborated: 'default',
    confirmed: 'success',
    disputed: 'destructive',
    retracted: 'muted',
  }
  return (map[status] ?? 'muted') as 'warning' | 'info' | 'default' | 'success' | 'destructive' | 'muted'
}

function sourceTypeLabel(type: string): string {
  const map: Record<string, string> = {
    named_individual: 'Named individual',
    anonymous: 'Anonymous',
    organization: 'Organization',
    official_record: 'Official record',
    media: 'Media',
    system: 'System',
  }
  return map[type] ?? type
}

export function SubmissionCard({ submission, caseId }: SubmissionCardProps) {
  return (
    <Card className="border-slate-200 hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge variant={reviewStatusVariant(submission.review_status) as never}>
                {labelForReviewStatus(submission.review_status)}
              </Badge>
              <Badge variant="outline">{sourceTypeLabel(submission.source_type)}</Badge>
              {submission.firsthand && (
                <Badge variant="muted">
                  <User className="h-3 w-3 mr-1" />
                  Firsthand
                </Badge>
              )}
              {submission.interpretation_text && (
                <Badge variant="warning">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Interpretation included
                </Badge>
              )}
            </div>

            <p className="text-sm text-slate-700 font-mono bg-slate-50 rounded p-2 border border-slate-100">
              {truncate(submission.raw_text, 200)}
            </p>

            <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
              <span>{formatDate(submission.intake_date, true)}</span>
              <span>{labelForObservationMode(submission.observation_mode)}</span>
              {(submission.file_count ?? 0) > 0 && (
                <span className="flex items-center gap-1">
                  <Paperclip className="h-3 w-3" />
                  {submission.file_count} {submission.file_count === 1 ? 'file' : 'files'}
                </span>
              )}
              {(submission.entity_count ?? 0) > 0 && (
                <span>{submission.entity_count} identifiers submitted</span>
              )}
              {(submission.claim_count ?? 0) > 0 && (
                <span>{submission.claim_count} claims extracted</span>
              )}
            </div>
          </div>

          <Button asChild size="sm" variant="outline" className="flex-shrink-0">
            <Link href={`/cases/${caseId}/submissions/${submission.id}`}>
              Review
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
