import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ChevronLeft,
  ExternalLink,
  MapPin,
  Calendar,
  User,
  Eye,
  Fingerprint,
  Brain,
  AlertTriangle,
  Link2,
  ShieldAlert,
  Flame,
  Star,
  Users,
} from 'lucide-react'
import { WatchButton } from '@/components/registry/WatchButton'
import { DeepResearchButton } from '@/components/registry/DeepResearchButton'
import { TagButton } from '@/components/registry/TagButton'
import { CaseHandoff } from '@/components/registry/CaseHandoff'

export default async function RegistryProfilePage({
  params,
}: {
  params: Promise<{ recordId: string }>
}) {
  const { recordId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: record } = await supabase
    .from('import_records')
    .select('*, source:import_sources(display_name, slug, base_url)')
    .eq('id', recordId)
    .single()

  if (!record) notFound()

  const isMissing = record.record_type === 'missing_person'
  const extraction = record.ai_extraction as Record<string, unknown> | null
  const demographics = extraction?.demographics as Record<string, unknown> | undefined
  const geography = extraction?.geography as Record<string, unknown> | undefined
  const timeline = extraction?.timeline as Record<string, unknown> | undefined
  const circumstances = extraction?.circumstances as Record<string, unknown> | undefined
  const entities = (extraction?.entities ?? []) as Array<Record<string, unknown>>
  const claims = (extraction?.claims ?? []) as Array<Record<string, unknown>>
  const behavioral = extraction?.behavioral_signals as Record<string, unknown> | undefined
  const solvability = extraction?.solvability_signals as Record<string, unknown> | undefined
  const investigatorNotes = extraction?.investigator_notes as string | undefined

  // Fetch connections (rule-based)
  const { data: connections } = await supabase
    .from('global_connections')
    .select('*, record_a:import_records!global_connections_record_a_id_fkey(id, person_name, record_type, state, date_missing, date_found, sex, age_text), record_b:import_records!global_connections_record_b_id_fkey(id, person_name, record_type, state, date_missing, date_found, sex, age_text)')
    .or(`record_a_id.eq.${recordId},record_b_id.eq.${recordId}`)
    .order('composite_score', { ascending: false })
    .limit(20)

  // Fetch DOE match candidates (the real 16-signal matches) via submission_id
  const submissionId = record.submission_id as string | null
  let doeMatches: Array<Record<string, unknown>> = []
  let offenderOverlaps: Array<Record<string, unknown>> = []

  if (submissionId) {
    // Missing person → their matches against unidentified remains
    if (isMissing) {
      const { data: matches } = await supabase
        .from('doe_match_candidates')
        .select('*')
        .eq('missing_submission_id', submissionId)
        .order('composite_score', { ascending: false })
        .limit(20)
      doeMatches = (matches ?? []) as Array<Record<string, unknown>>
    } else {
      // Unidentified remains → who might they be
      const { data: matches } = await supabase
        .from('doe_match_candidates')
        .select('*')
        .eq('unidentified_submission_id', submissionId)
        .order('composite_score', { ascending: false })
        .limit(20)
      doeMatches = (matches ?? []) as Array<Record<string, unknown>>
    }

    // Offender overlaps for this submission
    const { data: overlaps } = await supabase
      .from('offender_case_overlaps')
      .select('*, offender:known_offenders(name, status, mo_keywords, victim_states)')
      .eq('submission_id', submissionId)
      .order('composite_score', { ascending: false })
      .limit(10)
    offenderOverlaps = (overlaps ?? []) as Array<Record<string, unknown>>
  }

  // Fetch solvability
  const { data: solvabilityScore } = await supabase
    .from('solvability_scores')
    .select('*')
    .eq('import_record_id', recordId)
    .single()

  // Watcher count
  const { count: watcherCount } = await supabase
    .from('user_watchlist')
    .select('id', { count: 'exact', head: true })
    .eq('import_record_id', recordId)

  // Is user watching?
  const { data: isWatching } = await supabase
    .from('user_watchlist')
    .select('id')
    .eq('import_record_id', recordId)
    .eq('user_id', user.id)
    .single()

  // Community notes
  const { data: communityNotes } = await supabase
    .from('community_notes')
    .select('*, user:user_profiles(full_name)')
    .eq('import_record_id', recordId)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(20)

  // Deep research results
  const { data: researchResults } = await supabase
    .from('deep_research')
    .select('*')
    .eq('import_record_id', recordId)
    .order('created_at', { ascending: false })
    .limit(5)

  const source = record.source as { display_name: string; slug: string; base_url: string } | null

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <Link href="/registry" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-4 w-4" />
        Registry
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant={isMissing ? 'default' : 'secondary'}>
              {isMissing ? 'Missing Person' : 'Unidentified Remains'}
            </Badge>
            {/* Case status */}
            {record.case_status && record.case_status !== 'open' && (
              <Badge className={
                record.case_status === 'resolved_alive' ? 'bg-green-100 text-green-800 border-green-200' :
                record.case_status === 'resolved_deceased' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                record.case_status === 'resolved_arrested' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                record.case_status === 'cold' ? 'bg-amber-100 text-amber-800 border-amber-200' :
                'bg-slate-100 text-slate-600'
              }>
                {record.case_status === 'resolved_alive' ? 'Found Alive' :
                 record.case_status === 'resolved_deceased' ? 'Remains Identified' :
                 record.case_status === 'resolved_arrested' ? 'Arrest Made' :
                 record.case_status === 'resolved_other' ? 'Resolved' :
                 record.case_status === 'closed' ? 'Closed' :
                 record.case_status === 'cold' ? 'Cold Case' :
                 record.case_status}
              </Badge>
            )}
            {/* Classification */}
            {record.classification && (
              <Badge variant="outline" className={
                record.classification.toLowerCase().includes('runaway') || record.classification.toLowerCase().includes('voluntary')
                  ? 'text-amber-700 border-amber-300 bg-amber-50'
                  : record.classification.toLowerCase().includes('abduction') || record.classification.toLowerCase().includes('endangered')
                    ? 'text-red-700 border-red-300 bg-red-50'
                    : ''
              }>
                {record.classification}
              </Badge>
            )}
            {/* Key flags */}
            {record.key_flags && (record.key_flags as string[]).length > 0 && (record.key_flags as string[]).map((flag: string) => (
              <Badge key={flag} variant="outline" className="text-xs">
                {flag.replace(/_/g, ' ')}
              </Badge>
            ))}
            {source && (
              <Badge variant="outline">{source.display_name}</Badge>
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {record.person_name ?? 'Unidentified'}
          </h1>
          <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
            {record.sex && <span>{record.sex}</span>}
            {record.age_text && <span>Age {record.age_text}</span>}
            {record.race && <span>{record.race}</span>}
            {(record.city || record.state) && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {[record.city, record.state].filter(Boolean).join(', ')}
              </span>
            )}
            {(record.date_missing || record.date_found) && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {isMissing ? `Missing since ${record.date_missing}` : `Found ${record.date_found}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {watcherCount ?? 0} watching
            </span>
            {record.external_url && (
              <a href={record.external_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-indigo-600">
                <ExternalLink className="h-3 w-3" />
                View on {source?.display_name ?? 'source'}
              </a>
            )}
            <span>ID: {record.external_id}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 flex-shrink-0 items-end">
          <div className="flex gap-2">
            <WatchButton
              recordId={recordId}
              isWatching={!!isWatching}
              userId={user.id}
            />
            <DeepResearchButton recordId={recordId} />
          </div>
          <TagButton importRecordId={recordId} />
        </div>
      </div>

      {/* The person — not the data */}
      {(() => {
        const circumstancesText = (circumstances?.detailed ?? circumstances?.brief) as string | undefined
        const yearsMissing = record.date_missing
          ? Math.floor((Date.now() - new Date(record.date_missing as string).getTime()) / (365.25 * 86400000))
          : null
        const yearsFound = record.date_found
          ? Math.floor((Date.now() - new Date(record.date_found as string).getTime()) / (365.25 * 86400000))
          : null

        return (
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            {isMissing ? (
              <div className="space-y-2">
                <p className="text-slate-800 leading-relaxed">
                  <span className="font-semibold">{record.person_name}</span>
                  {record.age_text && <> was <span className="font-medium">{record.age_text} years old</span></>}
                  {record.city && record.state && <> in <span className="font-medium">{record.city}, {record.state}</span></>}
                  {record.date_missing && <> when {record.person_name?.split(' ')[0] ?? 'they'} went missing on <span className="font-medium">{new Date(record.date_missing as string).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span></>}
                  .{yearsMissing && yearsMissing > 0 && <> That was <span className="font-medium">{yearsMissing} years ago</span>.</>}
                </p>
                {circumstancesText && (
                  <p className="text-sm text-slate-600 leading-relaxed">{circumstancesText}</p>
                )}
                {!circumstancesText && yearsMissing && yearsMissing > 5 && (
                  <p className="text-sm text-slate-500 italic">
                    Someone is still looking for {record.person_name?.split(' ')[0] ?? 'this person'}.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-slate-800 leading-relaxed">
                  Unidentified {record.sex?.toLowerCase() ?? 'person'}
                  {record.age_text && <>, estimated age <span className="font-medium">{record.age_text}</span></>}
                  {record.city && record.state && <>, found in <span className="font-medium">{record.city}, {record.state}</span></>}
                  {record.date_found && <> on <span className="font-medium">{new Date(record.date_found as string).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span></>}
                  .{yearsFound && yearsFound > 0 && <> <span className="font-medium">{yearsFound} years</span> without a name.</>}
                </p>
                {circumstancesText && (
                  <p className="text-sm text-slate-600 leading-relaxed">{circumstancesText}</p>
                )}
                {!circumstancesText && (
                  <p className="text-sm text-slate-500 italic">
                    Somebody knows who this person is.
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* AI Extraction Notice */}
      {record.ai_processed && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span className="font-medium">AI-extracted data</span> — The structured information below was extracted by AI and has not been verified by a human. Original source data is preserved.
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left column — Details */}
        <div className="lg:col-span-2 space-y-6">

          {/* Summary */}
          {extraction?.summary && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">AI Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-700 leading-relaxed">{extraction.summary as string}</p>
              </CardContent>
            </Card>
          )}

          {/* Demographics */}
          {demographics && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Demographics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  {demographics.name && <Field label="Name" value={demographics.name as string} />}
                  {(demographics.aliases as string[])?.length > 0 && (
                    <Field label="Aliases" value={(demographics.aliases as string[]).join(', ')} />
                  )}
                  {demographics.age_at_event && <Field label="Age" value={String(demographics.age_at_event)} />}
                  {demographics.sex && <Field label="Sex" value={demographics.sex as string} />}
                  {demographics.race && <Field label="Race" value={demographics.race as string} />}
                  {demographics.height_inches && <Field label="Height" value={`${demographics.height_inches}"`} />}
                  {demographics.weight_lbs && <Field label="Weight" value={`${demographics.weight_lbs} lbs`} />}
                  {demographics.hair_color && <Field label="Hair" value={demographics.hair_color as string} />}
                  {demographics.eye_color && <Field label="Eyes" value={demographics.eye_color as string} />}
                </div>
                {(demographics.distinguishing_marks as string[])?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <span className="text-xs font-medium text-slate-500">Distinguishing marks</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(demographics.distinguishing_marks as string[]).map((mark, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{mark}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Circumstances */}
          {circumstances && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Circumstances</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {circumstances.classification && (
                  <Badge variant="outline">{circumstances.classification as string}</Badge>
                )}
                {circumstances.detailed && (
                  <p className="text-sm text-slate-700 leading-relaxed">{circumstances.detailed as string}</p>
                )}
                {circumstances.cause_of_death && (
                  <Field label="Cause of death" value={circumstances.cause_of_death as string} />
                )}
                {(circumstances.risk_factors as string[])?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-slate-500">Risk factors</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(circumstances.risk_factors as string[]).map((f, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{f}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Entities */}
          {entities.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Fingerprint className="h-4 w-4" />
                  Extracted Entities ({entities.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {entities.map((entity, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-slate-50 rounded-md">
                      <Badge variant="outline" className="text-xs">{entity.entity_type as string}</Badge>
                      <span className="text-sm font-medium text-slate-800">{entity.raw_value as string}</span>
                      {entity.role && (
                        <span className="text-xs text-slate-400">{entity.role as string}</span>
                      )}
                      {entity.notes && (
                        <span className="text-xs text-slate-500 italic">{entity.notes as string}</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Claims */}
          {claims.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Extracted Claims ({claims.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {claims.map((claim, i) => (
                    <div key={i} className="p-2 bg-slate-50 rounded-md">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">{claim.type as string}</Badge>
                        <Badge variant="outline" className={`text-xs ${
                          claim.confidence === 'high' ? 'text-green-600 border-green-200' :
                          claim.confidence === 'medium' ? 'text-amber-600 border-amber-200' :
                          'text-slate-500'
                        }`}>
                          {claim.confidence as string}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-700">{claim.text as string}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Connections */}
          {connections && connections.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Connections ({connections.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {connections.map((conn) => {
                    const other = conn.record_a_id === recordId ? conn.record_b : conn.record_a
                    const otherRecord = other as { id: string; person_name: string | null; record_type: string; state: string | null; date_missing: string | null; date_found: string | null; sex: string | null; age_text: string | null } | null
                    if (!otherRecord) return null

                    return (
                      <Link key={conn.id} href={`/registry/${otherRecord.id}`}>
                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-md hover:bg-slate-100 transition-colors">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm text-slate-900">
                                {otherRecord.person_name ?? 'Unidentified'}
                              </span>
                              <Badge variant={otherRecord.record_type === 'missing_person' ? 'default' : 'secondary'} className="text-xs">
                                {otherRecord.record_type === 'missing_person' ? 'Missing' : 'Unidentified'}
                              </Badge>
                              <Badge className={`text-xs ${
                                conn.grade === 'very_strong' || conn.grade === 'strong' ? 'bg-red-100 text-red-800' :
                                conn.grade === 'notable' ? 'bg-amber-100 text-amber-800' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {conn.grade} — {conn.composite_score}
                              </Badge>
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {otherRecord.sex} · Age {otherRecord.age_text ?? '?'} · {otherRecord.state ?? '?'}
                              {otherRecord.date_missing && ` · Missing ${otherRecord.date_missing}`}
                              {otherRecord.date_found && ` · Found ${otherRecord.date_found}`}
                            </div>
                            {conn.ai_summary && (
                              <p className="text-xs text-slate-600 mt-1">{conn.ai_summary}</p>
                            )}
                          </div>
                          <ChevronLeft className="h-4 w-4 text-slate-400 rotate-180" />
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* DOE Match Candidates — the real 16-signal matches */}
          {doeMatches.length > 0 && (
            <Card className="border-indigo-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-indigo-600" />
                  {isMissing ? 'Possible Remains Matches' : 'Possible Identity Matches'} ({doeMatches.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-slate-500 mb-3">
                  Scored on 16 signals including physical description, decomposition state, location, and temporal proximity. High scores mean shared characteristics — not confirmed identity.
                </p>
                <div className="space-y-2">
                  {doeMatches.map((match) => {
                    const score = match.composite_score as number
                    const grade = match.grade as string
                    const ai = match.ai_assessment as Record<string, unknown> | null
                    const aiLevel = ai?.connection_level as number | undefined

                    return (
                      <div key={match.id as string} className="p-3 bg-slate-50 rounded-md">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs ${
                              grade === 'very_strong' ? 'bg-indigo-100 text-indigo-800' :
                              grade === 'strong' ? 'bg-blue-100 text-blue-800' :
                              grade === 'notable' ? 'bg-amber-100 text-amber-800' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {grade} — {score}
                            </Badge>
                            {aiLevel && (
                              <Badge variant="outline" className={`text-xs ${
                                aiLevel >= 4 ? 'text-green-700 border-green-300' :
                                aiLevel === 3 ? 'text-amber-700 border-amber-300' :
                                'text-slate-500'
                              }`}>
                                AI: {aiLevel}/5
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-slate-400">
                            {isMissing
                              ? (match.unidentified_location as string ?? 'Unknown location')
                              : (match.missing_name as string ?? 'Unknown')}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-600">
                          {isMissing ? (
                            <>
                              {match.unidentified_sex && <span>{match.unidentified_sex as string}</span>}
                              {match.unidentified_age && <span>Age {match.unidentified_age as string}</span>}
                              {match.unidentified_race && <span>{match.unidentified_race as string}</span>}
                              {match.unidentified_date && <span>Found {match.unidentified_date as string}</span>}
                            </>
                          ) : (
                            <>
                              {match.missing_name && <span className="font-medium">{match.missing_name as string}</span>}
                              {match.missing_sex && <span>{match.missing_sex as string}</span>}
                              {match.missing_age && <span>Age {match.missing_age as string}</span>}
                              {match.missing_date && <span>Missing {match.missing_date as string}</span>}
                              {match.missing_location && <span>{match.missing_location as string}</span>}
                            </>
                          )}
                        </div>
                        {ai?.summary && (
                          <p className="text-xs text-slate-500 mt-1.5 italic">{ai.summary as string}</p>
                        )}
                        {match.missing_marks && (match.missing_marks as string).length > 5 && (
                          <p className="text-xs text-slate-500 mt-1">Marks: {(match.missing_marks as string).slice(0, 100)}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Offender Overlaps */}
          {offenderOverlaps.length > 0 && (
            <Card className="border-red-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-red-600" />
                  Offender Overlaps ({offenderOverlaps.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-slate-500 mb-3">
                  Statistical overlap with known serial offenders. Not an accusation — a signal for investigative review.
                </p>
                <div className="space-y-2">
                  {offenderOverlaps.map((overlap) => {
                    const offender = overlap.offender as Record<string, unknown> | null
                    const score = overlap.composite_score as number
                    const ai = overlap.ai_assessment as Record<string, unknown> | null

                    return (
                      <div key={`${overlap.offender_id}-${overlap.submission_id}`} className="p-3 bg-red-50 rounded-md">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm text-slate-900">
                            {offender?.name as string ?? 'Unknown offender'}
                          </span>
                          <Badge className="text-xs bg-red-100 text-red-800">
                            Score: {score}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          {offender?.status && <span>{offender.status as string}</span>}
                          {offender?.victim_states && <span>Active in: {(offender.victim_states as string[]).slice(0, 3).join(', ')}</span>}
                        </div>
                        {(overlap.matched_mo_keywords as string[])?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {(overlap.matched_mo_keywords as string[]).map((kw: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">{kw}</Badge>
                            ))}
                          </div>
                        )}
                        {ai?.summary && (
                          <p className="text-xs text-slate-500 mt-1.5 italic">{ai.summary as string}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Law Enforcement Handoff */}
          <CaseHandoff recordId={recordId} personName={record.person_name as string | null} />

          {/* Community Notes */}
          {communityNotes && communityNotes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Community Notes ({communityNotes.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {communityNotes.map((note) => {
                    const noteUser = note.user as { full_name: string | null } | null
                    return (
                      <div key={note.id} className="p-3 bg-slate-50 rounded-md">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">{note.note_type}</Badge>
                          <span className="text-xs text-slate-500">
                            {noteUser?.full_name ?? 'Anonymous'} · {new Date(note.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">{note.content}</p>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column — Solvability, Behavioral, Research */}
        <div className="space-y-6">

          {/* Solvability Score */}
          {solvabilityScore && (
            <Card className={
              solvabilityScore.grade === 'high' ? 'border-green-200 bg-green-50' :
              solvabilityScore.grade === 'moderate' ? 'border-amber-200 bg-amber-50' :
              ''
            }>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Flame className="h-4 w-4" />
                  Solvability Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold mb-2">{solvabilityScore.score}/100</div>
                <Badge className={
                  solvabilityScore.grade === 'high' ? 'bg-green-100 text-green-800' :
                  solvabilityScore.grade === 'moderate' ? 'bg-amber-100 text-amber-800' :
                  'bg-slate-100 text-slate-600'
                }>
                  {solvabilityScore.grade}
                </Badge>
                <p className="text-sm text-slate-700 mt-3 leading-relaxed">
                  {solvabilityScore.ai_summary}
                </p>
                {solvabilityScore.ai_next_steps && (solvabilityScore.ai_next_steps as string[]).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <span className="text-xs font-medium text-slate-500">Suggested next steps</span>
                    <ul className="mt-1 space-y-1">
                      {(solvabilityScore.ai_next_steps as string[]).map((step, i) => (
                        <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                          <span className="text-indigo-500 mt-0.5">→</span>
                          {step}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Behavioral Signals */}
          {behavioral && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  Behavioral Signals
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(behavioral.mo_keywords as string[])?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-slate-500">MO Keywords</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(behavioral.mo_keywords as string[]).map((kw, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{kw}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {(behavioral.disposal_indicators as string[])?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-slate-500">Disposal</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(behavioral.disposal_indicators as string[]).map((d, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{d}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {(behavioral.forensic_awareness as string[])?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-slate-500">Forensic Awareness</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(behavioral.forensic_awareness as string[]).map((f, i) => (
                        <Badge key={i} variant="outline" className="text-xs text-red-600 border-red-200">{f}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Investigator Notes */}
          {investigatorNotes && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  AI Investigator Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-700 leading-relaxed">{investigatorNotes}</p>
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 mt-2">
                  AI-generated — not verified
                </Badge>
              </CardContent>
            </Card>
          )}

          {/* Deep Research History */}
          {researchResults && researchResults.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Research History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {researchResults.map((r) => (
                    <div key={r.id} className="p-2 bg-slate-50 rounded-md">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`text-xs ${
                          r.status === 'complete' ? 'text-green-600 border-green-200' :
                          r.status === 'running' ? 'text-blue-600 border-blue-200' :
                          r.status === 'failed' ? 'text-red-600 border-red-200' :
                          ''
                        }`}>
                          {r.status}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {new Date(r.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      {r.summary && (
                        <p className="text-xs text-slate-600 mt-1 line-clamp-3">{r.summary}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <p className="text-sm text-slate-800">{value}</p>
    </div>
  )
}
