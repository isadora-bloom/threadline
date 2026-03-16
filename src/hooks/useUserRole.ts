'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/lib/types'

export function useUserRole(caseId: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: ['user-role', caseId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      const { data } = await supabase
        .from('case_user_roles')
        .select('role')
        .eq('case_id', caseId)
        .eq('user_id', user.id)
        .single()

      return (data?.role ?? null) as UserRole | null
    },
    enabled: !!caseId,
  })
}

export function canReview(role: UserRole | null | undefined): boolean {
  return ['reviewer', 'lead_investigator', 'admin'].includes(role ?? '')
}

export function canExport(role: UserRole | null | undefined): boolean {
  return ['lead_investigator', 'export_only', 'admin'].includes(role ?? '')
}

export function canManageCase(role: UserRole | null | undefined): boolean {
  return ['lead_investigator', 'admin'].includes(role ?? '')
}

export function canViewAudit(role: UserRole | null | undefined): boolean {
  return ['lead_investigator', 'legal', 'admin'].includes(role ?? '')
}
