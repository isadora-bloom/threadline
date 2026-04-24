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
  AlertTriangle,
  Database,
  RefreshCw,
} from 'lucide-react'

export default async function NeedingAttentionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Fetch user's skills for personalized matching
  const { data: userSkills } = await supabase
    .from('user_skills')
    .select('skill, region')
    .eq('user_id', user.id)

  const skillSet = new Set((userSkills ?? []).map(s => s.skill))
  const userRegions = (userSkills ?? []).filter(s => s.region).map(s => s.region!.toLowerCase())
  const hasSkills = skillSet.size > 0

  // Fetch cases that need skills matching the user's profile
  // If user has skills, prioritize cases needing those skills
  // If no skills set, fall back to solvability scores
  let solvableRecords: unknown[] | null = null

  if (hasSkills) {
    // Fetch records whose needs_skills overlap with user's skills
    const { data } = await supabase
      .from('import_records')
      .select('*, source:import_sources(display_name)')
      .overlaps('needs_skills', [...skillSet])
      .order('created_at', { ascending: false })
      .limit(100)

    solvableRecords = (data ?? []).map(record => ({
      import_record_id: record.id,
      score: 50, // default score for skill-matched
      grade: 'moderate',
      ai_summary: `Needs: ${(record.needs_skills as string[] ?? []).filter((s: string) => skillSet.has(s)).join(', ')}`,
      ai_next_steps: [],
      import_record: record,
    }))
  }

  if (!solvableRecords?.length) {
    // Fall back to solvability scores
    const { data } = await supabase
      .from('solvability_scores')
      .select('*, import_record:import_records(*, source:import_sources(display_name))')
      .in('grade', ['high', 'moderate'])
      .order('score', { ascending: false })
      .limit(50)
    solvableRecords = data
  }

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

  // Data quality: stale records
  const { data: staleRecords } = await supabase
    .from('import_records')
    .select('id, person_name, record_type, state, external_id, source:import_sources(display_name)')
    .eq('stale', true)
    .limit(20)

  // Data quality: potential cross-source duplicates
  // Find person_name + sex + state combos that appear in multiple sources
  const { data: dupeCheckRaw } = await supabase
    .from('import_records')
    .select('id, person_name, sex, state, record_type, external_id, source_id, source:import_sources(display_name, slug)')
    .not('person_name', 'is', null)
    .eq('record_type', 'missing_person')
    .order('person_name')
    .limit(2000)

  // Group by normalized name+sex+state, flag combos with multiple source_ids
  const dupeGroups: Array<{ key: string; records: typeof dupeCheckRaw }> = []
  if (dupeCheckRaw?.length) {
    const byKey: Record<string, typeof dupeCheckRaw> = {}
    for (const r of dupeCheckRaw) {
      if (!r.person_name || r.person_name === 'Unknown') continue
      const key = `${(r.person_name as string).toLowerCase().trim()}|${(r.sex as string ?? '').toLowerCase()}|${(r.state as string ?? '').toLowerCase()}`
      if (!byKey[key]) byKey[key] = []
      byKey[key]!.push(r)
    }
    for (const [key, recs] of Object.entries(byKey)) {
      const sourceIds = new Set(recs!.map(r => r.source_id))
      if (sourceIds.size > 1) {
        dupeGroups.push({ key, records: recs! })
      }
    }
  }

  const hasDataQuality = (staleRecords?.length ?? 0) > 0 || dupeGroups.length > 0

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Flame className="h-5 w-5 text-orange-500" />
          <h1 className="text-2xl font-bold text-slate-900">Cases That Need You</h1>
        </div>
        <p className="text-sm text-slate-500">
          {hasSkills
            ? `Showing cases that match your skills: ${[...skillSet].join(', ')}. These cases specifically need what you can do.`
            : 'AI has identified these cases as potentially solvable — but nobody is investigating them yet. Add your skills in My Profile to see personalized matches.'
          }
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

      {/* Data Quality / Entity Resolution */}
      {hasDataQuality && (
        <div className="space-y-4 pt-6 border-t border-slate-200">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Database className="h-5 w-5 text-amber-500" />
              <h2 className="text-xl font-bold text-slate-900">Data Quality Review</h2>
            </div>
            <p className="text-sm text-slate-500">
              Records that may have normalization errors, stale data, or potential duplicates across sources.
            </p>
          </div>

          {/* Stale records */}
          {staleRecords && staleRecords.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
                <RefreshCw className="h-4 w-4" />
                Stale Records ({staleRecords.length})
              </h3>
              <p className="text-xs text-slate-500 mb-2">
                Source data changed since last import. These records may have outdated information.
              </p>
              <div className="space-y-1.5">
                {staleRecords.map(r => (
                  <Link
                    key={r.id}
                    href={`/registry/${r.id}`}
                    className="flex items-center justify-between p-2.5 rounded-md border border-amber-100 bg-amber-50 hover:bg-amber-100 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-slate-900 truncate">
                        {r.person_name ?? r.external_id}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {r.record_type === 'missing_person' ? 'Missing' : 'Unidentified'}
                      </span>
                      {r.state && <span className="text-[10px] text-slate-400">{r.state}</span>}
                      <span className="text-[10px] text-amber-600">
                        {(r.source as { display_name: string } | null)?.display_name}
                      </span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Cross-source duplicates */}
          {dupeGroups.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-purple-700 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Potential Cross-Source Duplicates ({dupeGroups.length})
              </h3>
              <p className="text-xs text-slate-500 mb-2">
                Same person name, sex, and state appearing in multiple databases. May be the same case tracked separately, or genuinely different people. Review to confirm.
              </p>
              <div className="space-y-2">
                {dupeGroups.slice(0, 15).map(group => {
                  const first = group.records![0]
                  return (
                    <Card key={group.key} className="border-purple-100">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-1.5">
                          <div>
                            <span className="text-sm font-semibold text-slate-900">{first.person_name}</span>
                            <span className="text-xs text-slate-500 ml-2">
                              {first.sex}{first.state ? ` / ${first.state}` : ''}
                            </span>
                          </div>
                          <Badge className="text-[10px] bg-purple-100 text-purple-700 border-purple-200">
                            {group.records!.length} records
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.records!.map(r => (
                            <Link
                              key={r.id}
                              href={`/registry/${r.id}`}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-slate-50 border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 transition-colors"
                            >
                              <span className="font-medium text-indigo-600">{r.external_id}</span>
                              <span className="text-slate-400">
                                {(r.source as { display_name: string } | null)?.display_name}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
                {dupeGroups.length > 15 && (
                  <p className="text-xs text-slate-400 text-center">
                    {dupeGroups.length - 15} more potential duplicates not shown
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
