import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BookOpen, Brain, ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react'

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  queued: { label: 'Queued', color: 'bg-slate-100 text-slate-600', Icon: Loader2 },
  running: { label: 'Running', color: 'bg-blue-100 text-blue-700', Icon: Loader2 },
  complete: { label: 'Complete', color: 'bg-green-100 text-green-700', Icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700', Icon: XCircle },
}

export default async function ResearchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: researchTasks } = await supabase
    .from('deep_research')
    .select('*, import_record:import_records(id, person_name, record_type, state, external_id)')
    .order('created_at', { ascending: false })
    .limit(50)

  const [
    { count: totalComplete },
    { count: totalRunning },
    { count: totalQueued },
  ] = await Promise.all([
    supabase.from('deep_research').select('id', { count: 'exact', head: true }).eq('status', 'complete'),
    supabase.from('deep_research').select('id', { count: 'exact', head: true }).eq('status', 'running'),
    supabase.from('deep_research').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
  ])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="h-5 w-5 text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900">Research</h1>
        </div>
        <p className="text-sm text-slate-500">
          Threadline AI deep research tasks. Click &quot;Threadline AI&quot; on any registry entry to start one.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Running</div>
            <div className="text-2xl font-bold text-blue-700 mt-1">{totalRunning ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Queued</div>
            <div className="text-2xl font-bold text-slate-700 mt-1">{totalQueued ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Complete</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{totalComplete ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        {(!researchTasks || researchTasks.length === 0) ? (
          <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
            <Brain className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <h3 className="font-semibold text-slate-700 mb-1">No research tasks yet</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Open any person in the registry and click &quot;Threadline AI&quot; to run deep research.
            </p>
          </div>
        ) : (
          researchTasks.map((task) => {
            const record = task.import_record as { id: string; person_name: string | null; record_type: string; state: string | null; external_id: string } | null
            const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.queued
            const StatusIcon = config.Icon

            return (
              <Card key={task.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${config.color}`}>
                      <StatusIcon className={`h-4 w-4 ${task.status === 'running' ? 'animate-spin' : ''}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm text-slate-900">
                          {record?.person_name ?? record?.external_id ?? 'Unknown'}
                        </span>
                        <Badge className={`text-xs ${config.color}`}>{config.label}</Badge>
                        <Badge variant="outline" className="text-xs">{task.research_type}</Badge>
                      </div>

                      {task.summary && (
                        <p className="text-sm text-slate-600 line-clamp-2">{task.summary}</p>
                      )}

                      {task.error_message && (
                        <p className="text-sm text-red-600">{task.error_message}</p>
                      )}

                      <div className="text-xs text-slate-400 mt-1">
                        {task.model_used && <span>{task.model_used} · </span>}
                        {task.tokens_used && <span>{task.tokens_used.toLocaleString()} tokens · </span>}
                        <span>{new Date(task.created_at).toLocaleString()}</span>
                      </div>
                    </div>

                    {record && (
                      <Link href={`/registry/${record.id}`} className="flex-shrink-0">
                        <ChevronRight className="h-4 w-4 text-slate-400 hover:text-slate-700" />
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
