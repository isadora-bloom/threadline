'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PatternFlagList } from '@/components/patterns/PatternFlagList'
import { LinkScoreList } from '@/components/patterns/LinkScoreList'
import { CorridorView } from '@/components/patterns/CorridorView'
import { SocialNetworkGraph } from '@/components/patterns/SocialNetworkGraph'
import { DoeMatchView } from '@/components/patterns/DoeMatchView'
import dynamic from 'next/dynamic'
import { OffenderView } from '@/components/patterns/OffenderView'
import Link from 'next/link'

const GeoView = dynamic(
  () => import('@/components/patterns/GeoView').then(m => ({ default: m.GeoView })),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading map…</div> }
)

import {
  Brain,
  Flag,
  Link2,
  Navigation,
  Users,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  GitMerge,
  Globe,
  ShieldAlert,
  ChevronLeft,
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

/**
 * Global Analysis Page
 *
 * This page reuses the existing pattern analysis components but at the global level.
 * It auto-discovers system cases (Doe Network, NamUs imports) and passes their IDs
 * to the components that already know how to work with them.
 *
 * The key insight: DoeMatchView and GeoView already find the Doe Network case internally.
 * OffenderView works per-case. PatternFlagList/LinkScoreList work per-case.
 * So we find the primary "system" case and use it as the entry point.
 */
export default function GlobalAnalysisPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [activeTab, setActiveTab] = useState('doe-match')
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false)

  // Find system cases — the cases holding imported data
  const { data: systemCases, isLoading: casesLoading } = useQuery({
    queryKey: ['system-cases'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      // Get all cases the user has access to
      const { data: roles } = await supabase
        .from('case_user_roles')
        .select('case_id, role')
        .eq('user_id', user.id)

      if (!roles?.length) return []

      const caseIds = roles.map(r => r.case_id)
      const { data: cases } = await supabase
        .from('cases')
        .select('id, title, case_type, status')
        .in('id', caseIds)
        .order('updated_at', { ascending: false })

      return cases ?? []
    },
  })

  // Find the primary case for analysis — the one with the most data
  // DoeMatchView internally looks for "Doe Network" in the title,
  // so any case works as an entry point for DOE matching.
  const primaryCase = systemCases?.find(c =>
    c.title?.toLowerCase().includes('doe') ||
    c.title?.toLowerCase().includes('namus') ||
    c.title?.toLowerCase().includes('missing')
  ) ?? systemCases?.[0]

  const caseId = primaryCase?.id

  // Summary stats from intelligence queue (global, not per-case)
  const { data: globalStats } = useQuery({
    queryKey: ['global-analysis-stats'],
    queryFn: async () => {
      const [queueNew, queueActioned, connections, doeMatches, offenderOverlaps] = await Promise.all([
        supabase.from('intelligence_queue').select('id', { count: 'exact', head: true }).eq('status', 'new'),
        supabase.from('intelligence_queue').select('id', { count: 'exact', head: true }).eq('status', 'actioned'),
        supabase.from('global_connections').select('id', { count: 'exact', head: true }).gte('composite_score', 41),
        supabase.from('doe_match_candidates').select('id', { count: 'exact', head: true }),
        supabase.from('offender_case_overlaps').select('id', { count: 'exact', head: true }),
      ])

      return {
        queue_new: queueNew.count ?? 0,
        queue_actioned: queueActioned.count ?? 0,
        global_connections: connections.count ?? 0,
        doe_matches: doeMatches.count ?? 0,
        offender_overlaps: offenderOverlaps.count ?? 0,
      }
    },
  })

  async function handleRunAnalysis() {
    if (!caseId) return
    setIsRunningAnalysis(true)
    try {
      const res = await fetch('/api/pattern/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Analysis failed')

      toast({
        title: 'Analysis complete',
        description: `${data.linksScored} links scored, ${data.flagsGenerated} flags generated.`,
      })
      queryClient.invalidateQueries({ queryKey: ['global-analysis-stats'] })
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Analysis failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setIsRunningAnalysis(false)
    }
  }

  if (casesLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          <span className="text-sm text-slate-500">Loading analysis...</span>
        </div>
      </div>
    )
  }

  if (!caseId) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
          <Brain className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <h3 className="font-semibold text-slate-700 mb-1">No cases available for analysis</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Import data from NamUs or Doe Network, create a case, and run the analysis pipeline
            to see pattern intelligence here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/intelligence" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
            <ChevronLeft className="h-4 w-4" />
            Intelligence
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <Brain className="h-5 w-5 text-indigo-600" />
            <h1 className="text-xl font-bold text-slate-900">Global Analysis</h1>
          </div>
          <p className="text-sm text-slate-500">
            Cross-case pattern analysis across all imported data. DOE matching, offender overlaps, corridor analysis, geographic clustering.
          </p>
        </div>

        <Button
          onClick={handleRunAnalysis}
          disabled={isRunningAnalysis}
          size="sm"
        >
          {isRunningAnalysis ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isRunningAnalysis ? 'Analyzing...' : 'Run analysis'}
        </Button>
      </div>

      {/* Epistemic notice */}
      <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <AlertTriangle className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-500 leading-relaxed">
          All pattern analysis is automated and surfaced for human review only.
          Match scores compare statistical similarity — they do not confirm identity.
          Confirmation requires forensic verification (dental, DNA, fingerprints).
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">DOE Matches</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{(globalStats?.doe_matches ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Offender Overlaps</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{(globalStats?.offender_overlaps ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Global Connections</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{globalStats?.global_connections ?? 0}</div>
          </CardContent>
        </Card>
        <Card className={globalStats?.queue_new ? 'border-amber-200 bg-amber-50' : ''}>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-amber-700">Needs Review</div>
            <div className="text-2xl font-bold text-amber-800 mt-1">{globalStats?.queue_new ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Actioned</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{globalStats?.queue_actioned ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs — reusing existing components with the system case ID */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-4xl grid-cols-7">
          <TabsTrigger value="doe-match" className="text-xs">
            <GitMerge className="h-3.5 w-3.5 mr-1" />
            Remains Match
          </TabsTrigger>
          <TabsTrigger value="offenders" className="text-xs">
            <ShieldAlert className="h-3.5 w-3.5 mr-1" />
            Offenders
          </TabsTrigger>
          <TabsTrigger value="geo" className="text-xs">
            <Globe className="h-3.5 w-3.5 mr-1" />
            Map
          </TabsTrigger>
          <TabsTrigger value="corridor" className="text-xs">
            <Navigation className="h-3.5 w-3.5 mr-1" />
            Corridors
          </TabsTrigger>
          <TabsTrigger value="flags" className="text-xs">
            <Flag className="h-3.5 w-3.5 mr-1" />
            Flags
          </TabsTrigger>
          <TabsTrigger value="links" className="text-xs">
            <Link2 className="h-3.5 w-3.5 mr-1" />
            Connections
          </TabsTrigger>
          <TabsTrigger value="network" className="text-xs">
            <Users className="h-3.5 w-3.5 mr-1" />
            Network
          </TabsTrigger>
        </TabsList>

        <TabsContent value="doe-match" className="mt-4">
          <DoeMatchView caseId={caseId} canManage={true} />
        </TabsContent>

        <TabsContent value="offenders" className="mt-4">
          <OffenderView caseId={caseId} />
        </TabsContent>

        <TabsContent value="geo" className="mt-4">
          <GeoView caseId={caseId} />
        </TabsContent>

        <TabsContent value="corridor" className="mt-4">
          <CorridorView caseId={caseId} />
        </TabsContent>

        <TabsContent value="flags" className="mt-4">
          <PatternFlagList caseId={caseId} />
        </TabsContent>

        <TabsContent value="links" className="mt-4">
          <LinkScoreList caseId={caseId} />
        </TabsContent>

        <TabsContent value="network" className="mt-4">
          <SocialNetworkGraph caseId={caseId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
