'use client'

// CaseDashboard is handled directly in the page server component.
// This file exists as a client sub-component for interactive dashboard elements.

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface CaseDashboardProps {
  caseId: string
}

export function CaseDashboard({ caseId }: CaseDashboardProps) {
  const supabase = createClient()

  const { data: stats, isLoading } = useQuery({
    queryKey: ['case-stats', caseId],
    queryFn: async () => {
      const [subsRes, entitiesRes, unreviewedRes] = await Promise.all([
        supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('case_id', caseId),
        supabase.from('entities').select('id', { count: 'exact', head: true }).eq('case_id', caseId),
        supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('case_id', caseId).eq('review_status', 'unverified'),
      ])

      return {
        submissions: subsRes.count ?? 0,
        entities: entitiesRes.count ?? 0,
        unreviewed: unreviewedRes.count ?? 0,
      }
    },
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-md" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <CardContent className="p-4 text-center">
          <p className="text-2xl font-bold">{stats?.submissions ?? 0}</p>
          <p className="text-xs text-slate-500 mt-0.5">Submissions</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 text-center">
          <p className="text-2xl font-bold">{stats?.entities ?? 0}</p>
          <p className="text-xs text-slate-500 mt-0.5">Entities</p>
        </CardContent>
      </Card>
      <Card className={stats?.unreviewed ?? 0 > 0 ? 'border-amber-200 bg-amber-50' : ''}>
        <CardContent className="p-4 text-center">
          <p className={`text-2xl font-bold ${(stats?.unreviewed ?? 0) > 0 ? 'text-amber-700' : ''}`}>
            {stats?.unreviewed ?? 0}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Needs review</p>
        </CardContent>
      </Card>
    </div>
  )
}
