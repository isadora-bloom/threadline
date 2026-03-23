'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
} from 'lucide-react'

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
        <div
          className="h-full bg-indigo-400 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-slate-700 w-6 text-right">{score}</span>
    </div>
  )
}

function OffenderCases({ offenderId }: { offenderId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['offender-cases', offenderId],
    queryFn: async () => {
      const res = await fetch(`/api/pattern/offenders?type=offender_cases&offenderId=${offenderId}&limit=20`)
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json()
      return json.overlaps as OffenderOverlap[]
    },
  })

  if (isLoading) return (
    <div className="flex items-center gap-2 p-4 text-slate-500 text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading overlapping cases...
    </div>
  )

  if (!data?.length) return (
    <p className="p-4 text-sm text-slate-500">No overlapping cases found above threshold.</p>
  )

  return (
    <div className="divide-y divide-slate-100">
      {data.map((overlap, i) => (
        <div key={overlap.submission_id} className="p-3 hover:bg-slate-50">
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
            <div className="flex-shrink-0 text-right">
              <span className="text-base font-bold text-indigo-700">{Math.round(overlap.composite_score)}</span>
              <span className="text-xs text-slate-400">/100</span>
            </div>
          </div>
          <div className="mt-2 space-y-0.5">
            <ScoreBar label="Temporal" score={overlap.temporal_score} max={20} />
            <ScoreBar label="Predator geo" score={overlap.predator_geo_score} max={25} />
            <ScoreBar label="Victim geo" score={overlap.victim_geo_score} max={20} />
            <ScoreBar label="Sex" score={overlap.victim_sex_score} max={15} />
            <ScoreBar label="Age" score={overlap.victim_age_score} max={10} />
            <ScoreBar label="Race" score={overlap.victim_race_score} max={5} />
            <ScoreBar label="MO" score={overlap.mo_score} max={5} />
          </div>
        </div>
      ))}
    </div>
  )
}

function OffenderCard({ offender }: { offender: Offender }) {
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
                  <Calendar className="h-3 w-3" />
                  {activeYears}
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
                <p className="px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Top overlapping submissions ({offender.overlap_count} total)
                </p>
                <OffenderCases offenderId={offender.id} />
              </div>
            )}

            {offender.overlap_count === 0 && (
              <p className="px-4 pb-3 text-xs text-slate-400 italic">
                No submissions from this case met the overlap threshold for this offender.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function OffenderView({ caseId }: { caseId: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('overlap_count')
  const [showOnlyOverlaps, setShowOnlyOverlaps] = useState(true)

  const { data, isLoading } = useQuery({
    queryKey: ['offender-list'],
    queryFn: async () => {
      const res = await fetch('/api/pattern/offenders?type=list')
      if (!res.ok) throw new Error('Failed to load offenders')
      const json = await res.json()
      return json.offenders as Offender[]
    },
    staleTime: 5 * 60 * 1000,
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
                sortKey === k
                  ? 'bg-indigo-100 text-indigo-700 font-medium'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {k === 'overlap_count' ? 'Overlaps' : k === 'suspected_count' ? 'Suspected' : k === 'conviction_count' ? 'Convicted' : 'Name'}
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
            <OffenderCard key={offender.id} offender={offender} />
          ))}
        </div>
      )}
    </div>
  )
}
