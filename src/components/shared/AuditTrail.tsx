'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { formatDate, labelForAuditAction } from '@/lib/utils'
import { Lock, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { AuditTargetType } from '@/lib/types'

interface AuditTrailProps {
  targetId?: string
  targetType?: AuditTargetType
  caseId?: string
  limit?: number
}

const actionVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline' | 'warning' | 'info' | 'success' | 'muted'> = {
  created: 'success',
  edited: 'info',
  approved: 'success',
  disputed: 'warning',
  retracted: 'destructive',
  merged: 'secondary',
  split: 'secondary',
  flagged: 'warning',
  escalated: 'warning',
  exported: 'info',
  viewed: 'muted',
}

export function AuditTrail({ targetId, targetType, caseId, limit = 50 }: AuditTrailProps) {
  const supabase = createClient()

  const { data: actions, isLoading } = useQuery({
    queryKey: ['audit-trail', targetId, caseId],
    queryFn: async () => {
      let query = supabase
        .from('review_actions')
        .select('*, actor:user_profiles(full_name, organization)')
        .order('timestamp', { ascending: false })
        .limit(limit)

      if (targetId && targetType) {
        query = query.eq('target_id', targetId).eq('target_type', targetType)
      } else if (caseId) {
        query = query.eq('case_id', caseId)
      }

      const { data, error } = await query
      if (error) throw error
      return data
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (!actions || actions.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400 text-sm">
        No audit records found.
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-4 p-3 bg-slate-50 rounded-md border border-slate-200">
        <Lock className="h-4 w-4 text-slate-500 flex-shrink-0" />
        <p className="text-xs text-slate-600 font-medium">
          Immutable audit record — entries cannot be edited or deleted
        </p>
      </div>

      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200" />

        {actions.map((action) => {
          const actor = action.actor as { full_name?: string; organization?: string } | null
          const actorName = actor?.full_name ?? 'Unknown user'
          const variant = actionVariant[action.action] ?? 'muted'

          return (
            <div key={action.id} className="relative pl-10 pb-4">
              <div className="absolute left-2.5 top-1.5 h-3 w-3 rounded-full bg-white border-2 border-slate-300" />

              <div className="bg-white border border-slate-100 rounded-md p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-sm font-medium text-slate-800">{actorName}</span>
                    </div>
                    <Badge variant={variant as never}>
                      {labelForAuditAction(action.action)}
                    </Badge>
                    <span className="text-xs text-slate-400 capitalize">
                      {action.target_type}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {formatDate(action.timestamp, true)}
                  </span>
                </div>

                {action.note && (
                  <p className="mt-1.5 text-xs text-slate-600 italic">
                    &quot;{action.note}&quot;
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
