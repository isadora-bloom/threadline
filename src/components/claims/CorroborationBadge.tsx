'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'

interface CorroborationBadgeProps {
  claimId: string
}

interface Corroboration {
  id: string
  similarity_score: number | null
  match_type: string
  is_contradiction: boolean
  contradiction_detail: string | null
  corroborated_by_claim_id: string
}

export function CorroborationBadge({ claimId }: CorroborationBadgeProps) {
  const supabase = createClient()
  const [expanded, setExpanded] = useState(false)

  const { data } = useQuery({
    queryKey: ['corroborations', claimId],
    queryFn: async () => {
      const { data } = await supabase
        .from('claim_corroborations')
        .select('id, similarity_score, match_type, is_contradiction, contradiction_detail, corroborated_by_claim_id')
        .eq('claim_id', claimId)
      return data as Corroboration[]
    },
  })

  const corroborations = (data ?? []).filter(c => !c.is_contradiction)
  const contradictions = (data ?? []).filter(c => c.is_contradiction)

  if (!corroborations.length && !contradictions.length) return null

  return (
    <div className="mt-1.5 space-y-1">
      {contradictions.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50">
          <button
            className="w-full flex items-center gap-1.5 px-2 py-1 text-left"
            onClick={() => setExpanded(e => !e)}
          >
            <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />
            <span className="text-xs font-medium text-red-700">
              {contradictions.length} contradiction{contradictions.length !== 1 ? 's' : ''} with existing claims
            </span>
            {expanded ? <ChevronUp className="h-3 w-3 text-red-400 ml-auto" /> : <ChevronDown className="h-3 w-3 text-red-400 ml-auto" />}
          </button>
          {expanded && (
            <div className="px-2 pb-2 space-y-1">
              {contradictions.map(c => (
                <p key={c.id} className="text-xs text-red-700 bg-red-100 rounded px-2 py-1">
                  {c.contradiction_detail}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {corroborations.length > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50">
          <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-shrink-0" />
          <span className="text-xs text-emerald-700">
            Corroborates {corroborations.length} existing claim{corroborations.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
