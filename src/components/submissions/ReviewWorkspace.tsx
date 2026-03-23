'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuditLog } from '@/hooks/useAuditLog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EpistemicBadge, getEpistemicType } from '@/components/shared/EpistemicBadge'
import { EntityLinkModal } from '@/components/entities/EntityLinkModal'
import { useToast } from '@/components/ui/use-toast'
import {
  formatDate,
  labelForObservationMode,
  labelForClaimType,
  labelForEntityType,
} from '@/lib/utils'
import {
  Plus,
  AlertTriangle,
  Paperclip,
  User,
  Link2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Keyboard,
  Car,
  Phone,
  CheckCircle2,
} from 'lucide-react'
import Link from 'next/link'
import {
  splitIntoSentences,
  suggestClaimType,
  preflaggerInterpretation,
  detectVehicleInText,
  detectPhonesInText,
} from '@/lib/scoring'
import type { Submission, ConfidenceLevel, ClaimType, DatePrecision, NoveltyFlag } from '@/lib/types'
import { SubmissionLinksPanel } from './SubmissionLinksPanel'

interface ReviewWorkspaceProps {
  submission: Submission & {
    files?: Array<{ id: string; file_name: string; file_type?: string | null }>
    step6Entities?: Array<{ id: string; entity_type: string; raw_value: string }>
    novelty_flags?: NoveltyFlag[]
    priority_level?: string
    priority_score?: number
    duplicate_similarity?: number | null
    duplicate_of_submission_id?: string | null
    triage_status?: string
  }
  caseId: string
  queuePosition?: number
  queueTotal?: number
}

interface ClaimDraft {
  id: string // local draft id
  extracted_text: string
  claim_type: ClaimType
  interpretation_flag: boolean
  source_confidence: ConfidenceLevel
  content_confidence: ConfidenceLevel
  event_date: string
  event_date_precision: DatePrecision
  notes: string
  behavioral_category: string
  behavioral_consistency_flag: boolean
  notesOpen: boolean
  savedId?: string // db id once saved
}

type EntitySuggestion = {
  source: 'step6' | 'vehicle' | 'phone'
  entity_type: string
  raw_value: string
  status: 'pending' | 'accepted' | 'rejected'
  entity_role: string
  identifier_source: string
  existsInCase?: boolean
}

function makeDraftId() {
  return `draft_${Math.random().toString(36).slice(2)}`
}

function defaultDraft(text = '', type?: string): ClaimDraft {
  return {
    id: makeDraftId(),
    extracted_text: text,
    claim_type: (type ?? suggestClaimType(text)) as ClaimType,
    interpretation_flag: preflaggerInterpretation(text),
    source_confidence: 'medium',
    content_confidence: 'medium',
    event_date: '',
    event_date_precision: 'unknown',
    notes: '',
    behavioral_category: '',
    behavioral_consistency_flag: false,
    notesOpen: false,
  }
}

const CLAIM_TYPES: ClaimType[] = [
  'statement', 'sighting', 'identifier', 'association',
  'interpretation', 'official', 'behavioral', 'physical_description',
]
const BEHAVIORAL_CATEGORIES = [
  { value: '', label: 'None' },
  { value: 'method_of_approach', label: 'Method of approach' },
  { value: 'method_of_control', label: 'Method of control' },
  { value: 'method_of_disposal', label: 'Method of disposal' },
  { value: 'signature_behavior', label: 'Signature behavior' },
  { value: 'forensic_awareness', label: 'Forensic awareness' },
  { value: 'staging', label: 'Scene staging' },
  { value: 'unknown', label: 'Unknown behavioral' },
]

function PriorityBadge({ level, score }: { level: string; score: number }) {
  const cls =
    level === 'high'
      ? 'bg-red-100 text-red-700 border border-red-300'
      : level === 'medium'
      ? 'bg-amber-100 text-amber-700 border border-amber-300'
      : 'bg-slate-100 text-slate-600 border border-slate-200'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${cls}`}>
      {level}
      <span className="font-normal opacity-60 normal-case">({score})</span>
    </span>
  )
}

function NoveltyChip({ flag }: { flag: NoveltyFlag }) {
  if (flag.type === 'new_entity') {
    return <span className="text-[11px] bg-green-100 text-green-700 rounded px-1.5 py-0.5">New entity: {flag.label}</span>
  }
  if (flag.type === 'corroboration') {
    return <span className="text-[11px] bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">Corroborates: {flag.label}{flag.count ? `, ${flag.count}x` : ''}</span>
  }
  if (flag.type === 'contradiction') {
    return <span className="text-[11px] bg-red-100 text-red-700 rounded px-1.5 py-0.5">Possible contradiction</span>
  }
  if (flag.type === 'duplicate') {
    return <span className="text-[11px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">Possible duplicate {flag.similarity ? `(${flag.similarity}%)` : ''}</span>
  }
  return null
}

const DRAFT_KEY = (id: string) => `review_draft_${id}`

export function ReviewWorkspace({
  submission,
  caseId,
  queuePosition,
  queueTotal,
}: ReviewWorkspaceProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { logAction } = useAuditLog()
  const { toast } = useToast()

  const [drafts, setDrafts] = useState<ClaimDraft[]>([])
  const [activeDraftIdx, setActiveDraftIdx] = useState<number | null>(null)
  const [reviewStatus, setReviewStatus] = useState(submission.review_status)
  const [reviewNotes, setReviewNotes] = useState(submission.notes ?? '')
  const [linkingClaimId, setLinkingClaimId] = useState<string | null>(null)
  const [entityTrayOpen, setEntityTrayOpen] = useState(true)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [extractedSentences, setExtractedSentences] = useState<Set<string>>(new Set())
  const [flashSentence, setFlashSentence] = useState<string | null>(null)
  const [draftRestoreOffered, setDraftRestoreOffered] = useState(false)
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Entity suggestions from step6 + auto-detect
  const [entitySuggestions, setEntitySuggestions] = useState<EntitySuggestion[]>([])

  // Fetch existing claims
  const { data: claims, isLoading: claimsLoading } = useQuery({
    queryKey: ['claims', submission.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('claims')
        .select(`
          *,
          claim_entity_links(
            *,
            entity:entities(id, entity_type, normalized_value, raw_value)
          )
        `)
        .eq('submission_id', submission.id)
        .order('claim_position')
      if (error) throw error
      return data
    },
  })

  // Track which sentences are already extracted
  useEffect(() => {
    if (!claims) return
    const texts = new Set(claims.map(c => c.extracted_text))
    setExtractedSentences(texts)
  }, [claims])

  // Initialize entity suggestions
  useEffect(() => {
    const suggestions: EntitySuggestion[] = []

    // Step 6 entities
    for (const e of submission.step6Entities ?? []) {
      suggestions.push({
        source: 'step6',
        entity_type: e.entity_type,
        raw_value: e.raw_value,
        status: 'pending',
        entity_role: 'unknown',
        identifier_source: 'unknown',
      })
    }

    // Auto-detected vehicles
    const vehicles = detectVehicleInText(submission.raw_text)
    for (const v of vehicles) {
      if (!suggestions.some(s => s.raw_value.toLowerCase() === v.toLowerCase())) {
        suggestions.push({
          source: 'vehicle',
          entity_type: 'vehicle',
          raw_value: v,
          status: 'pending',
          entity_role: 'vehicle_seen',
          identifier_source: 'seen_directly',
        })
      }
    }

    // Auto-detected phones
    const phones = detectPhonesInText(submission.raw_text)
    for (const p of phones) {
      if (!suggestions.some(s => s.raw_value.toLowerCase() === p.toLowerCase())) {
        suggestions.push({
          source: 'phone',
          entity_type: 'phone',
          raw_value: p,
          status: 'pending',
          entity_role: 'unknown',
          identifier_source: 'seen_directly',
        })
      }
    }

    setEntitySuggestions(suggestions)
  }, [submission.id, submission.raw_text, submission.step6Entities])

  // Draft restore
  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY(submission.id))
    if (saved && submission.review_status === 'under_review') {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.drafts && parsed.drafts.length > 0) {
          setDraftRestoreOffered(true)
        }
      } catch { /* ignore */ }
    }
  }, [submission.id, submission.review_status])

  const restoreDraft = () => {
    const saved = localStorage.getItem(DRAFT_KEY(submission.id))
    if (!saved) return
    try {
      const parsed = JSON.parse(saved)
      if (parsed.drafts) setDrafts(parsed.drafts)
      if (parsed.reviewNotes) setReviewNotes(parsed.reviewNotes)
      setDraftRestoreOffered(false)
      toast({ title: 'Draft restored', description: 'Your unsaved progress has been restored.' })
    } catch { /* ignore */ }
  }

  // Auto-save to localStorage every 30s
  useEffect(() => {
    autoSaveRef.current = setInterval(() => {
      if (drafts.length > 0 || reviewNotes) {
        localStorage.setItem(
          DRAFT_KEY(submission.id),
          JSON.stringify({ drafts, reviewNotes, savedAt: new Date().toISOString() })
        )
      }
    }, 30000)
    return () => {
      if (autoSaveRef.current) clearInterval(autoSaveRef.current)
    }
  }, [drafts, reviewNotes, submission.id])

  // Signal start-review on mount
  useEffect(() => {
    fetch('/api/submissions/start-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: submission.id }),
    }).catch(() => { /* non-fatal */ })
  }, [submission.id])

  // Save a single draft to DB — declared before keyboard shortcut useEffect
  const saveDraftMutation = useMutation({
    mutationFn: async (draft: ClaimDraft) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const position = (claims?.length ?? 0) + 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = {
        submission_id: submission.id,
        original_submission_id: submission.id,
        claim_position: position,
        extracted_text: draft.extracted_text,
        claim_type: draft.claim_type,
        interpretation_flag: draft.interpretation_flag,
        source_confidence: draft.source_confidence,
        content_confidence: draft.content_confidence,
        event_date: draft.event_date || null,
        event_date_precision: draft.event_date_precision,
        notes: draft.notes || null,
        created_by: user.id,
        behavioral_category: draft.behavioral_category || null,
        behavioral_consistency_flag: draft.behavioral_consistency_flag,
      }

      const { data: claim, error } = await supabase
        .from('claims')
        .insert(payload)
        .select()
        .single()

      if (error) throw error

      await logAction({
        action: 'created',
        target_type: 'claim',
        target_id: claim.id,
        case_id: caseId,
        note: `Extracted from submission ${submission.id}`,
      })

      return { draft, claim }
    },
    onSuccess: ({ draft, claim }) => {
      queryClient.invalidateQueries({ queryKey: ['claims', submission.id] })
      // Mark draft as saved
      setDrafts(prev => prev.map(d =>
        d.id === draft.id ? { ...d, savedId: claim.id } : d
      ))
      setExtractedSentences(prev => new Set([...prev, draft.extracted_text]))
      toast({ title: 'Claim saved' })
    },
    onError: (error) => {
      toast({ variant: 'destructive', title: 'Failed to save claim', description: error.message })
    },
  })

  const saveReviewMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('submissions')
        .update({ review_status: reviewStatus, notes: reviewNotes || null })
        .eq('id', submission.id)
      if (error) throw error

      await logAction({
        action: 'edited',
        target_type: 'submission',
        target_id: submission.id,
        case_id: caseId,
        note: `Status: ${reviewStatus}`,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submission', submission.id] })
      localStorage.removeItem(DRAFT_KEY(submission.id))
      toast({ title: 'Review saved' })
    },
    onError: (error) => {
      toast({ variant: 'destructive', title: 'Failed to save', description: error.message })
    },
  })

  const completeReviewMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('submissions')
        .update({
          review_status: reviewStatus,
          notes: reviewNotes || null,
          review_completed_at: new Date().toISOString(),
        })
        .eq('id', submission.id)
      if (error) throw error

      await logAction({
        action: 'edited',
        target_type: 'submission',
        target_id: submission.id,
        case_id: caseId,
        note: `Review completed, status: ${reviewStatus}`,
      })
    },
    onSuccess: () => {
      localStorage.removeItem(DRAFT_KEY(submission.id))
      toast({ title: 'Review completed' })
      // Navigate back to queue
      window.location.href = `/cases/${caseId}/submissions`
    },
    onError: (error) => {
      toast({ variant: 'destructive', title: 'Failed to complete review', description: error.message })
    },
  })

  const deleteClaimMutation = useMutation({
    mutationFn: async (claimId: string) => {
      const { error } = await supabase.from('claims').delete().eq('id', claimId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claims', submission.id] })
    },
  })

  const acceptEntityMutation = useMutation({
    mutationFn: async (suggestion: EntitySuggestion) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: entity, error } = await supabase
        .from('entities')
        .insert({
          case_id: caseId,
          entity_type: suggestion.entity_type as never,
          raw_value: suggestion.raw_value,
          normalization_status: 'raw',
          confidence: 'medium',
          created_by: user.id,
        })
        .select()
        .single()

      if (error) throw error
      return entity
    },
    onSuccess: (entity, suggestion) => {
      queryClient.invalidateQueries({ queryKey: ['entities', caseId] })
      setEntitySuggestions(prev => prev.map(s =>
        s.raw_value === suggestion.raw_value ? { ...s, status: 'accepted' } : s
      ))
      toast({ title: `Entity accepted: ${entity.raw_value}` })
    },
    onError: (error) => {
      toast({ variant: 'destructive', title: 'Failed to accept entity', description: error.message })
    },
  })

  // Keyboard shortcuts — declared after saveDraftMutation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (activeDraftIdx === null) return

      if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          setActiveDraftIdx(i => i !== null && i > 0 ? i - 1 : null)
        } else {
          setActiveDraftIdx(i => i !== null && i < drafts.length - 1 ? i + 1 : i)
        }
        return
      }

      if (e.key === 'Escape') {
        setActiveDraftIdx(null)
        return
      }

      if (e.key === 'Enter') {
        const draft = drafts[activeDraftIdx]
        if (draft && draft.extracted_text.trim()) {
          saveDraftMutation.mutate(draft)
        }
        return
      }

      if (e.key === 'i' || e.key === 'I') {
        setDrafts(prev => prev.map((d, i) => i === activeDraftIdx
          ? { ...d, interpretation_flag: !d.interpretation_flag }
          : d
        ))
        return
      }

      const levels: ConfidenceLevel[] = ['low', 'medium', 'high']
      if (['1', '2', '3'].includes(e.key) && !e.shiftKey) {
        const lvl = levels[parseInt(e.key) - 1]
        setDrafts(prev => prev.map((d, i) => i === activeDraftIdx
          ? { ...d, content_confidence: lvl }
          : d
        ))
        return
      }
      if (['1', '2', '3'].includes(e.key) && e.shiftKey) {
        const lvl = levels[parseInt(e.key) - 1]
        setDrafts(prev => prev.map((d, i) => i === activeDraftIdx
          ? { ...d, source_confidence: lvl }
          : d
        ))
        return
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activeDraftIdx, drafts, saveDraftMutation])

  // Click-to-claim sentence handler
  const handleSentenceClick = useCallback((sentence: string) => {
    if (extractedSentences.has(sentence)) return

    setFlashSentence(sentence)
    setTimeout(() => setFlashSentence(null), 400)

    const draft = defaultDraft(sentence)
    setDrafts(prev => {
      setActiveDraftIdx(prev.length) // point to the just-added draft
      return [...prev, draft]
    })
    // scroll right panel to new draft
    setTimeout(() => {
      document.getElementById(`draft-${draft.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 50)
  }, [extractedSentences])

  const sentences = splitIntoSentences(submission.raw_text)

  const noveltyFlags = (submission.novelty_flags ?? []) as NoveltyFlag[]
  const priorityLevel = submission.priority_level ?? 'medium'
  const priorityScore = submission.priority_score ?? 0
  const hasDuplicate = (submission.duplicate_similarity ?? 0) > 0.75

  return (
    <div className="flex flex-col lg:h-full">
      {/* Zone 1: Context bar */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 px-4 py-2 bg-white border-b border-slate-200 text-xs">
        <div className="flex items-center gap-3 flex-wrap">
          <PriorityBadge level={priorityLevel} score={priorityScore} />
          {noveltyFlags.length > 0 && (
            <span className="text-slate-500">{noveltyFlags.length} novelty flag{noveltyFlags.length !== 1 ? 's' : ''}</span>
          )}
          {noveltyFlags.filter(f => f.type === 'corroboration').length > 0 && (
            <span className="text-blue-600">{noveltyFlags.filter(f => f.type === 'corroboration').length} corroboration{noveltyFlags.filter(f => f.type === 'corroboration').length !== 1 ? 's' : ''}</span>
          )}
          {queuePosition !== undefined && queueTotal !== undefined && (
            <span className="text-slate-400">
              Submission {queuePosition} of {queueTotal} untriaged
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/cases/${caseId}/submissions`}
            className="flex items-center gap-1 text-slate-500 hover:text-slate-700"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to queue
          </Link>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => completeReviewMutation.mutate()}
            disabled={completeReviewMutation.isPending}
          >
            Complete review
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Restore draft offer */}
      {draftRestoreOffered && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-amber-800">You have an unsaved draft for this submission.</span>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={restoreDraft}>
            Restore draft
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-slate-400"
            onClick={() => {
              localStorage.removeItem(DRAFT_KEY(submission.id))
              setDraftRestoreOffered(false)
            }}
          >
            Discard
          </Button>
        </div>
      )}

      {/* Main two-panel layout */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-auto lg:overflow-hidden min-h-0">

        {/* Zone 2: Left panel — original submission */}
        <div className="w-full lg:w-2/5 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 lg:min-h-0 lg:overflow-hidden">
          <div className="flex-shrink-0 px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h3 className="font-semibold text-slate-800 text-sm">Original submission — read only</h3>
            <p className="text-xs text-slate-400 mt-0.5">Click any sentence to extract as a claim</p>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">

              {/* Duplicate warning */}
              {hasDuplicate && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">
                      High similarity to another submission ({Math.round((submission.duplicate_similarity ?? 0) * 100)}% similar) — possible duplicate
                    </p>
                    {submission.duplicate_of_submission_id && (
                      <Link
                        href={`/cases/${caseId}/submissions/${submission.duplicate_of_submission_id}`}
                        className="text-amber-700 underline mt-0.5 inline-block"
                      >
                        View similar submission
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {/* Novelty flags */}
              {noveltyFlags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {noveltyFlags.map((flag, i) => (
                    <NoveltyChip key={i} flag={flag} />
                  ))}
                </div>
              )}

              {/* Click-to-claim raw text */}
              <div>
                <Label className="text-xs text-slate-500 uppercase tracking-wide mb-2 block">
                  Reported statement
                </Label>
                <div className="font-mono text-sm text-slate-800 bg-slate-50 rounded-md p-3 border border-slate-200 leading-relaxed">
                  {sentences.length > 0 ? (
                    sentences.map((sentence, i) => {
                      const isExtracted = extractedSentences.has(sentence)
                      const isFlashing = flashSentence === sentence
                      return (
                        <span
                          key={i}
                          onClick={() => handleSentenceClick(sentence)}
                          className={[
                            'cursor-pointer rounded transition-colors duration-150',
                            isFlashing ? 'bg-indigo-100' : '',
                            isExtracted
                              ? 'underline decoration-green-400 decoration-2'
                              : 'hover:bg-indigo-50',
                          ].join(' ')}
                          title={isExtracted ? 'Already extracted' : 'Click to extract as a claim'}
                        >
                          {sentence}{' '}
                        </span>
                      )
                    })
                  ) : (
                    <span>{submission.raw_text}</span>
                  )}
                </div>
              </div>

              {/* Metadata */}
              <div className="space-y-1 text-xs text-slate-600 bg-white rounded border border-slate-100 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-20">Received:</span>
                  <span>{formatDate(submission.intake_date, true)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-20">Mode:</span>
                  <span>{labelForObservationMode(submission.observation_mode)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-20">Consent:</span>
                  <span className="capitalize">{submission.submitter_consent}</span>
                </div>
                {submission.firsthand && (
                  <div className="flex items-center gap-1 text-slate-700">
                    <User className="h-3 w-3" />
                    <span>Firsthand account</span>
                  </div>
                )}
                {submission.event_date && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 w-20">Event date:</span>
                    <span>{formatDate(submission.event_date)}{submission.event_date_precision !== 'exact' && ` (${submission.event_date_precision})`}</span>
                  </div>
                )}
                {submission.event_location && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 w-20">Location:</span>
                    <span>{submission.event_location}</span>
                  </div>
                )}
              </div>

              {/* Step 6 entities */}
              {submission.step6Entities && submission.step6Entities.length > 0 && (
                <div>
                  <Label className="text-xs text-slate-500 uppercase tracking-wide mb-2 block">
                    Identifiers submitted by source
                  </Label>
                  <div className="space-y-1.5">
                    {submission.step6Entities.map((entity) => (
                      <div key={entity.id} className="flex items-center gap-2 text-xs bg-white rounded border border-slate-200 p-2">
                        <Badge variant="outline" className="text-[10px]">
                          {labelForEntityType(entity.entity_type)}
                        </Badge>
                        <span className="font-mono text-slate-700">{entity.raw_value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Interpretation callout */}
              {submission.interpretation_text && (
                <div>
                  <div className="flex items-center gap-2 mb-1.5 p-2.5 bg-amber-50 border-2 border-dashed border-amber-300 rounded-md">
                    <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                        Submitter&apos;s interpretation — not factual evidence
                      </p>
                      <p className="text-sm text-amber-800 italic mt-1">
                        {submission.interpretation_text}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Files */}
              {submission.files && submission.files.length > 0 && (
                <div>
                  <Label className="text-xs text-slate-500 uppercase tracking-wide mb-2 block">
                    Attached files
                  </Label>
                  <div className="space-y-1">
                    {submission.files.map((file) => (
                      <div key={file.id} className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 rounded p-2 border border-slate-200">
                        <Paperclip className="h-3.5 w-3.5 text-slate-400" />
                        {file.file_name}
                        {file.file_type && <span className="text-slate-400">({file.file_type})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Cross-references: offender overlaps + DOE remains matches */}
          <div className="flex-shrink-0 border-t border-slate-200 overflow-y-auto max-h-96 lg:max-h-72">
            <SubmissionLinksPanel submissionId={submission.id} caseId={caseId} />
          </div>
        </div>

        {/* Zone 3: Right panel — claim extraction workspace */}
        <div className="flex-1 flex flex-col lg:min-h-0 lg:overflow-hidden">
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
            <h3 className="font-semibold text-slate-800 text-sm">
              Claim extraction workspace
              {claims && claims.length > 0 && (
                <span className="ml-2 text-slate-400 font-normal text-xs">({claims.length} saved)</span>
              )}
              {drafts.filter(d => !d.savedId).length > 0 && (
                <span className="ml-1 text-amber-600 font-normal text-xs">
                  ({drafts.filter(d => !d.savedId).length} unsaved)
                </span>
              )}
            </h3>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-slate-400"
                onClick={() => setShortcutsOpen(v => !v)}
              >
                <Keyboard className="h-3.5 w-3.5" />
                Shortcuts
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  const draft = defaultDraft()
                  setDrafts(prev => [...prev, draft])
                  setActiveDraftIdx(drafts.length)
                  setTimeout(() => {
                    document.getElementById(`draft-${draft.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                  }, 50)
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add claim
              </Button>
            </div>
          </div>

          {/* Keyboard shortcut reference card */}
          {shortcutsOpen && (
            <div className="flex-shrink-0 bg-slate-900 text-slate-300 text-xs p-3 grid grid-cols-2 gap-x-6 gap-y-1">
              <div><kbd className="bg-slate-700 px-1 rounded">Tab</kbd> Next claim</div>
              <div><kbd className="bg-slate-700 px-1 rounded">Shift+Tab</kbd> Prev claim</div>
              <div><kbd className="bg-slate-700 px-1 rounded">Enter</kbd> Save focused claim</div>
              <div><kbd className="bg-slate-700 px-1 rounded">I</kbd> Toggle interpretation flag</div>
              <div><kbd className="bg-slate-700 px-1 rounded">1/2/3</kbd> Set claim certainty low/medium/high</div>
              <div><kbd className="bg-slate-700 px-1 rounded">Shift+1/2/3</kbd> Set source reliability low/medium/high</div>
              <div><kbd className="bg-slate-700 px-1 rounded">Escape</kbd> Unfocus claim</div>
            </div>
          )}

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {claimsLoading ? (
                <p className="text-sm text-slate-400">Loading claims...</p>
              ) : null}

              {/* Saved claims */}
              {(claims ?? []).map((claim) => {
                const epistemicType = getEpistemicType(
                  claim.verification_status,
                  claim.claim_type,
                  claim.interpretation_flag
                )
                const linkedEntities = (claim as unknown as { claim_entity_links?: Array<{ entity?: { id: string; entity_type: string; normalized_value?: string | null; raw_value: string } }> }).claim_entity_links ?? []

                return (
                  <Card key={claim.id} className="border-green-100 bg-green-50/30">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <EpistemicBadge type={epistemicType} />
                          <Badge variant="outline" className="text-xs">
                            {labelForClaimType(claim.claim_type)}
                          </Badge>
                          {claim.interpretation_flag && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                              <AlertTriangle className="h-3 w-3" />
                              INTERPRETATION
                            </span>
                          )}
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 ml-1" />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-slate-300 hover:text-red-400 flex-shrink-0"
                          onClick={() => deleteClaimMutation.mutate(claim.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p className="text-xs text-slate-700 bg-white rounded p-2 border border-slate-100 font-mono leading-relaxed mb-2">
                        &ldquo;{claim.extracted_text}&rdquo;
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap mb-1.5">
                        <span>Source: <strong className="text-slate-700">{claim.source_confidence}</strong></span>
                        <span>Certainty: <strong className="text-slate-700">{claim.content_confidence}</strong></span>
                      </div>
                      {linkedEntities.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {linkedEntities.map((link, li) => {
                            const entity = link.entity
                            if (!entity) return null
                            return (
                              <span key={li} className="inline-flex items-center gap-1 text-[11px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 border border-slate-200">
                                <span className="text-slate-400">{labelForEntityType(entity.entity_type)}</span>
                                <span className="font-medium">{entity.normalized_value ?? entity.raw_value}</span>
                              </span>
                            )
                          })}
                        </div>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setLinkingClaimId(claim.id)}
                      >
                        <Link2 className="h-3 w-3" />
                        Link entity
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}

              {/* Draft claim cards */}
              {drafts.map((draft, idx) => {
                if (draft.savedId) return null // already saved, shown above
                const isActive = activeDraftIdx === idx
                const isInterpretation = preflaggerInterpretation(draft.extracted_text)
                const hasVehicle = detectVehicleInText(draft.extracted_text).length > 0
                const hasPhone = detectPhonesInText(draft.extracted_text).length > 0

                return (
                  <Card
                    id={`draft-${draft.id}`}
                    key={draft.id}
                    className={`border-2 transition-all ${
                      isActive ? 'border-indigo-300 shadow-sm' : 'border-indigo-100'
                    } bg-indigo-50/20`}
                    onClick={() => setActiveDraftIdx(idx)}
                  >
                    <CardContent className="p-3 space-y-2.5">
                      {/* Auto-assist pills */}
                      <div className="flex flex-wrap gap-1 min-h-[18px]">
                        {isInterpretation && (
                          <span className="text-[11px] bg-amber-100 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
                            Interpretation detected — verify
                          </span>
                        )}
                        {hasVehicle && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] bg-blue-100 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">
                            <Car className="h-3 w-3" />
                            Vehicle mentioned
                          </span>
                        )}
                        {hasPhone && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] bg-blue-100 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">
                            <Phone className="h-3 w-3" />
                            Phone number detected
                          </span>
                        )}
                      </div>

                      {/* Extracted text */}
                      <div>
                        <Label className="text-[11px] text-slate-500 mb-1 block">Extracted text *</Label>
                        <Textarea
                          value={draft.extracted_text}
                          onChange={e => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, extracted_text: e.target.value } : d))}
                          className="text-xs min-h-[60px] font-mono"
                          placeholder="The exact text from the submission…"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {/* Claim type */}
                        <div>
                          <Label className="text-[11px] text-slate-500 mb-1 block">Claim type</Label>
                          <Select
                            value={draft.claim_type}
                            onValueChange={v => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, claim_type: v as ClaimType } : d))}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CLAIM_TYPES.map(ct => (
                                <SelectItem key={ct} value={ct}>{labelForClaimType(ct)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Event date */}
                        <div>
                          <Label className="text-[11px] text-slate-500 mb-1 block">Event date (optional)</Label>
                          <Input
                            type="date"
                            value={draft.event_date}
                            onChange={e => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, event_date: e.target.value } : d))}
                            className="h-7 text-xs"
                          />
                        </div>
                      </div>

                      {/* Two separate confidence selectors */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[11px] text-slate-500 mb-1 block">Source reliability</Label>
                          <Select
                            value={draft.source_confidence}
                            onValueChange={v => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, source_confidence: v as ConfidenceLevel } : d))}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[11px] text-slate-500 mb-1 block">Claim certainty</Label>
                          <Select
                            value={draft.content_confidence}
                            onValueChange={v => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, content_confidence: v as ConfidenceLevel } : d))}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Interpretation flag */}
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`interp-${draft.id}`}
                          checked={draft.interpretation_flag}
                          onCheckedChange={checked => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, interpretation_flag: !!checked } : d))}
                        />
                        <Label htmlFor={`interp-${draft.id}`} className="text-xs cursor-pointer">
                          Interpretation, not a direct observation
                        </Label>
                      </div>

                      {/* Behavioral category (collapsible if type is behavioral) */}
                      {draft.claim_type === 'behavioral' && (
                        <div>
                          <Label className="text-[11px] text-slate-500 mb-1 block">Behavioral category</Label>
                          <Select
                            value={draft.behavioral_category}
                            onValueChange={v => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, behavioral_category: v } : d))}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                              {BEHAVIORAL_CATEGORIES.map(bc => (
                                <SelectItem key={bc.value} value={bc.value}>{bc.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Notes (collapsible) */}
                      <div>
                        <button
                          className="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-1"
                          onClick={() => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, notesOpen: !d.notesOpen } : d))}
                        >
                          {draft.notesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          Notes
                        </button>
                        {draft.notesOpen && (
                          <Textarea
                            value={draft.notes}
                            onChange={e => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, notes: e.target.value } : d))}
                            className="mt-1 text-xs min-h-[50px]"
                            placeholder="Analyst notes…"
                          />
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-1 border-t border-indigo-100">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => saveDraftMutation.mutate(draft)}
                          disabled={!draft.extracted_text.trim() || saveDraftMutation.isPending}
                        >
                          {saveDraftMutation.isPending ? 'Saving…' : 'Save claim'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-slate-400"
                          onClick={() => {
                            setDrafts(prev => prev.filter((_, i) => i !== idx))
                            if (activeDraftIdx === idx) setActiveDraftIdx(null)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}

              {!claimsLoading && (claims?.length ?? 0) === 0 && drafts.length === 0 && (
                <div className="text-center py-10 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-lg">
                  <p className="font-medium text-slate-500">No claims yet</p>
                  <p className="text-xs mt-1">Click sentences in the left panel to extract claims, or use &ldquo;Add claim&rdquo;.</p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Zone 4: Entity tray */}
          <div className="flex-shrink-0 border-t border-slate-200 bg-white">
            <button
              className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              onClick={() => setEntityTrayOpen(v => !v)}
            >
              <span>
                Entities detected across this submission
                {entitySuggestions.filter(s => s.status === 'pending').length > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white px-1">
                    {entitySuggestions.filter(s => s.status === 'pending').length}
                  </span>
                )}
              </span>
              {entityTrayOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </button>

            {entityTrayOpen && (
              <div className="px-4 pb-3 max-h-48 overflow-y-auto">
                {entitySuggestions.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">No entities detected.</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-slate-400">
                        From submitted identifiers, auto-detected vehicles, and phone numbers.
                      </p>
                      {entitySuggestions.some(s => s.status === 'pending') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px]"
                          onClick={() => {
                            entitySuggestions
                              .filter(s => s.status === 'pending')
                              .forEach(s => acceptEntityMutation.mutate(s))
                          }}
                        >
                          Accept all suggested
                        </Button>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {entitySuggestions.map((suggestion, si) => (
                        <div
                          key={si}
                          className={`flex items-center gap-2 p-2 rounded border text-xs ${
                            suggestion.status === 'accepted'
                              ? 'bg-green-50 border-green-200 opacity-70'
                              : suggestion.status === 'rejected'
                              ? 'opacity-40 border-slate-100'
                              : 'bg-white border-slate-200'
                          }`}
                        >
                          {suggestion.source === 'vehicle' && <Car className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />}
                          {suggestion.source === 'phone' && <Phone className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />}
                          {suggestion.source === 'step6' && (
                            <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-1 flex-shrink-0">
                              {labelForEntityType(suggestion.entity_type)}
                            </span>
                          )}
                          <span className="font-mono text-slate-700 flex-1">{suggestion.raw_value}</span>
                          {suggestion.existsInCase && (
                            <span className="text-[10px] text-green-600 font-medium">Already in case</span>
                          )}
                          {suggestion.status === 'accepted' && (
                            <span className="text-[10px] text-green-600 font-medium flex items-center gap-0.5">
                              <CheckCircle2 className="h-3 w-3" />
                              Accepted
                            </span>
                          )}
                          {suggestion.status === 'pending' && (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-5 text-[10px] px-1.5"
                                onClick={() => acceptEntityMutation.mutate(suggestion)}
                                disabled={acceptEntityMutation.isPending}
                              >
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 text-[10px] px-1.5 text-slate-400"
                                onClick={() => setEntitySuggestions(prev =>
                                  prev.map((s, i) => i === si ? { ...s, status: 'rejected' } : s)
                                )}
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Bottom action bar */}
          <div className="flex-shrink-0 border-t border-slate-200 bg-white p-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <Label className="text-xs text-slate-600 whitespace-nowrap">Status:</Label>
                <Select
                  value={reviewStatus}
                  onValueChange={(v) => setReviewStatus(v as typeof reviewStatus)}
                >
                  <SelectTrigger className="h-7 text-xs w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unverified">Unverified</SelectItem>
                    <SelectItem value="under_review">Under review</SelectItem>
                    <SelectItem value="corroborated">Corroborated</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="disputed">Disputed</SelectItem>
                    <SelectItem value="retracted">Retracted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                placeholder="Review notes…"
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                className="text-xs min-h-[32px] h-8 resize-none flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs whitespace-nowrap"
                onClick={() => saveReviewMutation.mutate()}
                disabled={saveReviewMutation.isPending}
              >
                Save progress
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs whitespace-nowrap"
                onClick={() => completeReviewMutation.mutate()}
                disabled={completeReviewMutation.isPending}
              >
                Complete review
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Entity link modal */}
      {linkingClaimId && (
        <EntityLinkModal
          claimId={linkingClaimId}
          caseId={caseId}
          onClose={() => {
            setLinkingClaimId(null)
            queryClient.invalidateQueries({ queryKey: ['claims', submission.id] })
          }}
        />
      )}
    </div>
  )
}
