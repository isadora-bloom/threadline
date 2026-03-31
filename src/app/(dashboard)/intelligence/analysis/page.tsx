'use client'

import { useState } from 'react'
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
import { InvestigativeThreads } from '@/components/patterns/InvestigativeThreads'
import { ResearchTaskList } from '@/components/research/ResearchTaskList'

const GeoView = dynamic(
  () => import('@/components/patterns/GeoView').then(m => ({ default: m.GeoView })),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading map...</div> }
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
  Sparkles,
  Microscope,
  Clock,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { formatDate } from '@/lib/utils'

export default function IntelligencePage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [activeTab, setActiveTab] = useState('doe-match')
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [alertsDismissed, setAlertsDismissed] = useState(false)

  // Find system cases
  const { data: systemCases, isLoading: casesLoading } = useQuery({
    queryKey: ['system-cases'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

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

  // Find specific cases for different components
  const namusMissingCase = systemCases?.find(c => c.title?.includes('NamUs') && c.title?.includes('Missing'))
  const doeMissingCase = systemCases?.find(c => c.title?.includes('Doe Network') && c.title?.includes('Missing'))
  const charleyCase = systemCases?.find(c => c.title?.includes('Charley'))

  // Primary case for DOE matching (NamUs has the most matches)
  const primaryCase = namusMissingCase ?? doeMissingCase ?? charleyCase ?? systemCases?.[0]
  const caseId = primaryCase?.id

  // Offender overlaps + stalls are stored under Doe Network case
  const offenderCaseId = doeMissingCase?.id ?? caseId

  // Stats — avoid counting huge tables (doe_match_candidates has millions of rows)
  // Only count filtered subsets that won't time out
  const { data: stats } = useQuery({
    queryKey: ['intelligence-stats'],
    queryFn: async () => {
      const [doeVeryStrong, stalledCases, importTotal, clusters, entityMentions, settingsRes] = await Promise.all([
        supabase.from('doe_match_candidates').select('id', { count: 'exact', head: true }).eq('grade', 'very_strong'),
        supabase.from('doe_stall_flags').select('id', { count: 'exact', head: true }),
        supabase.from('import_records').select('id', { count: 'exact', head: true }),
        supabase.from('doe_victimology_clusters').select('id', { count: 'exact', head: true }),
        supabase.from('doe_entity_mentions').select('id', { count: 'exact', head: true }),
        caseId ? supabase.from('case_pattern_settings').select('updated_at').eq('case_id', caseId).single() : Promise.resolve({ data: null }),
      ])
      return {
        doe_total: doeVeryStrong.count ?? 0,
        doe_strong: doeVeryStrong.count ?? 0,
        stalled_cases: stalledCases.count ?? 0,
        registry_total: importTotal.count ?? 0,
        clusters: clusters.count ?? 0,
        entity_mentions: entityMentions.count ?? 0,
        last_analyzed: settingsRes.data?.updated_at ?? null,
      }
    },
    enabled: !!caseId,
  })

  // Fetch top stalled case alerts for the banner
  const { data: stalledAlerts } = useQuery({
    queryKey: ['stalled-alerts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('intelligence_queue')
        .select('id, title, summary, priority_score')
        .eq('queue_type', 'stalled_case')
        .eq('status', 'new')
        .order('priority_score', { ascending: false })
        .limit(5)
      return data ?? []
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
      queryClient.invalidateQueries({ queryKey: ['intelligence-stats'] })
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
          <span className="text-sm text-slate-500">Loading intelligence...</span>
        </div>
      </div>
    )
  }

  if (!caseId) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
          <Brain className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <h3 className="font-semibold text-slate-700 mb-1">No data available for analysis</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Import data from NamUs or Doe Network, then run the analysis pipeline.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Brain className="h-5 w-5 text-indigo-600" />
            <h1 className="text-xl font-bold text-slate-900">Intelligence</h1>
          </div>
          <p className="text-sm text-slate-500">
            {(stats?.registry_total ?? 0).toLocaleString()} records across NamUs and Doe Network.
            {stats?.last_analyzed && ` Last analyzed ${formatDate(stats.last_analyzed)}.`}
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

      {/* Stalled case alerts */}
      {stalledAlerts && stalledAlerts.length > 0 && !alertsDismissed && (
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-semibold text-amber-800">
                {stats?.stalled_cases ?? 0} stalled cases flagged
              </span>
            </div>
            <Button variant="ghost" size="sm" className="text-xs text-amber-600 h-6" onClick={() => setAlertsDismissed(true)}>
              Dismiss
            </Button>
          </div>
          <div className="space-y-1.5">
            {stalledAlerts.slice(0, 3).map(alert => (
              <p key={alert.id} className="text-xs text-amber-700 leading-relaxed">
                {alert.summary}
              </p>
            ))}
            {stalledAlerts.length > 3 && (
              <p className="text-xs text-amber-500">+{stalledAlerts.length - 3} more</p>
            )}
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className={stats?.doe_strong ? 'border-indigo-200 bg-indigo-50' : ''}>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-indigo-600">Very Strong Matches</div>
            <div className="text-2xl font-bold text-indigo-800 mt-1">{(stats?.doe_strong ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Clusters</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{(stats?.clusters ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Stalled Cases</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{stats?.stalled_cases ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Entities</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{(stats?.entity_mentions ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Registry</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{(stats?.registry_total ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Epistemic notice */}
      <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <AlertTriangle className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-500 leading-relaxed">
          Match scores compare physical descriptions statistically. A high score means shared characteristics —
          it does not mean the same person. Confirmation requires official record comparison, dental or DNA matching,
          or other forensic verification.
        </p>
      </div>

      {/* Help banner */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setHelpOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-sm text-slate-600"
        >
          <span className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-slate-400" />
            <span className="font-medium">What do these tabs do?</span>
          </span>
          {helpOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>
        {helpOpen && (
          <div className="px-4 py-3 bg-white border-t border-slate-200 text-xs text-slate-600 space-y-1.5">
            <p><span className="font-semibold text-slate-700">Remains Match:</span> Cross-references missing person submissions against unidentified remains records. Full 16-signal scoring with decomposition weighting.</p>
            <p><span className="font-semibold text-slate-700">Known Offenders:</span> Pattern overlap between cases and convicted serial offenders. Statistical only — not an accusation.</p>
            <p><span className="font-semibold text-slate-700">Map View:</span> Geographic clustering of locations mentioned across submissions.</p>
            <p><span className="font-semibold text-slate-700">Travel Routes:</span> Submissions that mention known travel corridors or interstates.</p>
            <p><span className="font-semibold text-slate-700">Flags:</span> Automated signals surfaced from comparing submissions to each other.</p>
            <p><span className="font-semibold text-slate-700">Connections:</span> Pairwise similarity between submissions.</p>
            <p><span className="font-semibold text-slate-700">Network:</span> Visual web of people and entities mentioned across submissions.</p>
            <p><span className="font-semibold text-slate-700">Threads:</span> AI-drafted investigative questions and leads.</p>
            <p><span className="font-semibold text-slate-700">Research:</span> Manual and AI-assisted open-source research tasks.</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-5xl grid-cols-9">
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
          <TabsTrigger value="threads" className="text-xs">
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Threads
          </TabsTrigger>
          <TabsTrigger value="research" className="text-xs">
            <Microscope className="h-3.5 w-3.5 mr-1" />
            Research
          </TabsTrigger>
        </TabsList>

        <TabsContent value="doe-match" className="mt-4">
          <DoeMatchView caseId={caseId} canManage={true} />
        </TabsContent>

        <TabsContent value="offenders" className="mt-4">
          <OffenderView caseId={offenderCaseId} />
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

        <TabsContent value="threads" className="mt-4">
          <InvestigativeThreads caseId={caseId} canGenerate={true} />
        </TabsContent>

        <TabsContent value="research" className="mt-4">
          <ResearchTaskList caseId={caseId} canManage={true} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
