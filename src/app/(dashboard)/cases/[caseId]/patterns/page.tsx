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
import { CaseLinkageView } from '@/components/patterns/CaseLinkageView'
import { InvestigativeThreads } from '@/components/patterns/InvestigativeThreads'
import { ResearchTaskList } from '@/components/research/ResearchTaskList'
import { DoeMatchView } from '@/components/patterns/DoeMatchView'
import { GeoView } from '@/components/patterns/GeoView'
import { OffenderView } from '@/components/patterns/OffenderView'
import { useToast } from '@/components/ui/use-toast'
import { useParams } from 'next/navigation'
import {
  Brain,
  Flag,
  Link2,
  Navigation,
  Users,
  Layers,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Sparkles,
  Microscope,
  GitMerge,
  Globe,
  ShieldAlert,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default function PatternIntelligencePage() {
  const params = useParams()
  const caseId = params.caseId as string
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [activeTab, setActiveTab] = useState('flags')
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [roleLoaded, setRoleLoaded] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase
        .from('case_user_roles')
        .select('role')
        .eq('case_id', caseId)
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          setUserRole(data?.role ?? null)
          setRoleLoaded(true)
        })
    })
  }, [caseId, supabase])

  // Summary stats
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['pattern-summary', caseId],
    queryFn: async () => {
      const [flagsRes, linksRes, confirmedRes, crossCaseRes, settingsRes] = await Promise.all([
        supabase
          .from('pattern_flags')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .eq('reviewer_status', 'unreviewed'),
        supabase
          .from('link_scores')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .in('grade', ['notable', 'strong', 'very_strong']),
        supabase
          .from('pattern_flags')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .in('reviewer_status', ['confirmed', 'worth_investigating']),
        supabase
          .from('case_linkage_scores')
          .select('id', { count: 'exact', head: true })
          .or(`case_a_id.eq.${caseId},case_b_id.eq.${caseId}`)
          .neq('reviewer_status', 'dismissed'),
        supabase
          .from('case_pattern_settings')
          .select('updated_at')
          .eq('case_id', caseId)
          .single(),
      ])

      return {
        unreviewed_flags: flagsRes.count ?? 0,
        notable_plus_links: linksRes.count ?? 0,
        confirmed_patterns: confirmedRes.count ?? 0,
        cross_case_signals: crossCaseRes.count ?? 0,
        last_analyzed_at: settingsRes.data?.updated_at ?? null,
      }
    },
  })

  const canRunAnalysis = userRole === 'lead_investigator' || userRole === 'admin'

  async function handleRunAnalysis() {
    setIsRunningAnalysis(true)
    try {
      const res = await fetch('/api/pattern/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error ?? 'Analysis failed')
      }

      toast({
        title: 'Analysis complete',
        description: `${data.linksScored} links scored, ${data.flagsGenerated} flags generated.`,
      })

      queryClient.invalidateQueries({ queryKey: ['pattern-summary', caseId] })
      queryClient.invalidateQueries({ queryKey: ['pattern-flags', caseId] })
      queryClient.invalidateQueries({ queryKey: ['link-scores', caseId] })
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

  const SummaryCard = ({
    label,
    value,
    icon: Icon,
    highlight,
  }: {
    label: string
    value: number
    icon: React.ComponentType<{ className?: string }>
    highlight?: boolean
  }) => (
    <Card className={highlight && value > 0 ? 'border-amber-200 bg-amber-50' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${highlight && value > 0 ? 'text-amber-700' : 'text-slate-600'}`}>
            {label}
          </span>
          <Icon className={`h-4 w-4 ${highlight && value > 0 ? 'text-amber-500' : 'text-slate-400'}`} />
        </div>
        <div className="flex items-end gap-2 mt-1">
          <span className={`text-2xl font-bold ${highlight && value > 0 ? 'text-amber-800' : 'text-slate-900'}`}>
            {value}
          </span>
          {highlight && value > 0 && (
            <Badge className="mb-0.5 bg-amber-100 text-amber-700 border-amber-200 text-xs">
              Needs review
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Brain className="h-5 w-5 text-indigo-600" />
            <h1 className="text-xl font-bold text-slate-900">Pattern Intelligence</h1>
          </div>
          <p className="text-sm text-slate-500">
            Automated signals surfaced for investigator review. All flags require human evaluation.
          </p>
          {summary?.last_analyzed_at && (
            <p className="text-xs text-slate-400 mt-1">
              Last analyzed {formatDate(summary.last_analyzed_at)}
            </p>
          )}
        </div>

        {canRunAnalysis && (
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
        )}
      </div>

      {/* Epistemic notice */}
      <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <AlertTriangle className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-500 leading-relaxed">
          Pattern flags and link scores are generated automatically and surfaced for review only.
          None of these signals constitute findings, confirmed connections, or evidence. All require
          investigator judgment before any action is taken.
        </p>
      </div>

      {/* Summary cards */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Unreviewed flags"
            value={summary?.unreviewed_flags ?? 0}
            icon={Flag}
            highlight
          />
          <SummaryCard
            label="Notable+ links"
            value={summary?.notable_plus_links ?? 0}
            icon={Link2}
          />
          <SummaryCard
            label="Confirmed patterns"
            value={summary?.confirmed_patterns ?? 0}
            icon={CheckCircle}
          />
          <SummaryCard
            label="Cross-case signals"
            value={summary?.cross_case_signals ?? 0}
            icon={Layers}
          />
        </div>
      )}

      {/* Help banner */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setHelpOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-sm text-slate-600"
        >
          <span className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-slate-400" />
            <span className="font-medium">What is Pattern Intelligence?</span>
          </span>
          {helpOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>
        {helpOpen && (
          <div className="px-4 py-3 bg-white border-t border-slate-200 text-xs text-slate-600 space-y-1.5">
            <p><span className="font-semibold text-slate-700">Flags:</span> Automated signals surfaced from comparing submissions to each other. Not findings — review each one.</p>
            <p><span className="font-semibold text-slate-700">Connection Scores:</span> Pairwise similarity between submissions. High scores = similar content, people, or locations.</p>
            <p><span className="font-semibold text-slate-700">Travel Routes:</span> Submissions that mention known travel corridors or interstates. Useful for hitchhiker and highway cases.</p>
            <p><span className="font-semibold text-slate-700">Social Network:</span> Visual web of people and entities mentioned across submissions.</p>
            <p><span className="font-semibold text-slate-700">Cross-Case Links:</span> Signals shared between this case and other cases in the system.</p>
            <p><span className="font-semibold text-slate-700">Threads:</span> AI-drafted investigative questions and leads for human follow-up.</p>
            <p><span className="font-semibold text-slate-700">Research Tasks:</span> Manual and AI-assisted open-source research tasks.</p>
            <p><span className="font-semibold text-slate-700">Remains Match:</span> Cross-references missing person submissions against unidentified remains records (Doe Network).</p>
            <p><span className="font-semibold text-slate-700">Map View:</span> Geographic clustering of locations mentioned across submissions.</p>
            <p><span className="font-semibold text-slate-700">Known Offenders:</span> Pattern overlap between this case and convicted serial offenders. Statistical only — not an accusation.</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {roleLoaded && (
        <TabsList className={`grid w-full max-w-5xl ${canRunAnalysis ? 'grid-cols-10' : 'grid-cols-9'}`}>
          <TabsTrigger value="flags" className="text-xs">
            <Flag className="h-3.5 w-3.5 mr-1" />
            Flags
            {(summary?.unreviewed_flags ?? 0) > 0 && (
              <span className="ml-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
                {summary!.unreviewed_flags > 99 ? '99+' : summary!.unreviewed_flags}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="links" className="text-xs">
            <Link2 className="h-3.5 w-3.5 mr-1" />
            Connection Scores
          </TabsTrigger>
          <TabsTrigger value="corridor" className="text-xs">
            <Navigation className="h-3.5 w-3.5 mr-1" />
            Travel Routes
          </TabsTrigger>
          <TabsTrigger value="network" className="text-xs">
            <Users className="h-3.5 w-3.5 mr-1" />
            Social Network
          </TabsTrigger>
          {canRunAnalysis && (
            <TabsTrigger value="cross-case" className="text-xs">
              <Layers className="h-3.5 w-3.5 mr-1" />
              Cross-Case Links
            </TabsTrigger>
          )}
          <TabsTrigger value="threads" className="text-xs">
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Threads
          </TabsTrigger>
          <TabsTrigger value="research" className="text-xs">
            <Microscope className="h-3.5 w-3.5 mr-1" />
            Research Tasks
          </TabsTrigger>
          <TabsTrigger value="doe-match" className="text-xs">
            <GitMerge className="h-3.5 w-3.5 mr-1" />
            Remains Match
          </TabsTrigger>
          <TabsTrigger value="geo" className="text-xs">
            <Globe className="h-3.5 w-3.5 mr-1" />
            Map View
          </TabsTrigger>
          <TabsTrigger value="offenders" className="text-xs">
            <ShieldAlert className="h-3.5 w-3.5 mr-1" />
            Known Offenders
          </TabsTrigger>
        </TabsList>
        )}

        <TabsContent value="flags" className="mt-4">
          <PatternFlagList caseId={caseId} />
        </TabsContent>

        <TabsContent value="links" className="mt-4">
          <LinkScoreList caseId={caseId} />
        </TabsContent>

        <TabsContent value="corridor" className="mt-4">
          <CorridorView caseId={caseId} />
        </TabsContent>

        <TabsContent value="network" className="mt-4">
          <SocialNetworkGraph caseId={caseId} />
        </TabsContent>

        {canRunAnalysis && (
          <TabsContent value="cross-case" className="mt-4">
            <CaseLinkageView caseId={caseId} />
          </TabsContent>
        )}

        <TabsContent value="threads" className="mt-4">
          <InvestigativeThreads caseId={caseId} canGenerate={canRunAnalysis} />
        </TabsContent>

        <TabsContent value="research" className="mt-4">
          <ResearchTaskList caseId={caseId} canManage={canRunAnalysis} />
        </TabsContent>

        <TabsContent value="doe-match" className="mt-4">
          <DoeMatchView caseId={caseId} canManage={canRunAnalysis} />
        </TabsContent>

        <TabsContent value="geo" className="mt-4">
          <GeoView caseId={caseId} />
        </TabsContent>

        <TabsContent value="offenders" className="mt-4">
          <OffenderView caseId={caseId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
