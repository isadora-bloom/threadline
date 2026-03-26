'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  Calendar,
  Loader2,
  ArrowUpDown,
  User,
  ShieldAlert,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Clock,
  XCircle,
  CheckCircle,
  Brain,
  RefreshCw,
} from 'lucide-react'

// ── AI connection level helpers ───────────────────────────────────────────────

interface AiAssessment {
  connection_level?: number
  summary: string
  supporting: string[]
  conflicting: string[]
  reviewed_at: string
  model: string
}

const CONNECTION_LEVEL_LABEL: Record<number, string> = {
  1: 'Ignore', 2: 'Slim', 3: 'Some connection', 4: 'Strong', 5: 'Very strong',
}
const CONNECTION_LEVEL_COLOR: Record<number, string> = {
  1: 'bg-slate-100 text-slate-500 border-slate-200',
  2: 'bg-blue-50 text-blue-600 border-blue-200',
  3: 'bg-amber-50 text-amber-700 border-amber-200',
  4: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  5: 'bg-rose-100 text-rose-700 border-rose-300',
}
const CONNECTION_LEVEL_ROW: Record<number, string> = {
  1: 'opacity-50',
  2: '',
  3: '',
  4: 'border-l-2 border-l-emerald-300 bg-emerald-50/20',
  5: 'border-l-2 border-l-rose-300 bg-rose-50/30',
}

function ConnectionLevelBadge({ level }: { level: number }) {
  const cls = CONNECTION_LEVEL_COLOR[level] ?? CONNECTION_LEVEL_COLOR[2]
  const label = CONNECTION_LEVEL_LABEL[level] ?? `Level ${level}`
  return (
    <span className={`inline-flex items-center gap-1 border rounded-full text-[10px] px-2 py-0.5 font-semibold ${cls}`}>
      <span className="font-black">{level}</span>
      <span className="opacity-80">{label}</span>
    </span>
  )
}

const STATUS_STYLE: Record<string, string> = {
  unreviewed:          'bg-slate-100 text-slate-600',
  worth_investigating: 'bg-amber-100 text-amber-700',
  confirmed:           'bg-green-100 text-green-700',
  dismissed:           'bg-red-50 text-red-500',
}

// ── Interfaces ────────────────────────────────────────────────────────────────

interface Offender {
  id: string
  name: string
  aliases: string[]
  birth_year: number | null
  status: string
  conviction_count: number | null
  suspected_count: number | null
  active_from: number | null
  active_to: number | null
  incarcerated_from: number | null
  home_states: string[]
  operation_states: string[]
  victim_states: string[]
  victim_sex: string | null
  victim_races: string[]
  victim_age_min: number | null
  victim_age_max: number | null
  victim_age_typical: number | null
  mo_keywords: string[]
  disposal_method: string[]
  cause_of_death: string[]
  signature_details: string | null
  wikipedia_slug: string | null
  overlap_count: number
}

interface OffenderOverlap {
  submission_id: string
  case_id: string
  composite_score: number
  temporal_score: number
  predator_geo_score: number
  victim_geo_score: number
  victim_sex_score: number
  victim_age_score: number
  victim_race_score: number
  mo_score: number
  matched_mo_keywords: string[]
  resolution_confirmed: boolean
  reviewer_status: string
  ai_assessment: AiAssessment | null
  preview: string
}

type SortKey = 'overlap_count' | 'suspected_count' | 'conviction_count' | 'name'

const MO_LABELS: Record<string, string> = {
  hitchhiker: 'Hitchhiker',
  sex_worker: 'Sex worker',
  truck_stop: 'Truck stop',
  long_haul_trucker: 'Long-haul trucker',
  highway_abduction: 'Highway abduction',
  college_campus: 'College campus',
  home_invasion: 'Home invasion',
  runaway: 'Runaway',
  bar: 'Bar/nightclub',
  drifter: 'Drifter/transient',
  children: 'Children',
  national_park: 'National park/trail',
  stalking: 'Stalking',
  modeling_ruse: 'Modeling ruse',
  rail: 'Railroad/rail',
}

function ScoreBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = Math.round((score / max) * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-24 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-700 w-6 text-right">{score}</span>
    </div>
  )
}

// ── OffenderCases — overlap rows for a single offender ────────────────────────

function OffenderCases({ offenderId, caseId, minScore }: {
  offenderId: string
  caseId: string
  minScore: number
}) {
  const [aiFilter, setAiFilter] = useState<'all' | 'strong_plus' | 'some' | 'ignore' | 'worth_investigating'>('all')
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  // Local overrides for optimistic AI + status updates (keyed by submission_id)
  const [localOverrides, setLocalOverrides] = useState<Map<string, Partial<OffenderOverlap>>>(new Map())

  const { data, isLoading } = useQuery({
    queryKey: ['offender-cases', offenderId, caseId, minScore],
    queryFn: async () => {
      const res = await fetch(
        `/api/pattern/offenders?type=offender_cases&offenderId=${offenderId}&caseId=${caseId}&minScore=${minScore}&limit=30`
      )
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json()
      return json.overlaps as OffenderOverlap[]
    },
  })

  async function runAiReview(submissionId: string) {
    setReviewingId(submissionId)
    try {
      const res = await fetch('/api/pattern/offenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offenderId, submissionId }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { ok: boolean; assessment: AiAssessment }
      setLocalOverrides(prev => {
        const next = new Map(prev)
        next.set(submissionId, { ...next.get(submissionId), ai_assessment: json.assessment })
        return next
      })
    } finally {
      setReviewingId(null)
    }
  }

  async function updateStatus(submissionId: string, reviewerStatus: string) {
    setLocalOverrides(prev => {
      const next = new Map(prev)
      next.set(submissionId, { ...next.get(submissionId), reviewer_status: reviewerStatus })
      return next
    })
    await fetch('/api/pattern/offenders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offenderId, submissionId, reviewerStatus }),
    })
  }

  if (isLoading) return (
    <div className="flex items-center gap-2 p-4 text-slate-500 text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading overlapping submissions…
    </div>
  )

  if (!data?.length) return (
    <p className="p-4 text-sm text-slate-500">No submissions in this case meet the overlap threshold.</p>
  )

  // Merge server data with local overrides
  const overlaps = data.map(o => ({ ...o, ...(localOverrides.get(o.submission_id) ?? {}) }))

  // Apply AI connection level filter
  const filtered = overlaps.filter(o => {
    const lvl = o.ai_assessment?.connection_level ?? null
    if (aiFilter === 'strong_plus')       return lvl !== null && lvl >= 4
    if (aiFilter === 'some')              return lvl === 3
    if (aiFilter === 'ignore')            return lvl !== null && lvl <= 2
    if (aiFilter === 'worth_investigating') return o.reviewer_status === 'worth_investigating'
    return true
  })

  const hasAnyReview = overlaps.some(o => o.ai_assessment !== null)

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100 flex-wrap">
        <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
          <Sparkles className="h-2.5 w-2.5" />Filter:
        </span>
        {([
          { value: 'all',                 label: 'All',                 cls: 'bg-white text-slate-600 border-slate-300',          active: 'bg-slate-800 text-white border-slate-800' },
          { value: 'worth_investigating', label: 'Worth investigating',  cls: 'bg-amber-50 text-amber-700 border-amber-200',        active: 'bg-amber-600 text-white border-amber-600' },
          { value: 'strong_plus',         label: '4–5 Strong+',         cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',  active: 'bg-emerald-700 text-white border-emerald-700' },
          { value: 'some',                label: '3 Some',              cls: 'bg-amber-50 text-amber-700 border-amber-200',        active: 'bg-amber-500 text-white border-amber-500' },
          { value: 'ignore',              label: '1–2 Ignore/Slim',     cls: 'bg-slate-100 text-slate-500 border-slate-200',       active: 'bg-slate-500 text-white border-slate-500' },
        ] as const).map(f => (
          <button key={f.value} onClick={() => setAiFilter(f.value)}
            className={`px-2 py-0.5 text-[10px] font-medium rounded border transition-colors ${aiFilter === f.value ? f.active : f.cls}`}>
            {f.label}
          </button>
        ))}
        {!hasAnyReview && (
          <span className="text-[10px] text-slate-400 italic ml-1">— run AI review on rows below to enable filtering</span>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {filtered.map((overlap) => {
          const aiLevel = overlap.ai_assessment?.connection_level ?? null
          const rowCls = aiLevel ? (CONNECTION_LEVEL_ROW[aiLevel] ?? '') : ''
          const isReviewing = reviewingId === overlap.submission_id
          const status = overlap.reviewer_status ?? 'unreviewed'

          return (
            <div
              key={overlap.submission_id}
              className={`p-3 ${overlap.resolution_confirmed ? 'bg-green-50' : 'hover:bg-slate-50/50'} ${rowCls}`}
            >
              {overlap.resolution_confirmed && (
                <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold text-green-700 uppercase tracking-wide">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Confirmed connection — conviction on record
                </div>
              )}

              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">{overlap.preview || '(no preview)'}</p>
                  {overlap.matched_mo_keywords?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {overlap.matched_mo_keywords.map(kw => (
                        <Badge key={kw} variant="outline" className="text-[10px] px-1.5 py-0 text-indigo-700 border-indigo-200 bg-indigo-50">
                          {MO_LABELS[kw] ?? kw}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                  <div className="text-right">
                    <span className="text-base font-bold text-indigo-700">{Math.round(overlap.composite_score)}</span>
                    <span className="text-xs text-slate-400">/100</span>
                  </div>
                  {aiLevel && <ConnectionLevelBadge level={aiLevel} />}
                  <Badge className={`text-[10px] ${STATUS_STYLE[status]}`}>
                    {status.replace(/_/g, ' ')}
                  </Badge>
                  <Link
                    href={`/cases/${overlap.case_id}/submissions/${overlap.submission_id}`}
                    className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    View submission <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>

              {/* Score bars */}
              <div className="mt-2 space-y-0.5">
                <ScoreBar label="MO match"     score={overlap.mo_score}           max={22} />
                <ScoreBar label="Predator geo" score={overlap.predator_geo_score}  max={20} />
                <ScoreBar label="Sex"          score={overlap.victim_sex_score}    max={15} />
                <ScoreBar label="Victim geo"   score={overlap.victim_geo_score}    max={15} />
                <ScoreBar label="Temporal"     score={overlap.temporal_score}      max={15} />
                <ScoreBar label="Age"          score={overlap.victim_age_score}    max={8} />
                <ScoreBar label="Race"         score={overlap.victim_race_score}   max={5} />
              </div>

              {/* AI assessment panel */}
              {overlap.ai_assessment && aiLevel && (
                <div className={`mt-2 p-2.5 rounded border space-y-1 text-[11px] ${
                  aiLevel >= 4 ? 'bg-emerald-50 border-emerald-200' :
                  aiLevel <= 1 ? 'bg-slate-50 border-slate-200' :
                  'bg-amber-50 border-amber-200'
                }`}>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3 w-3 text-slate-400 flex-shrink-0" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">AI assessment</span>
                    <ConnectionLevelBadge level={aiLevel} />
                  </div>
                  <p className="text-slate-700 leading-relaxed">{overlap.ai_assessment.summary}</p>
                  {overlap.ai_assessment.supporting.length > 0 && (
                    <ul className="space-y-0.5 mt-1">
                      {overlap.ai_assessment.supporting.map((s, i) => (
                        <li key={i} className="text-[10px] text-green-700 flex items-start gap-1">
                          <CheckCircle className="h-2.5 w-2.5 flex-shrink-0 mt-0.5" />{s}
                        </li>
                      ))}
                    </ul>
                  )}
                  {overlap.ai_assessment.conflicting.length > 0 && (
                    <ul className="space-y-0.5">
                      {overlap.ai_assessment.conflicting.map((s, i) => (
                        <li key={i} className="text-[10px] text-red-600 flex items-start gap-1">
                          <XCircle className="h-2.5 w-2.5 flex-shrink-0 mt-0.5" />{s}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[9px] text-slate-400">AI signal only — requires investigator review.</p>
                </div>
              )}

              {/* Action row */}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {/* AI review */}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] gap-1 border-violet-200 text-violet-600 hover:bg-violet-50"
                  disabled={isReviewing}
                  onClick={() => runAiReview(overlap.submission_id)}
                >
                  {isReviewing
                    ? <><Loader2 className="h-2.5 w-2.5 animate-spin" />Reviewing…</>
                    : <><Sparkles className="h-2.5 w-2.5" />{overlap.ai_assessment ? 'Re-review' : 'AI review'}</>
                  }
                </Button>

                {/* Reviewer status actions */}
                {status === 'unreviewed' && (
                  <>
                    <button
                      onClick={() => updateStatus(overlap.submission_id, 'worth_investigating')}
                      className="h-6 flex items-center gap-1 text-[10px] px-2 rounded border border-amber-200 text-amber-700 hover:bg-amber-50 transition-colors"
                    >
                      <Clock className="h-2.5 w-2.5" />Worth investigating
                    </button>
                    <button
                      onClick={() => updateStatus(overlap.submission_id, 'dismissed')}
                      className="h-6 flex items-center gap-1 text-[10px] px-2 rounded border border-slate-200 text-slate-400 hover:bg-slate-50 transition-colors"
                    >
                      <XCircle className="h-2.5 w-2.5" />Dismiss
                    </button>
                  </>
                )}
                {status === 'worth_investigating' && (
                  <button
                    onClick={() => updateStatus(overlap.submission_id, 'unreviewed')}
                    className="h-6 flex items-center gap-1 text-[10px] px-2 rounded border border-slate-200 text-slate-400 hover:bg-slate-50 transition-colors"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />Reset
                  </button>
                )}
                {status === 'dismissed' && (
                  <button
                    onClick={() => updateStatus(overlap.submission_id, 'unreviewed')}
                    className="h-6 flex items-center gap-1 text-[10px] px-2 rounded border border-slate-200 text-slate-400 hover:bg-slate-50 transition-colors"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />Restore
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <p className="p-4 text-sm text-slate-400 italic text-center">
            No overlaps match this filter.
          </p>
        )}
      </div>
    </div>
  )
}

// ── OffenderCard ──────────────────────────────────────────────────────────────

function OffenderCard({ offender, caseId, minScore }: { offender: Offender; caseId: string; minScore: number }) {
  const [expanded, setExpanded] = useState(false)

  const activeYears = offender.active_from
    ? offender.active_to
      ? `${offender.active_from}–${offender.active_to}`
      : `${offender.active_from}–?`
    : null

  const allStates = Array.from(new Set([
    ...(offender.home_states ?? []),
    ...(offender.operation_states ?? []),
    ...(offender.victim_states ?? []),
  ]))

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Header row */}
        <div
          className="flex items-start gap-3 p-4 cursor-pointer hover:bg-slate-50"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex-shrink-0 mt-0.5">
            <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center">
              <User className="h-5 w-5 text-slate-500" />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900">{offender.name}</span>
              {offender.wikipedia_slug && (
                <a
                  href={`https://en.wikipedia.org/wiki/${offender.wikipedia_slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-slate-500">
                {offender.status}
              </Badge>
            </div>

            {offender.aliases?.length > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                a.k.a. {offender.aliases.slice(0, 3).join(', ')}
                {offender.aliases.length > 3 && ` +${offender.aliases.length - 3} more`}
              </p>
            )}

            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {activeYears && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Calendar className="h-3 w-3" />{activeYears}
                </span>
              )}
              {allStates.length > 0 && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {allStates.slice(0, 6).join(', ')}
                  {allStates.length > 6 && ` +${allStates.length - 6}`}
                </span>
              )}
            </div>

            {offender.mo_keywords?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {offender.mo_keywords.slice(0, 4).map(kw => (
                  <Badge key={kw} variant="outline" className="text-[10px] px-1.5 py-0 text-slate-500">
                    {MO_LABELS[kw] ?? kw}
                  </Badge>
                ))}
                {offender.mo_keywords.length > 4 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-slate-400">
                    +{offender.mo_keywords.length - 4}
                  </Badge>
                )}
              </div>
            )}
          </div>

          <div className="flex-shrink-0 text-right">
            <div className="text-xl font-bold text-indigo-700">{offender.overlap_count}</div>
            <div className="text-[10px] text-slate-400 leading-tight">overlap{offender.overlap_count !== 1 ? 's' : ''}</div>
            <div className="mt-1 text-xs text-slate-500">
              {offender.conviction_count ?? '?'} conv
              {offender.suspected_count ? ` · ${offender.suspected_count} susp` : ''}
            </div>
          </div>

          <div className="flex-shrink-0 text-slate-400 mt-1">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="border-t border-slate-100">
            {/* Victim profile strip */}
            <div className="px-4 py-3 bg-slate-50 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              {offender.victim_sex && (
                <span><span className="text-slate-400">Victims:</span> {offender.victim_sex}</span>
              )}
              {(offender.victim_age_min !== null || offender.victim_age_typical !== null) && (
                <span>
                  <span className="text-slate-400">Age:</span>{' '}
                  {offender.victim_age_typical !== null
                    ? `typ. ${offender.victim_age_typical}`
                    : `${offender.victim_age_min}–${offender.victim_age_max}`}
                </span>
              )}
              {offender.victim_races?.length > 0 && (
                <span><span className="text-slate-400">Race:</span> {offender.victim_races.join(', ')}</span>
              )}
              {offender.birth_year && (
                <span><span className="text-slate-400">Born:</span> {offender.birth_year}</span>
              )}
              {offender.incarcerated_from && (
                <span><span className="text-slate-400">Incarcerated:</span> {offender.incarcerated_from}</span>
              )}
            </div>

            {/* Predator vs victim geography */}
            <div className="px-4 py-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-400 font-medium mb-1">Predator geography</p>
                {offender.home_states?.length > 0 && (
                  <p className="text-slate-600"><span className="text-slate-400">Home:</span> {offender.home_states.join(', ')}</p>
                )}
                {offender.operation_states?.length > 0 && (
                  <p className="text-slate-600"><span className="text-slate-400">Operated:</span> {offender.operation_states.join(', ')}</p>
                )}
              </div>
              <div>
                <p className="text-slate-400 font-medium mb-1">Victim geography</p>
                {offender.victim_states?.length > 0 && (
                  <p className="text-slate-600">{offender.victim_states.join(', ')}</p>
                )}
              </div>
            </div>

            {offender.signature_details && (
              <div className="px-4 pb-3 text-xs text-slate-600">
                <span className="text-slate-400 font-medium">Signature: </span>
                {offender.signature_details}
              </div>
            )}

            {/* Matching submissions */}
            {offender.overlap_count > 0 && (
              <div className="border-t border-slate-100">
                <div className="flex items-center justify-between px-4 py-2">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Overlapping submissions ({offender.overlap_count} above threshold)
                  </p>
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <Brain className="h-3 w-3" />
                    <span>Click AI review on any row below to assess the connection</span>
                  </div>
                </div>
                <OffenderCases offenderId={offender.id} caseId={caseId} minScore={minScore} />
              </div>
            )}

            {offender.overlap_count === 0 && (
              <p className="px-4 pb-3 text-xs text-slate-400 italic">
                No submissions in this case met the overlap threshold for this offender.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── OffenderView (main) ───────────────────────────────────────────────────────

const SCORE_OPTIONS = [
  { label: '50+', value: 50 },
  { label: '60+', value: 60 },
  { label: '65+', value: 65 },
  { label: '75+', value: 75 },
  { label: '85+', value: 85 },
]

export function OffenderView({ caseId }: { caseId: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('overlap_count')
  const [showOnlyOverlaps, setShowOnlyOverlaps] = useState(true)
  const [minScore, setMinScore] = useState(65)

  const { data, isLoading } = useQuery({
    queryKey: ['offender-list', caseId, minScore],
    queryFn: async () => {
      const res = await fetch(`/api/pattern/offenders?type=list&caseId=${caseId}&minScore=${minScore}`)
      if (!res.ok) throw new Error('Failed to load offenders')
      const json = await res.json()
      return json.offenders as Offender[]
    },
    staleTime: 2 * 60 * 1000,
  })

  const sorted = [...(data ?? [])].sort((a, b) => {
    if (sortKey === 'name') return a.name.localeCompare(b.name)
    return (b[sortKey] ?? 0) - (a[sortKey] ?? 0)
  })

  const filtered = showOnlyOverlaps ? sorted.filter(o => o.overlap_count > 0) : sorted

  const totalOverlaps = (data ?? []).reduce((s, o) => s + o.overlap_count, 0)
  const withOverlaps = (data ?? []).filter(o => o.overlap_count > 0).length

  return (
    <div className="space-y-4">
      {/* Epistemic disclaimer */}
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <ShieldAlert className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800 leading-relaxed space-y-1">
          <p className="font-medium">Pattern overlap — not an accusation</p>
          <p>
            These results show statistical similarities between case characteristics and documented patterns of convicted offenders.
            Overlap scores reflect geography, timing, victim profile, and MO keywords only. A high score means the case shares
            characteristics with a known pattern — it does not implicate this individual in any specific crime.
            All signals require investigator judgment. Do not share overlap results as findings.
          </p>
        </div>
      </div>

      {/* Stats bar */}
      {!isLoading && data && (
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <span><span className="font-semibold text-slate-900">{withOverlaps}</span> of {data.length} offenders have overlapping cases</span>
          <span className="text-slate-300">·</span>
          <span><span className="font-semibold text-slate-900">{totalOverlaps.toLocaleString()}</span> total overlaps</span>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-xs text-slate-500">Sort:</span>
          {(['overlap_count', 'suspected_count', 'conviction_count', 'name'] as SortKey[]).map(k => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className={`text-xs px-2 py-1 rounded ${
                sortKey === k ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {k === 'overlap_count' ? 'Overlaps' : k === 'suspected_count' ? 'Suspected' : k === 'conviction_count' ? 'Convicted' : 'Name'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">Min score:</span>
          {SCORE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setMinScore(opt.value)}
              className={`text-xs px-2 py-1 rounded ${
                minScore === opt.value ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={showOnlyOverlaps}
            onChange={e => setShowOnlyOverlaps(e.target.checked)}
            className="rounded"
          />
          Only show offenders with overlaps
        </label>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading offender profiles...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          {showOnlyOverlaps
            ? 'No offenders have overlapping submissions in this case yet. The matching run may still be in progress.'
            : 'No offenders loaded.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(offender => (
            <OffenderCard key={offender.id} offender={offender} caseId={caseId} minScore={minScore} />
          ))}
        </div>
      )}
    </div>
  )
}
