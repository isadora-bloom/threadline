import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Radar,
  AlertTriangle,
  Users,
  Search,
  Flame,
  ChevronRight,
  Clock,
  ShieldAlert,
  MapPin,
  Link2,
  Eye,
} from 'lucide-react'

const GRADE_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-amber-100 text-amber-800 border-amber-200',
  medium: 'bg-blue-100 text-blue-800 border-blue-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
}

const TYPE_ICONS: Record<string, typeof AlertTriangle> = {
  possible_match: Link2,
  stalled_case: Clock,
  offender_overlap: ShieldAlert,
  geographic_cluster: MapPin,
  new_lead: Flame,
  entity_crossmatch: Users,
  behavioral_pattern: Eye,
  temporal_pattern: Clock,
  corridor_cluster: MapPin,
  contradiction: AlertTriangle,
}

const TYPE_LABELS: Record<string, string> = {
  possible_match: 'Possible Match',
  stalled_case: 'Stalled Case',
  offender_overlap: 'Offender Overlap',
  geographic_cluster: 'Geographic Cluster',
  new_lead: 'New Lead',
  entity_crossmatch: 'Entity Crossmatch',
  behavioral_pattern: 'Behavioral Pattern',
  temporal_pattern: 'Temporal Pattern',
  corridor_cluster: 'Corridor Cluster',
  contradiction: 'Contradiction',
}

export default async function IntelligencePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Fetch queue items grouped by priority
  const { data: queueItems } = await supabase
    .from('intelligence_queue')
    .select('*')
    .eq('status', 'new')
    .order('priority_score', { ascending: false })
    .limit(50)

  // Stats
  const [
    { count: totalNew },
    { count: totalReviewing },
    { count: totalActioned },
    { count: totalRecords },
    { count: totalProcessed },
  ] = await Promise.all([
    supabase.from('intelligence_queue').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    supabase.from('intelligence_queue').select('id', { count: 'exact', head: true }).eq('status', 'reviewing'),
    supabase.from('intelligence_queue').select('id', { count: 'exact', head: true }).eq('status', 'actioned'),
    supabase.from('import_records').select('id', { count: 'exact', head: true }),
    supabase.from('import_records').select('id', { count: 'exact', head: true }).eq('ai_processed', true),
  ])

  // Type breakdown
  const typeCounts: Record<string, number> = {}
  for (const item of queueItems ?? []) {
    typeCounts[item.queue_type] = (typeCounts[item.queue_type] ?? 0) + 1
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Radar className="h-5 w-5 text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900">Intelligence</h1>
        </div>
        <p className="text-sm text-slate-500">
          AI-surfaced connections and patterns across {(totalRecords ?? 0).toLocaleString()} records.
          Everything here is unverified and needs human review.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Needs Review</div>
            <div className="text-2xl font-bold text-amber-700 mt-1">{totalNew ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">In Review</div>
            <div className="text-2xl font-bold text-blue-700 mt-1">{totalReviewing ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Actioned</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{totalActioned ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Total Records</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{(totalRecords ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">AI Processed</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{(totalProcessed ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Type breakdown pills */}
      {Object.keys(typeCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(typeCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => (
              <Badge key={type} variant="outline" className="text-xs">
                {TYPE_LABELS[type] ?? type}: {count}
              </Badge>
            ))}
        </div>
      )}

      {/* Queue items */}
      <div className="space-y-3">
        {(!queueItems || queueItems.length === 0) ? (
          <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
            <Radar className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <h3 className="font-semibold text-slate-700 mb-1">No intelligence items yet</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Import records from NamUs, Doe Network, or other sources, then run the AI batch processor
              to surface connections and patterns.
            </p>
          </div>
        ) : (
          queueItems.map((item) => {
            const Icon = TYPE_ICONS[item.queue_type] ?? AlertTriangle
            const gradeClass = GRADE_COLORS[item.priority_grade] ?? GRADE_COLORS.medium

            return (
              <Card key={item.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                      item.priority_grade === 'critical' ? 'bg-red-100' :
                      item.priority_grade === 'high' ? 'bg-amber-100' :
                      'bg-slate-100'
                    }`}>
                      <Icon className={`h-4 w-4 ${
                        item.priority_grade === 'critical' ? 'text-red-600' :
                        item.priority_grade === 'high' ? 'text-amber-600' :
                        'text-slate-500'
                      }`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={`text-xs ${gradeClass}`}>
                          {item.priority_grade} — {item.priority_score}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {TYPE_LABELS[item.queue_type] ?? item.queue_type}
                        </Badge>
                        {item.signal_count > 0 && (
                          <span className="text-xs text-slate-400">
                            {item.signal_count} signal{item.signal_count !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      <h3 className="font-semibold text-slate-900 text-sm">
                        {item.title}
                      </h3>
                      <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                        {item.summary}
                      </p>

                      <div className="flex items-center gap-2 mt-3">
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 bg-amber-50">
                          AI-surfaced — not verified
                        </Badge>
                        {item.ai_confidence !== null && (
                          <span className="text-xs text-slate-400">
                            Confidence: {Math.round((item.ai_confidence as number) * 100)}%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex-shrink-0">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/intelligence/${item.id}`}>
                          Review
                          <ChevronRight className="h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* Epistemic notice */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-medium mb-1">About intelligence items</p>
        <p>
          Everything on this page was generated by AI pattern analysis. These are possible connections
          surfaced for human review — they are not findings, matches, or conclusions. Many will be
          false positives. The value is in the ones that aren&apos;t.
        </p>
      </div>
    </div>
  )
}
