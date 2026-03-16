'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { LinkCard } from './LinkCard'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Link2 } from 'lucide-react'
import type { LinkScoreWithClaims } from '@/lib/types'

interface LinkScoreListProps {
  caseId: string
  filterClaimId?: string
}

export function LinkScoreList({ caseId, filterClaimId }: LinkScoreListProps) {
  const supabase = createClient()

  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('unreviewed')
  const [sortBy, setSortBy] = useState<string>('score_desc')

  const { data: links, isLoading, error } = useQuery({
    queryKey: ['link-scores', caseId, filterClaimId],
    queryFn: async (): Promise<LinkScoreWithClaims[]> => {
      let query = supabase
        .from('link_scores')
        .select('*')
        .eq('case_id', caseId)

      if (filterClaimId) {
        query = supabase
          .from('link_scores')
          .select('*')
          .eq('case_id', caseId)
          .or(`claim_a_id.eq.${filterClaimId},claim_b_id.eq.${filterClaimId}`)
      }

      const { data, error } = await query.order('score', { ascending: false })
      if (error) throw error

      // Fetch claims for all link scores
      const claimIds = new Set<string>()
      for (const ls of data ?? []) {
        claimIds.add(ls.claim_a_id)
        claimIds.add(ls.claim_b_id)
      }

      const { data: claimsData } = await supabase
        .from('claims')
        .select('id, extracted_text, event_date, claim_type, content_confidence')
        .in('id', Array.from(claimIds))

      const claimsMap = Object.fromEntries((claimsData ?? []).map((c) => [c.id, c]))

      return (data ?? []).map((ls) => ({
        ...ls,
        claim_a: claimsMap[ls.claim_a_id],
        claim_b: claimsMap[ls.claim_b_id],
      }))
    },
  })

  const filtered = useMemo(() => {
    if (!links) return []
    let result = [...links]

    if (gradeFilter !== 'all') {
      const gradeOrder: Record<string, number> = {
        very_strong: 5, strong: 4, notable: 3, moderate: 2, weak: 1,
      }
      const minGrade = gradeOrder[gradeFilter] ?? 0
      result = result.filter((ls) => (gradeOrder[ls.grade] ?? 0) >= minGrade)
    }

    if (statusFilter === 'unreviewed') {
      result = result.filter(
        (ls) => !ls.reviewer_status || ls.reviewer_status === 'unreviewed'
      )
    } else if (statusFilter === 'reviewed') {
      result = result.filter(
        (ls) => ls.reviewer_status && ls.reviewer_status !== 'unreviewed'
      )
    }

    if (sortBy === 'score_desc') {
      result.sort((a, b) => b.score - a.score)
    } else if (sortBy === 'grade_desc') {
      const order: Record<string, number> = {
        very_strong: 5, strong: 4, notable: 3, moderate: 2, weak: 1,
      }
      result.sort((a, b) => (order[b.grade] ?? 0) - (order[a.grade] ?? 0))
    } else {
      result.sort(
        (a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
      )
    }

    return result
  }, [links, gradeFilter, statusFilter, sortBy])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 bg-slate-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500 text-sm">
        Failed to load link scores.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Grade</Label>
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All grades</SelectItem>
              <SelectItem value="notable">Notable+</SelectItem>
              <SelectItem value="strong">Strong+</SelectItem>
              <SelectItem value="very_strong">Very strong only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unreviewed">Unreviewed</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Sort by</Label>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score_desc">Score (high first)</SelectItem>
              <SelectItem value="grade_desc">Grade (high first)</SelectItem>
              <SelectItem value="date_desc">Newest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
          <Link2 className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="font-medium text-slate-600">No link scores match your filters</p>
          <p className="text-sm text-slate-400 mt-1">
            Run pattern analysis to generate link scores.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">{filtered.length} link{filtered.length !== 1 ? 's' : ''}</p>
          {filtered.map((ls) => (
            <LinkCard key={ls.id} linkScore={ls} caseId={caseId} />
          ))}
        </div>
      )}
    </div>
  )
}
