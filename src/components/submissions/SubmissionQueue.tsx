'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { SubmissionCard } from './SubmissionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Inbox } from 'lucide-react'

interface SubmissionQueueProps {
  caseId: string
  filter?: string
}

export function SubmissionQueue({ caseId, filter = 'unverified' }: SubmissionQueueProps) {
  const supabase = createClient()

  const { data: submissions, isLoading } = useQuery({
    queryKey: ['submissions', caseId, filter],
    queryFn: async () => {
      let query = supabase
        .from('submissions')
        .select('*')
        .eq('case_id', caseId)
        .order('intake_date', { ascending: false })

      if (filter !== 'all') {
        query = query.eq('review_status', filter)
      }

      const { data } = await query
      return data ?? []
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-md" />
        ))}
      </div>
    )
  }

  if (!submissions || submissions.length === 0) {
    return (
      <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
        <Inbox className="h-12 w-12 text-slate-300 mx-auto mb-3" />
        <p className="font-medium text-slate-600">No submissions</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {submissions.map((s) => (
        <SubmissionCard key={s.id} submission={s} caseId={caseId} />
      ))}
    </div>
  )
}
