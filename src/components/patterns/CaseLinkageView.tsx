'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { GradeBadge } from './GradeBadge'
import { Link2, Lock, Layers } from 'lucide-react'
import type { CaseLinkageScore, ContributingLayers } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface CaseLinkageViewProps {
  caseId: string
}

const LAYER_LABELS: Record<string, string> = {
  geographic: 'Geographic',
  corridor: 'Corridor',
  victimology: 'Victimology',
  temporal: 'Temporal',
  weapon: 'Weapon/Method',
  behavioral_signature: 'Behavioral signature',
  forensic_method: 'Forensic method',
  social_network: 'Social network',
}

const LAYER_COLORS: Record<string, string> = {
  geographic: 'bg-blue-400',
  corridor: 'bg-orange-400',
  victimology: 'bg-purple-400',
  temporal: 'bg-cyan-400',
  weapon: 'bg-red-400',
  behavioral_signature: 'bg-amber-400',
  forensic_method: 'bg-rose-400',
  social_network: 'bg-indigo-400',
}

interface LinkageCardProps {
  linkage: CaseLinkageScore
  currentCaseId: string
  accessibleCaseIds: Set<string>
  cases: Record<string, { title: string; case_type: string }>
}

function ContributingLayersBar({
  layers,
}: {
  layers: ContributingLayers
}) {
  const total = Object.values(layers).reduce((sum, v) => sum + (v ?? 0), 0)
  if (total === 0) return null

  return (
    <div className="space-y-2">
      {Object.entries(layers)
        .filter(([, v]) => (v ?? 0) > 0)
        .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
        .map(([key, value]) => (
          <div key={key} className="space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{LAYER_LABELS[key] ?? key}</span>
              <span className="text-xs font-mono text-slate-600">+{value}</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', LAYER_COLORS[key] ?? 'bg-slate-400')}
                style={{ width: `${Math.min(100, ((value ?? 0) / 100) * 100)}%` }}
              />
            </div>
          </div>
        ))}
    </div>
  )
}

function LinkageCard({ linkage, currentCaseId, accessibleCaseIds, cases }: LinkageCardProps) {
  const [expanded, setExpanded] = useState(false)

  const otherCaseId = linkage.case_a_id === currentCaseId ? linkage.case_b_id : linkage.case_a_id
  const hasAccess = accessibleCaseIds.has(otherCaseId)
  const otherCase = cases[otherCaseId]
  const layers = (linkage.contributing_layers ?? {}) as ContributingLayers

  return (
    <Card className="border-slate-200">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <GradeBadge grade={linkage.grade} score={linkage.composite_score} />
            {hasAccess && otherCase ? (
              <p className="text-sm font-medium text-slate-800">{otherCase.title}</p>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-slate-500">
                <Lock className="h-3.5 w-3.5" />
                <span>Another case in the system</span>
              </div>
            )}
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            {expanded ? 'Less' : 'Details'}
          </button>
        </div>

        {linkage.shared_entity_ids && linkage.shared_entity_ids.length > 0 && (
          <p className="text-xs text-slate-500">
            {linkage.shared_entity_ids.length} shared {linkage.shared_entity_ids.length === 1 ? 'entity' : 'entities'}
          </p>
        )}

        {expanded && (
          <div className="border-t border-slate-100 pt-3 space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
              Contributing layers
            </p>
            <ContributingLayersBar layers={layers} />

            {linkage.lead_investigator_note && (
              <div className="bg-slate-50 rounded p-2 border border-slate-100">
                <p className="text-xs text-slate-600 italic">&ldquo;{linkage.lead_investigator_note}&rdquo;</p>
                {linkage.reviewed_at && (
                  <p className="text-[10px] text-slate-400 mt-1">{formatDate(linkage.reviewed_at)}</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {hasAccess && (
                <Button size="sm" variant="outline" className="text-xs h-7" asChild>
                  <a href={`/cases/${otherCaseId}/patterns`}>Request case comparison</a>
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-xs h-7 text-slate-400">
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function CaseLinkageView({ caseId }: CaseLinkageViewProps) {
  const supabase = createClient()

  const { data: linkages, isLoading } = useQuery({
    queryKey: ['case-linkage-scores', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_linkage_scores')
        .select('*')
        .or(`case_a_id.eq.${caseId},case_b_id.eq.${caseId}`)
        .order('composite_score', { ascending: false })

      if (error) throw error
      return data ?? []
    },
  })

  // Get user's accessible cases for access check
  const { data: userCaseRoles } = useQuery({
    queryKey: ['user-case-roles'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      const { data } = await supabase
        .from('case_user_roles')
        .select('case_id')
        .eq('user_id', user.id)

      return (data ?? []).map((r) => r.case_id)
    },
  })

  const { data: accessibleCases } = useQuery({
    queryKey: ['accessible-cases', userCaseRoles],
    enabled: !!userCaseRoles && userCaseRoles.length > 0,
    queryFn: async () => {
      if (!userCaseRoles || userCaseRoles.length === 0) return {}

      const { data } = await supabase
        .from('cases')
        .select('id, title, case_type')
        .in('id', userCaseRoles)

      return Object.fromEntries((data ?? []).map((c) => [c.id, c]))
    },
  })

  const accessibleCaseIds = new Set(userCaseRoles ?? [])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-24 bg-slate-100 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (!linkages || linkages.length === 0) {
    return (
      <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
        <Layers className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="font-medium text-slate-600">No cross-case signals yet</p>
        <p className="text-sm text-slate-400 mt-1">
          Cross-case matching must be enabled in pattern settings.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Lock className="h-4 w-4 text-slate-400" />
        <p className="text-xs text-slate-500">
          Cases you don&apos;t have access to are shown as &ldquo;Another case in the system&rdquo;.
          Scores are generated by the system — they do not confirm any connection.
        </p>
      </div>

      {(linkages ?? []).map((linkage) => (
        <LinkageCard
          key={linkage.id}
          linkage={linkage}
          currentCaseId={caseId}
          accessibleCaseIds={accessibleCaseIds}
          cases={accessibleCases ?? {}}
        />
      ))}
    </div>
  )
}
