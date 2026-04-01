'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { QuickWatch } from '@/components/registry/QuickWatch'
import {
  Fingerprint,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Loader2,
  Sparkles,
  ExternalLink,
  MapPin,
  Calendar,
  User,
} from 'lucide-react'

interface TattooMatchItem {
  id: string
  title: string
  summary: string
  priority_score: number
  status: string
  reviewer_note: string | null
  ai_reasoning: string | null
  details: {
    type: string
    missing_submission_id: string
    unidentified_submission_id: string
    shared_keywords: string[]
    location_match: boolean
    strength: string
    missing_mark: string
    unidentified_mark: string
  }
}

interface SubmissionDetail {
  raw_text: string
  name: string | null
  sex: string | null
  age: string | null
  race: string | null
  location: string | null
  date: string | null
  marks: string | null
  circumstances: string | null
}

function parseSubmissionText(rawText: string): SubmissionDetail {
  const get = (field: string) => rawText.match(new RegExp(`^${field}:\\s*(.+)$`, 'mi'))?.[1]?.trim() ?? null
  return {
    raw_text: rawText,
    name: get('Name'),
    sex: get('Sex'),
    age: get('Age'),
    race: get('Race/Ethnicity') ?? get('Race'),
    location: get('Last Seen') ?? get('Location Found'),
    date: get('Date Missing') ?? get('Date Found'),
    marks: get('Distinguishing Marks'),
    circumstances: get('Circumstances'),
  }
}

export function TattooMatchCard({
  item,
  missingCaseId,
  onStatusChange,
}: {
  item: TattooMatchItem
  missingCaseId: string
  onStatusChange: () => void
}) {
  const supabase = createClient()
  const [expanded, setExpanded] = useState(false)
  const [missingDetail, setMissingDetail] = useState<SubmissionDetail | null>(null)
  const [unidentifiedDetail, setUnidentifiedDetail] = useState<SubmissionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<string | null>(item.ai_reasoning)
  const [reviewLoading, setReviewLoading] = useState(false)

  const details = item.details
  const score = item.priority_score
  const locMatch = details.location_match

  const loadDetails = useCallback(async () => {
    if (missingDetail) return // already loaded
    setLoading(true)
    try {
      const [missingRes, uidRes] = await Promise.all([
        fetch(`/api/pattern/doe-match?missingCaseId=${missingCaseId}&type=submission&submissionId=${details.missing_submission_id}`),
        fetch(`/api/pattern/doe-match?missingCaseId=${missingCaseId}&type=submission&submissionId=${details.unidentified_submission_id}`),
      ])
      const [missingData, uidData] = await Promise.all([missingRes.json(), uidRes.json()])
      setMissingDetail(parseSubmissionText(missingData.raw_text ?? ''))
      setUnidentifiedDetail(parseSubmissionText(uidData.raw_text ?? ''))
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [missingCaseId, details.missing_submission_id, details.unidentified_submission_id, missingDetail])

  const toggleExpand = () => {
    const next = !expanded
    setExpanded(next)
    if (next) loadDetails()
  }

  const handleReview = async (status: 'reviewing' | 'actioned' | 'dismissed') => {
    setReviewLoading(true)
    await supabase
      .from('intelligence_queue')
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq('id', item.id)
    setReviewLoading(false)
    onStatusChange()
  }

  const runAiReview = async () => {
    setAiLoading(true)
    try {
      // Fetch both submission texts for AI
      const [missingRes, uidRes] = await Promise.all([
        fetch(`/api/pattern/doe-match?missingCaseId=${missingCaseId}&type=submission&submissionId=${details.missing_submission_id}`),
        fetch(`/api/pattern/doe-match?missingCaseId=${missingCaseId}&type=submission&submissionId=${details.unidentified_submission_id}`),
      ])
      const [mData, uData] = await Promise.all([missingRes.json(), uidRes.json()])

      // Call AI review endpoint
      const res = await fetch('/api/pattern/doe-match/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tattooReview: true,
          missingText: mData.raw_text ?? '',
          unidentifiedText: uData.raw_text ?? '',
          sharedKeywords: details.shared_keywords,
          locationMatch: details.location_match,
          queueItemId: item.id,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const reasoning = data.assessment?.summary ?? 'AI review complete'
        setAiResult(reasoning)
        // Store in queue item
        await supabase
          .from('intelligence_queue')
          .update({ ai_reasoning: reasoning })
          .eq('id', item.id)
      }
    } catch {
      setAiResult('AI review failed')
    } finally {
      setAiLoading(false)
    }
  }

  const isReviewed = item.status !== 'new'

  return (
    <div className={`rounded-lg border transition-all ${
      isReviewed
        ? item.status === 'actioned' ? 'border-green-200 bg-green-50/50' : 'border-slate-200 bg-slate-50/50 opacity-60'
        : locMatch ? 'border-purple-300 bg-white' : 'border-slate-200 bg-white'
    }`}>
      {/* Header — always visible, clickable to expand */}
      <button
        onClick={toggleExpand}
        className="w-full p-3 text-left flex items-start gap-3"
      >
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold ${
            score >= 80 ? 'bg-purple-200 text-purple-900' :
            score >= 60 ? 'bg-amber-200 text-amber-900' :
            'bg-slate-200 text-slate-700'
          }`}>
            {score}
          </span>
          {locMatch && (
            <span className="text-[8px] font-bold text-purple-600 leading-tight text-center">SAME<br/>LOCATION</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {details.shared_keywords.map((kw, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-purple-100 text-purple-800 text-[10px] font-medium rounded">
                {kw}
              </span>
            ))}
            {isReviewed && (
              <Badge className={`text-[10px] ${
                item.status === 'actioned' ? 'bg-green-100 text-green-700' :
                item.status === 'dismissed' ? 'bg-slate-100 text-slate-500' :
                'bg-blue-100 text-blue-700'
              }`}>
                {item.status}
              </Badge>
            )}
          </div>
          <h4 className="text-sm font-semibold text-slate-900">{item.title}</h4>
          <div className="grid grid-cols-2 gap-2 mt-1 text-[10px] text-slate-600">
            <div className="truncate"><span className="text-blue-600 font-medium">Missing:</span> {details.missing_mark.slice(0, 80)}</div>
            <div className="truncate"><span className="text-slate-400 font-medium">Unidentified:</span> {details.unidentified_mark.slice(0, 80)}</div>
          </div>
        </div>

        <div className="flex-shrink-0 mt-1">
          {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </div>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-slate-200 p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              <span className="text-sm text-slate-500 ml-2">Loading case details...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {/* Missing person */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold text-blue-600 uppercase tracking-wide">Missing Person</h5>
                  <QuickWatch submissionId={details.missing_submission_id} size="xs" />
                </div>
                {missingDetail && (
                  <>
                    <div className="space-y-1 text-xs">
                      {missingDetail.name && <div className="flex items-center gap-1"><User className="h-3 w-3 text-slate-400" /><span className="font-medium">{missingDetail.name}</span></div>}
                      <div className="flex items-center gap-2 text-slate-500">
                        {missingDetail.sex && <span>{missingDetail.sex}</span>}
                        {missingDetail.age && <span>Age {missingDetail.age}</span>}
                        {missingDetail.race && <span>{missingDetail.race}</span>}
                      </div>
                      {missingDetail.location && <div className="flex items-center gap-1 text-slate-500"><MapPin className="h-3 w-3" />{missingDetail.location}</div>}
                      {missingDetail.date && <div className="flex items-center gap-1 text-slate-500"><Calendar className="h-3 w-3" />{missingDetail.date}</div>}
                    </div>
                    {missingDetail.marks && (
                      <div className="p-2 bg-purple-50 rounded border border-purple-200">
                        <span className="text-[10px] font-bold text-purple-700 uppercase">Marks</span>
                        <p className="text-xs text-slate-700 mt-0.5">{missingDetail.marks}</p>
                      </div>
                    )}
                    {missingDetail.circumstances && (
                      <div className="p-2 bg-slate-50 rounded">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Circumstances</span>
                        <p className="text-xs text-slate-600 mt-0.5 line-clamp-4">{missingDetail.circumstances}</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Unidentified remains */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Unidentified Remains</h5>
                  <QuickWatch submissionId={details.unidentified_submission_id} size="xs" />
                </div>
                {unidentifiedDetail && (
                  <>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2 text-slate-500">
                        {unidentifiedDetail.sex && <span>{unidentifiedDetail.sex}</span>}
                        {unidentifiedDetail.age && <span>Age {unidentifiedDetail.age}</span>}
                        {unidentifiedDetail.race && <span>{unidentifiedDetail.race}</span>}
                      </div>
                      {unidentifiedDetail.location && <div className="flex items-center gap-1 text-slate-500"><MapPin className="h-3 w-3" />{unidentifiedDetail.location}</div>}
                      {unidentifiedDetail.date && <div className="flex items-center gap-1 text-slate-500"><Calendar className="h-3 w-3" />Found {unidentifiedDetail.date}</div>}
                    </div>
                    {unidentifiedDetail.marks && (
                      <div className="p-2 bg-purple-50 rounded border border-purple-200">
                        <span className="text-[10px] font-bold text-purple-700 uppercase">Marks</span>
                        <p className="text-xs text-slate-700 mt-0.5">{unidentifiedDetail.marks}</p>
                      </div>
                    )}
                    {unidentifiedDetail.circumstances && (
                      <div className="p-2 bg-slate-50 rounded">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Circumstances</span>
                        <p className="text-xs text-slate-600 mt-0.5 line-clamp-4">{unidentifiedDetail.circumstances}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* AI Review */}
          {aiResult && (
            <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <span className="text-[10px] font-bold text-indigo-700 uppercase">AI Assessment</span>
              <p className="text-xs text-indigo-900 mt-1">{aiResult}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-green-200 text-green-700 hover:bg-green-50"
              onClick={() => handleReview('actioned')}
              disabled={reviewLoading}
            >
              <CheckCircle className="h-3 w-3" />
              Worth investigating
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => handleReview('dismissed')}
              disabled={reviewLoading}
            >
              <XCircle className="h-3 w-3" />
              Dismiss
            </Button>
            {!aiResult && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                onClick={runAiReview}
                disabled={aiLoading}
              >
                {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                AI Review
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
