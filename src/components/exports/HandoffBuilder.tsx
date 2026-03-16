'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuditLog } from '@/hooks/useAuditLog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { EpistemicBadge, getEpistemicType } from '@/components/shared/EpistemicBadge'
import { useToast } from '@/components/ui/use-toast'
import {
  labelForClaimType,
  labelForEntityType,
  labelForReviewStatus,
  truncate,
  formatDate,
} from '@/lib/utils'
import { ChevronLeft, ChevronRight, Download, Shield, AlertTriangle } from 'lucide-react'
import type { RecipientType, ExportFormat } from '@/lib/types'
import { pdf } from '@react-pdf/renderer'
import { HandoffPDF } from './HandoffPDF'

interface HandoffBuilderProps {
  caseId: string
  caseTitle: string
}

interface HandoffState {
  step: number
  recipient_type: RecipientType
  recipient_name: string
  purpose: string
  selected_claim_ids: Set<string>
  selected_entity_ids: Set<string>
  case_summary: string
  methodology_note: string
  confidence_statement: string
}

const TOTAL_STEPS = 7

export function HandoffBuilder({ caseId, caseTitle }: HandoffBuilderProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { logAction } = useAuditLog()
  const { toast } = useToast()

  const [state, setState] = useState<HandoffState>({
    step: 1,
    recipient_type: 'law_enforcement',
    recipient_name: '',
    purpose: '',
    selected_claim_ids: new Set(),
    selected_entity_ids: new Set(),
    case_summary: '',
    methodology_note: '',
    confidence_statement: '',
  })

  const update = (updates: Partial<HandoffState>) => setState(prev => ({ ...prev, ...updates }))

  // Fetch verified/corroborated/confirmed claims
  const { data: verifiedClaims } = useQuery({
    queryKey: ['verified-claims', caseId],
    queryFn: async () => {
      const { data: subs } = await supabase
        .from('submissions')
        .select('id')
        .eq('case_id', caseId)

      if (!subs || subs.length === 0) return []

      const { data } = await supabase
        .from('claims')
        .select(`
          *,
          entities:claim_entity_links(
            entity_id,
            entity:entities(id, entity_type, raw_value, normalized_value)
          )
        `)
        .in('submission_id', subs.map(s => s.id))
        .in('verification_status', ['corroborated', 'confirmed', 'under_review'])
        .order('claim_type')

      return data ?? []
    },
  })

  // Derive entities from selected claims
  const derivedEntityIds = new Set<string>()
  if (verifiedClaims) {
    for (const claim of verifiedClaims) {
      if (state.selected_claim_ids.has(claim.id)) {
        const links = (claim as { entities?: Array<{ entity_id: string }> }).entities ?? []
        links.forEach(link => derivedEntityIds.add(link.entity_id))
      }
    }
  }

  const { data: derivedEntities } = useQuery({
    queryKey: ['derived-entities', Array.from(derivedEntityIds)],
    queryFn: async () => {
      if (derivedEntityIds.size === 0) return []
      const { data } = await supabase
        .from('entities')
        .select('*')
        .in('id', Array.from(derivedEntityIds))
      return data ?? []
    },
    enabled: derivedEntityIds.size > 0,
  })

  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const selectedClaims = verifiedClaims?.filter(c =>
        state.selected_claim_ids.has(c.id)
      ) ?? []
      const selectedEntities = derivedEntities?.filter(e =>
        state.selected_entity_ids.has(e.id) || derivedEntityIds.has(e.id)
      ) ?? []

      // Generate PDF
      const doc = (
        <HandoffPDF
          caseTitle={caseTitle}
          preparedBy={user.email ?? 'Unknown'}
          recipientName={state.recipient_name}
          recipientType={state.recipient_type}
          purpose={state.purpose}
          caseSummary={state.case_summary}
          methodologyNote={state.methodology_note}
          confidenceStatement={state.confidence_statement}
          claims={selectedClaims}
          entities={selectedEntities}
          exportDate={new Date().toISOString()}
        />
      )

      const blob = await pdf(doc).toBlob()

      // Upload to Supabase Storage
      const fileName = `exports/${caseId}/${Date.now()}-handoff.pdf`
      const { error: uploadError } = await supabase.storage
        .from('exports')
        .upload(fileName, blob, { contentType: 'application/pdf' })

      const storagePath = uploadError ? null : fileName

      // Create export record
      const { data: record, error: recordError } = await supabase
        .from('export_records')
        .insert({
          case_id: caseId,
          exported_by: user.id,
          scope: 'filtered',
          recipient: state.recipient_name,
          recipient_type: state.recipient_type,
          purpose: state.purpose,
          included_claim_ids: Array.from(state.selected_claim_ids),
          included_entity_ids: Array.from(state.selected_entity_ids),
          export_format: 'pdf' as ExportFormat,
          storage_path: storagePath,
        })
        .select()
        .single()

      if (recordError) throw recordError

      await logAction({
        action: 'exported',
        target_type: 'case',
        target_id: caseId,
        case_id: caseId,
        note: `Handoff package prepared for ${state.recipient_name} (${state.recipient_type})`,
      })

      // Trigger download
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `threadline-handoff-${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      return record
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports', caseId] })
      toast({ title: 'Package generated', description: 'The handoff PDF has been downloaded.' })
      // Reset to step 1
      setState(prev => ({ ...prev, step: 1 }))
    },
    onError: (error) => {
      toast({ variant: 'destructive', title: 'Export failed', description: error.message })
    },
  })

  const progress = (state.step / TOTAL_STEPS) * 100

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Step {state.step} of {TOTAL_STEPS}</span>
          <span className="font-medium">{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Step 1: Recipient */}
      {state.step === 1 && (
        <div className="space-y-4">
          <h3 className="font-semibold text-slate-800">Who is this package for?</h3>
          <div className="space-y-1.5">
            <Label>Recipient type *</Label>
            <Select
              value={state.recipient_type}
              onValueChange={(v) => update({ recipient_type: v as RecipientType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="law_enforcement">Law enforcement</SelectItem>
                <SelectItem value="legal">Legal counsel</SelectItem>
                <SelectItem value="journalist">Journalist</SelectItem>
                <SelectItem value="family">Family</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Recipient name *</Label>
            <Input
              placeholder="e.g. Detective J. Smith, Austin PD"
              value={state.recipient_name}
              onChange={(e) => update({ recipient_name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Purpose of handoff *</Label>
            <Textarea
              placeholder="e.g. Providing organized account of reported sightings for ongoing investigation..."
              value={state.purpose}
              onChange={(e) => update({ purpose: e.target.value })}
              className="min-h-[80px]"
            />
          </div>
        </div>
      )}

      {/* Step 2: Select claims */}
      {state.step === 2 && (
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-slate-800">Select claims to include</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Only corroborated, under review, or confirmed claims are shown. Unverified claims cannot be exported.
            </p>
          </div>

          {!verifiedClaims || verifiedClaims.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-lg">
              <AlertTriangle className="h-8 w-8 text-amber-400 mx-auto mb-2" />
              <p className="font-medium text-slate-600">No verified claims to export</p>
              <p className="text-xs text-slate-400 mt-1">
                Mark claims as corroborated or confirmed before building a handoff package.
              </p>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => update({ selected_claim_ids: new Set(verifiedClaims.map(c => c.id)) })}
                >
                  Select all
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => update({ selected_claim_ids: new Set() })}
                >
                  Clear
                </Button>
                <span className="text-sm text-slate-500 self-center">
                  {state.selected_claim_ids.size} selected
                </span>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {verifiedClaims.map((claim) => (
                  <div
                    key={claim.id}
                    className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                      state.selected_claim_ids.has(claim.id)
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                    onClick={() => {
                      const newSet = new Set(state.selected_claim_ids)
                      if (newSet.has(claim.id)) newSet.delete(claim.id)
                      else newSet.add(claim.id)
                      update({ selected_claim_ids: newSet })
                    }}
                  >
                    <Checkbox
                      checked={state.selected_claim_ids.has(claim.id)}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <EpistemicBadge
                          type={getEpistemicType(claim.verification_status, claim.claim_type, claim.interpretation_flag)}
                        />
                        <Badge variant="outline" className="text-xs">{labelForClaimType(claim.claim_type)}</Badge>
                      </div>
                      <p className="text-xs font-mono text-slate-700 truncate">
                        {truncate(claim.extracted_text, 120)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: Review entities */}
      {state.step === 3 && (
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-slate-800">Review entity set</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              These entities were derived from your selected claims. Remove any that are too sensitive to include.
            </p>
          </div>

          {derivedEntityIds.size === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">
              No entities are linked to your selected claims.
            </p>
          ) : (
            <div className="space-y-2">
              {(derivedEntities ?? []).map((entity) => (
                <div
                  key={entity.id}
                  className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                    !state.selected_entity_ids.has(entity.id + '_excluded')
                      ? 'border-slate-200 bg-white'
                      : 'border-red-200 bg-red-50 opacity-60'
                  }`}
                >
                  <Checkbox
                    checked={!state.selected_entity_ids.has(entity.id + '_excluded')}
                    onCheckedChange={(checked) => {
                      const newSet = new Set(state.selected_entity_ids)
                      if (checked) newSet.delete(entity.id + '_excluded')
                      else newSet.add(entity.id + '_excluded')
                      update({ selected_entity_ids: newSet })
                    }}
                  />
                  <Badge variant="outline" className="text-xs">{labelForEntityType(entity.entity_type)}</Badge>
                  <span className="text-sm font-medium">{entity.normalized_value ?? entity.raw_value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 4: Case summary */}
      {state.step === 4 && (
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-slate-800">Write case summary</h3>
            <div className="flex items-center gap-1.5 mt-1 p-2 bg-slate-50 rounded border border-slate-200">
              <Shield className="h-4 w-4 text-slate-500 flex-shrink-0" />
              <p className="text-xs text-slate-600 font-medium">
                Human-authored. Not auto-generated. Write this yourself.
              </p>
            </div>
          </div>
          <Textarea
            placeholder="Provide a narrative overview of this case, the nature of the information gathered, and the key findings..."
            value={state.case_summary}
            onChange={(e) => update({ case_summary: e.target.value })}
            className="min-h-[160px]"
          />
        </div>
      )}

      {/* Step 5: Methodology */}
      {state.step === 5 && (
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-slate-800">Methodology note</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Describe how the information was gathered, the intake process, and any limitations.
            </p>
          </div>
          <Textarea
            placeholder="e.g. Information was gathered through a structured public intake form. All submissions were manually reviewed by trained case volunteers. Claims were extracted individually and evaluated for source reliability and content certainty..."
            value={state.methodology_note}
            onChange={(e) => update({ methodology_note: e.target.value })}
            className="min-h-[120px]"
          />
        </div>
      )}

      {/* Step 6: Confidence statement */}
      {state.step === 6 && (
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-slate-800">Confidence statement</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Describe the overall confidence level of the information in this package and any known limitations.
            </p>
          </div>
          <Textarea
            placeholder="e.g. The claims in this package range from low to high confidence. All high-confidence claims are corroborated by multiple independent sources. Interpretations are clearly labeled as such and should not be treated as factual accounts..."
            value={state.confidence_statement}
            onChange={(e) => update({ confidence_statement: e.target.value })}
            className="min-h-[120px]"
          />
        </div>
      )}

      {/* Step 7: Preview */}
      {state.step === 7 && (
        <div className="space-y-4">
          <h3 className="font-semibold text-slate-800">Package preview</h3>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-50 rounded border border-slate-200">
                <p className="text-xs text-slate-500">Recipient</p>
                <p className="font-medium">{state.recipient_name}</p>
                <p className="text-xs text-slate-400 capitalize">{state.recipient_type.replace('_', ' ')}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded border border-slate-200">
                <p className="text-xs text-slate-500">Purpose</p>
                <p className="font-medium text-sm">{truncate(state.purpose, 80)}</p>
              </div>
            </div>

            <div className="flex gap-4 text-sm text-slate-600">
              <span><strong>{state.selected_claim_ids.size}</strong> claims included</span>
              <span><strong>{derivedEntityIds.size - state.selected_entity_ids.size}</strong> entities included</span>
            </div>

            <div className="p-3 bg-amber-50 rounded-md border border-amber-200">
              <p className="text-xs text-amber-700 font-semibold mb-1">Source protection reminder</p>
              <p className="text-xs text-amber-600">
                Anonymous and confidential source identities will NOT be included in this export. Only on-record information will appear.
              </p>
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || state.selected_claim_ids.size === 0}
          >
            {generateMutation.isPending ? (
              'Generating PDF...'
            ) : (
              <>
                <Download className="h-4 w-4" />
                Generate handoff package
              </>
            )}
          </Button>
        </div>
      )}

      {/* Navigation */}
      <Separator />
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => update({ step: Math.max(1, state.step - 1) })}
          disabled={state.step === 1}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>

        {state.step < TOTAL_STEPS && (
          <Button
            size="sm"
            onClick={() => update({ step: state.step + 1 })}
            disabled={
              (state.step === 1 && (!state.recipient_name || !state.purpose)) ||
              (state.step === 2 && state.selected_claim_ids.size === 0)
            }
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
