import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import {
  Clock,
  MapPin,
  Eye,
  FileText,
  AlertCircle,
  ArrowRight,
  Calendar,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type DatePrecision = 'exact' | 'approximate' | 'unknown'

interface TimelineEvent {
  id: string
  type: 'submission' | 'claim'
  eventDate: string
  datePrecision: DatePrecision
  title: string
  location: string | null
  sourceType: string | null
  claimType: string | null
  reviewStatus: string
  submissionId: string
  caseId: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  named_individual: 'Named individual',
  anonymous:        'Anonymous',
  organization:     'Organization',
  official_record:  'Official record',
  media:            'Media',
  system:           'System',
}

const CLAIM_TYPE_LABEL: Record<string, string> = {
  sighting:             'Sighting',
  identifier:           'Identifier',
  association:          'Association',
  statement:            'Statement',
  interpretation:       'Interpretation',
  official:             'Official',
  behavioral:           'Behavioral',
  physical_description: 'Physical description',
  forensic_countermeasure: 'Forensic countermeasure',
  scene_staging:        'Scene staging',
  disposal_method:      'Disposal method',
}

const STATUS_COLOR: Record<string, string> = {
  unverified:   'bg-slate-100 text-slate-500',
  under_review: 'bg-blue-100 text-blue-700',
  corroborated: 'bg-indigo-100 text-indigo-700',
  confirmed:    'bg-green-100 text-green-700',
  disputed:     'bg-orange-100 text-orange-700',
  retracted:    'bg-red-100 text-red-500',
}

function groupByYear(events: TimelineEvent[]): [string, TimelineEvent[]][] {
  const map = new Map<string, TimelineEvent[]>()
  for (const e of events) {
    const year = e.eventDate ? new Date(e.eventDate).getFullYear().toString() : 'Unknown date'
    if (!map.has(year)) map.set(year, [])
    map.get(year)!.push(e)
  }
  // Sort descending by year (most recent first), unknown last
  return Array.from(map.entries()).sort(([a], [b]) => {
    if (a === 'Unknown date') return 1
    if (b === 'Unknown date') return -1
    return Number(b) - Number(a)
  })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: roleData } = await supabase
    .from('case_user_roles').select('role').eq('case_id', caseId).eq('user_id', user.id).single()
  if (!roleData) notFound()

  const { data: caseData } = await supabase.from('cases').select('title').eq('id', caseId).single()

  // ── Fetch submissions with event dates ────────────────────────────────────
  const { data: submissions } = await supabase
    .from('submissions')
    .select('id, event_date, event_date_precision, event_location, source_type, review_status, raw_text')
    .eq('case_id', caseId)
    .not('event_date', 'is', null)
    .order('event_date', { ascending: true })

  // ── Fetch claims with event dates ─────────────────────────────────────────
  const { data: subsAll } = await supabase.from('submissions').select('id').eq('case_id', caseId)
  const subIds = subsAll?.map(s => s.id) ?? []

  const claims = subIds.length > 0
    ? (await supabase
        .from('claims')
        .select('id, submission_id, event_date, event_date_precision, extracted_text, claim_type, verification_status')
        .in('submission_id', subIds)
        .not('event_date', 'is', null)
        .order('event_date', { ascending: true })
      ).data ?? []
    : []

  // ── Merge and sort ────────────────────────────────────────────────────────
  const events: TimelineEvent[] = [
    ...(submissions ?? []).map(s => ({
      id:            s.id,
      type:          'submission' as const,
      eventDate:     s.event_date,
      datePrecision: (s.event_date_precision ?? 'unknown') as DatePrecision,
      title:         (s.raw_text as string).split('\n')[0].slice(0, 120),
      location:      s.event_location,
      sourceType:    s.source_type,
      claimType:     null,
      reviewStatus:  s.review_status,
      submissionId:  s.id,
      caseId,
    })),
    ...claims.map(c => ({
      id:            c.id,
      type:          'claim' as const,
      eventDate:     c.event_date,
      datePrecision: (c.event_date_precision ?? 'unknown') as DatePrecision,
      title:         (c.extracted_text as string).slice(0, 120),
      location:      null,
      sourceType:    null,
      claimType:     c.claim_type,
      reviewStatus:  c.verification_status,
      submissionId:  c.submission_id,
      caseId,
    })),
  ].sort((a, b) => {
    if (!a.eventDate) return 1
    if (!b.eventDate) return -1
    return new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime()
  })

  const grouped = groupByYear(events)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
          <Link href={`/cases/${caseId}`} className="hover:text-slate-700">{caseData?.title}</Link>
          <span>/</span>
          <span>Timeline</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Clock className="h-5 w-5 text-indigo-500" />
              Case Timeline
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {events.length} dated events across submissions and claims, sorted chronologically
            </p>
          </div>
          <Badge variant="outline" className="text-slate-600">
            {events.length} events
          </Badge>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
          <Calendar className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="font-semibold text-slate-700">No dated events yet</p>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            Events appear here when submissions or claims have a known event date. Add event dates when reviewing submissions.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([year, yearEvents]) => (
            <div key={year}>
              {/* Year header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-sm font-bold text-slate-500 uppercase tracking-widest px-2">{year}</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              {/* Events for this year */}
              <div className="relative pl-6 space-y-3">
                {/* Vertical line */}
                <div className="absolute left-[9px] top-0 bottom-0 w-px bg-slate-200" />

                {yearEvents.map((event) => (
                  <div key={`${event.type}-${event.id}`} className="relative">
                    {/* Dot */}
                    <div className={`absolute left-[-15px] top-3 w-3 h-3 rounded-full border-2 border-white ring-2 ${
                      event.type === 'claim'
                        ? 'bg-indigo-400 ring-indigo-200'
                        : 'bg-slate-400 ring-slate-200'
                    }`} />

                    <div className="bg-white border border-slate-200 rounded-lg p-3 hover:border-slate-300 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Date + precision */}
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                              {event.type === 'claim'
                                ? <><FileText className="h-2.5 w-2.5" />Claim</>
                                : <><Eye className="h-2.5 w-2.5" />Submission</>
                              }
                            </span>
                            <span className="text-[10px] text-slate-400">·</span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {event.eventDate
                                ? formatDate(new Date(event.eventDate).toISOString())
                                : '—'}
                              {event.datePrecision === 'approximate' && (
                                <span className="ml-1 text-amber-500 italic">approx.</span>
                              )}
                            </span>
                          </div>

                          {/* Title */}
                          <p className="text-sm text-slate-800 leading-snug line-clamp-2">{event.title}</p>

                          {/* Meta chips */}
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {event.location && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                                <MapPin className="h-2.5 w-2.5" />{event.location}
                              </span>
                            )}
                            {event.claimType && (
                              <span className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 rounded px-1.5 py-0.5">
                                {CLAIM_TYPE_LABEL[event.claimType] ?? event.claimType}
                              </span>
                            )}
                            {event.sourceType && (
                              <span className="text-[10px] bg-slate-50 text-slate-500 border border-slate-100 rounded px-1.5 py-0.5">
                                {SOURCE_LABEL[event.sourceType] ?? event.sourceType}
                              </span>
                            )}
                            <span className={`text-[10px] rounded px-1.5 py-0.5 ${STATUS_COLOR[event.reviewStatus] ?? STATUS_COLOR.unverified}`}>
                              {event.reviewStatus.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </div>

                        {/* Link */}
                        <Link
                          href={`/cases/${event.caseId}/submissions/${event.submissionId}`}
                          className="flex-shrink-0 text-[10px] text-indigo-500 hover:text-indigo-700 flex items-center gap-1 mt-0.5"
                        >
                          View <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Note about events without dates */}
      {subIds.length > 0 && (
        <p className="mt-8 text-center text-xs text-slate-400">
          Submissions and claims without a recorded event date are not shown here.
          Add event dates during submission review to include them.
        </p>
      )}
    </div>
  )
}
