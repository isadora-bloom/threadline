'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { ClaimCard } from './ClaimCard'
import { Skeleton } from '@/components/ui/skeleton'
import { FileText } from 'lucide-react'
import type { ClaimWithLinks } from '@/lib/types'

interface ClaimListProps {
  caseId: string
  submissionIds: string[]
  filters?: {
    claim_type?: string
    status?: string
    interpretation?: string
    search?: string
  }
}

export function ClaimList({ caseId, submissionIds, filters }: ClaimListProps) {
  const supabase = createClient()

  const { data: claims, isLoading } = useQuery({
    queryKey: ['claims-list', caseId, submissionIds, filters],
    queryFn: async () => {
      if (submissionIds.length === 0) return []

      let query = supabase
        .from('claims')
        .select(`
          *,
          entities:claim_entity_links(
            entity_id,
            entity_role,
            identifier_source,
            confidence,
            entity:entities(id, entity_type, raw_value, normalized_value)
          )
        `)
        .in('submission_id', submissionIds)
        .order('created_at', { ascending: false })

      if (filters?.claim_type) query = query.eq('claim_type', filters.claim_type)
      if (filters?.status) query = query.eq('verification_status', filters.status)
      if (filters?.interpretation === 'true') query = query.eq('interpretation_flag', true)
      if (filters?.interpretation === 'false') query = query.eq('interpretation_flag', false)

      const { data } = await query
      let result = (data ?? []) as unknown as ClaimWithLinks[]

      if (filters?.search) {
        const s = filters.search.toLowerCase()
        result = result.filter(c => c.extracted_text.toLowerCase().includes(s))
      }

      return result
    },
    enabled: submissionIds.length > 0,
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-md" />
        ))}
      </div>
    )
  }

  if (!claims || claims.length === 0) {
    return (
      <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
        <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
        <p className="font-medium text-slate-600">No claims found</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {claims.map((claim) => (
        <ClaimCard key={claim.id} claim={claim} caseId={caseId} />
      ))}
    </div>
  )
}
