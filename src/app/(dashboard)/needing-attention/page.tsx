import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Flame,
  User,
  MapPin,
  Calendar,
  ChevronRight,
  Eye,
  Star,
  ArrowRight,
} from 'lucide-react'

export default async function NeedingAttentionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Fetch high-solvability cases with few/no watchers
  // We query solvability_scores + import_records + watchlist counts
  const { data: solvableRecords } = await supabase
    .from('solvability_scores')
    .select('*, import_record:import_records(*, source:import_sources(display_name))')
    .in('grade', ['high', 'moderate'])
    .order('score', { ascending: false })
    .limit(50)

  // Get watcher counts for these records
  const recordIds = solvableRecords?.map(s => s.import_record_id) ?? []
  let watcherCounts: Record<string, number> = {}

  if (recordIds.length > 0) {
    const { data: watchData } = await supabase
      .from('user_watchlist')
      .select('import_record_id')
      .in('import_record_id', recordIds)

    if (watchData) {
      for (const w of watchData) {
        watcherCounts[w.import_record_id] = (watcherCounts[w.import_record_id] ?? 0) + 1
      }
    }
  }

  // Sort by: high solvability + few watchers first
  const sorted = (solvableRecords ?? [])
    .map(s => ({
      ...s,
      watchers: watcherCounts[s.import_record_id] ?? 0,
    }))
    .sort((a, b) => {
      // Unwatched high-solvability first
      if (a.watchers === 0 && b.watchers > 0) return -1
      if (a.watchers > 0 && b.watchers === 0) return 1
      return b.score - a.score
    })

  // Get user's watchlist for "Already watching" badges
  const { data: userWatchlist } = await supabase
    .from('user_watchlist')
    .select('import_record_id')
    .eq('user_id', user.id)

  const watchingSet = new Set(userWatchlist?.map(w => w.import_record_id) ?? [])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Flame className="h-5 w-5 text-orange-500" />
          <h1 className="text-2xl font-bold text-slate-900">Cases That Need You</h1>
        </div>
        <p className="text-sm text-slate-500">
          AI has identified these cases as potentially solvable — but nobody is investigating them yet.
          Your fresh eyes could make the difference.
        </p>
      </div>

      {/* How it works */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
        <h3 className="text-sm font-semibold text-indigo-900 mb-2">How solvability scores work</h3>
        <div className="grid sm:grid-cols-3 gap-3 text-xs text-indigo-800">
          <div>
            <span className="font-medium">High (70-100):</span> Specific leads exist — named persons of interest, vehicle descriptions, witness accounts, DNA available.
          </div>
          <div>
            <span className="font-medium">Moderate (35-69):</span> Some investigative threads — locations, timelines, or circumstances that could yield results with fresh research.
          </div>
          <div>
            <span className="font-medium">Why it matters:</span> Cases with high solvability but zero watchers are opportunities. Someone just needs to look.
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
          <Flame className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <h3 className="font-semibold text-slate-700 mb-1">No scored cases yet</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Cases need to be imported and AI-processed before solvability scores appear.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((item) => {
            const record = item.import_record as Record<string, unknown> & {
              source: { display_name: string } | null
            } | null
            if (!record) return null

            const isMissing = record.record_type === 'missing_person'
            const isWatching = watchingSet.has(item.import_record_id)

            return (
              <Card key={item.id} className={`hover:shadow-md transition-shadow ${
                item.watchers === 0 ? 'border-l-4 border-l-orange-400' : ''
              }`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Score */}
                    <div className={`flex flex-col items-center justify-center rounded-lg p-3 min-w-[70px] ${
                      item.grade === 'high' ? 'bg-green-100' : 'bg-amber-100'
                    }`}>
                      <span className={`text-2xl font-bold ${
                        item.grade === 'high' ? 'text-green-800' : 'text-amber-800'
                      }`}>
                        {item.score}
                      </span>
                      <span className={`text-xs font-medium ${
                        item.grade === 'high' ? 'text-green-600' : 'text-amber-600'
                      }`}>
                        {item.grade}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-slate-900">
                          {record.person_name as string ?? 'Unidentified'}
                        </span>
                        <Badge variant={isMissing ? 'default' : 'secondary'} className="text-xs">
                          {isMissing ? 'Missing' : 'Unidentified'}
                        </Badge>
                        {item.watchers === 0 && (
                          <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-200">
                            Nobody watching
                          </Badge>
                        )}
                        {isWatching && (
                          <Badge className="text-xs bg-indigo-100 text-indigo-700 border-indigo-200">
                            <Star className="h-3 w-3 mr-0.5 fill-current" />
                            You&apos;re watching
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        {record.sex && <span>{record.sex as string}</span>}
                        {record.age_text && <span>Age {record.age_text as string}</span>}
                        {(record.city || record.state) && (
                          <span className="flex items-center gap-0.5">
                            <MapPin className="h-3 w-3" />
                            {[record.city, record.state].filter(Boolean).join(', ')}
                          </span>
                        )}
                        {(record.date_missing || record.date_found) && (
                          <span className="flex items-center gap-0.5">
                            <Calendar className="h-3 w-3" />
                            {isMissing ? record.date_missing as string : record.date_found as string}
                          </span>
                        )}
                        <span className="flex items-center gap-0.5">
                          <Eye className="h-3 w-3" />
                          {item.watchers} watching
                        </span>
                      </div>

                      <p className="text-sm text-slate-600 mt-2 leading-relaxed line-clamp-2">
                        {item.ai_summary}
                      </p>

                      {item.ai_next_steps && (item.ai_next_steps as string[]).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(item.ai_next_steps as string[]).slice(0, 2).map((step, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-xs text-indigo-600 bg-indigo-50 rounded-md px-2 py-0.5">
                              <ArrowRight className="h-3 w-3" />
                              {step.length > 60 ? step.slice(0, 60) + '...' : step}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <Button variant="outline" size="sm" asChild className="flex-shrink-0">
                      <Link href={`/registry/${item.import_record_id}`}>
                        View
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
