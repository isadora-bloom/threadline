'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { CaseWithCounts, UserRole } from '@/lib/types'

export function useCase(caseId: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: ['case', caseId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Fetch case
      const { data: caseData, error: caseError } = await supabase
        .from('cases')
        .select('*')
        .eq('id', caseId)
        .single()

      if (caseError) throw caseError

      // Fetch user role
      const { data: roleData } = await supabase
        .from('case_user_roles')
        .select('role')
        .eq('case_id', caseId)
        .eq('user_id', user.id)
        .single()

      // Fetch counts
      const [submissionsRes, claimsRes, entitiesRes, unreviewedRes] = await Promise.all([
        supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('case_id', caseId),
        supabase.from('claims').select('id', { count: 'exact', head: true })
          .in('submission_id', (await supabase.from('submissions').select('id').eq('case_id', caseId)).data?.map(s => s.id) ?? []),
        supabase.from('entities').select('id', { count: 'exact', head: true }).eq('case_id', caseId),
        supabase.from('submissions').select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .eq('review_status', 'unverified'),
      ])

      const result: CaseWithCounts = {
        ...caseData,
        submission_count: submissionsRes.count ?? 0,
        claim_count: claimsRes.count ?? 0,
        entity_count: entitiesRes.count ?? 0,
        unreviewed_count: unreviewedRes.count ?? 0,
        user_role: roleData?.role as UserRole | undefined,
      }

      return result
    },
    enabled: !!caseId,
  })
}
