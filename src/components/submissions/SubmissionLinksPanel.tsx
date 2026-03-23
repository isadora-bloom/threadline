'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import {
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  GitMerge,
  ExternalLink,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'

interface CaseResolution {
  status: string
  resolution_type: string | null
  resolution_notes: string | null
  resolved_at: string | null
}

const RESOLUTION_LABEL: Record<string, { label: string; color: string }> = {
  found_alive:              { label: 'Found alive',               color: 'text-green-700 bg-green-50 border-green-200' },
  remains_identified:       { label: 'Remains identified',        color: 'text-green-700 bg-green-50 border-green-200' },
  perpetrator_convicted:    { label: 'Perpetrator convicted',     color: 'text-blue-700 bg-blue-50 border-blue-200' },
  perpetrator_identified:   { label: 'Perpetrator identified',    color: 'text-blue-700 bg-blue-50 border-blue-200' },
  closed_unresolved:        { label: 'Closed — unresolved',       color: 'text-slate-600 bg-slate-50 border-slate-200' },
  duplicate_case:           { label: 'Duplicate case',            color: 'text-slate-500 bg-slate-50 border-slate-200' },
}

function ResolutionBanner({ resolution }: { resolution: CaseResolution }) {
  if (!resolution.resolution_type) return null
  const meta = RESOLUTION_LABEL[resolution.resolution_type]
  if (!meta) return null
  return (
    <div className={`flex items-start gap-2 rounded border px-2.5 py-2 text-xs leading-snug ${meta.color}`}>
      <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
      <div>
        <span className="font-semibold">{meta.label}</span>
        {resolution.resolution_notes && (
          <p className="mt-0.5 opacity-80">{resolution.resolution_notes}</p>
        )}
      </div>
    </div>
  )
}

interface SubmissionLinksPanelProps {
  submissionId: string
  caseId: string
}

interface OffenderOverlap {
  offender_id: string
  composite_score: number
  temporal_score: number
  predator_geo_score: number
  victim_geo_score: number
  mo_score: number
  matched_mo_keywords: string[]
  resolution_confirmed: boolean
  offender: {
    id: string
    name: string
    aliases: string[]
    active_from: number | null
    active_to: number | null
    conviction_count: number | null
    suspected_count: number | null
    victim_sex: string | null
    victim_age_typical: number | null
    home_states: string[]
    operation_states: string[]
    signature_details: string | null
    wikipedia_slug: string | null
  } | null
}

interface DoeMatch {
  id: string
  composite_score: number
  grade: string
  reviewer_status: string
  missing_submission_id: string
  unidentified_submission_id: string
  missing_case_id: string
  unidentified_case_id: string
  missing_doe_id: string | null
  missing_name: string | null
  missing_sex: string | null
  missing_race: string | null
  missing_age: string | null
  missing_location: string | null
  missing_date: string | null
  unidentified_doe_id: string | null
  unidentified_sex: string | null
  unidentified_race: string | null
  unidentified_age: string | null
  unidentified_location: string | null
  unidentified_date: string | null
  signals: Record<string, unknown>
}

const MO_LABELS: Record<string, string> = {
  hitchhiker: 'Hitchhiker', sex_worker: 'Sex worker', truck_stop: 'Truck stop',
  long_haul_trucker: 'Long-haul trucker', highway_abduction: 'Highway abduction',
  college_campus: 'College campus', home_invasion: 'Home invasion', runaway: 'Runaway',
  bar: 'Bar/nightclub', drifter: 'Drifter/transient', children: 'Children',
  national_park: 'National park/trail', stalking: 'Stalking',
  modeling_ruse: 'Modeling ruse', rail: 'Railroad/rail',
}

const GRADE_STYLE: Record<string, string> = {
  very_strong: 'bg-red-100 text-red-700 border-red-200',
  strong: 'bg-orange-100 text-orange-700 border-orange-200',
  notable: 'bg-amber-100 text-amber-700 border-amber-200',
  moderate: 'bg-slate-100 text-slate-600 border-slate-200',
  weak: 'bg-slate-50 text-slate-400 border-slate-100',
}

function Section({
  icon: Icon,
  title,
  count,
  children,
  defaultOpen = true,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-medium text-slate-700">{title}</span>
          {count > 0 && (
            <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 font-medium">
              {count}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

export function SubmissionLinksPanel({ submissionId, caseId }: SubmissionLinksPanelProps) {
  const supabase = createClient()

  // Current case resolution status
  const { data: currentCase } = useQuery({
    queryKey: ['case-resolution', caseId],
    queryFn: async () => {
      const { data } = await supabase
        .from('cases')
        .select('status,resolution_type,resolution_notes,resolved_at')
        .eq('id', caseId)
        .single() as { data: CaseResolution | null }
      return data
    },
    staleTime: 5 * 60 * 1000,
  })

  // Offender overlaps for this submission
  const { data: offenderData, isLoading: offLoading } = useQuery({
    queryKey: ['submission-offender-overlaps', submissionId],
    queryFn: async () => {
      const res = await fetch(`/api/pattern/offenders?type=submission_overlaps&submissionId=${submissionId}`)
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      return json.overlaps as OffenderOverlap[]
    },
    staleTime: 5 * 60 * 1000,
  })

  // DOE match candidates — this submission as either side
  const { data: doeData, isLoading: doeLoading } = useQuery({
    queryKey: ['submission-doe-matches', submissionId],
    queryFn: async () => {
      const { data: matches } = await supabase
        .from('doe_match_candidates' as never)
        .select('*')
        .or(`missing_submission_id.eq.${submissionId},unidentified_submission_id.eq.${submissionId}`)
        .neq('reviewer_status', 'dismissed')
        .order('composite_score', { ascending: false })
        .limit(15) as { data: DoeMatch[] | null }

      if (!matches?.length) return []

      // Fetch resolution status for all matched cases
      const otherCaseIds = [...new Set(matches.map(m =>
        m.missing_submission_id === submissionId ? m.unidentified_case_id : m.missing_case_id
      ))]
      const { data: casesData } = await supabase
        .from('cases')
        .select('id,status,resolution_type,resolution_notes,resolved_at')
        .in('id', otherCaseIds) as { data: Array<CaseResolution & { id: string }> | null }

      const caseMap = new Map((casesData ?? []).map(c => [c.id, c]))

      return matches.map(m => {
        const otherCaseId = m.missing_submission_id === submissionId ? m.unidentified_case_id : m.missing_case_id
        return { ...m, otherCaseResolution: caseMap.get(otherCaseId) ?? null }
      })
    },
    staleTime: 5 * 60 * 1000,
  })

  const offenders = offenderData ?? []
  const doeMatches = doeData ?? []
  const hasAny = offenders.length > 0 || doeMatches.length > 0

  if (!hasAny && !offLoading && !doeLoading) {
    return (
      <div className="px-4 py-3 text-xs text-slate-400 italic">
        No cross-references found for this submission.
      </div>
    )
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Cross-references</p>

      {/* This case's resolution — shown prominently if resolved */}
      {currentCase && currentCase.resolution_type && (
        <ResolutionBanner resolution={currentCase} />
      )}

      {/* Epistemic notice — only show if case not resolved */}
      {(!currentCase?.resolution_type) && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-snug">
          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
          Pattern overlap only — not an accusation or confirmation. Requires investigator judgment.
        </div>
      )}

      {/* Offender overlaps */}
      <Section icon={ShieldAlert} title="Offender pattern overlap" count={offenders.length}>
        {offLoading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
          </div>
        ) : offenders.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-400">No offender patterns overlap this submission above threshold.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {offenders.map(o => (
              <div key={o.offender_id} className={`px-3 py-2.5 ${o.resolution_confirmed ? 'bg-green-50' : ''}`}>
                {o.resolution_confirmed && (
                  <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-semibold text-green-700 uppercase tracking-wide">
                    <CheckCircle2 className="h-3 w-3" />
                    Confirmed connection — conviction on record
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-slate-800">{o.offender?.name ?? 'Unknown'}</span>
                      {o.offender?.wikipedia_slug && (
                        <a
                          href={`https://en.wikipedia.org/wiki/${o.offender.wikipedia_slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 hover:text-slate-600"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <Badge variant="outline" className="text-[9px] px-1 py-0 text-slate-400">
                        {o.offender?.conviction_count ?? '?'} conv · {o.offender?.suspected_count ?? '?'} susp
                      </Badge>
                    </div>
                    {o.offender?.active_from && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Active {o.offender.active_from}–{o.offender.active_to ?? '?'} · {o.offender.home_states?.slice(0, 3).join(', ')}
                      </p>
                    )}
                    {o.matched_mo_keywords?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {o.matched_mo_keywords.map(kw => (
                          <Badge key={kw} variant="outline" className="text-[9px] px-1 py-0 text-indigo-700 border-indigo-200 bg-indigo-50">
                            {MO_LABELS[kw] ?? kw}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className="text-sm font-bold text-indigo-700">{Math.round(o.composite_score)}</span>
                    <span className="text-[10px] text-slate-400">/100</span>
                  </div>
                </div>
                {/* Mini score bars */}
                <div className="mt-1.5 space-y-0.5">
                  {[
                    { label: 'MO', score: o.mo_score, max: 22 },
                    { label: 'Pred. geo', score: o.predator_geo_score, max: 20 },
                    { label: 'Victim geo', score: o.victim_geo_score, max: 15 },
                    { label: 'Temporal', score: o.temporal_score, max: 15 },
                  ].map(bar => (
                    <div key={bar.label} className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-400 w-14 flex-shrink-0">{bar.label}</span>
                      <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-400 rounded-full"
                          style={{ width: `${Math.round((bar.score / bar.max) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-slate-500 w-4 text-right">{bar.score}</span>
                    </div>
                  ))}
                </div>
                <Link
                  href={`/cases/${caseId}/patterns?tab=offenders`}
                  className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800"
                >
                  View in Offenders tab <ExternalLink className="h-2.5 w-2.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* DOE remains matches */}
      <Section icon={GitMerge} title="Possible remains matches" count={doeMatches.length} defaultOpen={doeMatches.length > 0}>
        {doeLoading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
          </div>
        ) : doeMatches.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-400">No unidentified remains matched to this submission yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {doeMatches.map(m => {
              const isMissing = m.missing_submission_id === submissionId
              const otherSubmissionId = isMissing ? m.unidentified_submission_id : m.missing_submission_id
              const otherCaseId = isMissing ? m.unidentified_case_id : m.missing_case_id
              const otherLabel = isMissing
                ? [m.unidentified_doe_id, m.unidentified_sex, m.unidentified_race, m.unidentified_age, m.unidentified_location].filter(Boolean).join(' · ')
                : [m.missing_doe_id, m.missing_name, m.missing_sex, m.missing_age, m.missing_location].filter(Boolean).join(' · ')
              const otherDate = isMissing ? m.unidentified_date : m.missing_date
              const otherResolution = (m as DoeMatch & { otherCaseResolution: (CaseResolution & { id: string }) | null }).otherCaseResolution

              return (
                <div key={m.id} className="px-3 py-2.5 space-y-1.5">
                  {/* Resolution of the matched case */}
                  {otherResolution?.resolution_type && (
                    <ResolutionBanner resolution={otherResolution} />
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">
                        {isMissing ? 'Unidentified remains' : 'Missing person'}
                      </p>
                      <p className="text-xs font-medium text-slate-800 leading-snug">{otherLabel || '(no description)'}</p>
                      {otherDate && <p className="text-[10px] text-slate-400 mt-0.5">{otherDate}</p>}
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1.5 py-0 ${GRADE_STYLE[m.grade] ?? ''}`}
                        >
                          {m.grade.replace('_', ' ')}
                        </Badge>
                        {m.reviewer_status !== 'unreviewed' && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-slate-500">
                            {m.reviewer_status.replace('_', ' ')}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <span className="text-sm font-bold text-slate-700">{m.composite_score}</span>
                      <span className="text-[10px] text-slate-400">/100</span>
                    </div>
                  </div>
                  <Link
                    href={`/cases/${otherCaseId}/submissions/${otherSubmissionId}`}
                    className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800"
                  >
                    View this record <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}
