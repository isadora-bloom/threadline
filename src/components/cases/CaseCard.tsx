'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, labelForCaseType, labelForCaseStatus } from '@/lib/utils'
import { Inbox, FileText, Users, MapPin } from 'lucide-react'
import type { CaseWithCounts } from '@/lib/types'

function caseTypeVariant(type: string): 'default' | 'destructive' | 'secondary' | 'outline' | 'warning' | 'info' | 'muted' {
  const map: Record<string, 'default' | 'destructive' | 'secondary' | 'warning' | 'info' | 'muted'> = {
    missing_person: 'warning',
    unidentified_remains: 'warning',
    homicide: 'destructive',
    assault: 'destructive',
    trafficking: 'destructive',
    other: 'muted',
  }
  return map[type] ?? 'muted'
}

function statusVariant(status: string): 'default' | 'secondary' | 'muted' | 'success' {
  const map: Record<string, 'default' | 'secondary' | 'muted' | 'success'> = {
    active: 'success',
    inactive: 'muted',
    closed: 'secondary',
    archived: 'muted',
  }
  return map[status] ?? 'muted'
}

interface CaseCardProps {
  caseData: CaseWithCounts
}

export function CaseCard({ caseData }: CaseCardProps) {
  return (
    <Link href={`/cases/${caseData.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer border-slate-200">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge variant={caseTypeVariant(caseData.case_type) as never}>
                  {labelForCaseType(caseData.case_type)}
                </Badge>
                <Badge variant={statusVariant(caseData.status) as never}>
                  {labelForCaseStatus(caseData.status)}
                </Badge>
              </div>

              <h3 className="font-semibold text-slate-900 text-base truncate">
                {caseData.title}
              </h3>

              {caseData.jurisdiction && (
                <div className="flex items-center gap-1 mt-1">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs text-slate-500">{caseData.jurisdiction}</span>
                </div>
              )}
            </div>

            <span className="text-xs text-slate-400 flex-shrink-0">
              {formatDate(caseData.updated_at)}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-5 border-t border-slate-100 pt-3">
            <div className="flex items-center gap-1.5 text-sm text-slate-600">
              <Inbox className="h-4 w-4 text-slate-400" />
              <span>{caseData.submission_count}</span>
              {caseData.unreviewed_count > 0 && (
                <span className="text-xs text-amber-600 font-medium">
                  ({caseData.unreviewed_count} new)
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-slate-600">
              <FileText className="h-4 w-4 text-slate-400" />
              <span>{caseData.claim_count} claims</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-slate-600">
              <Users className="h-4 w-4 text-slate-400" />
              <span>{caseData.entity_count} entities</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
