'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { PatternFlagCard } from './PatternFlagCard'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Flag } from 'lucide-react'
import { FLAG_LABELS, type PatternFlagWithClaims } from '@/lib/types'

interface PatternFlagListProps {
  caseId: string
}

export function PatternFlagList({ caseId }: PatternFlagListProps) {
  const supabase = createClient()

  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('unreviewed')
  const [sortBy, setSortBy] = useState<string>('date_desc')

  const { data: flags, isLoading, error } = useQuery({
    queryKey: ['pattern-flags', caseId],
    queryFn: async (): Promise<PatternFlagWithClaims[]> => {
      const { data, error } = await supabase
        .from('pattern_flags')
        .select('*')
        .eq('case_id', caseId)
        .order('generated_at', { ascending: false })

      if (error) throw error

      // Fetch involved claims for each flag
      const allClaimIds = (data ?? []).flatMap((f) => f.involved_claim_ids ?? [])
      const uniqueClaimIds = [...new Set(allClaimIds)]

      let claimsMap: Record<string, { id: string; extracted_text: string; event_date: string | null; claim_type: string }> = {}
      if (uniqueClaimIds.length > 0) {
        const { data: claimsData } = await supabase
          .from('claims')
          .select('id, extracted_text, event_date, claim_type')
          .in('id', uniqueClaimIds)

        claimsMap = Object.fromEntries((claimsData ?? []).map((c) => [c.id, c]))
      }

      return (data ?? []).map((f) => ({
        ...f,
        involved_claims: (f.involved_claim_ids ?? [])
          .map((id: string) => claimsMap[id])
          .filter(Boolean),
      }))
    },
  })

  const filtered = useMemo(() => {
    if (!flags) return []

    let result = [...flags]

    if (gradeFilter !== 'all') {
      result = result.filter((f) => f.grade === gradeFilter)
    }

    if (typeFilter !== 'all') {
      result = result.filter((f) => f.flag_type === typeFilter)
    }

    if (statusFilter === 'unreviewed') {
      result = result.filter((f) => f.reviewer_status === 'unreviewed')
    } else if (statusFilter === 'reviewed') {
      result = result.filter((f) => f.reviewer_status !== 'unreviewed')
    }

    if (sortBy === 'score_desc') {
      result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    } else if (sortBy === 'grade_desc') {
      const order: Record<string, number> = {
        very_strong: 5, strong: 4, notable: 3, moderate: 2, weak: 1,
      }
      result.sort((a, b) => (order[b.grade ?? ''] ?? 0) - (order[a.grade ?? ''] ?? 0))
    } else {
      result.sort(
        (a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
      )
    }

    return result
  }, [flags, gradeFilter, typeFilter, statusFilter, sortBy])

  const uniqueTypes = useMemo(
    () => [...new Set((flags ?? []).map((f) => f.flag_type))],
    [flags]
  )

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-slate-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500 text-sm">
        Failed to load pattern flags.
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
          <Label className="text-xs text-slate-500">Flag type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 text-xs w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {uniqueTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {FLAG_LABELS[t] ?? t}
                </SelectItem>
              ))}
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
              <SelectItem value="date_desc">Newest first</SelectItem>
              <SelectItem value="score_desc">Score (high first)</SelectItem>
              <SelectItem value="grade_desc">Grade (high first)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
          <Flag className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="font-medium text-slate-600">No flags match your filters</p>
          <p className="text-sm text-slate-400 mt-1">
            Run pattern analysis or adjust your filters.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">{filtered.length} flag{filtered.length !== 1 ? 's' : ''}</p>
          {filtered.map((flag) => (
            <PatternFlagCard key={flag.id} flag={flag} caseId={caseId} />
          ))}
        </div>
      )}
    </div>
  )
}
