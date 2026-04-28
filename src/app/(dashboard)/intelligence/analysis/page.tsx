'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
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
// Threads and Research now directed to watchlist/registry profiles

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
  const [isAdmin, setIsAdmin] = useState(false)

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

      // Store whether user is admin (lead_investigator on any case)
      const hasLeadRole = roles.some(r => (r as { role: string }).role === 'lead_investigator' || (r as { role: string }).role === 'admin')
      setIsAdmin(hasLeadRole)

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
        caseId ? supabase.from('case_pattern_settings').select('updated_at').eq('case_id', caseId).maybeSingle() : Promise.resolve({ data: null }),
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

  // Lead-quality breakdown: outcome rates by queue_type. Admin-only because it
  // exposes reviewer judgments and drives scoring-weight tuning, not day-to-day use.
  const { data: leadQuality } = useQuery({
    queryKey: ['lead-quality'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from('intelligence_queue')
        .select('queue_type, outcome')
        .not('outcome', 'is', null)
      const rollup: Record<string, { total: number; led: number; dead: number; known: number; insufficient: number; duplicate: number }> = {}
      for (const row of (data ?? []) as Array<{ queue_type: string; outcome: string }>) {
        if (!rollup[row.queue_type]) rollup[row.queue_type] = { total: 0, led: 0, dead: 0, known: 0, insufficient: 0, duplicate: 0 }
        const r = rollup[row.queue_type]
        r.total++
        if (row.outcome === 'led_somewhere') r.led++
        else if (row.outcome === 'dead_end') r.dead++
        else if (row.outcome === 'already_known') r.known++
        else if (row.outcome === 'insufficient_evidence') r.insufficient++
        else if (row.outcome === 'duplicate') r.duplicate++
      }
      return Object.entries(rollup)
        .map(([queue_type, r]) => ({ queue_type, ...r, led_pct: r.total > 0 ? Math.round((r.led / r.total) * 100) : 0 }))
        .sort((a, b) => b.total - a.total)
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

        {isAdmin && (
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

      {/* Lead quality — admin-only feedback loop on which queue types produce real leads */}
      {isAdmin && leadQuality && leadQuality.length > 0 && (
        <div className="border border-slate-200 rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-700">Lead quality by type</span>
            <span className="text-[10px] text-slate-400">from reviewer outcomes — higher &ldquo;led&rdquo; % means the signal is pulling its weight</span>
          </div>
          <div className="space-y-1.5">
            {leadQuality.map(q => (
              <div key={q.queue_type} className="flex items-center gap-2 text-[11px]">
                <span className="font-medium text-slate-700 min-w-[120px] truncate">{q.queue_type}</span>
                <span className="text-slate-400 min-w-[36px] text-right">{q.total}</span>
                <div className="flex-1 flex h-3 rounded overflow-hidden bg-slate-100">
                  {q.led > 0 && <div title={`${q.led} led somewhere`} className="bg-emerald-500" style={{ flex: q.led }} />}
                  {q.known > 0 && <div title={`${q.known} already known`} className="bg-sky-400" style={{ flex: q.known }} />}
                  {q.insufficient > 0 && <div title={`${q.insufficient} insufficient evidence`} className="bg-amber-400" style={{ flex: q.insufficient }} />}
                  {q.duplicate > 0 && <div title={`${q.duplicate} duplicates`} className="bg-purple-400" style={{ flex: q.duplicate }} />}
                  {q.dead > 0 && <div title={`${q.dead} dead end`} className="bg-slate-400" style={{ flex: q.dead }} />}
                </div>
                <span className="text-emerald-700 font-medium min-w-[32px] text-right">{q.led_pct}%</span>
              </div>
            ))}
          </div>
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

      {/* Tabs — scrollable on mobile, grid on lg+ so 9 tabs do not crush text */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-2 px-2 lg:mx-0 lg:px-0">
          <TabsList className="flex w-max gap-1 lg:grid lg:w-full lg:max-w-5xl lg:grid-cols-9 lg:gap-0">
            <TabsTrigger value="doe-match" className="text-xs whitespace-nowrap">
              <GitMerge className="h-3.5 w-3.5 mr-1" />
              Remains Match
            </TabsTrigger>
            <TabsTrigger value="offenders" className="text-xs whitespace-nowrap">
              <ShieldAlert className="h-3.5 w-3.5 mr-1" />
              Offenders
            </TabsTrigger>
            <TabsTrigger value="geo" className="text-xs whitespace-nowrap">
              <Globe className="h-3.5 w-3.5 mr-1" />
              Map
            </TabsTrigger>
            <TabsTrigger value="corridor" className="text-xs whitespace-nowrap">
              <Navigation className="h-3.5 w-3.5 mr-1" />
              Corridors
            </TabsTrigger>
            <TabsTrigger value="flags" className="text-xs whitespace-nowrap">
              <Flag className="h-3.5 w-3.5 mr-1" />
              Flags
            </TabsTrigger>
            <TabsTrigger value="links" className="text-xs whitespace-nowrap">
              <Link2 className="h-3.5 w-3.5 mr-1" />
              Connections
            </TabsTrigger>
            <TabsTrigger value="network" className="text-xs whitespace-nowrap">
              <Users className="h-3.5 w-3.5 mr-1" />
              Network
            </TabsTrigger>
            <TabsTrigger value="threads" className="text-xs whitespace-nowrap">
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              Threads
            </TabsTrigger>
            <TabsTrigger value="research" className="text-xs whitespace-nowrap">
              <Microscope className="h-3.5 w-3.5 mr-1" />
              Research
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="doe-match" className="mt-4">
          <DoeMatchView caseId={caseId} canManage={isAdmin} />
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
          <ThreadsTab />
        </TabsContent>

        <TabsContent value="research" className="mt-4">
          <ResearchTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Threads Tab — shows investigative leads from deep research, grouped by case ──

const LEAD_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  research_connection: { label: 'Connection', color: 'bg-blue-100 text-blue-700' },
  research_action: { label: 'Next Step', color: 'bg-green-100 text-green-700' },
  research_red_flag: { label: 'Red Flag', color: 'bg-red-100 text-red-700' },
  research_question: { label: 'Question', color: 'bg-amber-100 text-amber-700' },
}

const OUTCOME_OPTIONS = [
  { value: 'led_somewhere', label: 'Led somewhere', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'dead_end', label: 'Dead end', color: 'bg-slate-200 text-slate-700' },
  { value: 'already_known', label: 'Already known', color: 'bg-sky-100 text-sky-700' },
  { value: 'insufficient_evidence', label: 'Insufficient', color: 'bg-amber-100 text-amber-700' },
  { value: 'duplicate', label: 'Duplicate', color: 'bg-purple-100 text-purple-700' },
]

function ThreadsTab() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [showOutcomes, setShowOutcomes] = useState(false)

  const { data: leadsWithRecords, isLoading } = useQuery({
    queryKey: ['research-leads-grouped'],
    queryFn: async () => {
      const { data: leads } = await supabase
        .from('intelligence_queue')
        .select('*')
        .eq('queue_type', 'new_lead')
        .neq('status', 'dismissed')
        .order('priority_score', { ascending: false })
        .limit(200)

      if (!leads?.length) return { leads: [], records: {} }

      const importIds = new Set<string>()
      for (const lead of leads) {
        const ids = lead.related_import_ids as string[] | null
        if (ids) ids.forEach(id => importIds.add(id))
      }

      const records: Record<string, { id: string; person_name: string | null; record_type: string; state: string | null; external_id: string }> = {}
      if (importIds.size > 0) {
        const { data: importRecords } = await supabase
          .from('import_records')
          .select('id, person_name, record_type, state, external_id')
          .in('id', Array.from(importIds))
        if (importRecords) {
          for (const r of importRecords) records[r.id] = r
        }
      }

      return { leads, records }
    },
    retry: false,
  })

  const leads = leadsWithRecords?.leads ?? []
  const records = leadsWithRecords?.records ?? {}

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('intelligence_queue').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    queryClient.invalidateQueries({ queryKey: ['research-leads-grouped'] })
  }

  const setOutcome = async (id: string, outcome: string) => {
    await supabase.from('intelligence_queue').update({
      outcome,
      outcome_at: new Date().toISOString(),
      status: 'actioned',
      reviewed_at: new Date().toISOString(),
    }).eq('id', id)
    queryClient.invalidateQueries({ queryKey: ['research-leads-grouped'] })
  }

  const saveNote = async (leadId: string) => {
    setSavingNote(true)
    await supabase.from('intelligence_queue').update({ reviewer_note: noteText || null }).eq('id', leadId)
    queryClient.invalidateQueries({ queryKey: ['research-leads-grouped'] })
    setEditingNote(null)
    setSavingNote(false)
  }

  const toggle = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>

  if (!leads.length) return (
    <div className="py-10 text-center space-y-3">
      <Sparkles className="h-8 w-8 text-slate-300 mx-auto" />
      <h3 className="font-semibold text-slate-700">No investigative leads yet</h3>
      <p className="text-sm text-slate-500 max-w-md mx-auto">
        Run &quot;Threadline AI&quot; on a watched case to generate leads. Each finding becomes a trackable thread here.
      </p>
      <Link href="/my-watchlist" className="text-sm text-indigo-600 font-medium hover:underline inline-block pt-2">Go to My Cases &rarr;</Link>
    </div>
  )

  // Two-level grouping: record_type > person
  const byType: Record<string, Record<string, typeof leads>> = { missing_person: {}, unidentified_remains: {}, _other: {} }
  for (const lead of leads) {
    const ids = lead.related_import_ids as string[] | null
    const recordId = ids?.[0] ?? '_ungrouped'
    const rec = records[recordId]
    const typeKey = rec?.record_type === 'missing_person' ? 'missing_person'
      : rec?.record_type === 'unidentified_remains' ? 'unidentified_remains'
      : '_other'
    if (!byType[typeKey][recordId]) byType[typeKey][recordId] = []
    byType[typeKey][recordId].push(lead)
  }

  const TYPE_SECTIONS = [
    { key: 'missing_person', label: 'Missing Persons', icon: '?', bgColor: 'bg-indigo-50 border-indigo-200', textColor: 'text-indigo-800' },
    { key: 'unidentified_remains', label: 'Unidentified Remains', icon: '?', bgColor: 'bg-rose-50 border-rose-200', textColor: 'text-rose-800' },
    { key: '_other', label: 'Other', icon: '?', bgColor: 'bg-slate-50 border-slate-200', textColor: 'text-slate-700' },
  ]

  // Outcome stats
  const outcomeStats = {
    led_somewhere: leads.filter(l => (l as Record<string, unknown>).outcome === 'led_somewhere').length,
    dead_end: leads.filter(l => (l as Record<string, unknown>).outcome === 'dead_end').length,
    already_known: leads.filter(l => (l as Record<string, unknown>).outcome === 'already_known').length,
    no_outcome: leads.filter(l => !(l as Record<string, unknown>).outcome).length,
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {leads.length} leads across {Object.values(byType).reduce((n, g) => n + Object.keys(g).length, 0)} cases
        </p>
        <button
          onClick={() => setShowOutcomes(v => !v)}
          className="text-[10px] text-indigo-600 hover:underline font-medium"
        >
          {showOutcomes ? 'Hide outcomes' : 'Show outcomes'}
        </button>
      </div>

      {/* Outcome stats */}
      {showOutcomes && (
        <div className="flex gap-3 text-[11px]">
          <span className="text-emerald-700 font-medium">{outcomeStats.led_somewhere} led somewhere</span>
          <span className="text-slate-500">{outcomeStats.dead_end} dead ends</span>
          <span className="text-sky-600">{outcomeStats.already_known} already known</span>
          <span className="text-slate-400">{outcomeStats.no_outcome} unresolved</span>
        </div>
      )}

      {/* Type sections */}
      {TYPE_SECTIONS.map(section => {
        const people = byType[section.key]
        const personEntries = Object.entries(people)
        if (!personEntries.length) return null

        // Sort by max priority
        personEntries.sort(([, a], [, b]) => {
          const maxA = Math.max(...a.map(l => l.priority_score ?? 0))
          const maxB = Math.max(...b.map(l => l.priority_score ?? 0))
          return maxB - maxA
        })

        const sectionTotal = personEntries.reduce((n, [, ls]) => n + ls.length, 0)
        const sectionActive = personEntries.reduce((n, [, ls]) => n + ls.filter(l => l.status === 'new' || l.status === 'reviewing').length, 0)
        const sectionExpanded = expandedSections[section.key] !== false

        return (
          <div key={section.key} className={`border rounded-lg overflow-hidden ${section.bgColor}`}>
            {/* Section header */}
            <button
              onClick={() => toggle(section.key)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:brightness-95 transition text-left"
            >
              <div className="flex items-center gap-2">
                {sectionExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                <span className={`text-sm font-bold ${section.textColor}`}>{section.label}</span>
              </div>
              <span className="text-[10px] text-slate-500">{sectionActive} active / {sectionTotal} leads / {personEntries.length} cases</span>
            </button>

            {/* Person groups inside section */}
            {sectionExpanded && (
              <div className="px-2 pb-2 space-y-2">
                {personEntries.map(([recordId, groupLeads]) => {
                  const record = records[recordId]
                  const personKey = `${section.key}_${recordId}`
                  const isExpanded = expandedSections[personKey] !== false
                  const activeCount = groupLeads.filter(l => l.status === 'new' || l.status === 'reviewing').length
                  const maxPriority = Math.max(...groupLeads.map(l => l.priority_score ?? 0))

                  return (
                    <div key={recordId} className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                      <button
                        onClick={() => toggle(personKey)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-white hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                          <div className="min-w-0">
                            <span className="text-sm font-semibold text-slate-900 truncate block">
                              {record ? (record.person_name ?? record.external_id) : 'Ungrouped'}
                            </span>
                            {record?.state && <span className="text-[10px] text-slate-500">{record.state}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {maxPriority >= 75 && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">P{maxPriority}</span>}
                          <span className="text-[10px] text-slate-500">{activeCount}/{groupLeads.length}</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-2 space-y-2 border-t border-slate-100">
                          {record && (
                            <Link href={`/registry/${record.id}`} className="text-[10px] text-indigo-600 hover:underline font-medium px-1">
                              Open profile &rarr;
                            </Link>
                          )}
                          {groupLeads.map((lead) => {
                            const details = lead.details as Record<string, unknown> | null
                            const typeConfig = LEAD_TYPE_LABELS[(details?.type as string) ?? ''] ?? { label: 'Lead', color: 'bg-slate-100 text-slate-600' }
                            const existingNote = lead.reviewer_note as string | null
                            const outcome = (lead as Record<string, unknown>).outcome as string | null
                            const outcomeConfig = outcome ? OUTCOME_OPTIONS.find(o => o.value === outcome) : null

                            return (
                              <div key={lead.id} className={`p-3 rounded-lg border ${
                                outcome === 'led_somewhere' ? 'border-emerald-200 bg-emerald-50/50' :
                                lead.status === 'actioned' ? 'border-green-200 bg-green-50/50' :
                                lead.status === 'reviewing' ? 'border-blue-200 bg-blue-50/50' :
                                'border-slate-200 bg-white'
                              }`}>
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeConfig.color}`}>{typeConfig.label}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      lead.priority_score >= 75 ? 'bg-red-100 text-red-800' :
                                      lead.priority_score >= 50 ? 'bg-amber-100 text-amber-800' :
                                      'bg-slate-100 text-slate-600'
                                    }`}>{lead.priority_score}</span>
                                    {lead.status !== 'new' && !outcomeConfig && (
                                      <span className={`text-[10px] ${lead.status === 'actioned' ? 'text-green-600' : lead.status === 'reviewing' ? 'text-blue-600' : 'text-slate-400'}`}>{lead.status}</span>
                                    )}
                                    {outcomeConfig && (
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${outcomeConfig.color}`}>{outcomeConfig.label}</span>
                                    )}
                                  </div>
                                </div>
                                <h4 className="text-sm font-semibold text-slate-900 mb-1">{lead.title}</h4>
                                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{lead.summary}</p>

                                {/* Note */}
                                {editingNote === lead.id ? (
                                  <div className="mt-2 space-y-1">
                                    <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add your thoughts..." className="w-full text-xs p-2 border border-slate-300 rounded resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400" rows={2} autoFocus />
                                    <div className="flex gap-1">
                                      <button onClick={() => saveNote(lead.id)} disabled={savingNote} className="text-[10px] px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium">{savingNote ? 'Saving...' : 'Save'}</button>
                                      <button onClick={() => setEditingNote(null)} className="text-[10px] px-2 py-1 rounded bg-slate-50 text-slate-500 hover:bg-slate-100 font-medium">Cancel</button>
                                    </div>
                                  </div>
                                ) : existingNote ? (
                                  <div className="mt-2 p-2 bg-amber-50 border border-amber-100 rounded text-xs text-amber-800 cursor-pointer hover:bg-amber-100" onClick={() => { setEditingNote(lead.id); setNoteText(existingNote) }}>
                                    <span className="font-medium text-amber-600">Note:</span> {existingNote}
                                  </div>
                                ) : null}

                                {/* Actions + Outcome */}
                                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                  {lead.status === 'new' && (
                                    <>
                                      <button onClick={() => updateStatus(lead.id, 'reviewing')} className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium">Investigating</button>
                                      <button onClick={() => updateStatus(lead.id, 'dismissed')} className="text-[10px] px-2 py-1 rounded bg-slate-50 text-slate-500 hover:bg-slate-100 font-medium">Dismiss</button>
                                    </>
                                  )}
                                  {(lead.status === 'reviewing' || lead.status === 'actioned') && !outcome && (
                                    <>
                                      {OUTCOME_OPTIONS.map(opt => (
                                        <button key={opt.value} onClick={() => setOutcome(lead.id, opt.value)} className={`text-[10px] px-2 py-1 rounded font-medium hover:brightness-90 ${opt.color}`}>{opt.label}</button>
                                      ))}
                                    </>
                                  )}
                                  {lead.status === 'new' && (
                                    <span className="text-[9px] text-slate-300 mx-1">|</span>
                                  )}
                                  {OUTCOME_OPTIONS.slice(0, 2).map(opt => lead.status === 'new' ? (
                                    <button key={opt.value} onClick={() => setOutcome(lead.id, opt.value)} className={`text-[10px] px-2 py-1 rounded font-medium hover:brightness-90 ${opt.color}`}>{opt.label}</button>
                                  ) : null)}
                                  {!editingNote && editingNote !== lead.id && (
                                    <button onClick={() => { setEditingNote(lead.id); setNoteText(existingNote ?? '') }} className="text-[10px] px-2 py-1 rounded bg-slate-50 text-slate-500 hover:bg-slate-100 font-medium ml-auto">
                                      {existingNote ? 'Edit note' : '+ Note'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Research Tab — shows completed deep research tasks ──────────────────────

function ResearchTab() {
  const supabase = createClient()

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['research-tasks-analysis'],
    queryFn: async () => {
      const { data } = await supabase
        .from('deep_research')
        .select('*, import_record:import_records(id, person_name, record_type, state, external_id)')
        .order('created_at', { ascending: false })
        .limit(30)
      return data ?? []
    },
    retry: false,
  })

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>

  if (!tasks?.length) return (
    <div className="py-10 text-center space-y-3">
      <Microscope className="h-8 w-8 text-slate-300 mx-auto" />
      <h3 className="font-semibold text-slate-700">No research tasks yet</h3>
      <p className="text-sm text-slate-500 max-w-md mx-auto">
        Open any person in the registry and click &quot;Threadline AI&quot; to run deep research.
      </p>
    </div>
  )

  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const record = task.import_record as { id: string; person_name: string | null; record_type: string; state: string | null; external_id: string } | null
        return (
          <Link key={task.id} href={record ? `/registry/${record.id}` : '#'}>
            <div className={`p-3 rounded-lg border hover:shadow-sm transition-shadow ${
              task.status === 'complete' ? 'border-green-200' :
              task.status === 'failed' ? 'border-red-200' :
              'border-slate-200'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-slate-900">
                  {record?.person_name ?? record?.external_id ?? 'Unknown'}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  task.status === 'complete' ? 'bg-green-100 text-green-700' :
                  task.status === 'failed' ? 'bg-red-100 text-red-700' :
                  task.status === 'running' ? 'bg-blue-100 text-blue-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {task.status}
                </span>
              </div>
              {task.summary && <p className="text-xs text-slate-600 line-clamp-2">{task.summary}</p>}
              <div className="text-[10px] text-slate-400 mt-1">
                {task.model_used} · {new Date(task.created_at).toLocaleDateString()}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
