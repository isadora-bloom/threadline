'use client'

import { useState, useCallback, type ComponentType } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  GitMerge, Users, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Clock, RefreshCw, Sparkles,
  User, MapPin, Calendar, Eye, Scissors, Scale, Ruler,
  Skull, Flame, Brain, Car, UserX, Search, ShieldAlert,
  Fingerprint, Globe,
} from 'lucide-react'

interface DoeMatchCandidate {
  id: string
  missing_submission_id: string
  unidentified_submission_id: string
  composite_score: number
  grade: string
  signals: Record<string, { score: number; match: string; detail?: string; keywords?: string[] }>
  missing_doe_id: string | null
  missing_name: string | null
  missing_sex: string | null
  missing_race: string | null
  missing_age: string | null
  missing_location: string | null
  missing_date: string | null
  missing_hair: string | null
  missing_eyes: string | null
  missing_marks: string | null
  unidentified_doe_id: string | null
  unidentified_sex: string | null
  unidentified_race: string | null
  unidentified_age: string | null
  unidentified_location: string | null
  unidentified_date: string | null
  unidentified_hair: string | null
  unidentified_eyes: string | null
  unidentified_marks: string | null
  reviewer_status: string
  reviewer_note: string | null
  generated_at: string
}

interface DoeCluster {
  id: string
  cluster_label: string
  cluster_type: string
  sex: string | null
  race: string | null
  age_group: string | null
  state: string | null
  temporal_pattern: string | null
  year_span_start: number | null
  year_span_end: number | null
  case_count: number
  primary_signal: string | null
  signal_category: string | null
  matched_signals: string[] | null
  submission_ids: string[] | null
  signals: Record<string, unknown>
  ai_narrative: string | null
  ai_generated_at: string | null
  reviewer_status: string
  reviewer_note: string | null
  generated_at: string
}

interface DoeClusterMember {
  id: string
  cluster_id: string
  submission_id: string
  confidence: number
  confidence_reason: string | null
  membership_status: 'candidate' | 'confirmed' | 'rejected'
  member_name: string | null
  member_doe_id: string | null
  member_location: string | null
  member_date: string | null
  member_age: string | null
  member_sex: string | null
  notes: string | null
}

interface DoeEntityMention {
  id: string
  submission_id: string
  entity_type: 'person_name' | 'vehicle' | 'location' | 'possible_duplicate'
  entity_value: string
  raw_snippet: string | null
  matched_submission_ids: string[]
  match_count: number
  generated_at: string
}

interface DoeStallFlag {
  id: string
  submission_id: string
  stall_type: 'voluntary_misclassification' | 'runaway_no_followup' | 'quick_closure_young'
  stall_label: string
  elapsed_days: number | null
  classification_used: string | null
  supporting_signals: string[]
  missing_name: string | null
  missing_age: string | null
  missing_date: string | null
  missing_location: string | null
  reviewer_status: string
  reviewer_note: string | null
  generated_at: string
}

interface DoeMatchViewProps {
  caseId: string
  canManage: boolean
}

const GRADE_COLOR: Record<string, string> = {
  very_strong: 'bg-red-100 text-red-800 border-red-200',
  strong:      'bg-orange-100 text-orange-800 border-orange-200',
  notable:     'bg-amber-100 text-amber-800 border-amber-200',
  moderate:    'bg-blue-100 text-blue-700 border-blue-200',
  weak:        'bg-slate-100 text-slate-600 border-slate-200',
}

const GRADE_LABEL: Record<string, string> = {
  very_strong: 'Very Strong', strong: 'Strong', notable: 'Notable',
  moderate: 'Moderate', weak: 'Weak',
}

const STATUS_STYLE: Record<string, string> = {
  unreviewed:         'bg-slate-100 text-slate-600',
  worth_investigating:'bg-amber-100 text-amber-700',
  confirmed:          'bg-green-100 text-green-700',
  dismissed:          'bg-red-50 text-red-500',
}

const MATCH_DOT: Record<string, string> = {
  exact:         'bg-green-500',
  group_match:   'bg-emerald-400',
  adjacent:      'bg-amber-400',
  very_close:    'bg-green-500',
  close:         'bg-emerald-400',
  possible:      'bg-amber-400',
  overlap:       'bg-amber-300',
  partial:       'bg-amber-400',
  strong_overlap:'bg-green-500',
  partial_overlap:'bg-amber-400',
  both_have_marks:'bg-amber-300',
  same_state:    'bg-green-500',
  adjacent_state:'bg-emerald-400',
  unknown:       'bg-slate-300',
  no_match:      'bg-red-300',
  mismatch:      'bg-red-500',
  none_mentioned:'bg-slate-200',
  one_side_only: 'bg-slate-200',
  incompatible:  'bg-red-400',
}

function SignalBar({ label, signal, icon: Icon }: {
  label: string
  signal: { score: number; match: string; detail?: string; keywords?: string[] } | undefined
  icon: React.ComponentType<{ className?: string }>
}) {
  if (!signal) return null
  const dotColor = MATCH_DOT[signal.match] ?? 'bg-slate-300'
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <Icon className="h-3 w-3 text-slate-400 flex-shrink-0" />
      <span className="text-slate-500 w-12 flex-shrink-0">{label}</span>
      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dotColor}`} />
      <span className="text-slate-600">
        {signal.match.replace(/_/g, ' ')}
        {signal.detail ? ` (${signal.detail})` : ''}
        {signal.keywords?.length ? `: ${signal.keywords.join(', ')}` : ''}
      </span>
      {signal.score > 0 && (
        <span className="ml-auto text-slate-400 font-mono">+{signal.score}</span>
      )}
    </div>
  )
}

function ScoreBar({ score, grade }: { score: number; grade: string }) {
  const color =
    grade === 'very_strong' ? 'bg-red-400' :
    grade === 'strong'      ? 'bg-orange-400' :
    grade === 'notable'     ? 'bg-amber-400' :
    grade === 'moderate'    ? 'bg-blue-400' : 'bg-slate-300'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-bold text-slate-700 w-8 text-right">{score}</span>
    </div>
  )
}

const BODY_STATE_BADGE: Record<string, { label: string; style: string; icon: typeof Skull }> = {
  skeletal: { label: 'Skeletal remains', style: 'bg-purple-100 text-purple-700 border-purple-200', icon: Skull },
  burned:   { label: 'Burned remains',   style: 'bg-red-100 text-red-700 border-red-200',       icon: Flame },
  advanced: { label: 'Advanced decomp',  style: 'bg-orange-100 text-orange-700 border-orange-200', icon: AlertTriangle },
  partial:  { label: 'Partial remains',  style: 'bg-amber-100 text-amber-700 border-amber-200', icon: AlertTriangle },
  moderate: { label: 'Moderate decomp',  style: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: AlertTriangle },
}

const SIGNAL_CATEGORY_STYLE: Record<string, string> = {
  location_context: 'bg-blue-50 text-blue-700 border-blue-200',
  last_activity:    'bg-indigo-50 text-indigo-700 border-indigo-200',
  social_context:   'bg-rose-50 text-rose-700 border-rose-200',
  behavioral:       'bg-amber-50 text-amber-700 border-amber-200',
  investigative:    'bg-slate-50 text-slate-700 border-slate-200',
}

const SIGNAL_DEFS: { key: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { key: 'sex',      label: 'Sex',    Icon: User },
  { key: 'race',     label: 'Race',   Icon: Globe },
  { key: 'age',      label: 'Age',    Icon: Calendar },
  { key: 'hair',     label: 'Hair',   Icon: Scissors },
  { key: 'eyes',     label: 'Eyes',   Icon: Eye },
  { key: 'height',   label: 'Height', Icon: Ruler },
  { key: 'weight',   label: 'Weight', Icon: Scale },
  { key: 'marks',    label: 'Marks',  Icon: Fingerprint },
  { key: 'location', label: 'State',  Icon: MapPin },
]

function countPositiveSignals(signals: DoeMatchCandidate['signals']): number {
  const noData = ['unknown', 'no_match', 'not_available', 'no_data', 'missing']
  return SIGNAL_DEFS.filter(({ key }) => {
    const s = signals[key]
    return s && s.score > 0 && !noData.includes(s.match)
  }).length
}

function MatchCard({ match, onReview }: {
  match: DoeMatchCandidate
  onReview: (id: string, status: string, note?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [fullRecords, setFullRecords] = useState<{ missing: string | null; unidentified: string | null } | null>(null)
  const [fullRecordsLoading, setFullRecordsLoading] = useState(false)
  const [showFull, setShowFull] = useState(false)

  const supabase = createClient()

  async function loadFullRecords() {
    if (fullRecords) { setShowFull(true); return }
    setFullRecordsLoading(true)
    try {
      const [{ data: mRaw }, { data: uRaw }] = await Promise.all([
        supabase.from('submissions').select('raw_text').eq('id', match.missing_submission_id).single(),
        supabase.from('submissions').select('raw_text').eq('id', match.unidentified_submission_id).single(),
      ])
      setFullRecords({
        missing:      (mRaw as { raw_text: string } | null)?.raw_text ?? null,
        unidentified: (uRaw as { raw_text: string } | null)?.raw_text ?? null,
      })
      setShowFull(true)
    } finally {
      setFullRecordsLoading(false)
    }
  }

  async function review(status: string) {
    setReviewing(true)
    onReview(match.id, status)
    setTimeout(() => setReviewing(false), 500)
  }

  const isDismissed = match.reviewer_status === 'dismissed'

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={`overflow-hidden transition-opacity ${isDismissed ? 'opacity-40' : ''}`}>
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                {/* Score */}
                <div className="flex-shrink-0 text-center w-12">
                  <div className="text-2xl font-black text-slate-800">{match.composite_score}</div>
                  <Badge className={`text-[9px] px-1 py-0 ${GRADE_COLOR[match.grade]}`}>
                    {GRADE_LABEL[match.grade]}
                  </Badge>
                  <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{countPositiveSignals(match.signals)}/9</div>
                </div>

                {/* People */}
                <div className="flex-1 grid grid-cols-2 gap-3 min-w-0">
                  {/* Missing */}
                  <div className="space-y-0.5">
                    <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Missing Person</div>
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {match.missing_name ?? 'Unknown name'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {[match.missing_sex, match.missing_race, match.missing_age].filter(Boolean).join(', ')}
                    </div>
                    {match.missing_location && (
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        <MapPin className="h-2.5 w-2.5" />{match.missing_location}
                      </div>
                    )}
                    {match.missing_doe_id && (
                      <div className="text-[10px] text-indigo-400 font-mono">{match.missing_doe_id}</div>
                    )}
                  </div>

                  {/* Unidentified */}
                  <div className="space-y-0.5">
                    <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Unidentified</div>
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {match.unidentified_doe_id ?? 'Unknown ID'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {[match.unidentified_sex, match.unidentified_race, match.unidentified_age].filter(Boolean).join(', ')}
                    </div>
                    {match.unidentified_location && (
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        <MapPin className="h-2.5 w-2.5" />{match.unidentified_location}
                      </div>
                    )}
                    {match.unidentified_date && (
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Calendar className="h-2.5 w-2.5" />Found: {match.unidentified_date}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side */}
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <Badge className={`text-[10px] ${STATUS_STYLE[match.reviewer_status]}`}>
                    {match.reviewer_status.replace(/_/g, ' ')}
                  </Badge>
                  {open
                    ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                    : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  }
                </div>
              </div>

              {/* Signal dot strip */}
              <div className="flex gap-1 mt-2">
                {SIGNAL_DEFS.map(({ key, label, Icon }) => {
                  const s = match.signals[key]
                  const noData = ['unknown', 'no_match', 'not_available', 'no_data', 'missing']
                  const active = s && s.score > 0 && !noData.includes(s.match)
                  return (
                    <div
                      key={key}
                      title={`${label}: ${s?.match ?? 'no data'}${s?.detail ? ' — ' + s.detail : ''}`}
                      className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium
                        ${active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-50 text-slate-300 border border-slate-100'}`}
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </div>
                  )
                })}
              </div>

              {/* Body state warning (if significant decomposition) */}
              {(() => {
                const bs = match.signals.body_state as unknown as { state: string; note: string | null } | undefined
                if (!bs || !(bs.state in BODY_STATE_BADGE)) return null
                const badge = BODY_STATE_BADGE[bs.state]
                const Icon = badge.icon
                return (
                  <div className={`mt-2 flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border ${badge.style}`}>
                    <Icon className="h-3 w-3 flex-shrink-0" />
                    <span className="font-medium">{badge.label}</span>
                    <span className="opacity-70">— soft-tissue signals weighted down</span>
                  </div>
                )
              })()}

              {/* Score bar (always visible) */}
              <div className="mt-2">
                <ScoreBar score={match.composite_score} grade={match.grade} />
              </div>
            </CardContent>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">
            {/* Signal breakdown */}
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Signal breakdown</p>
              <div className="space-y-1.5">
                <SignalBar label="Sex"     signal={match.signals.sex}      icon={User} />
                <SignalBar label="Race"    signal={match.signals.race}     icon={Globe} />
                <SignalBar label="Age"     signal={match.signals.age}      icon={Calendar} />
                <SignalBar label="Hair"    signal={match.signals.hair}     icon={Scissors} />
                <SignalBar label="Eyes"    signal={match.signals.eyes}     icon={Eye} />
                <SignalBar label="Height"  signal={match.signals.height}   icon={Ruler} />
                <SignalBar label="Weight"  signal={match.signals.weight}   icon={Scale} />
                <SignalBar label="Marks"   signal={match.signals.marks}    icon={Fingerprint} />
                <SignalBar label="State"   signal={match.signals.location} icon={MapPin} />
              </div>
            </div>

            {/* Distinguishing marks full text */}
            {(match.missing_marks || match.unidentified_marks) && (
              <div className="grid grid-cols-2 gap-3">
                {match.missing_marks && (
                  <div>
                    <p className="text-[10px] text-slate-400 font-medium mb-0.5">Missing — marks</p>
                    <p className="text-[11px] text-slate-600">{match.missing_marks}</p>
                  </div>
                )}
                {match.unidentified_marks && (
                  <div>
                    <p className="text-[10px] text-slate-400 font-medium mb-0.5">Unidentified — marks</p>
                    <p className="text-[11px] text-slate-600">{match.unidentified_marks}</p>
                  </div>
                )}
              </div>
            )}

            {/* Body state note (expanded detail) */}
            {(() => {
              const bs = match.signals.body_state as unknown as { note: string | null } | undefined
              if (!bs?.note) return null
              return (
                <div className="flex items-start gap-2 p-2 bg-purple-50 border border-purple-100 rounded text-[10px] text-purple-700">
                  <Skull className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  {bs.note}
                </div>
              )
            })()}

            {/* Epistemic notice */}
            <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-100 rounded text-[10px] text-amber-700">
              <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              This score is a statistical signal only. It does not confirm any connection.
              Verification requires official record comparison and investigator judgment.
            </div>

            {/* Review actions */}
            {match.reviewer_status === 'unreviewed' && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1 border-amber-200 text-amber-700 hover:bg-amber-50"
                  disabled={reviewing}
                  onClick={() => review('worth_investigating')}
                >
                  <Clock className="h-3 w-3" />
                  Worth investigating
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1 border-green-200 text-green-700 hover:bg-green-50"
                  disabled={reviewing}
                  onClick={() => review('confirmed')}
                >
                  <CheckCircle className="h-3 w-3" />
                  Mark confirmed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1 text-slate-400 hover:bg-slate-50"
                  disabled={reviewing}
                  onClick={() => review('dismissed')}
                >
                  <XCircle className="h-3 w-3" />
                  Dismiss
                </Button>
              </div>
            )}
            {match.reviewer_status !== 'unreviewed' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] text-slate-400"
                onClick={() => review('unreviewed')}
              >
                Reset to unreviewed
              </Button>
            )}

            {/* Full record viewer */}
            <div className="pt-1 border-t border-slate-100">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] text-slate-400 gap-1 px-0"
                disabled={fullRecordsLoading}
                onClick={() => showFull ? setShowFull(false) : loadFullRecords()}
              >
                {fullRecordsLoading
                  ? <><Loader2 className="h-3 w-3 animate-spin" />Loading full records…</>
                  : showFull
                  ? <><ChevronUp className="h-3 w-3" />Hide full records</>
                  : <><ChevronDown className="h-3 w-3" />View full records</>
                }
              </Button>

              {showFull && fullRecords && (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {fullRecords.missing && (
                    <div>
                      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                        Missing person — full record
                      </p>
                      <pre className="text-[10px] text-slate-600 bg-slate-50 border border-slate-100 rounded p-2 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto font-mono">
                        {fullRecords.missing}
                      </pre>
                    </div>
                  )}
                  {fullRecords.unidentified && (
                    <div>
                      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                        Unidentified — full record
                      </p>
                      <pre className="text-[10px] text-slate-600 bg-slate-50 border border-slate-100 rounded p-2 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto font-mono">
                        {fullRecords.unidentified}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

const CLUSTER_TYPE_META: Record<string, { label: string; borderColor: string; iconBg: string; iconColor: string }> = {
  circumstance_signal:      { label: 'Circumstance',    borderColor: 'border-l-rose-400',    iconBg: 'bg-rose-100',    iconColor: 'text-rose-600' },
  demographic_temporal:     { label: 'Demographic',     borderColor: 'border-l-indigo-400',  iconBg: 'bg-indigo-100',  iconColor: 'text-indigo-600' },
  same_date_proximity:      { label: 'Same date',       borderColor: 'border-l-amber-400',   iconBg: 'bg-amber-100',   iconColor: 'text-amber-600' },
  location_runaway_cluster: { label: 'Location runaway', borderColor: 'border-l-orange-400', iconBg: 'bg-orange-100',  iconColor: 'text-orange-600' },
  corridor_cluster:         { label: 'Corridor',        borderColor: 'border-l-cyan-400',    iconBg: 'bg-cyan-100',    iconColor: 'text-cyan-600' },
  age_bracket:              { label: 'Age bracket',     borderColor: 'border-l-purple-400',  iconBg: 'bg-purple-100',  iconColor: 'text-purple-600' },
}

const MEMBER_STATUS_STYLE: Record<string, string> = {
  candidate: 'bg-slate-100 text-slate-600',
  confirmed: 'bg-green-100 text-green-700',
  rejected:  'bg-red-50 text-red-500',
}

function ClusterMemberRow({ member, onReviewMember }: {
  member: DoeClusterMember
  onReviewMember: (id: string, status: 'confirmed' | 'rejected' | 'candidate') => void
}) {
  const pct = Math.round(member.confidence * 100)
  const isRejected = member.membership_status === 'rejected'

  return (
    <div className={`flex items-start gap-2 p-2 rounded border border-slate-100 text-[10px] transition-opacity ${isRejected ? 'opacity-40' : ''}`}>
      {/* Confidence */}
      <div className="flex-shrink-0 text-center w-8">
        <div className={`text-sm font-black ${pct >= 85 ? 'text-emerald-700' : pct >= 75 ? 'text-amber-600' : 'text-slate-500'}`}>{pct}%</div>
      </div>

      {/* Member info */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-800 truncate">{member.member_name ?? 'Unknown'}</div>
        <div className="text-slate-500 flex flex-wrap gap-x-2 mt-0.5">
          {member.member_sex && <span>{member.member_sex}</span>}
          {member.member_age && <span>age {member.member_age}</span>}
          {member.member_location && <span className="flex items-center gap-0.5"><MapPin className="h-2 w-2" />{member.member_location}</span>}
          {member.member_date && <span><Calendar className="h-2 w-2 inline mr-0.5" />{member.member_date}</span>}
          {member.member_doe_id && <span className="text-indigo-400 font-mono">{member.member_doe_id}</span>}
        </div>
        {member.confidence_reason && (
          <div className="text-slate-400 italic mt-0.5 truncate">{member.confidence_reason}</div>
        )}
      </div>

      {/* Status + actions */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        <Badge className={`text-[9px] px-1 py-0 ${MEMBER_STATUS_STYLE[member.membership_status]}`}>
          {member.membership_status}
        </Badge>
        {member.membership_status !== 'rejected' && (
          <button
            onClick={() => onReviewMember(member.id, 'confirmed')}
            className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${member.membership_status === 'confirmed' ? 'bg-green-200 text-green-800' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
          >
            <CheckCircle className="h-2.5 w-2.5 inline mr-0.5" />Confirm
          </button>
        )}
        {member.membership_status !== 'confirmed' && (
          <button
            onClick={() => onReviewMember(member.id, member.membership_status === 'rejected' ? 'candidate' : 'rejected')}
            className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${member.membership_status === 'rejected' ? 'bg-slate-200 text-slate-500 hover:bg-slate-300' : 'bg-red-50 text-red-500 hover:bg-red-100'}`}
          >
            {member.membership_status === 'rejected'
              ? <><RefreshCw className="h-2.5 w-2.5 inline mr-0.5" />Restore</>
              : <><XCircle className="h-2.5 w-2.5 inline mr-0.5" />Reject</>
            }
          </button>
        )}
      </div>
    </div>
  )
}

function ClusterCard({ cluster, missingCaseId, onReview, onSynthesize, onReviewMember }: {
  cluster: DoeCluster
  missingCaseId: string
  onReview: (id: string, status: string) => void
  onSynthesize: (id: string) => void
  onReviewMember: (id: string, status: 'confirmed' | 'rejected' | 'candidate') => void
}) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<DoeClusterMember[] | null>(null)
  const [membersLoading, setMembersLoading] = useState(false)

  const isCircumstance = cluster.cluster_type === 'circumstance_signal'

  // Load members when expanded (only for new cluster types that have member rows)
  const hasMembers = ['location_runaway_cluster', 'corridor_cluster', 'age_bracket'].includes(cluster.cluster_type)

  async function loadMembers() {
    if (!hasMembers || members !== null) return
    setMembersLoading(true)
    try {
      const res = await fetch(`/api/pattern/doe-match?missingCaseId=${missingCaseId}&type=cluster_members&clusterId=${cluster.id}`)
      const data = await res.json()
      setMembers(data.members ?? [])
    } catch {
      setMembers([])
    } finally {
      setMembersLoading(false)
    }
  }

  function handleOpenChange(val: boolean) {
    setOpen(val)
    if (val && hasMembers) loadMembers()
  }

  function handleMemberReview(memberId: string, status: 'confirmed' | 'rejected' | 'candidate') {
    // Optimistic update
    setMembers(prev => prev?.map(m => m.id === memberId ? { ...m, membership_status: status } : m) ?? null)
    onReviewMember(memberId, status)
  }
  const ageGroupLabel: Record<string, string> = {
    child: 'children (0–12)', teen: 'teens (13–17)', young_adult: 'young adults (18–25)',
    adult: 'adults (26–40)', middle_age: 'middle age (41–60)', senior: 'seniors (60+)',
  }

  const meta = CLUSTER_TYPE_META[cluster.cluster_type] ?? CLUSTER_TYPE_META.demographic_temporal
  const { borderColor, iconBg, iconColor } = meta
  const categoryStyle = cluster.signal_category
    ? (SIGNAL_CATEGORY_STYLE[cluster.signal_category] ?? 'bg-slate-100 text-slate-600')
    : 'bg-indigo-50 text-indigo-700'

  const clusterSig = cluster.signals as {
    season_counts?: Record<string, number>
    temporal_count?: number
    primary_label?: string
    top_co_signals?: string[]
    co_signals?: Record<string, number>
    city?: string
    sex_counts?: Record<string, number>
    corridor_label?: string
    state_counts?: Record<string, number>
    mean_age?: number
    std_dev?: number
    pattern?: string
  }

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <Card className={`overflow-hidden border-l-4 ${borderColor}`}>
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 ${iconBg} rounded-full p-2`}>
                  {cluster.cluster_type === 'corridor_cluster'
                    ? <Car className={`h-4 w-4 ${iconColor}`} />
                    : cluster.cluster_type === 'age_bracket'
                    ? <Scale className={`h-4 w-4 ${iconColor}`} />
                    : cluster.cluster_type === 'location_runaway_cluster'
                    ? <MapPin className={`h-4 w-4 ${iconColor}`} />
                    : isCircumstance
                    ? <Brain className={`h-4 w-4 ${iconColor}`} />
                    : <Users className={`h-4 w-4 ${iconColor}`} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-900">{cluster.case_count} cases</span>
                    <Badge className="text-[9px] bg-slate-100 text-slate-500">{meta.label}</Badge>

                    {isCircumstance && cluster.primary_signal && (
                      <Badge className={`text-[10px] border ${categoryStyle}`}>
                        {clusterSig.primary_label ?? cluster.primary_signal.replace(/_/g, ' ')}
                      </Badge>
                    )}
                    {cluster.cluster_type === 'demographic_temporal' && cluster.race && (
                      <Badge className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200">{cluster.race}</Badge>
                    )}
                    {cluster.cluster_type === 'demographic_temporal' && cluster.sex && cluster.age_group && (
                      <Badge className="text-[10px] bg-slate-100 text-slate-600">
                        {cluster.sex} {ageGroupLabel[cluster.age_group] ?? cluster.age_group}
                      </Badge>
                    )}
                    {cluster.cluster_type === 'location_runaway_cluster' && clusterSig.city && (
                      <Badge className="text-[10px] bg-orange-50 text-orange-700 border-orange-200">
                        <MapPin className="h-2.5 w-2.5 mr-0.5" />{clusterSig.city}
                      </Badge>
                    )}
                    {cluster.cluster_type === 'corridor_cluster' && clusterSig.corridor_label && (
                      <Badge className="text-[10px] bg-cyan-50 text-cyan-700 border-cyan-200">
                        <Car className="h-2.5 w-2.5 mr-0.5" />{clusterSig.corridor_label}
                      </Badge>
                    )}
                    {cluster.cluster_type === 'age_bracket' && clusterSig.std_dev !== undefined && (
                      <Badge className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">
                        SD {clusterSig.std_dev}yr
                      </Badge>
                    )}
                    {cluster.state && (
                      <Badge className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                        <MapPin className="h-2.5 w-2.5 mr-0.5" />{cluster.state}
                      </Badge>
                    )}
                    {cluster.temporal_pattern && (
                      <Badge className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                        <Calendar className="h-2.5 w-2.5 mr-0.5" />{cluster.temporal_pattern} pattern
                      </Badge>
                    )}
                    {hasMembers && (
                      <Badge className="text-[9px] bg-slate-50 text-slate-400 border-slate-200">
                        members tracked
                      </Badge>
                    )}
                    {cluster.ai_narrative && (
                      <Badge className="text-[10px] bg-violet-50 text-violet-600 border-violet-200">
                        <Brain className="h-2.5 w-2.5 mr-0.5" />AI analysis
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">{cluster.cluster_label}</p>
                  {cluster.year_span_start && cluster.year_span_end && cluster.year_span_start !== cluster.year_span_end && (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {cluster.year_span_end - cluster.year_span_start} year span ({cluster.year_span_start}–{cluster.year_span_end})
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge className={`text-[10px] ${STATUS_STYLE[cluster.reviewer_status]}`}>
                    {cluster.reviewer_status.replace(/_/g, ' ')}
                  </Badge>
                  {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                </div>
              </div>
            </CardContent>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
            {/* Co-occurring signals (circumstance clusters) */}
            {isCircumstance && clusterSig.co_signals && Object.keys(clusterSig.co_signals).length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Also present in these cases</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(clusterSig.co_signals)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .slice(0, 8)
                    .map(([sig, count]) => (
                      <span key={sig} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                        {sig.replace(/_/g, ' ')} ({count as number})
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* Seasonal distribution (demographic clusters) */}
            {cluster.cluster_type === 'demographic_temporal' && clusterSig.season_counts && Object.keys(clusterSig.season_counts).length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Seasonal distribution</p>
                <div className="flex gap-3">
                  {Object.entries(clusterSig.season_counts).map(([season, count]) => (
                    <div key={season} className="text-center">
                      <div className="text-lg font-bold text-slate-700">{count as number}</div>
                      <div className="text-[10px] text-slate-400 capitalize">{season}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sex breakdown (runaway/corridor/age_bracket clusters) */}
            {clusterSig.sex_counts && Object.keys(clusterSig.sex_counts).length > 0 && !isCircumstance && cluster.cluster_type !== 'demographic_temporal' && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Sex breakdown</p>
                <div className="flex gap-3">
                  {Object.entries(clusterSig.sex_counts).map(([sx, count]) => (
                    <div key={sx} className="text-center">
                      <div className="text-lg font-bold text-slate-700">{count as number}</div>
                      <div className="text-[10px] text-slate-400 capitalize">{sx}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* State breakdown (corridor clusters) */}
            {cluster.cluster_type === 'corridor_cluster' && clusterSig.state_counts && Object.keys(clusterSig.state_counts).length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">State distribution</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(clusterSig.state_counts)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .map(([st, count]) => (
                      <span key={st} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                        {st} ({count as number})
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* Age bracket stats */}
            {cluster.cluster_type === 'age_bracket' && clusterSig.mean_age !== undefined && (
              <div className="flex items-center gap-4 p-2 bg-purple-50 border border-purple-100 rounded text-[10px]">
                <div className="text-center">
                  <div className="text-base font-black text-purple-700">{clusterSig.mean_age}</div>
                  <div className="text-purple-400">mean age</div>
                </div>
                <div className="text-center">
                  <div className="text-base font-black text-purple-700">±{clusterSig.std_dev}</div>
                  <div className="text-purple-400">std dev (yr)</div>
                </div>
                <div className="text-purple-600 italic">
                  Tight age preference over {cluster.year_span_start && cluster.year_span_end
                    ? `${cluster.year_span_end - cluster.year_span_start} years`
                    : 'multiple years'}
                  . Warrants investigative attention.
                </div>
              </div>
            )}

            {/* Member list — for location_runaway_cluster, corridor_cluster, age_bracket */}
            {hasMembers && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                  Individual cases in this pattern
                  {members && (
                    <span className="ml-2 text-slate-300 normal-case font-normal">
                      {members.filter(m => m.membership_status === 'confirmed').length} confirmed,
                      {' '}{members.filter(m => m.membership_status === 'candidate').length} pending
                    </span>
                  )}
                </p>
                {membersLoading && (
                  <div className="py-3 text-center"><Loader2 className="h-4 w-4 animate-spin text-slate-300 mx-auto" /></div>
                )}
                {!membersLoading && members !== null && members.length === 0 && (
                  <p className="text-[10px] text-slate-400 italic">No member records yet — re-run the cluster detection to populate.</p>
                )}
                {!membersLoading && members && members.length > 0 && (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {members.map(m => (
                      <ClusterMemberRow key={m.id} member={m} onReviewMember={handleMemberReview} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* AI narrative */}
            {cluster.ai_narrative && (
              <div className="p-3 bg-violet-50 border border-violet-100 rounded space-y-1">
                <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-wide flex items-center gap-1">
                  <Brain className="h-3 w-3" />AI analysis
                </p>
                <p className="text-[11px] text-violet-900 leading-relaxed">{cluster.ai_narrative}</p>
                <p className="text-[9px] text-violet-400">AI-generated for investigator review. Not a conclusion.</p>
              </div>
            )}

            <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-100 rounded text-[10px] text-amber-700">
              <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              {isCircumstance
                ? 'Circumstance clusters surface shared patterns for review only. Shared signals do not confirm a connection between cases.'
                : 'Demographic clusters surface statistical patterns for review only. They do not indicate confirmed activity.'}
            </div>

            <div className="flex gap-2 flex-wrap">
              {!cluster.ai_narrative && (
                <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-violet-200 text-violet-600"
                  onClick={() => onSynthesize(cluster.id)}>
                  <Brain className="h-3 w-3" />Generate AI analysis
                </Button>
              )}
              {cluster.reviewer_status === 'unreviewed' && (
                <>
                  <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-amber-200 text-amber-700"
                    onClick={() => onReview(cluster.id, 'worth_investigating')}>
                    <Clock className="h-3 w-3" />Worth investigating
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-slate-400"
                    onClick={() => onReview(cluster.id, 'dismissed')}>
                    <XCircle className="h-3 w-3" />Dismiss
                  </Button>
                </>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

const STALL_TYPE_STYLE: Record<string, { label: string; style: string; icon: typeof ShieldAlert }> = {
  voluntary_misclassification: { label: 'Voluntary misclassification', style: 'bg-orange-50 border-orange-200', icon: ShieldAlert },
  runaway_no_followup:         { label: 'Runaway — no follow-up',      style: 'bg-amber-50 border-amber-200',  icon: ShieldAlert },
  quick_closure_young:         { label: 'Minor — quick closure',       style: 'bg-rose-50 border-rose-200',    icon: ShieldAlert },
}

function StallCard({ stall, onReview }: {
  stall: DoeStallFlag
  onReview: (id: string, status: string) => void
}) {
  const type = STALL_TYPE_STYLE[stall.stall_type] ?? STALL_TYPE_STYLE.voluntary_misclassification
  const Icon = type.icon
  const isDismissed = stall.reviewer_status === 'dismissed'
  const years = stall.elapsed_days ? Math.floor(stall.elapsed_days / 365) : null
  const months = stall.elapsed_days ? Math.floor((stall.elapsed_days % 365) / 30) : null

  return (
    <Card className={`overflow-hidden transition-opacity ${isDismissed ? 'opacity-40' : ''} ${type.style}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Icon className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-slate-900">
                  {stall.missing_name ?? 'Unknown name'}
                  {stall.missing_age && <span className="ml-1.5 font-normal text-slate-500">age {stall.missing_age}</span>}
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">{stall.stall_label}</p>
              </div>
              <Badge className={`text-[10px] flex-shrink-0 ${STATUS_STYLE[stall.reviewer_status]}`}>
                {stall.reviewer_status.replace(/_/g, ' ')}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              {stall.missing_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-2.5 w-2.5" />Disappeared {stall.missing_date}
                </span>
              )}
              {stall.missing_location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-2.5 w-2.5" />{stall.missing_location}
                </span>
              )}
              {stall.elapsed_days && (
                <span className="flex items-center gap-1 font-medium text-orange-700">
                  <Clock className="h-2.5 w-2.5" />
                  {years ? `${years}yr` : ''}{months ? ` ${months}mo` : ''} elapsed
                </span>
              )}
            </div>
            {stall.supporting_signals.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {stall.supporting_signals.map(s => (
                  <span key={s} className="text-[10px] bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                    {s.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
            {stall.reviewer_status === 'unreviewed' && (
              <div className="mt-2 flex gap-1.5">
                <button onClick={() => onReview(stall.id, 'worth_investigating')}
                  className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors">
                  Worth investigating
                </button>
                <button onClick={() => onReview(stall.id, 'confirmed')}
                  className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors">
                  Confirmed
                </button>
                <button onClick={() => onReview(stall.id, 'dismissed')}
                  className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded hover:bg-slate-200 transition-colors">
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const ENTITY_TYPE_STYLE: Record<string, { label: string; icon: typeof Car; style: string }> = {
  vehicle:            { label: 'Vehicle',            icon: Car,    style: 'bg-blue-50 border-blue-200 text-blue-700' },
  person_name:        { label: 'Person mentioned',   icon: User,   style: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
  location:           { label: 'Location',           icon: MapPin, style: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  possible_duplicate: { label: 'Possible duplicate', icon: UserX,  style: 'bg-rose-50 border-rose-200 text-rose-700' },
}

function EntityCard({ entity }: { entity: DoeEntityMention }) {
  const def = ENTITY_TYPE_STYLE[entity.entity_type] ?? ENTITY_TYPE_STYLE.person_name
  const Icon = def.icon

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <span className={`flex-shrink-0 flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${def.style}`}>
            <Icon className="h-2.5 w-2.5" />{def.label}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">{entity.entity_value}</p>
            {entity.raw_snippet && (
              <p className="text-[11px] text-slate-500 mt-0.5 italic truncate">"{entity.raw_snippet}"</p>
            )}
          </div>
          {entity.match_count > 0 && (
            <div className="flex-shrink-0 text-center">
              <div className="text-lg font-black text-indigo-700">{entity.match_count}</div>
              <div className="text-[9px] text-indigo-500">other case{entity.match_count !== 1 ? 's' : ''}</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DoeMatchView({ caseId, canManage }: DoeMatchViewProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'matches' | 'clusters' | 'stalls' | 'entities'>('matches')
  const [gradeFilter, setGradeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('unreviewed')
  const [page, setPage] = useState(0)

  // Cross-match run state
  const [runState, setRunState] = useState<{
    running: boolean
    processed: number
    total: number
    newMatches: number
    unidentifiedCaseId: string | null
  }>({ running: false, processed: 0, total: 0, newMatches: 0, unidentifiedCaseId: null })

  const [clusterRunning, setClusterRunning] = useState(false)
  const [circumstanceRunning, setCircumstanceRunning] = useState(false)
  const [sameDateRunning, setSameDateRunning] = useState(false)
  const [locationRunawayRunning, setLocationRunawayRunning] = useState(false)
  const [corridorRunning, setCorridorRunning] = useState(false)
  const [ageBracketRunning, setAgeBracketRunning] = useState(false)
  const [entitiesRunning, setEntitiesRunning] = useState(false)
  const [dedupRunning, setDedupRunning] = useState(false)
  const [stallsRunning, setStallsRunning] = useState(false)
  const [confirmRunning, setConfirmRunning] = useState(false)
  const [clusterTypeFilter, setClusterTypeFilter] = useState<'all' | 'demographic_temporal' | 'circumstance_signal' | 'same_date_proximity' | 'location_runaway_cluster' | 'corridor_cluster' | 'age_bracket'>('all')
  const [stallTypeFilter, setStallTypeFilter] = useState<'all' | 'voluntary_misclassification' | 'runaway_no_followup' | 'quick_closure_young'>('all')
  const [entityTypeFilter, setEntityTypeFilter] = useState<'all' | 'person_name' | 'vehicle' | 'possible_duplicate'>('all')
  const [signalCountFilter, setSignalCountFilter] = useState(0)

  const supabase = createClient()

  // Find Doe Network import cases the user can access
  const { data: doeCases } = useQuery({
    queryKey: ['doe-case-ids'],
    queryFn: async () => {
      const { data: roleRows } = await supabase
        .from('case_user_roles')
        .select('case_id')
      const caseIds = (roleRows ?? []).map(r => (r as { case_id: string }).case_id)
      if (!caseIds.length) return { missing: null, unidentified: null, all: [] }

      const { data: cases } = await supabase
        .from('cases')
        .select('id, title')
        .in('id', caseIds)
        .ilike('title', '%Doe Network%')

      const all = (cases ?? []) as Array<{ id: string; title: string }>
      return {
        missing:      all.find(c => c.title.includes('Missing Persons'))?.id ?? null,
        unidentified: all.find(c => c.title.includes('Unidentified'))?.id ?? null,
        all,
      }
    },
  })

  // Fetch match candidates
  const matchQuery = useQuery({
    queryKey: ['doe-matches', caseId, gradeFilter, statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        missingCaseId: caseId,
        type: 'matches',
        page: String(page),
      })
      if (gradeFilter !== 'all')      params.set('grade', gradeFilter)
      if (statusFilter !== 'all')     params.set('reviewerStatus', statusFilter)
      const res = await fetch(`/api/pattern/doe-match?${params}`)
      return await res.json() as { matches: DoeMatchCandidate[]; total: number }
    },
    enabled: activeTab === 'matches',
  })

  // Fetch clusters
  const clusterQuery = useQuery({
    queryKey: ['doe-clusters', caseId, statusFilter, clusterTypeFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ missingCaseId: caseId, type: 'clusters', page: String(page) })
      if (statusFilter !== 'all')     params.set('reviewerStatus', statusFilter)
      if (clusterTypeFilter !== 'all') params.set('clusterType', clusterTypeFilter)
      const res = await fetch(`/api/pattern/doe-match?${params}`)
      return await res.json() as { clusters: DoeCluster[]; total: number }
    },
    enabled: activeTab === 'clusters',
  })

  // Fetch stall flags
  const stallQuery = useQuery({
    queryKey: ['doe-stalls', caseId, statusFilter, stallTypeFilter, page],
    queryFn: async () => {
      const p = new URLSearchParams({ missingCaseId: caseId, type: 'stalls', page: String(page) })
      if (statusFilter !== 'all')   p.set('reviewerStatus', statusFilter)
      if (stallTypeFilter !== 'all') p.set('stallType', stallTypeFilter)
      const res = await fetch(`/api/pattern/doe-match?${p}`)
      return await res.json() as { stalls: DoeStallFlag[]; total: number }
    },
    enabled: activeTab === 'stalls',
  })

  // Fetch entity mentions
  const entityQuery = useQuery({
    queryKey: ['doe-entities', caseId, entityTypeFilter, page],
    queryFn: async () => {
      const p = new URLSearchParams({ missingCaseId: caseId, type: 'entities', page: String(page) })
      if (entityTypeFilter !== 'all') p.set('entityType', entityTypeFilter)
      const res = await fetch(`/api/pattern/doe-match?${p}`)
      return await res.json() as { entities: DoeEntityMention[]; total: number }
    },
    enabled: activeTab === 'entities',
  })

  const runCrossMatch = useCallback(async (unidentifiedCaseId: string, startOffset = 0, totalAcc = 0, matchAcc = 0) => {
    setRunState(prev => ({ ...prev, running: true, unidentifiedCaseId }))
    try {
      const res = await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cross_match',
          missingCaseId: caseId,
          unidentifiedCaseId,
          offset: startOffset,
          limit: 400,
        }),
      })
      const data = await res.json()
      const newTotal = data.total ?? totalAcc
      const newMatches = matchAcc + (data.newMatches ?? 0)

      setRunState(prev => ({
        ...prev,
        processed: data.processed ?? startOffset,
        total: newTotal,
        newMatches,
      }))

      if (data.hasMore) {
        // Continue with next batch
        await runCrossMatch(unidentifiedCaseId, data.nextOffset, newTotal, newMatches)
      } else {
        setRunState(prev => ({ ...prev, running: false }))
        queryClient.invalidateQueries({ queryKey: ['doe-matches', caseId] })
      }
    } catch {
      setRunState(prev => ({ ...prev, running: false }))
    }
  }, [caseId, queryClient])

  const runCluster = useCallback(async () => {
    setClusterRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cluster', missingCaseId: caseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', caseId] })
    } finally {
      setClusterRunning(false)
    }
  }, [caseId, queryClient])

  const runCircumstanceCluster = useCallback(async () => {
    setCircumstanceRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'circumstance_cluster', missingCaseId: caseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', caseId] })
    } finally {
      setCircumstanceRunning(false)
    }
  }, [caseId, queryClient])

  const synthesizeCluster = useCallback(async (clusterId: string) => {
    await fetch('/api/pattern/doe-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'synthesize_cluster', missingCaseId: caseId, clusterId }),
    })
    queryClient.invalidateQueries({ queryKey: ['doe-clusters', caseId] })
  }, [caseId, queryClient])

  const reviewMatch = useCallback(async (id: string, status: string) => {
    await fetch('/api/pattern/doe-match', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'match', reviewerStatus: status }),
    })
    queryClient.invalidateQueries({ queryKey: ['doe-matches', caseId] })
  }, [caseId, queryClient])

  const reviewCluster = useCallback(async (id: string, status: string) => {
    await fetch('/api/pattern/doe-match', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'cluster', reviewerStatus: status }),
    })
    queryClient.invalidateQueries({ queryKey: ['doe-clusters', caseId] })
  }, [caseId, queryClient])

  const reviewStall = useCallback(async (id: string, status: string) => {
    await fetch('/api/pattern/doe-match', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'stall', reviewerStatus: status }),
    })
    queryClient.invalidateQueries({ queryKey: ['doe-stalls', caseId] })
  }, [caseId, queryClient])

  const runConfirmSubmissions = useCallback(async () => {
    setConfirmRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_doe_submissions', missingCaseId: caseId }),
      })
    } finally { setConfirmRunning(false) }
  }, [caseId])

  const runSameDateCluster = useCallback(async () => {
    setSameDateRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'same_date_cluster', missingCaseId: caseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', caseId] })
    } finally { setSameDateRunning(false) }
  }, [caseId, queryClient])

  const runExtractEntities = useCallback(async () => {
    setEntitiesRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract_entities', missingCaseId: caseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-entities', caseId] })
    } finally { setEntitiesRunning(false) }
  }, [caseId, queryClient])

  const runNameDedup = useCallback(async () => {
    setDedupRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'name_dedup', missingCaseId: caseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-entities', caseId] })
    } finally { setDedupRunning(false) }
  }, [caseId, queryClient])

  const runDetectStalls = useCallback(async () => {
    setStallsRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'detect_stalls', missingCaseId: caseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-stalls', caseId] })
    } finally { setStallsRunning(false) }
  }, [caseId, queryClient])

  const runLocationRunaway = useCallback(async () => {
    setLocationRunawayRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'location_runaway_cluster', missingCaseId: caseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', caseId] })
    } finally { setLocationRunawayRunning(false) }
  }, [caseId, queryClient])

  const runCorridor = useCallback(async () => {
    setCorridorRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'corridor_cluster', missingCaseId: caseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', caseId] })
    } finally { setCorridorRunning(false) }
  }, [caseId, queryClient])

  const runAgeBracket = useCallback(async () => {
    setAgeBracketRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'age_bracket_cluster', missingCaseId: caseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', caseId] })
    } finally { setAgeBracketRunning(false) }
  }, [caseId, queryClient])

  const reviewClusterMember = useCallback(async (id: string, membershipStatus: 'confirmed' | 'rejected' | 'candidate') => {
    await fetch('/api/pattern/doe-match', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'cluster_member', membershipStatus }),
    })
  }, [])

  const allMatches = matchQuery.data?.matches ?? []
  const matches = signalCountFilter === 0
    ? allMatches
    : allMatches.filter(m => countPositiveSignals(m.signals) >= signalCountFilter)
  const clusters = clusterQuery.data?.clusters ?? []
  const stalls   = stallQuery.data?.stalls     ?? []
  const entities = entityQuery.data?.entities  ?? []
  const totalMatches  = matchQuery.data?.total  ?? 0
  const totalClusters = clusterQuery.data?.total ?? 0
  const totalStalls   = stallQuery.data?.total   ?? 0
  const totalEntities = entityQuery.data?.total  ?? 0
  const PAGE_SIZE = 50

  const GRADE_FILTERS = ['all', 'very_strong', 'strong', 'notable', 'moderate']
  const STATUS_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'unreviewed', label: 'Unreviewed' },
    { value: 'worth_investigating', label: 'Worth investigating' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'dismissed', label: 'Dismissed' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900">Cross-Case Matching</h3>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Score missing persons against unidentified remains. Surface victimology patterns. All signals require human review.
          </p>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-1.5">
            {doeCases?.unidentified && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                disabled={runState.running} onClick={() => runCrossMatch(doeCases.unidentified!)}>
                {runState.running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {runState.running ? `Matching… ${runState.processed}/${runState.total}` : 'Cross-match'}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              disabled={clusterRunning} onClick={runCluster}>
              {clusterRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
              {clusterRunning ? 'Clustering…' : 'Demographics'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              disabled={circumstanceRunning} onClick={runCircumstanceCluster}>
              {circumstanceRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
              {circumstanceRunning ? 'Analysing…' : 'Circumstances'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              disabled={sameDateRunning} onClick={runSameDateCluster}>
              {sameDateRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Calendar className="h-3 w-3" />}
              {sameDateRunning ? 'Clustering…' : 'Date clusters'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-orange-200 text-orange-700 hover:bg-orange-50"
              disabled={locationRunawayRunning} onClick={runLocationRunaway}>
              {locationRunawayRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
              {locationRunawayRunning ? 'Scanning…' : 'Location runaway'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-cyan-200 text-cyan-700 hover:bg-cyan-50"
              disabled={corridorRunning} onClick={runCorridor}>
              {corridorRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Car className="h-3 w-3" />}
              {corridorRunning ? 'Scanning…' : 'Corridors'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-purple-200 text-purple-700 hover:bg-purple-50"
              disabled={ageBracketRunning} onClick={runAgeBracket}>
              {ageBracketRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scale className="h-3 w-3" />}
              {ageBracketRunning ? 'Scanning…' : 'Age bracket'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              disabled={entitiesRunning} onClick={runExtractEntities}>
              {entitiesRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Car className="h-3 w-3" />}
              {entitiesRunning ? 'Extracting…' : 'Extract entities'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              disabled={dedupRunning} onClick={runNameDedup}>
              {dedupRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
              {dedupRunning ? 'Comparing…' : 'Name dedup'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              disabled={stallsRunning} onClick={runDetectStalls}>
              {stallsRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldAlert className="h-3 w-3" />}
              {stallsRunning ? 'Scanning…' : 'Detect stalls'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50"
              disabled={confirmRunning} onClick={runConfirmSubmissions}>
              {confirmRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
              {confirmRunning ? 'Confirming…' : 'Confirm submissions'}
            </Button>
          </div>
        )}
      </div>

      {/* Progress */}
      {runState.running && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-indigo-700 font-medium">Running cross-match…</span>
            <span className="text-indigo-500">{runState.newMatches} candidates found so far</span>
          </div>
          <div className="h-1.5 bg-indigo-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: runState.total ? `${(runState.processed / runState.total) * 100}%` : '0%' }}
            />
          </div>
          <p className="text-[10px] text-indigo-400">
            {runState.processed.toLocaleString()} of {runState.total.toLocaleString()} missing persons processed
          </p>
        </div>
      )}

      {/* Epistemic notice */}
      <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <AlertTriangle className="h-3.5 w-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-500">
          Match scores compare physical descriptions statistically. A high score means shared characteristics —
          it does not mean the same person. Confirmation requires official record comparison,
          dental or DNA matching, or other forensic verification.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 pb-0 flex-wrap">
        {[
          { id: 'matches'  as const, label: 'Missing ↔ Unidentified', count: totalMatches },
          { id: 'clusters' as const, label: 'Clusters',                count: totalClusters },
          { id: 'stalls'   as const, label: 'Stall Flags',             count: totalStalls },
          { id: 'entities' as const, label: 'Entity Cross-Match',      count: totalEntities },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setPage(0) }}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors
              ${activeTab === tab.id
                ? 'border-indigo-500 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 bg-slate-100 text-slate-600 text-[10px] px-1 rounded">
                {tab.count.toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {activeTab === 'matches' && (
          <>
            <div className="flex gap-1 flex-wrap">
              {GRADE_FILTERS.map(g => (
                <button key={g} onClick={() => { setGradeFilter(g); setPage(0) }}
                  className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors capitalize
                    ${gradeFilter === g ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                  {g === 'all' ? 'All grades' : GRADE_LABEL[g]}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              {[0, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => { setSignalCountFilter(n); setPage(0) }}
                  className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors
                    ${signalCountFilter === n ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                  {n === 0 ? 'Any signals' : `${n}+ signals`}
                </button>
              ))}
            </div>
          </>
        )}
        {activeTab === 'clusters' && (
          <div className="flex gap-1 flex-wrap">
            {([
              { value: 'all',                      label: 'All' },
              { value: 'demographic_temporal',     label: 'Demographic' },
              { value: 'circumstance_signal',      label: 'Circumstance' },
              { value: 'same_date_proximity',      label: 'Same date' },
              { value: 'location_runaway_cluster', label: 'Location runaway' },
              { value: 'corridor_cluster',         label: 'Corridor' },
              { value: 'age_bracket',              label: 'Age bracket' },
            ] as const).map(f => (
              <button key={f.value} onClick={() => { setClusterTypeFilter(f.value); setPage(0) }}
                className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors
                  ${clusterTypeFilter === f.value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        {activeTab === 'stalls' && (
          <div className="flex gap-1 flex-wrap">
            {([
              { value: 'all',                        label: 'All types' },
              { value: 'voluntary_misclassification', label: 'Voluntary' },
              { value: 'runaway_no_followup',         label: 'Runaway' },
              { value: 'quick_closure_young',         label: 'Minors' },
            ] as const).map(f => (
              <button key={f.value} onClick={() => { setStallTypeFilter(f.value); setPage(0) }}
                className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors
                  ${stallTypeFilter === f.value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        {activeTab === 'entities' && (
          <div className="flex gap-1 flex-wrap">
            {([
              { value: 'all',                label: 'All' },
              { value: 'person_name',        label: 'People' },
              { value: 'vehicle',            label: 'Vehicles' },
              { value: 'possible_duplicate', label: 'Duplicates' },
            ] as const).map(f => (
              <button key={f.value} onClick={() => { setEntityTypeFilter(f.value); setPage(0) }}
                className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors
                  ${entityTypeFilter === f.value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        {(activeTab === 'matches' || activeTab === 'stalls') && (
          <div className="flex gap-1 flex-wrap">
            {STATUS_FILTERS.map(f => (
              <button key={f.value} onClick={() => { setStatusFilter(f.value); setPage(0) }}
                className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors
                  ${statusFilter === f.value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      {activeTab === 'matches' && (
        <>
          {matchQuery.isLoading ? (
            <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>
          ) : matches.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <GitMerge className="h-8 w-8 text-slate-200 mx-auto" />
              <p className="text-sm text-slate-400">
                {totalMatches === 0
                  ? 'No match candidates yet. Click "Run cross-match" to score missing persons against unidentified remains.'
                  : 'No candidates match this filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {matches.map(m => (
                <MatchCard key={m.id} match={m} onReview={reviewMatch} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalMatches > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400">
                {signalCountFilter > 0
                  ? `${matches.length} of ${PAGE_SIZE} loaded — showing ${signalCountFilter}+ signal matches`
                  : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalMatches)} of ${totalMatches.toLocaleString()} candidates`
                }
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  disabled={(page + 1) * PAGE_SIZE >= totalMatches}
                  onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'clusters' && (
        <>
          {clusterQuery.isLoading ? (
            <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>
          ) : clusters.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Users className="h-8 w-8 text-slate-200 mx-auto" />
              <p className="text-sm text-slate-400">
                No clusters yet. Use "Demographic clusters" for who disappeared, "Circumstance clusters" for how and why.
              </p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Circumstance clusters surface patterns like: foster care placements, hitchhiking, meeting someone online, vehicle abandonment.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {clusters.map(c => (
                <ClusterCard key={c.id} cluster={c} missingCaseId={caseId} onReview={reviewCluster} onSynthesize={synthesizeCluster} onReviewMember={reviewClusterMember} />
              ))}
            </div>
          )}

          {totalClusters > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalClusters)} of {totalClusters} clusters
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  disabled={(page + 1) * PAGE_SIZE >= totalClusters}
                  onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'stalls' && (
        <>
          {stallQuery.isLoading ? (
            <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>
          ) : stalls.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <ShieldAlert className="h-8 w-8 text-slate-200 mx-auto" />
              <p className="text-sm text-slate-400">
                No stall flags yet. Click "Detect stalls" to scan for voluntary/runaway classifications with years elapsed.
              </p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Flags cases where a person was classified as a voluntary missing or runaway — but the case has
                remained open for months or years with no resolution.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {stalls.map(s => (
                <StallCard key={s.id} stall={s} onReview={reviewStall} />
              ))}
            </div>
          )}
          {totalStalls > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalStalls)} of {totalStalls} flags
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  disabled={(page + 1) * PAGE_SIZE >= totalStalls}
                  onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'entities' && (
        <>
          {entityQuery.isLoading ? (
            <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>
          ) : entities.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Search className="h-8 w-8 text-slate-200 mx-auto" />
              <p className="text-sm text-slate-400">No entity mentions yet.</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                "Extract entities" pulls vehicle descriptions and person names from circumstances text and
                cross-matches them across all cases — same vehicle appearing in 5 cases is a signal.
                "Name dedup" finds missing persons records with near-identical names that may be the same person.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {entities.map(e => (
                <EntityCard key={e.id} entity={e} />
              ))}
            </div>
          )}
          {totalEntities > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalEntities)} of {totalEntities} entities
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  disabled={(page + 1) * PAGE_SIZE >= totalEntities}
                  onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
