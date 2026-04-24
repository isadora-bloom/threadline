'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Send,
  Shield,
  Phone,
  Mail,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Plus,
  ChevronDown,
  ChevronUp,
  FileText,
  Sparkles,
  Loader2,
} from 'lucide-react'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  draft:          { label: 'Draft',           color: 'bg-slate-100 text-slate-600',    icon: FileText },
  ready:          { label: 'Ready to send',   color: 'bg-blue-100 text-blue-700',      icon: Send },
  submitted:      { label: 'Submitted',       color: 'bg-indigo-100 text-indigo-700',  icon: Send },
  acknowledged:   { label: 'Acknowledged',    color: 'bg-green-100 text-green-700',    icon: CheckCircle },
  under_review:   { label: 'Under review',    color: 'bg-amber-100 text-amber-700',    icon: Clock },
  action_taken:   { label: 'Action taken',    color: 'bg-green-200 text-green-800',    icon: CheckCircle },
  declined:       { label: 'Declined',        color: 'bg-red-100 text-red-700',        icon: XCircle },
  no_response:    { label: 'No response',     color: 'bg-slate-200 text-slate-600',    icon: Clock },
}

export function CaseHandoff({ recordId, personName }: { recordId: string; personName: string | null }) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [aiDrafting, setAiDrafting] = useState(false)

  // Form state
  const [agencyName, setAgencyName] = useState('')
  const [agencyType, setAgencyType] = useState('local_police')
  const [agencyContact, setAgencyContact] = useState('')
  const [agencyJurisdiction, setAgencyJurisdiction] = useState('')
  const [tipLine, setTipLine] = useState('')
  const [customSummary, setCustomSummary] = useState('')

  // Fetch existing handoffs. Can't FK-embed user_profiles because case_handoffs.created_by
  // references auth.users, not user_profiles, so PostgREST has no relationship to traverse.
  const { data: handoffs } = useQuery({
    queryKey: ['handoffs', recordId],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from('case_handoffs')
        .select('*')
        .eq('import_record_id', recordId)
        .order('created_at', { ascending: false })

      const raw = rows ?? []
      const creatorIds = Array.from(
        new Set(raw.map((r) => r.created_by).filter((id): id is string => !!id))
      )

      let nameById = new Map<string, string | null>()
      if (creatorIds.length) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, full_name')
          .in('id', creatorIds)
        nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]))
      }

      return raw.map((r) => ({
        ...r,
        submitter: { full_name: r.created_by ? nameById.get(r.created_by) ?? null : null },
      }))
    },
  })

  const createHandoff = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      await supabase.from('case_handoffs').insert({
        import_record_id: recordId,
        agency_name: agencyName,
        agency_type: agencyType,
        agency_contact: agencyContact || null,
        agency_jurisdiction: agencyJurisdiction || null,
        tip_line: tipLine || null,
        custom_summary: customSummary || null,
        status: 'draft',
        created_by: user.id,
      })
    },
    onSuccess: () => {
      setShowForm(false)
      setAgencyName('')
      setAgencyContact('')
      setAgencyJurisdiction('')
      setTipLine('')
      setCustomSummary('')
      queryClient.invalidateQueries({ queryKey: ['handoffs', recordId] })
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, response, declinedReason }: {
      id: string; status: string; response?: string; declinedReason?: string
    }) => {
      const update: Record<string, unknown> = { status }
      if (status === 'submitted') update.submitted_at = new Date().toISOString()
      if (response) { update.le_response = response; update.le_response_at = new Date().toISOString() }
      if (declinedReason) update.le_declined_reason = declinedReason

      await supabase.from('case_handoffs').update(update).eq('id', id)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['handoffs', recordId] }),
  })

  const hasHandoffs = handoffs && handoffs.length > 0
  const latestHandoff = handoffs?.[0]
  const isDeclined = latestHandoff?.status === 'declined'

  return (
    <Card className={isDeclined ? 'border-red-200' : hasHandoffs ? 'border-blue-200' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Law Enforcement Handoff
          </CardTitle>
          {hasHandoffs && (
            <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-slate-600">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status alert — visible to ALL watchers */}
        {isDeclined && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-semibold text-red-800">Law enforcement declined this submission</span>
            </div>
            <p className="text-xs text-red-700">
              {latestHandoff.le_declined_reason && <><strong>Reason:</strong> {latestHandoff.le_declined_reason}. </>}
              {latestHandoff.le_response && <>{latestHandoff.le_response}</>}
            </p>
            <p className="text-xs text-red-600 mt-1">
              Submitted to {latestHandoff.agency_name} by {(latestHandoff.submitter as { full_name: string | null })?.full_name ?? 'a user'} on {new Date(latestHandoff.submitted_at).toLocaleDateString()}.
            </p>
          </div>
        )}

        {latestHandoff && latestHandoff.status === 'action_taken' && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm font-semibold text-green-800">Law enforcement took action</span>
            </div>
            {latestHandoff.le_response && <p className="text-xs text-green-700">{latestHandoff.le_response}</p>}
            {latestHandoff.reference_number && <p className="text-xs text-green-600 mt-1">Reference: {latestHandoff.reference_number}</p>}
          </div>
        )}

        {latestHandoff && !['declined', 'action_taken'].includes(latestHandoff.status) && (
          <div className="flex items-center gap-2">
            <Badge className={STATUS_CONFIG[latestHandoff.status]?.color ?? ''}>
              {STATUS_CONFIG[latestHandoff.status]?.label ?? latestHandoff.status}
            </Badge>
            <span className="text-xs text-slate-500">
              {latestHandoff.agency_name}
              {latestHandoff.submitted_at && ` — submitted ${new Date(latestHandoff.submitted_at).toLocaleDateString()}`}
            </span>
          </div>
        )}

        {/* Expanded details */}
        {expanded && handoffs && handoffs.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            {handoffs.map((h) => {
              const config = STATUS_CONFIG[h.status] ?? STATUS_CONFIG.draft
              return (
                <div key={h.id} className="p-3 bg-slate-50 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge className={config.color}>{config.label}</Badge>
                      <span className="text-xs font-medium text-slate-700">{h.agency_name}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">{new Date(h.created_at).toLocaleDateString()}</span>
                  </div>

                  {h.agency_contact && <p className="text-xs text-slate-600"><Phone className="h-3 w-3 inline mr-1" />{h.agency_contact}</p>}
                  {h.tip_line && <p className="text-xs text-slate-600">Tip line: {h.tip_line}</p>}
                  {h.custom_summary && <p className="text-xs text-slate-700 italic">{h.custom_summary}</p>}
                  {h.le_response && <p className="text-xs text-slate-700 bg-white p-2 rounded border">LE Response: {h.le_response}</p>}
                  {h.reference_number && <p className="text-xs text-slate-500">Ref #: {h.reference_number}</p>}

                  {/* Status update buttons */}
                  {h.status === 'draft' && (
                    <div className="flex gap-2">
                      <Button size="sm" className="h-6 text-[10px]"
                        onClick={() => updateStatus.mutate({ id: h.id, status: 'submitted' })}>
                        Mark as submitted
                      </Button>
                    </div>
                  )}
                  {h.status === 'submitted' && (
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" className="h-6 text-[10px]"
                        onClick={() => updateStatus.mutate({ id: h.id, status: 'acknowledged' })}>
                        Acknowledged
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px]"
                        onClick={() => updateStatus.mutate({ id: h.id, status: 'no_response' })}>
                        No response
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] text-red-600"
                        onClick={() => {
                          const reason = prompt('Why did they decline?')
                          if (reason) updateStatus.mutate({ id: h.id, status: 'declined', declinedReason: reason })
                        }}>
                        Declined
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] text-green-600"
                        onClick={() => updateStatus.mutate({ id: h.id, status: 'action_taken' })}>
                        Action taken
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Create new handoff */}
        {!showForm ? (
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setShowForm(true)}>
            <Plus className="h-3 w-3" />
            {hasHandoffs ? 'Submit to another agency' : 'Prepare law enforcement submission'}
          </Button>
        ) : (
          <div className="space-y-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
            <h4 className="text-xs font-semibold text-indigo-900">Which agency should receive this?</h4>

            <Input
              placeholder="Agency name (e.g. Salt Lake City Police)"
              value={agencyName}
              onChange={e => setAgencyName(e.target.value)}
              className="text-sm"
            />

            <Select value={agencyType} onValueChange={setAgencyType}>
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local_police">Local Police</SelectItem>
                <SelectItem value="sheriff">Sheriff&apos;s Office</SelectItem>
                <SelectItem value="state_police">State Police</SelectItem>
                <SelectItem value="fbi">FBI</SelectItem>
                <SelectItem value="medical_examiner">Medical Examiner</SelectItem>
                <SelectItem value="district_attorney">District Attorney</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="Contact (phone, email, or address)"
              value={agencyContact}
              onChange={e => setAgencyContact(e.target.value)}
              className="text-sm"
            />

            <Input
              placeholder="Jurisdiction (e.g. Salt Lake City, Utah)"
              value={agencyJurisdiction}
              onChange={e => setAgencyJurisdiction(e.target.value)}
              className="text-sm"
            />

            <Input
              placeholder="Tip line number (if different)"
              value={tipLine}
              onChange={e => setTipLine(e.target.value)}
              className="text-sm"
            />

            <Textarea
              placeholder="Summary of what you want to tell them — what match did you find, what pattern, why it matters..."
              value={customSummary}
              onChange={e => setCustomSummary(e.target.value)}
              rows={3}
              className="text-sm"
            />

            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded p-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-700">
                Be professional and specific. State facts, not theories. Reference the NamUs/Doe Network case numbers.
                Let law enforcement draw conclusions — your job is to surface the connection, not solve the case.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-indigo-200 text-indigo-700"
                disabled={aiDrafting}
                onClick={async () => {
                  setAiDrafting(true)
                  try {
                    const res = await fetch('/api/deep-research', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ importRecordId: recordId, researchType: 'full' }),
                    })
                    if (res.ok) {
                      const data = await res.json()
                      const summary = data.summary ?? data.findings?.executive_summary ?? ''
                      const steps = (data.findings?.next_steps ?? []).map((s: { action?: string }) => s.action).filter(Boolean).join('\n- ')
                      const connections = (data.findings?.connections ?? []).slice(0, 3).map((c: { name?: string; reasoning?: string }) => `${c.name}: ${c.reasoning}`).join('\n')

                      setCustomSummary(
                        `Re: ${personName ?? 'Case'}\n\n` +
                        `${summary}\n\n` +
                        (connections ? `Possible connections identified:\n${connections}\n\n` : '') +
                        (steps ? `Suggested investigative steps:\n- ${steps}\n\n` : '') +
                        `This information was surfaced by Threadline (threadline.app), a case intelligence platform that cross-references NamUs, Doe Network, and Charley Project records. ` +
                        `All matches are statistical — confirmation requires forensic verification.`
                      )
                    }
                  } catch { /* silent */ }
                  finally { setAiDrafting(false) }
                }}
              >
                {aiDrafting ? <><Loader2 className="h-3 w-3 animate-spin" /> Drafting...</> : <><Sparkles className="h-3 w-3" /> AI Draft</>}
              </Button>
              <Button
                size="sm"
                onClick={() => createHandoff.mutate()}
                disabled={!agencyName.trim() || createHandoff.isPending}
              >
                <Send className="h-3 w-3" />
                Create submission
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
