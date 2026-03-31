'use client'

import { useState, useCallback, useMemo, useEffect, type ComponentType } from 'react'
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
  Fingerprint, Globe, ExternalLink, ArrowUpDown, X,
} from 'lucide-react'
import { TattooMatchCard } from './TattooMatchCard'
import { QuickWatch } from '@/components/registry/QuickWatch'

interface AiAssessment {
  connection_level?: number          // 1–5 (new universal rating)
  verdict?: 'plausible' | 'unlikely' | 'uncertain'  // legacy — kept for backward compat
  confidence?: 'high' | 'medium' | 'low'            // legacy
  summary: string
  supporting: string[]
  conflicting: string[]
  reviewed_at: string
  model: string
}

// ── Universal connection level helpers ────────────────────────────────────────

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
const CONNECTION_LEVEL_CARD: Record<number, string> = {
  1: 'opacity-50',
  2: '',
  3: '',
  4: 'border-emerald-300 bg-emerald-50/20',
  5: 'border-rose-300 bg-rose-50/30',
}

function resolveConnectionLevel(ai: AiAssessment | null): number | null {
  if (!ai) return null
  if (ai.connection_level) return ai.connection_level
  // Derive from legacy verdict
  if (ai.verdict === 'plausible')  return ai.confidence === 'high' ? 4 : 3
  if (ai.verdict === 'unlikely')   return 1
  if (ai.verdict === 'uncertain')  return 2
  return null
}

function ConnectionLevelBadge({ level, size = 'sm' }: { level: number; size?: 'sm' | 'xs' }) {
  const cls = CONNECTION_LEVEL_COLOR[level] ?? CONNECTION_LEVEL_COLOR[2]
  const label = CONNECTION_LEVEL_LABEL[level] ?? `Level ${level}`
  return (
    <span className={`inline-flex items-center gap-1 border rounded-full font-semibold ${size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'} ${cls}`}>
      <span className="font-black">{level}</span>
      <span className="opacity-80">{label}</span>
    </span>
  )
}

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
  missing_jewelry: string | null
  unidentified_doe_id: string | null
  unidentified_sex: string | null
  unidentified_race: string | null
  unidentified_age: string | null
  unidentified_location: string | null
  unidentified_date: string | null
  unidentified_hair: string | null
  unidentified_eyes: string | null
  unidentified_marks: string | null
  unidentified_jewelry: string | null
  reviewer_status: string
  reviewer_note: string | null
  ai_assessment: AiAssessment | null
  generated_at: string
  destination_text:  string | null
  destination_city:  string | null
  destination_state: string | null
  match_type:        string | null
}

interface ComparedCase {
  submissionId: string
  caseType: 'missing' | 'unidentified'
  doeId: string | null
  name: string | null
  sex: string | null
  race: string | null
  age: string | null
  height: string | null
  weight: string | null
  hair: string | null
  eyes: string | null
  marks: string | null
  jewelry: string | null
  date: string | null
  location: string | null
  circumstances: string | null
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
  mismatch:         'bg-red-500',
  none_mentioned:   'bg-slate-200',
  one_side_only:    'bg-slate-200',
  incompatible:     'bg-red-500',
  distant:          'bg-slate-300',
  both_parous:      'bg-emerald-400',
  both_nulliparous: 'bg-blue-300',
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
  { key: 'sex',        label: 'Sex',        Icon: User },
  { key: 'race',       label: 'Race',       Icon: Globe },
  { key: 'age',        label: 'Age',        Icon: Calendar },
  { key: 'hair',       label: 'Hair',       Icon: Scissors },
  { key: 'eyes',       label: 'Eyes',       Icon: Eye },
  { key: 'height',     label: 'Height',     Icon: Ruler },
  { key: 'weight',     label: 'Weight',     Icon: Scale },
  { key: 'tattoo',     label: 'Tattoo',     Icon: Fingerprint },
  { key: 'body_marks', label: 'Marks',      Icon: Fingerprint },
  { key: 'jewelry',    label: 'Jewelry',    Icon: Fingerprint },
  { key: 'location',   label: 'State',      Icon: MapPin },
  { key: 'childbirth', label: 'Childbirth', Icon: Users },
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
  const aiLevel = resolveConnectionLevel(match.ai_assessment)
  const aiCardCls = aiLevel ? (CONNECTION_LEVEL_CARD[aiLevel] ?? '') : ''

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={`overflow-hidden transition-opacity ${isDismissed ? 'opacity-40' : ''} ${aiCardCls}`}>
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
                  <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{countPositiveSignals(match.signals)}/{SIGNAL_DEFS.length}</div>
                </div>

                {/* People */}
                <div className="flex-1 grid grid-cols-2 gap-3 min-w-0">
                  {/* Missing */}
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Missing Person</div>
                      <QuickWatch submissionId={match.missing_submission_id} size="xs" />
                    </div>
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
                    <div className="flex items-center justify-between">
                      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Unidentified</div>
                      <QuickWatch submissionId={match.unidentified_submission_id} size="xs" />
                    </div>
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
                  {match.ai_assessment && aiLevel && (
                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${CONNECTION_LEVEL_COLOR[aiLevel] ?? ''}`}>
                      <Sparkles className="h-2.5 w-2.5" />
                      {aiLevel} — {CONNECTION_LEVEL_LABEL[aiLevel]}
                    </span>
                  )}
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
                <SignalBar label="Sex"         signal={match.signals.sex}                                     icon={User} />
                <SignalBar label="Race"        signal={match.signals.race}                                    icon={Globe} />
                <SignalBar label="Age"         signal={match.signals.age}                                     icon={Calendar} />
                <SignalBar label="Hair"        signal={match.signals.hair}                                    icon={Scissors} />
                <SignalBar label="Eyes"        signal={match.signals.eyes}                                    icon={Eye} />
                <SignalBar label="Height"      signal={match.signals.height}                                  icon={Ruler} />
                <SignalBar label="Weight"      signal={match.signals.weight}                                  icon={Scale} />
                <SignalBar label="Tattoo"      signal={match.signals.tattoo}                                  icon={Fingerprint} />
                <SignalBar label="Marks"       signal={match.signals.body_marks}                              icon={Fingerprint} />
                <SignalBar label="Jewelry"     signal={match.signals.jewelry}                                 icon={Fingerprint} />
                <SignalBar label="State"       signal={match.signals.location}                                icon={MapPin} />
                <SignalBar label="Childbirth"  signal={match.signals.childbirth as typeof match.signals.sex}  icon={Users} />
                {match.signals.time_gap && (
                  <SignalBar label="Time gap"  signal={match.signals.time_gap as typeof match.signals.sex}    icon={Clock} />
                )}
              </div>
            </div>

            {/* Distinguishing marks + jewelry full text */}
            {(match.missing_marks || match.unidentified_marks || match.missing_jewelry || match.unidentified_jewelry) && (
              <div className="space-y-2">
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
                {(match.missing_jewelry || match.unidentified_jewelry) && (
                  <div className="grid grid-cols-2 gap-3">
                    {match.missing_jewelry && (
                      <div>
                        <p className="text-[10px] text-slate-400 font-medium mb-0.5">Missing — jewelry</p>
                        <p className="text-[11px] text-slate-600">{match.missing_jewelry}</p>
                      </div>
                    )}
                    {match.unidentified_jewelry && (
                      <div>
                        <p className="text-[10px] text-slate-400 font-medium mb-0.5">Unidentified — jewelry</p>
                        <p className="text-[11px] text-slate-600">{match.unidentified_jewelry}</p>
                      </div>
                    )}
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

            {/* AI assessment panel */}
            {match.ai_assessment && aiLevel && (
              <div className={`p-3 rounded border space-y-1.5 ${
                aiLevel >= 4 ? 'bg-emerald-50 border-emerald-200' :
                aiLevel <= 1 ? 'bg-slate-50 border-slate-200' :
                aiLevel === 5 ? 'bg-rose-50 border-rose-200' :
                'bg-amber-50 border-amber-200'
              }`}>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-slate-500" />
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">AI assessment</p>
                  <ConnectionLevelBadge level={aiLevel} size="xs" />
                </div>
                <p className="text-[11px] text-slate-700 leading-relaxed">{match.ai_assessment.summary}</p>
                {match.ai_assessment.supporting.length > 0 && (
                  <ul className="space-y-0.5">
                    {match.ai_assessment.supporting.map((s, i) => (
                      <li key={i} className="text-[10px] text-green-700 flex items-start gap-1">
                        <CheckCircle className="h-2.5 w-2.5 flex-shrink-0 mt-0.5" />{s}
                      </li>
                    ))}
                  </ul>
                )}
                {match.ai_assessment.conflicting.length > 0 && (
                  <ul className="space-y-0.5">
                    {match.ai_assessment.conflicting.map((s, i) => (
                      <li key={i} className="text-[10px] text-red-600 flex items-start gap-1">
                        <XCircle className="h-2.5 w-2.5 flex-shrink-0 mt-0.5" />{s}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[9px] text-slate-400">AI-generated signal only. Not a conclusion. Requires investigator review.</p>
              </div>
            )}

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

// ─── Cluster member comparison modal ─────────────────────────────────────────

function ClusterCompareModal({
  open, onClose, submissionIds, missingCaseId,
}: {
  open: boolean
  onClose: () => void
  submissionIds: string[]
  missingCaseId: string
}) {
  const [records, setRecords] = useState<Array<{ id: string; raw_text: string; name: string | null }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !submissionIds.length) return
    setLoading(true)
    Promise.all(
      submissionIds.map(async id => {
        try {
          const res = await fetch(`/api/pattern/doe-match?missingCaseId=${missingCaseId}&type=submission&submissionId=${id}`)
          const data = await res.json()
          return { id, raw_text: (data.raw_text as string) ?? '', name: (data.name as string | null) ?? null }
        } catch {
          return { id, raw_text: 'Could not load record.', name: null }
        }
      })
    ).then(r => { setRecords(r); setLoading(false) })
  }, [open, submissionIds.join(','), missingCaseId])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl my-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Case comparison — cluster members</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">{submissionIds.length} cases selected for comparison</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        {loading ? (
          <div className="py-16 text-center"><Loader2 className="h-6 w-6 animate-spin text-slate-300 mx-auto" /></div>
        ) : (
          <div className={`grid gap-4 p-5 overflow-x-auto`} style={{ gridTemplateColumns: `repeat(${Math.min(records.length, 3)}, 1fr)` }}>
            {records.map((r, i) => (
              <div key={r.id}>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                  <span className="bg-indigo-100 text-indigo-700 rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-black flex-shrink-0">{i + 1}</span>
                  {r.name ?? <span className="font-mono">{r.id.slice(0, 8)}…</span>}
                </p>
                <pre className="text-[10px] text-slate-600 bg-slate-50 border border-slate-100 rounded p-2 whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto font-mono">
                  {r.raw_text || 'Record not found.'}
                </pre>
              </div>
            ))}
          </div>
        )}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
          <p className="text-[10px] text-slate-400">Comparison for investigator reference only. Not a conclusion.</p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}

const CLUSTER_TYPE_META: Record<string, { label: string; borderColor: string; iconBg: string; iconColor: string }> = {
  circumstance_signal:      { label: 'Circumstance',    borderColor: 'border-l-rose-400',    iconBg: 'bg-rose-100',    iconColor: 'text-rose-600' },
  demographic_temporal:     { label: 'Demographic',     borderColor: 'border-l-indigo-400',  iconBg: 'bg-indigo-100',  iconColor: 'text-indigo-600' },
  same_date_proximity:      { label: 'Same date',       borderColor: 'border-l-amber-400',   iconBg: 'bg-amber-100',   iconColor: 'text-amber-600' },
  location_runaway_cluster: { label: 'Location runaway', borderColor: 'border-l-orange-400', iconBg: 'bg-orange-100',  iconColor: 'text-orange-600' },
  corridor_cluster:         { label: 'Corridor',        borderColor: 'border-l-cyan-400',    iconBg: 'bg-cyan-100',    iconColor: 'text-cyan-600' },
  age_bracket:              { label: 'Age bracket',     borderColor: 'border-l-purple-400',  iconBg: 'bg-purple-100',  iconColor: 'text-purple-600' },
  demographic_hotspot:      { label: 'Hotspot',         borderColor: 'border-l-red-400',     iconBg: 'bg-red-100',     iconColor: 'text-red-600' },
  highway_proximity:        { label: 'Hwy proximity',   borderColor: 'border-l-yellow-400',  iconBg: 'bg-yellow-100',  iconColor: 'text-yellow-700' },
  national_park_proximity:  { label: 'Wilderness',      borderColor: 'border-l-green-400',   iconBg: 'bg-green-100',   iconColor: 'text-green-700' },
}

const MEMBER_STATUS_STYLE: Record<string, string> = {
  candidate: 'bg-slate-100 text-slate-600',
  confirmed: 'bg-green-100 text-green-700',
  rejected:  'bg-red-50 text-red-500',
}

function ClusterMemberRow({ member, missingCaseId, onReviewMember, isAiFlagged, selected, onToggleSelect }: {
  isAiFlagged?: boolean
  member: DoeClusterMember
  missingCaseId: string
  onReviewMember: (id: string, status: 'confirmed' | 'rejected' | 'candidate') => void
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const [showRecord, setShowRecord] = useState(false)
  const [record, setRecord] = useState<string | null>(null)
  const [recordLoading, setRecordLoading] = useState(false)

  async function loadRecord() {
    if (record !== null) { setShowRecord(v => !v); return }
    setRecordLoading(true)
    try {
      const res = await fetch(`/api/pattern/doe-match?missingCaseId=${missingCaseId}&type=submission&submissionId=${member.submission_id}`)
      const data = await res.json()
      setRecord(data.raw_text ?? 'Record not found.')
      setShowRecord(true)
    } catch {
      setRecord('Could not load record.')
      setShowRecord(true)
    } finally {
      setRecordLoading(false)
    }
  }

  const pct = Math.round(member.confidence * 100)
  const isRejected = member.membership_status === 'rejected'

  return (
    <div className={`flex items-start gap-2 p-2 rounded text-[10px] transition-opacity
      ${isRejected ? 'opacity-40' : ''}
      ${selected ? 'border border-indigo-300 bg-indigo-50' : isAiFlagged ? 'border border-violet-200 bg-violet-50' : 'border border-slate-100'}`}>
      {/* Select checkbox */}
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={onToggleSelect}
          className="mt-1 flex-shrink-0 accent-indigo-600 cursor-pointer"
          title="Select for comparison"
        />
      )}
      {/* Confidence */}
      <div className="flex-shrink-0 text-center w-8">
        <div className={`text-sm font-black ${pct >= 85 ? 'text-emerald-700' : pct >= 75 ? 'text-amber-600' : 'text-slate-500'}`}>{pct}%</div>
      </div>

      {/* Member info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-800 truncate">{member.member_name ?? 'Unknown'}</span>
          {isAiFlagged && (
            <span className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-semibold text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded">
              <Brain className="h-2 w-2" />AI flagged
            </span>
          )}
        </div>
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
        {member.notes && (
          <div className="text-slate-400 mt-0.5 text-[9px] leading-snug line-clamp-2">{member.notes}</div>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <button
            onClick={loadRecord}
            className="text-[9px] text-indigo-400 hover:text-indigo-600 flex items-center gap-0.5"
          >
            {recordLoading
              ? <><Loader2 className="h-2 w-2 animate-spin" />Loading…</>
              : showRecord
              ? <><ChevronUp className="h-2 w-2" />Hide record</>
              : <><ChevronDown className="h-2 w-2" />View full record</>
            }
          </button>
          <a
            href={`/cases/${missingCaseId}/submissions/${member.submission_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 font-medium"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="h-2 w-2" />Open case file
          </a>
        </div>
        {showRecord && record && (
          <pre className="mt-1 text-[9px] text-slate-600 bg-slate-50 border border-slate-100 rounded p-2 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto font-mono">
            {record}
          </pre>
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
  const [compareSelections, setCompareSelections] = useState<Set<string>>(new Set())
  const [clusterCompareOpen, setClusterCompareOpen] = useState(false)

  const isCircumstance = cluster.cluster_type === 'circumstance_signal'

  // Load members when expanded (only for new cluster types that have member rows)
  const hasMembers = ['location_runaway_cluster', 'corridor_cluster', 'age_bracket', 'demographic_hotspot', 'highway_proximity', 'national_park_proximity', 'demographic_temporal', 'circumstance_signal', 'same_date_proximity'].includes(cluster.cluster_type)

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
                    : cluster.cluster_type === 'highway_proximity'
                    ? <Car className={`h-4 w-4 ${iconColor}`} />
                    : cluster.cluster_type === 'national_park_proximity'
                    ? <MapPin className={`h-4 w-4 ${iconColor}`} />
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
                    {cluster.cluster_type === 'demographic_hotspot' && (clusterSig as { anomaly_ratio?: number }).anomaly_ratio !== undefined && (
                      <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200 font-bold">
                        {(clusterSig as { anomaly_ratio: number }).anomaly_ratio}× expected
                      </Badge>
                    )}
                    {cluster.cluster_type === 'demographic_hotspot' && (clusterSig as { city?: string }).city && (
                      <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200">
                        <MapPin className="h-2.5 w-2.5 mr-0.5" />{(clusterSig as { city: string }).city}
                      </Badge>
                    )}
                    {cluster.cluster_type === 'highway_proximity' && (clusterSig as { corridor_id?: string }).corridor_id && (
                      <Badge className="text-[10px] bg-yellow-50 text-yellow-700 border-yellow-200">
                        <Car className="h-2.5 w-2.5 mr-0.5" />{(clusterSig as { corridor_id: string }).corridor_id} corridor
                      </Badge>
                    )}
                    {cluster.cluster_type === 'national_park_proximity' && (clusterSig as { park?: string }).park && (
                      <Badge className="text-[10px] bg-green-50 text-green-700 border-green-200">
                        <MapPin className="h-2.5 w-2.5 mr-0.5" />{(clusterSig as { park: string }).park}
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
                  {(() => {
                    const urgency = (cluster.signals as { ai_urgency?: number }).ai_urgency
                    if (!urgency) return null
                    const urgencyConfig = urgency >= 5
                      ? { label: '🔴 5', cls: 'bg-red-100 text-red-700 border-red-200' }
                      : urgency === 4
                      ? { label: '🟠 4', cls: 'bg-orange-100 text-orange-700 border-orange-200' }
                      : urgency === 3
                      ? { label: '🟡 3', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' }
                      : { label: '⚪ ' + urgency, cls: 'bg-slate-100 text-slate-500 border-slate-200' }
                    return (
                      <Badge className={`text-[10px] border font-bold ${urgencyConfig.cls}`} title="AI urgency score (1–5)">
                        {urgencyConfig.label}
                      </Badge>
                    )
                  })()}
                  <Badge className={`text-[10px] ${STATUS_STYLE[cluster.reviewer_status]}`}>
                    {cluster.reviewer_status.replace(/_/g, ' ')}
                  </Badge>
                  {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                </div>
              </div>

              {/* Clear CTA to expand cases */}
              {hasMembers && (
                <div className="mt-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-xs font-semibold transition-colors
                      ${open
                        ? 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200'
                        : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
                      }`}
                    onClick={e => { e.stopPropagation(); handleOpenChange(!open) }}
                  >
                    <span>
                      {open ? <ChevronUp className="h-3.5 w-3.5 inline mr-1" /> : <ChevronDown className="h-3.5 w-3.5 inline mr-1" />}
                      {open ? 'Hide cases' : `↓ View ${cluster.case_count} case${cluster.case_count !== 1 ? 's' : ''} in this cluster`}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="font-black text-sm">{cluster.case_count}</span>
                      <span className="font-normal opacity-70">cases</span>
                    </span>
                  </button>
                </div>
              )}
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

            {/* Hotspot anomaly stats */}
            {cluster.cluster_type === 'demographic_hotspot' && (clusterSig as { anomaly_ratio?: number; expected_count?: number; city_total?: number; national_rate_pct?: number; decade?: number; top_circumstance_signals?: string[] }).anomaly_ratio !== undefined && (
              <div className="space-y-2">
                <div className="flex items-center gap-4 p-2 bg-red-50 border border-red-100 rounded text-[10px]">
                  <div className="text-center">
                    <div className="text-base font-black text-red-700">{(clusterSig as { anomaly_ratio: number }).anomaly_ratio}×</div>
                    <div className="text-red-400">anomaly ratio</div>
                  </div>
                  <div className="text-center">
                    <div className="text-base font-black text-red-700">{(clusterSig as { observed_count: number }).observed_count ?? cluster.case_count}</div>
                    <div className="text-red-400">observed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-base font-black text-slate-500">{(clusterSig as { expected_count: number }).expected_count}</div>
                    <div className="text-slate-400">expected</div>
                  </div>
                  <div className="text-red-700 text-[10px] italic leading-snug flex-1">
                    {(clusterSig as { national_rate_pct: number }).national_rate_pct}% of missing persons nationally are {cluster.race} {cluster.sex}. In this city and decade: {Math.round(((clusterSig as { observed_count: number }).observed_count / ((clusterSig as { city_total: number }).city_total || 1)) * 100)}%.
                  </div>
                </div>
                {(clusterSig as { top_circumstance_signals?: string[] }).top_circumstance_signals?.length ? (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Shared circumstance signals</p>
                    <div className="flex flex-wrap gap-1">
                      {(clusterSig as { top_circumstance_signals: string[] }).top_circumstance_signals.map(sig => (
                        <span key={sig} className="text-[10px] bg-red-50 text-red-600 border border-red-100 px-1.5 py-0.5 rounded">
                          {sig.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* Highway proximity stats */}
            {cluster.cluster_type === 'highway_proximity' && (clusterSig as { corridor_id?: string; corridor_label?: string; sex_counts?: Record<string, number>; race_counts?: Record<string, number> }).corridor_id && (
              <div className="space-y-2">
                <div className="p-2 bg-yellow-50 border border-yellow-100 rounded text-[10px] text-yellow-700 italic">
                  Cases where the disappearance or discovery location is a city within ~20 miles of the {(clusterSig as { corridor_label: string }).corridor_label ?? (clusterSig as { corridor_id: string }).corridor_id} interstate corridor.
                  Geographic proximity — not text mention. Suggests dumping/transit zone pattern.
                </div>
                {(clusterSig as { race_counts?: Record<string, number> }).race_counts && Object.keys((clusterSig as { race_counts: Record<string, number> }).race_counts).length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Demographic breakdown</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries((clusterSig as { race_counts: Record<string, number> }).race_counts).sort(([, a], [, b]) => b - a).map(([race, n]) => (
                        <span key={race} className="text-[10px] bg-yellow-50 text-yellow-700 border border-yellow-200 px-1.5 py-0.5 rounded">
                          {race}: {n}
                        </span>
                      ))}
                      {Object.entries((clusterSig as { sex_counts?: Record<string, number> }).sex_counts ?? {}).sort(([, a], [, b]) => b - a).map(([sex, n]) => (
                        <span key={sex} className="text-[10px] bg-slate-50 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded">
                          {sex}: {n}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* National park proximity stats */}
            {cluster.cluster_type === 'national_park_proximity' && (clusterSig as { park?: string; female_pct?: number; race_counts?: Record<string, number> }).park && (
              <div className="space-y-2">
                <div className="p-2 bg-green-50 border border-green-100 rounded text-[10px] text-green-800 italic">
                  Cases near <strong>{(clusterSig as { park: string }).park}</strong> — remote terrain may significantly delay discovery.
                  {(clusterSig as { female_pct?: number }).female_pct !== null && (clusterSig as { female_pct?: number }).female_pct !== undefined && (
                    <> {(clusterSig as { female_pct: number }).female_pct}% of cases in this cluster are female.</>
                  )}
                </div>
                {(clusterSig as { race_counts?: Record<string, number> }).race_counts && Object.keys((clusterSig as { race_counts: Record<string, number> }).race_counts).length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Demographic breakdown</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries((clusterSig as { race_counts: Record<string, number> }).race_counts).sort(([, a], [, b]) => b - a).map(([race, n]) => (
                        <span key={race} className="text-[10px] bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded">
                          {race}: {n}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
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
                  <div className="space-y-1.5">
                    {compareSelections.size > 0 && (
                      <div className="flex items-center gap-2 py-1.5 px-2 bg-indigo-50 border border-indigo-200 rounded text-[10px] text-indigo-700">
                        <span className="font-semibold">{compareSelections.size} selected</span>
                        <Button
                          size="sm"
                          disabled={compareSelections.size < 2}
                          className="h-5 text-[9px] px-2 bg-indigo-600 hover:bg-indigo-700 text-white ml-1"
                          onClick={() => setClusterCompareOpen(true)}
                        >
                          Compare side by side
                        </Button>
                        <button
                          className="ml-auto text-indigo-400 hover:text-indigo-600 underline"
                          onClick={() => setCompareSelections(new Set())}
                        >
                          Clear
                        </button>
                      </div>
                    )}
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {members.map(m => (
                        <ClusterMemberRow
                          key={m.id}
                          member={m}
                          missingCaseId={missingCaseId}
                          onReviewMember={handleMemberReview}
                          isAiFlagged={
                            Array.isArray((cluster.signals as { ai_flagged_ids?: string[] }).ai_flagged_ids) &&
                            ((cluster.signals as { ai_flagged_ids?: string[] }).ai_flagged_ids ?? []).includes(m.submission_id)
                          }
                          selected={compareSelections.has(m.submission_id)}
                          onToggleSelect={() => setCompareSelections(prev => {
                            const next = new Set(prev)
                            if (next.has(m.submission_id)) {
                              next.delete(m.submission_id)
                            } else if (next.size < 3) {
                              next.add(m.submission_id)
                            }
                            return next
                          })}
                        />
                      ))}
                    </div>
                    {compareSelections.size === 0 && members.length >= 2 && (
                      <p className="text-[9px] text-slate-400 italic px-1">Tick checkboxes to compare cases side by side (up to 3)</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* AI narrative */}
            {cluster.ai_narrative && (
              <div className="p-3 bg-violet-50 border border-violet-100 rounded space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-wide flex items-center gap-1">
                    <Brain className="h-3 w-3" />AI analysis
                  </p>
                  {(() => {
                    const lvl = (cluster.signals as { connection_level?: number }).connection_level
                    return lvl ? <ConnectionLevelBadge level={lvl} size="xs" /> : null
                  })()}
                </div>
                <p className="text-[11px] text-violet-900 leading-relaxed">{cluster.ai_narrative}</p>
                {(cluster.signals as { ai_flag_reason?: string | null }).ai_flag_reason && (
                  <div className="mt-1 pt-1.5 border-t border-violet-100">
                    <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-wide flex items-center gap-1 mb-0.5">
                      <Brain className="h-2.5 w-2.5" />Deeper connection flagged
                    </p>
                    <p className="text-[11px] text-violet-800 leading-relaxed italic">
                      {(cluster.signals as { ai_flag_reason?: string }).ai_flag_reason}
                    </p>
                  </div>
                )}
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
      <ClusterCompareModal
        open={clusterCompareOpen}
        onClose={() => setClusterCompareOpen(false)}
        submissionIds={[...compareSelections]}
        missingCaseId={missingCaseId}
      />
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

// ─── Case comparison modal ────────────────────────────────────────────────────

function CaseComparisonModal({
  open, onClose, unidentifiedId, missingIds, missingCaseId, unidentifiedCaseId, onLink, linkedIds,
}: {
  open: boolean
  onClose: () => void
  unidentifiedId: string | null
  missingIds: string[]
  missingCaseId: string
  unidentifiedCaseId: string | null
  onLink: (missingId: string) => Promise<void>
  linkedIds: Set<string>
}) {
  const [cases, setCases] = useState<ComparedCase[]>([])
  const [loading, setLoading] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !unidentifiedId || !missingIds.length) return
    const ids = [...missingIds, unidentifiedId].join(',')
    setLoading(true)
    const p = new URLSearchParams({ missingCaseId, type: 'compare_cases', submissionIds: ids })
    if (unidentifiedCaseId) p.set('unidentifiedCaseId', unidentifiedCaseId)
    fetch(`/api/pattern/doe-match?${p}`)
      .then(r => r.json())
      .then((d: { cases: ComparedCase[] }) => setCases(d.cases ?? []))
      .finally(() => setLoading(false))
  }, [open, unidentifiedId, missingIds.join(','), missingCaseId, unidentifiedCaseId])

  if (!open) return null

  const unidCase  = cases.find(c => c.caseType === 'unidentified')
  const missCases = cases.filter(c => c.caseType === 'missing')

  // Color-code a row based on whether values match/conflict
  function rowClass(unidVal: string | null, missVal: string | null): string {
    if (!unidVal || !missVal) return 'bg-slate-50'
    const u = unidVal.toLowerCase().trim()
    const m = missVal.toLowerCase().trim()
    if (u === m || u.includes(m) || m.includes(u)) return 'bg-green-50'
    return 'bg-red-50'
  }

  const FIELDS: Array<{ label: string; key: keyof ComparedCase }> = [
    { label: 'DOE ID / NamUs',  key: 'doeId' },
    { label: 'Name',            key: 'name' },
    { label: 'Sex',             key: 'sex' },
    { label: 'Race',            key: 'race' },
    { label: 'Age',             key: 'age' },
    { label: 'Height',          key: 'height' },
    { label: 'Weight',          key: 'weight' },
    { label: 'Hair',            key: 'hair' },
    { label: 'Eyes',            key: 'eyes' },
    { label: 'Marks / Tattoos', key: 'marks' },
    { label: 'Jewelry',         key: 'jewelry' },
    { label: 'Date',            key: 'date' },
    { label: 'Location',        key: 'location' },
    { label: 'Circumstances',   key: 'circumstances' },
  ]

  async function handleLink(missId: string) {
    setLinking(missId)
    try { await onLink(missId) } finally { setLinking(null) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl my-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Side-by-side comparison</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Green = values match · Red = values conflict · Grey = one side unknown
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center"><Loader2 className="h-6 w-6 animate-spin text-slate-300 mx-auto" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-3 py-2 text-slate-400 font-medium w-28 sticky left-0 bg-white">Field</th>
                  {/* Unidentified column */}
                  {unidCase && (
                    <th className="px-3 py-2 text-left min-w-[180px]">
                      <div className="bg-amber-100 border border-amber-200 rounded px-2 py-1.5">
                        <p className="text-[9px] text-amber-600 font-semibold uppercase tracking-wide">Unidentified remains</p>
                        <p className="text-xs font-bold text-slate-800 mt-0.5">{unidCase.doeId ?? 'Unknown ID'}</p>
                        {unidCase.sex && <p className="text-[10px] text-slate-500">{unidCase.sex} · {unidCase.race} · {unidCase.age}</p>}
                      </div>
                    </th>
                  )}
                  {/* Missing person columns */}
                  {missCases.map(mc => (
                    <th key={mc.submissionId} className="px-3 py-2 text-left min-w-[180px]">
                      <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                        <p className="text-[9px] text-blue-500 font-semibold uppercase tracking-wide">Missing person</p>
                        <p className="text-xs font-bold text-slate-800 mt-0.5">{mc.name ?? 'Unknown'}</p>
                        {mc.doeId && <p className="text-[10px] font-mono text-indigo-400">{mc.doeId}</p>}
                        <div className="mt-1.5">
                          {linkedIds.has(mc.submissionId) ? (
                            <span className="inline-flex items-center gap-1 text-[9px] bg-green-100 text-green-700 border border-green-200 rounded px-1.5 py-0.5 font-semibold">
                              <CheckCircle className="h-2.5 w-2.5" />Linked
                            </span>
                          ) : (
                            <button
                              disabled={!unidentifiedId || linking === mc.submissionId}
                              onClick={() => handleLink(mc.submissionId)}
                              className="inline-flex items-center gap-1 text-[9px] bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded px-2 py-0.5 font-semibold transition-colors"
                            >
                              {linking === mc.submissionId
                                ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                : <GitMerge className="h-2.5 w-2.5" />}
                              Link to remains
                            </button>
                          )}
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FIELDS.map(({ label, key }) => (
                  <tr key={key} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-3 py-1.5 text-slate-400 font-medium sticky left-0 bg-white">{label}</td>
                    {unidCase && (
                      <td className="px-3 py-1.5 text-slate-700 bg-amber-50/30">
                        <span className="line-clamp-3">{(unidCase[key] as string) || <span className="text-slate-300 italic">—</span>}</span>
                      </td>
                    )}
                    {missCases.map(mc => {
                      const cellClass = key !== 'name' && key !== 'circumstances' && key !== 'doeId'
                        ? rowClass(unidCase?.[key] as string ?? null, mc[key] as string ?? null)
                        : ''
                      return (
                        <td key={mc.submissionId} className={`px-3 py-1.5 text-slate-700 ${cellClass}`}>
                          <span className="line-clamp-3">{(mc[key] as string) || <span className="text-slate-300 italic">—</span>}</span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
          <p className="text-[10px] text-slate-400">
            Linking creates a confirmed match candidate visible in the Matches tab.
            All links require investigator review before any external action.
          </p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DoeMatchView({ caseId, canManage }: DoeMatchViewProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'matches' | 'clusters' | 'stalls' | 'entities' | 'route' | 'tattoo_matches'>('matches')
  const [gradeFilter, setGradeFilter] = useState('very_strong')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(0)

  // Cross-match run state
  const [runState, setRunState] = useState<{
    running: boolean
    processed: number
    total: number
    newMatches: number
    unidentifiedCaseId: string | null
  }>({ running: false, processed: 0, total: 0, newMatches: 0, unidentifiedCaseId: null })

  // Route match run state
  const [routeRunState, setRouteRunState] = useState<{
    running: boolean; processed: number; total: number; newMatches: number
  }>({ running: false, processed: 0, total: 0, newMatches: 0 })

  const [clusterRunning, setClusterRunning] = useState(false)
  const [circumstanceRunning, setCircumstanceRunning] = useState(false)
  const [sameDateRunning, setSameDateRunning] = useState(false)
  const [locationRunawayRunning, setLocationRunawayRunning] = useState(false)
  const [corridorRunning, setCorridorRunning] = useState(false)
  const [ageBracketRunning, setAgeBracketRunning] = useState(false)
  const [hotspotRunning, setHotspotRunning] = useState(false)
  const [highwayProximityRunning, setHighwayProximityRunning] = useState(false)
  const [nationalParkRunning, setNationalParkRunning] = useState(false)
  const [allClustersRunning, setAllClustersRunning] = useState(false)
  const [allClustersStep, setAllClustersStep] = useState('')
  const [entitiesRunning, setEntitiesRunning] = useState(false)
  const [dedupRunning, setDedupRunning] = useState(false)
  const [stallsRunning, setStallsRunning] = useState(false)
  const [confirmRunning, setConfirmRunning] = useState(false)
  const [aiReviewRunning, setAiReviewRunning] = useState(false)
  const [aiReviewProgress, setAiReviewProgress] = useState<{ reviewed: number; remaining: number } | null>(null)
  const [routeAiReviewRunning, setRouteAiReviewRunning] = useState(false)
  const [routeAiReviewProgress, setRouteAiReviewProgress] = useState<{ reviewed: number; remaining: number } | null>(null)
  const [clusterTypeFilter, setClusterTypeFilter] = useState<'all' | 'demographic_temporal' | 'circumstance_signal' | 'same_date_proximity' | 'location_runaway_cluster' | 'corridor_cluster' | 'age_bracket' | 'demographic_hotspot' | 'highway_proximity' | 'national_park_proximity'>('all')
  const [clusterSort, setClusterSort] = useState<'urgency' | 'count'>('urgency')
  const [stallTypeFilter, setStallTypeFilter] = useState<'all' | 'voluntary_misclassification' | 'runaway_no_followup' | 'quick_closure_young'>('all')
  const [entityTypeFilter, setEntityTypeFilter] = useState<'all' | 'person_name' | 'vehicle' | 'possible_duplicate'>('all')
  const [signalCountFilter, setSignalCountFilter] = useState(0)
  const [marksFilter, setMarksFilter] = useState(false)
  const [aiVerdictFilter, setAiVerdictFilter] = useState<'all' | 'strong_plus' | 'some' | 'ignore' | 'reviewed'>('all')
  const [clusterReviewFilter, setClusterReviewFilter] = useState<'all' | 'worth_investigating' | 'unreviewed'>('all')
  const [personShowLimit, setPersonShowLimit] = useState<Map<string, number>>(new Map())
  const [tattooSearchOpen, setTattooSearchOpen] = useState(false)
  const [tattooKeyword, setTattooKeyword] = useState('')
  const [tattooResults, setTattooResults] = useState<{
    keyword: string
    missing: Array<{ submissionId: string; doeId: string | null; name: string | null; sex: string | null; race: string | null; age: string | null; date: string | null; state: string | null; snippet: string | null }>
    unidentified: Array<{ submissionId: string; doeId: string | null; name: string | null; sex: string | null; race: string | null; age: string | null; date: string | null; state: string | null; snippet: string | null }>
  } | null>(null)
  const [tattooSearching, setTattooSearching] = useState(false)
  const [selectedMissingIds, setSelectedMissingIds] = useState<Set<string>>(new Set())
  const [selectedUnidentifiedId, setSelectedUnidentifiedId] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set())

  const supabase = createClient()

  // Find all import cases (Doe Network + NamUs) the user can access
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
        .or('title.ilike.%Doe Network%,title.ilike.%NamUs%')

      const all = (cases ?? []) as Array<{ id: string; title: string }>

      // Prefer NamUs missing case (has the most data), fall back to Doe Network
      const namusMissing = all.find(c => c.title.includes('NamUs') && c.title.includes('Missing'))?.id
      const doeMissing = all.find(c => c.title.includes('Doe Network') && c.title.includes('Missing'))?.id
      const namusUnidentified = all.find(c => c.title.includes('NamUs') && c.title.includes('Unidentified'))?.id
      const doeUnidentified = all.find(c => c.title.includes('Doe Network') && c.title.includes('Unidentified'))?.id

      return {
        missing:      namusMissing ?? doeMissing ?? null,
        unidentified: namusUnidentified ?? doeUnidentified ?? null,
        all,
      }
    },
  })

  // Use NamUs missing for matches (most data), Doe Network for stalls/entities/offenders
  const effectiveCaseId = doeCases?.missing ?? caseId

  // Stalls, entities, and clusters may be stored under a different case (Doe Network)
  // Find the Doe Network missing case for these queries
  const doeMissingId = (doeCases?.all ?? []).find((c: { id: string; title: string }) =>
    c.title.includes('Doe Network') && c.title.includes('Missing')
  )?.id
  const stallCaseId = doeMissingId ?? effectiveCaseId

  // Fetch match candidates
  const matchQuery = useQuery({
    queryKey: ['doe-matches', effectiveCaseId, gradeFilter, statusFilter, aiVerdictFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        missingCaseId: effectiveCaseId,
        type: 'matches',
        page: String(page),
      })
      // Always send grade filter — table is too large without it
      params.set('grade', gradeFilter === 'all' ? 'very_strong' : gradeFilter)
      if (statusFilter !== 'all')         params.set('reviewerStatus', statusFilter)
      if (aiVerdictFilter !== 'all')      params.set('aiVerdict', aiVerdictFilter)
      const res = await fetch(`/api/pattern/doe-match?${params}`)
      if (!res.ok) return { matches: [], total: 0 }
      return await res.json() as { matches: DoeMatchCandidate[]; total: number }
    },
    enabled: activeTab === 'matches',
    retry: false,
  })

  // Fetch route match candidates (destination-based)
  const routeMatchQuery = useQuery({
    queryKey: ['doe-route-matches', effectiveCaseId, gradeFilter, statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        missingCaseId: effectiveCaseId,
        type: 'route_matches',
        page: String(page),
      })
      params.set('grade', gradeFilter === 'all' ? 'very_strong' : gradeFilter)
      if (statusFilter !== 'all') params.set('reviewerStatus', statusFilter)
      const res = await fetch(`/api/pattern/doe-match?${params}`)
      if (!res.ok) return { matches: [], total: 0 }
      return await res.json() as { matches: DoeMatchCandidate[]; total: number }
    },
    enabled: activeTab === 'route',
    retry: false,
  })

  // Fetch tattoo matches from intelligence queue
  const tattooMatchQuery = useQuery({
    queryKey: ['tattoo-matches', page],
    queryFn: async () => {
      const { data, count, error } = await supabase
        .from('intelligence_queue')
        .select('*', { count: 'exact' })
        .eq('queue_type', 'entity_crossmatch')
        .neq('status', 'dismissed')
        .order('priority_score', { ascending: false })
        .range(page * 50, (page + 1) * 50 - 1)
      if (error) return { items: [], total: 0 }
      return { items: data ?? [], total: count ?? 0 }
    },
    enabled: activeTab === 'tattoo_matches',
    retry: false,
  })

  // Fetch clusters
  const clusterQuery = useQuery({
    queryKey: ['doe-clusters', effectiveCaseId, statusFilter, clusterTypeFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ missingCaseId: effectiveCaseId, type: 'clusters', page: String(page) })
      if (statusFilter !== 'all')     params.set('reviewerStatus', statusFilter)
      if (clusterTypeFilter !== 'all') params.set('clusterType', clusterTypeFilter)
      const res = await fetch(`/api/pattern/doe-match?${params}`)
      return await res.json() as { clusters: DoeCluster[]; total: number }
    },
    enabled: activeTab === 'clusters',
    retry: false,
  })

  // Fetch stall flags (may be stored under Doe Network case)
  const stallQuery = useQuery({
    queryKey: ['doe-stalls', stallCaseId, statusFilter, stallTypeFilter, page],
    queryFn: async () => {
      const p = new URLSearchParams({ missingCaseId: stallCaseId, type: 'stalls', page: String(page) })
      if (statusFilter !== 'all')   p.set('reviewerStatus', statusFilter)
      if (stallTypeFilter !== 'all') p.set('stallType', stallTypeFilter)
      const res = await fetch(`/api/pattern/doe-match?${p}`)
      return await res.json() as { stalls: DoeStallFlag[]; total: number }
    },
    enabled: activeTab === 'stalls',
    retry: false,
  })

  // Fetch entity mentions
  const entityQuery = useQuery({
    queryKey: ['doe-entities', stallCaseId, entityTypeFilter, page],
    queryFn: async () => {
      const p = new URLSearchParams({ missingCaseId: stallCaseId, type: 'entities', page: String(page) })
      if (entityTypeFilter !== 'all') p.set('entityType', entityTypeFilter)
      const res = await fetch(`/api/pattern/doe-match?${p}`)
      return await res.json() as { entities: DoeEntityMention[]; total: number }
    },
    enabled: activeTab === 'entities',
    retry: false,
  })

  const runCrossMatch = useCallback(async (unidentifiedCaseId: string, startOffset = 0, totalAcc = 0, matchAcc = 0) => {
    setRunState(prev => ({ ...prev, running: true, unidentifiedCaseId }))
    try {
      const res = await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cross_match',
          missingCaseId: effectiveCaseId,
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
        queryClient.invalidateQueries({ queryKey: ['doe-matches', effectiveCaseId] })
      }
    } catch {
      setRunState(prev => ({ ...prev, running: false }))
    }
  }, [caseId, queryClient])

  const runRouteMatch = useCallback(async (unidentifiedCaseId: string, startOffset = 0, totalAcc = 0, matchAcc = 0) => {
    setRouteRunState(prev => ({ ...prev, running: true }))
    try {
      const res = await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'destination_route_match',
          missingCaseId: effectiveCaseId,
          unidentifiedCaseId,
          offset: startOffset,
          limit: 200,
        }),
      })
      const data = await res.json()
      const newTotal = totalAcc + (data.processed - startOffset)
      const newMatches = matchAcc + (data.newMatches ?? 0)
      setRouteRunState({ running: data.hasMore, processed: data.processed ?? 0, total: data.total ?? 0, newMatches })
      if (data.hasMore) {
        await runRouteMatch(unidentifiedCaseId, data.nextOffset, newTotal, newMatches)
      } else {
        queryClient.invalidateQueries({ queryKey: ['doe-route-matches', effectiveCaseId] })
      }
    } catch {
      setRouteRunState(prev => ({ ...prev, running: false }))
    }
  }, [effectiveCaseId, queryClient])

  const runCluster = useCallback(async () => {
    setClusterRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cluster', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
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
        body: JSON.stringify({ action: 'circumstance_cluster', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
    } finally {
      setCircumstanceRunning(false)
    }
  }, [caseId, queryClient])

  const synthesizeCluster = useCallback(async (clusterId: string) => {
    await fetch('/api/pattern/doe-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'synthesize_cluster', missingCaseId: effectiveCaseId, clusterId }),
    })
    queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
  }, [caseId, queryClient])

  const reviewMatch = useCallback(async (id: string, status: string) => {
    await fetch('/api/pattern/doe-match', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'match', reviewerStatus: status }),
    })
    queryClient.invalidateQueries({ queryKey: ['doe-matches', effectiveCaseId] })
  }, [caseId, queryClient])

  const reviewCluster = useCallback(async (id: string, status: string) => {
    await fetch('/api/pattern/doe-match', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'cluster', reviewerStatus: status }),
    })
    queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
  }, [caseId, queryClient])

  const reviewStall = useCallback(async (id: string, status: string) => {
    await fetch('/api/pattern/doe-match', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'stall', reviewerStatus: status }),
    })
    queryClient.invalidateQueries({ queryKey: ['doe-stalls', effectiveCaseId] })
  }, [caseId, queryClient])

  const runConfirmSubmissions = useCallback(async () => {
    setConfirmRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_doe_submissions', missingCaseId: effectiveCaseId }),
      })
    } finally { setConfirmRunning(false) }
  }, [caseId])

  const runSameDateCluster = useCallback(async () => {
    setSameDateRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'same_date_cluster', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
    } finally { setSameDateRunning(false) }
  }, [caseId, queryClient])

  const runExtractEntities = useCallback(async () => {
    setEntitiesRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract_entities', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-entities', effectiveCaseId] })
    } finally { setEntitiesRunning(false) }
  }, [caseId, queryClient])

  const runNameDedup = useCallback(async () => {
    setDedupRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'name_dedup', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-entities', effectiveCaseId] })
    } finally { setDedupRunning(false) }
  }, [caseId, queryClient])

  const runDetectStalls = useCallback(async () => {
    setStallsRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'detect_stalls', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-stalls', effectiveCaseId] })
    } finally { setStallsRunning(false) }
  }, [caseId, queryClient])

  const runLocationRunaway = useCallback(async () => {
    setLocationRunawayRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'location_runaway_cluster', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
    } finally { setLocationRunawayRunning(false) }
  }, [caseId, queryClient])

  const runCorridor = useCallback(async () => {
    setCorridorRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'corridor_cluster', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
    } finally { setCorridorRunning(false) }
  }, [caseId, queryClient])

  const runAgeBracket = useCallback(async () => {
    setAgeBracketRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'age_bracket_cluster', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
    } finally { setAgeBracketRunning(false) }
  }, [caseId, queryClient])

  const runHotspot = useCallback(async () => {
    setHotspotRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'demographic_hotspot', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
    } finally { setHotspotRunning(false) }
  }, [effectiveCaseId, queryClient])

  const runHighwayProximity = useCallback(async () => {
    setHighwayProximityRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'highway_proximity', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
    } finally { setHighwayProximityRunning(false) }
  }, [effectiveCaseId, queryClient])

  const runNationalPark = useCallback(async () => {
    setNationalParkRunning(true)
    try {
      await fetch('/api/pattern/doe-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'national_park_proximity', missingCaseId: effectiveCaseId }),
      })
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
    } finally { setNationalParkRunning(false) }
  }, [effectiveCaseId, queryClient])

  const runAllClusters = useCallback(async () => {
    setAllClustersRunning(true)
    const steps = [
      { label: 'Demographics…',   action: 'cluster' },
      { label: 'Circumstances…',  action: 'circumstance_cluster' },
      { label: 'Date clusters…',  action: 'same_date_cluster' },
      { label: 'Hotspot…',        action: 'demographic_hotspot' },
      { label: 'Location…',       action: 'location_runaway_cluster' },
      { label: 'Corridors…',      action: 'corridor_cluster' },
      { label: 'Age bracket…',    action: 'age_bracket_cluster' },
      { label: 'Hwy proximity…',  action: 'highway_proximity' },
      { label: 'Wilderness…',     action: 'national_park_proximity' },
    ]
    try {
      for (const step of steps) {
        setAllClustersStep(step.label)
        await fetch('/api/pattern/doe-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: step.action, missingCaseId: effectiveCaseId }),
        })
      }
      queryClient.invalidateQueries({ queryKey: ['doe-clusters', effectiveCaseId] })
    } finally {
      setAllClustersRunning(false)
      setAllClustersStep('')
    }
  }, [effectiveCaseId, queryClient])

  const reviewClusterMember = useCallback(async (id: string, membershipStatus: 'confirmed' | 'rejected' | 'candidate') => {
    await fetch('/api/pattern/doe-match', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'cluster_member', membershipStatus }),
    })
  }, [])

  const runAiReviews = useCallback(async () => {
    setAiReviewRunning(true)
    setAiReviewProgress({ reviewed: 0, remaining: 0 })
    let totalReviewed = 0
    let consecutiveErrors = 0
    try {
      while (true) {
        let data: { reviewed: number; hasMore: boolean; remaining: number } | null = null
        try {
          const res = await fetch('/api/pattern/doe-match/ai-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ missingCaseId: effectiveCaseId, batchSize: 5 }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          data = await res.json() as { reviewed: number; hasMore: boolean; remaining: number }
          consecutiveErrors = 0
        } catch {
          consecutiveErrors++
          if (consecutiveErrors >= 3) break
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        totalReviewed += data.reviewed
        setAiReviewProgress({ reviewed: totalReviewed, remaining: data.remaining })
        if (!data.hasMore || data.reviewed === 0) break
        // Small pause between batches to avoid rate limits
        await new Promise(r => setTimeout(r, 500))
      }
      queryClient.invalidateQueries({ queryKey: ['doe-matches', effectiveCaseId] })
    } finally {
      setAiReviewRunning(false)
    }
  }, [effectiveCaseId, queryClient])

  const runRouteAiReviews = useCallback(async () => {
    setRouteAiReviewRunning(true)
    setRouteAiReviewProgress({ reviewed: 0, remaining: 0 })
    let totalReviewed = 0
    let consecutiveErrors = 0
    try {
      while (true) {
        let data: { reviewed: number; hasMore: boolean; remaining: number } | null = null
        try {
          const res = await fetch('/api/pattern/doe-match/ai-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ missingCaseId: effectiveCaseId, batchSize: 5, routeMatches: true }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          data = await res.json() as { reviewed: number; hasMore: boolean; remaining: number }
          consecutiveErrors = 0
        } catch {
          consecutiveErrors++
          if (consecutiveErrors >= 3) break
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        totalReviewed += data.reviewed
        setRouteAiReviewProgress({ reviewed: totalReviewed, remaining: data.remaining })
        if (!data.hasMore || data.reviewed === 0) break
        await new Promise(r => setTimeout(r, 500))
      }
      queryClient.invalidateQueries({ queryKey: ['doe-route-matches', effectiveCaseId] })
    } finally {
      setRouteAiReviewRunning(false)
    }
  }, [effectiveCaseId, queryClient])

  async function runTattooSearch() {
    const kw = tattooKeyword.trim()
    if (!kw || kw.length < 2) return
    setTattooSearching(true)
    setTattooResults(null)
    try {
      const params = new URLSearchParams({
        missingCaseId: effectiveCaseId,
        type: 'tattoo_search',
        keyword: kw,
      })
      if (doeCases?.unidentified) params.set('unidentifiedCaseId', doeCases.unidentified)
      const res = await fetch(`/api/pattern/doe-match?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setTattooResults(await res.json())
    } finally {
      setTattooSearching(false)
    }
  }

  async function linkCases(missingSubmissionId: string) {
    if (!selectedUnidentifiedId) return
    await fetch('/api/pattern/doe-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'manual_link',
        missingCaseId: effectiveCaseId,
        unidentifiedCaseId: doeCases?.unidentified ?? null,
        missingSubmissionId,
        unidentifiedSubmissionId: selectedUnidentifiedId,
      }),
    })
    setLinkedIds(prev => new Set([...prev, missingSubmissionId]))
    queryClient.invalidateQueries({ queryKey: ['doe-matches', effectiveCaseId] })
  }

  const allMatches = matchQuery.data?.matches ?? []
  const matches = allMatches
    .filter(m => signalCountFilter === 0 || countPositiveSignals(m.signals) >= signalCountFilter)
    .filter(m => !marksFilter || (
      ((m.signals.tattoo     as { score: number } | undefined)?.score ?? 0) > 0 ||
      ((m.signals.body_marks as { score: number } | undefined)?.score ?? 0) > 0 ||
      ((m.signals.jewelry    as { score: number } | undefined)?.score ?? 0) > 0
    ))

  // Group matches by missing person, sorted by score desc then location score (distance proxy)
  const groupedMatches = useMemo(() => {
    type Group = { submissionId: string; name: string | null; doeId: string | null; location: string | null; date: string | null; matches: DoeMatchCandidate[] }
    const map = new Map<string, Group>()
    for (const m of matches) {
      const g = map.get(m.missing_submission_id)
      if (g) {
        g.matches.push(m)
      } else {
        map.set(m.missing_submission_id, {
          submissionId: m.missing_submission_id,
          name: m.missing_name,
          doeId: m.missing_doe_id,
          location: m.missing_location,
          date: m.missing_date,
          matches: [m],
        })
      }
    }
    for (const g of map.values()) {
      g.matches.sort((a, b) => {
        if (b.composite_score !== a.composite_score) return b.composite_score - a.composite_score
        const locA = (a.signals.location as { score: number } | undefined)?.score ?? 0
        const locB = (b.signals.location as { score: number } | undefined)?.score ?? 0
        return locB - locA
      })
    }
    return [...map.values()].sort((a, b) => (b.matches[0]?.composite_score ?? 0) - (a.matches[0]?.composite_score ?? 0))
  }, [matches])
  const clusters = clusterQuery.data?.clusters ?? []
  const stalls   = stallQuery.data?.stalls     ?? []
  const entities = entityQuery.data?.entities  ?? []
  const totalMatches  = matchQuery.data?.total  ?? 0
  const totalClusters = clusterQuery.data?.total ?? 0
  const totalStalls   = stallQuery.data?.total   ?? 0
  const totalEntities = entityQuery.data?.total  ?? 0
  const PAGE_SIZE = 50

  const GRADE_FILTERS = ['all', 'notable_plus', 'very_strong', 'strong', 'notable', 'moderate']
  const GRADE_FILTER_LABELS: Record<string, string> = {
    all: 'All', notable_plus: 'Notable+', very_strong: 'Very strong',
    strong: 'Strong', notable: 'Notable', moderate: 'Moderate',
  }
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
            {doeCases?.unidentified && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-teal-200 text-teal-700 hover:bg-teal-50"
                disabled={routeRunState.running} onClick={() => runRouteMatch(doeCases.unidentified!)}>
                {routeRunState.running ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
                {routeRunState.running ? `Route matching… ${routeRunState.processed}/${routeRunState.total}` : 'Route match'}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-green-200 text-green-700 hover:bg-green-50"
              disabled={aiReviewRunning} onClick={runAiReviews}>
              {aiReviewRunning
                ? <><Loader2 className="h-3 w-3 animate-spin" />AI reviewing… {aiReviewProgress?.reviewed ?? 0}</>
                : <><Sparkles className="h-3 w-3" />AI review very strong</>
              }
            </Button>
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
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-red-200 text-red-700 hover:bg-red-50"
              disabled={hotspotRunning} onClick={runHotspot}>
              {hotspotRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
              {hotspotRunning ? 'Scanning…' : 'Hotspot'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-yellow-200 text-yellow-700 hover:bg-yellow-50"
              disabled={highwayProximityRunning} onClick={runHighwayProximity}>
              {highwayProximityRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Car className="h-3 w-3" />}
              {highwayProximityRunning ? 'Scanning…' : 'Hwy proximity'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-green-200 text-green-700 hover:bg-green-50"
              disabled={nationalParkRunning} onClick={runNationalPark}>
              {nationalParkRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
              {nationalParkRunning ? 'Scanning…' : 'Wilderness'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-slate-300 text-slate-700 hover:bg-slate-50 font-medium"
              disabled={allClustersRunning} onClick={runAllClusters}>
              {allClustersRunning ? <><Loader2 className="h-3 w-3 animate-spin" />{allClustersStep}</> : 'Run all clusters'}
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
          { id: 'route'    as const, label: 'Route Matches',            count: routeMatchQuery.data?.total ?? 0 },
          { id: 'tattoo_matches' as const, label: 'Tattoo Matches',    count: tattooMatchQuery.data?.total ?? 0 },
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
      <div className="space-y-2">
        {activeTab === 'matches' && (
          <>
            {/* AI verdict filter — prominent, own row */}
            <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500 whitespace-nowrap">
                <Sparkles className="h-3 w-3" />
                AI verdict
              </span>
              <div className="flex gap-1 flex-wrap">
                {([
                  { value: 'all',         label: 'All',              cls: 'bg-white text-slate-600 border-slate-300 hover:border-slate-400',            active: 'bg-slate-900 text-white border-slate-900' },
                  { value: 'reviewed',    label: 'Has AI review',    cls: 'bg-white text-slate-600 border-slate-300 hover:border-slate-400',            active: 'bg-slate-900 text-white border-slate-900' },
                  { value: 'strong_plus', label: '4–5 Strong+',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100',    active: 'bg-emerald-700 text-white border-emerald-700' },
                  { value: 'some',        label: '3 Some connection', cls: 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100',           active: 'bg-amber-600 text-white border-amber-600' },
                  { value: 'ignore',      label: '1–2 Ignore/Slim',  cls: 'bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200',          active: 'bg-slate-500 text-white border-slate-500' },
                ] as const).map(f => (
                  <button key={f.value} onClick={() => { setAiVerdictFilter(f.value); setPage(0) }}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded border transition-colors ${aiVerdictFilter === f.value ? f.active : f.cls}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Secondary filters row */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="flex gap-1 flex-wrap">
                {GRADE_FILTERS.map(g => (
                  <button key={g} onClick={() => { setGradeFilter(g); setPage(0) }}
                    className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors
                      ${gradeFilter === g ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                    {GRADE_FILTER_LABELS[g] ?? g}
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
              <button
                onClick={() => { setMarksFilter(v => !v); setPage(0) }}
                className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border transition-colors
                  ${marksFilter ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
              >
                <Fingerprint className="h-2.5 w-2.5" />
                Tattoos/marks/jewelry
              </button>
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2 items-center">
        {activeTab === 'clusters' && (
          <div className="space-y-2">
            <div className="flex gap-1 flex-wrap">
              {([
                { value: 'all',                      label: 'All' },
                { value: 'demographic_temporal',     label: 'Demographic' },
                { value: 'circumstance_signal',      label: 'Circumstance' },
                { value: 'same_date_proximity',      label: 'Same date' },
                { value: 'location_runaway_cluster', label: 'Location runaway' },
                { value: 'corridor_cluster',         label: 'Corridor' },
                { value: 'age_bracket',              label: 'Age bracket' },
                { value: 'demographic_hotspot',      label: 'Hotspot' },
                { value: 'highway_proximity',        label: 'Hwy proximity' },
                { value: 'national_park_proximity',  label: 'Wilderness' },
              ] as const).map(f => (
                <button key={f.value} onClick={() => { setClusterTypeFilter(f.value); setPage(0) }}
                  className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors
                    ${clusterTypeFilter === f.value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 font-medium">Review status:</span>
              <div className="flex gap-1 flex-wrap">
                {([
                  { value: 'all',                 label: 'All',                 cls: 'bg-white text-slate-600 border-slate-300',             active: 'bg-slate-900 text-white border-slate-900' },
                  { value: 'worth_investigating', label: 'Worth investigating', cls: 'bg-amber-50 text-amber-700 border-amber-300',           active: 'bg-amber-600 text-white border-amber-600' },
                  { value: 'unreviewed',          label: 'Unreviewed',          cls: 'bg-white text-slate-500 border-slate-200',              active: 'bg-slate-700 text-white border-slate-700' },
                ] as const).map(f => (
                  <button key={f.value} onClick={() => setClusterReviewFilter(f.value)}
                    className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full border transition-colors ${clusterReviewFilter === f.value ? f.active : f.cls}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
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
        {(activeTab === 'matches' || activeTab === 'route' || activeTab === 'stalls') && (
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
      </div>

      {/* Tattoo / Mark keyword search — available in both matches and route tabs */}
      {(activeTab === 'matches' || activeTab === 'route') && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
            onClick={() => { setTattooSearchOpen(o => !o); setTattooResults(null) }}
          >
            <Fingerprint className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-700">Tattoo / Mark keyword search</span>
            <span className="text-[10px] text-slate-400 ml-1">— find matching descriptions across missing persons & unidentified remains</span>
            {tattooSearchOpen ? <ChevronUp className="h-3 w-3 text-slate-400 ml-auto" /> : <ChevronDown className="h-3 w-3 text-slate-400 ml-auto" />}
          </button>
          {tattooSearchOpen && (
            <div className="px-3 pb-3 pt-2 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder='e.g. panther, eagle, rose, dragon, anchor…'
                  className="flex-1 text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  value={tattooKeyword}
                  onChange={e => setTattooKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runTattooSearch()}
                />
                <Button size="sm" className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white"
                  onClick={runTattooSearch} disabled={tattooSearching || tattooKeyword.trim().length < 2}>
                  {tattooSearching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                  <span className="ml-1">Search</span>
                </Button>
              </div>
              {tattooResults && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                        Missing persons ({tattooResults.missing.length})
                      </p>
                      {tattooResults.missing.length === 0 ? (
                        <p className="text-[11px] text-slate-400 italic">None found</p>
                      ) : (
                        <div className="space-y-1.5">
                          {tattooResults.missing.map(r => (
                            <div key={r.submissionId}
                              className={`text-[10px] border rounded p-2 cursor-pointer transition-colors ${selectedMissingIds.has(r.submissionId) ? 'bg-blue-100 border-blue-300' : 'bg-blue-50 border-blue-100 hover:border-blue-200'}`}
                              onClick={() => setSelectedMissingIds(prev => {
                                const next = new Set(prev)
                                next.has(r.submissionId) ? next.delete(r.submissionId) : (next.size < 3 && next.add(r.submissionId))
                                return next
                              })}
                            >
                              <div className="flex items-start gap-2">
                                <input type="checkbox" readOnly
                                  checked={selectedMissingIds.has(r.submissionId)}
                                  disabled={!selectedMissingIds.has(r.submissionId) && selectedMissingIds.size >= 3}
                                  className="mt-0.5 accent-blue-500 cursor-pointer"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <span className="font-semibold text-slate-800">{r.name ?? 'Unknown'}</span>
                                    {r.doeId && <span className="font-mono text-indigo-400">{r.doeId}</span>}
                                    {r.sex && <span className="text-slate-500">{r.sex}</span>}
                                    {r.race && <span className="text-slate-500">{r.race}</span>}
                                    {r.age && <span className="text-slate-500">age {r.age}</span>}
                                    {r.state && <span className="text-slate-500">{r.state}</span>}
                                    {r.date && <span className="text-slate-400">{r.date}</span>}
                                    <a href={`/cases/${effectiveCaseId}/submissions/${r.submissionId}`} target="_blank" rel="noopener noreferrer"
                                      className="ml-auto text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 font-medium"
                                      onClick={e => e.stopPropagation()}>
                                      <ExternalLink className="h-2 w-2" />View
                                    </a>
                                  </div>
                                  {r.snippet && <p className="mt-0.5 text-slate-500 italic">…{r.snippet}…</p>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                        Unidentified remains ({tattooResults.unidentified.length})
                      </p>
                      {tattooResults.unidentified.length === 0 ? (
                        <p className="text-[11px] text-slate-400 italic">None found</p>
                      ) : (
                        <div className="space-y-1.5">
                          {tattooResults.unidentified.map(r => (
                            <div key={r.submissionId}
                              className={`text-[10px] border rounded p-2 cursor-pointer transition-colors ${selectedUnidentifiedId === r.submissionId ? 'bg-amber-100 border-amber-400' : 'bg-amber-50 border-amber-100 hover:border-amber-300'}`}
                              onClick={() => setSelectedUnidentifiedId(prev => prev === r.submissionId ? null : r.submissionId)}
                            >
                              <div className="flex items-start gap-2">
                                <input type="radio" readOnly
                                  checked={selectedUnidentifiedId === r.submissionId}
                                  className="mt-0.5 accent-amber-500 cursor-pointer"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <span className="font-semibold text-slate-800">{r.doeId ?? 'Unknown ID'}</span>
                                    {r.sex && <span className="text-slate-500">{r.sex}</span>}
                                    {r.race && <span className="text-slate-500">{r.race}</span>}
                                    {r.age && <span className="text-slate-500">age {r.age}</span>}
                                    {r.state && <span className="text-slate-500">{r.state}</span>}
                                    {r.date && <span className="text-slate-400">{r.date}</span>}
                                    {doeCases?.unidentified && (
                                      <a href={`/cases/${doeCases.unidentified}/submissions/${r.submissionId}`} target="_blank" rel="noopener noreferrer"
                                        className="ml-auto text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 font-medium"
                                        onClick={e => e.stopPropagation()}>
                                        <ExternalLink className="h-2 w-2" />View
                                      </a>
                                    )}
                                  </div>
                                  {r.snippet && <p className="mt-0.5 text-slate-500 italic">…{r.snippet}…</p>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {(tattooResults.missing.length > 0 && tattooResults.unidentified.length > 0) && (
                    <div className="space-y-2">
                      <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                        <strong>{tattooResults.missing.length} missing person{tattooResults.missing.length !== 1 ? 's' : ''}</strong> and <strong>{tattooResults.unidentified.length} unidentified case{tattooResults.unidentified.length !== 1 ? 's' : ''}</strong> both mention <strong>"{tattooResults.keyword}"</strong>. Tick a remains (radio) and up to 3 missing persons (checkboxes) then compare.
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {(selectedMissingIds.size > 0 || selectedUnidentifiedId) && (
                          <button className="text-[10px] text-slate-400 hover:text-slate-600 underline"
                            onClick={() => { setSelectedMissingIds(new Set()); setSelectedUnidentifiedId(null) }}>
                            Clear selection
                          </button>
                        )}
                        {selectedMissingIds.size > 0 && selectedUnidentifiedId && (
                          <Button size="sm" className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                            onClick={() => setCompareOpen(true)}>
                            <GitMerge className="h-3 w-3 mr-1" />
                            Compare {selectedMissingIds.size} missing + 1 remains
                          </Button>
                        )}
                        {selectedMissingIds.size > 0 && !selectedUnidentifiedId && (
                          <p className="text-[10px] text-slate-400 italic">← Select a remains to compare</p>
                        )}
                        {selectedUnidentifiedId && selectedMissingIds.size === 0 && (
                          <p className="text-[10px] text-slate-400 italic">← Select 1–3 missing persons to compare</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
            <div className="space-y-5">
              {groupedMatches.map(group => (
                <div key={group.submissionId}>
                  {/* Person header */}
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <User className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-slate-800">{group.name ?? 'Unknown name'}</span>
                    {group.doeId && (
                      <span className="text-[10px] text-indigo-400 font-mono">{group.doeId}</span>
                    )}
                    {group.location && (
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <MapPin className="h-2.5 w-2.5" />{group.location}
                      </span>
                    )}
                    {group.date && (
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Calendar className="h-2.5 w-2.5" />Missing {group.date}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-400 flex-shrink-0">
                      {group.matches.length} match{group.matches.length !== 1 ? 'es' : ''}
                    </span>
                  </div>
                  {/* Match cards indented */}
                  <div className="space-y-1.5 pl-3 border-l-2 border-slate-100">
                    {group.matches.slice(0, personShowLimit.get(group.submissionId) ?? 10).map(m => (
                      <MatchCard key={m.id} match={m} onReview={reviewMatch} />
                    ))}
                    {group.matches.length > (personShowLimit.get(group.submissionId) ?? 10) && (
                      <button
                        className="text-[11px] text-indigo-500 hover:text-indigo-700 px-1 py-0.5"
                        onClick={() => setPersonShowLimit(prev => {
                          const next = new Map(prev)
                          next.set(group.submissionId, (prev.get(group.submissionId) ?? 10) + 10)
                          return next
                        })}
                      >
                        Show {Math.min(10, group.matches.length - (personShowLimit.get(group.submissionId) ?? 10))} more matches for this person
                      </button>
                    )}
                  </div>
                </div>
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

      {activeTab === 'route' && (
        <>
          {/* Route match info banner */}
          <div className="flex items-start gap-2 bg-teal-50 border border-teal-200 rounded-lg p-3">
            <MapPin className="h-3.5 w-3.5 text-teal-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[11px] text-teal-700">
                These candidates share physical characteristics with the missing person AND were found near or along
                their believed route of travel. Destination extracted from circumstances text.
              </p>
            </div>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1 border-violet-200 text-violet-600 flex-shrink-0"
                disabled={routeAiReviewRunning}
                onClick={runRouteAiReviews}
              >
                {routeAiReviewRunning
                  ? <><Loader2 className="h-3 w-3 animate-spin" />AI reviewing… {routeAiReviewProgress?.reviewed ?? 0}</>
                  : <><Sparkles className="h-3 w-3" />AI review route matches</>
                }
              </Button>
            )}
          </div>

          {routeMatchQuery.isLoading ? (
            <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>
          ) : (routeMatchQuery.data?.matches ?? []).length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <GitMerge className="h-8 w-8 text-slate-200 mx-auto" />
              <p className="text-sm text-slate-400">
                {(routeMatchQuery.data?.total ?? 0) === 0
                  ? 'No route match candidates yet. Click "Route match" to score missing persons with known destinations against unidentified remains found along their route.'
                  : 'No candidates match this filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {(() => {
                type RouteGroup = { submissionId: string; name: string | null; doeId: string | null; location: string | null; date: string | null; matches: DoeMatchCandidate[] }
                const routeMap = new Map<string, RouteGroup>()
                for (const m of (routeMatchQuery.data?.matches ?? [])) {
                  const g = routeMap.get(m.missing_submission_id)
                  if (g) {
                    g.matches.push(m)
                  } else {
                    routeMap.set(m.missing_submission_id, {
                      submissionId: m.missing_submission_id,
                      name: m.missing_name,
                      doeId: m.missing_doe_id,
                      location: m.missing_location,
                      date: m.missing_date,
                      matches: [m],
                    })
                  }
                }
                const routeGroups = [...routeMap.values()].sort((a, b) => (b.matches[0]?.composite_score ?? 0) - (a.matches[0]?.composite_score ?? 0))
                return routeGroups.map(group => (
                  <div key={group.submissionId}>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <User className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                      <span className="text-sm font-semibold text-slate-800">{group.name ?? 'Unknown name'}</span>
                      {group.doeId && (
                        <span className="text-[10px] text-indigo-400 font-mono">{group.doeId}</span>
                      )}
                      {group.location && (
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <MapPin className="h-2.5 w-2.5" />{group.location}
                        </span>
                      )}
                      {group.date && (
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <Calendar className="h-2.5 w-2.5" />Missing {group.date}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-slate-400 flex-shrink-0">
                        {group.matches.length} match{group.matches.length !== 1 ? 'es' : ''}
                      </span>
                    </div>
                    <div className="space-y-1.5 pl-3 border-l-2 border-teal-100">
                      {group.matches.slice(0, personShowLimit.get(group.submissionId) ?? 10).map(m => (
                        <div key={m.id}>
                          {m.destination_text && (
                            <div className="flex items-start gap-1.5 bg-teal-50 border border-teal-200 rounded px-2 py-1 mb-1">
                              <MapPin className="h-3 w-3 text-teal-500 flex-shrink-0 mt-0.5" />
                              <span className="text-[10px] text-teal-700">
                                <span className="font-semibold">Was heading to {m.destination_city ?? 'unknown'}{m.destination_state ? ', ' + m.destination_state : ''}</span>
                                {' — '}<span className="italic">{m.destination_text}</span>
                              </span>
                            </div>
                          )}
                          <MatchCard match={m} onReview={reviewMatch} />
                        </div>
                      ))}
                      {group.matches.length > (personShowLimit.get(group.submissionId) ?? 10) && (
                        <button
                          className="text-[11px] text-teal-500 hover:text-teal-700 px-1 py-0.5"
                          onClick={() => setPersonShowLimit(prev => {
                            const next = new Map(prev)
                            next.set(group.submissionId, (prev.get(group.submissionId) ?? 10) + 10)
                            return next
                          })}
                        >
                          Show {Math.min(10, group.matches.length - (personShowLimit.get(group.submissionId) ?? 10))} more matches for this person
                        </button>
                      )}
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}

          {(routeMatchQuery.data?.total ?? 0) > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, routeMatchQuery.data?.total ?? 0)} of {(routeMatchQuery.data?.total ?? 0).toLocaleString()} candidates
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  disabled={(page + 1) * PAGE_SIZE >= (routeMatchQuery.data?.total ?? 0)}
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
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-400">{totalClusters.toLocaleString()} clusters</p>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-400">Sort:</span>
                  <button
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${clusterSort === 'urgency' ? 'bg-violet-100 text-violet-700 border-violet-200' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                    onClick={() => setClusterSort('urgency')}
                  >AI urgency</button>
                  <button
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${clusterSort === 'count' ? 'bg-slate-200 text-slate-700 border-slate-300' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                    onClick={() => setClusterSort('count')}
                  >Case count</button>
                </div>
              </div>
              <div className="space-y-2">
                {[...clusters]
                  .filter(c => {
                    if (clusterReviewFilter === 'worth_investigating') return c.reviewer_status === 'worth_investigating'
                    if (clusterReviewFilter === 'unreviewed') return c.reviewer_status === 'unreviewed'
                    return true
                  })
                  .sort((a, b) => {
                    if (clusterSort === 'urgency') {
                      const ua = (a.signals as { ai_urgency?: number }).ai_urgency ?? 0
                      const ub = (b.signals as { ai_urgency?: number }).ai_urgency ?? 0
                      return ub - ua || b.case_count - a.case_count
                    }
                    return b.case_count - a.case_count
                  }).map(c => (
                  <ClusterCard key={c.id} cluster={c} missingCaseId={effectiveCaseId} onReview={reviewCluster} onSynthesize={synthesizeCluster} onReviewMember={reviewClusterMember} />
                ))}
              </div>
            </>
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

      {activeTab === 'tattoo_matches' && (
        <>
          <div className="flex items-start gap-2 bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
            <Fingerprint className="h-3.5 w-3.5 text-purple-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[11px] text-purple-700">
                Tattoo matches compare distinguishing mark descriptions (tattoos, scars, birthmarks) between missing persons
                and unidentified remains. Matches are scored by shared keywords and body location alignment.
                <strong> Description + same body location = strongest signal.</strong>
              </p>
            </div>
          </div>

          {tattooMatchQuery.isLoading ? (
            <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>
          ) : (tattooMatchQuery.data?.items ?? []).length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Fingerprint className="h-8 w-8 text-slate-200 mx-auto" />
              <p className="text-sm text-slate-400">No tattoo matches found.</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Run the tattoo matching script to compare mark descriptions across all cases.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {(tattooMatchQuery.data?.items ?? []).map((item: Record<string, unknown>) => (
                <TattooMatchCard
                  key={item.id as string}
                  item={item as never}
                  missingCaseId={effectiveCaseId}
                  onStatusChange={() => queryClient.invalidateQueries({ queryKey: ['tattoo-matches'] })}
                />
              ))}
            </div>
          )}
          {(tattooMatchQuery.data?.total ?? 0) > 50 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400">
                Page {page + 1} of {Math.ceil((tattooMatchQuery.data?.total ?? 0) / 50)}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  disabled={(page + 1) * 50 >= (tattooMatchQuery.data?.total ?? 0)}
                  onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      <CaseComparisonModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        unidentifiedId={selectedUnidentifiedId}
        missingIds={[...selectedMissingIds]}
        missingCaseId={effectiveCaseId}
        unidentifiedCaseId={doeCases?.unidentified ?? null}
        onLink={linkCases}
        linkedIds={linkedIds}
      />
    </div>
  )
}
