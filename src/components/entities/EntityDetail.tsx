'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuditLog } from '@/hooks/useAuditLog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { EpistemicBadge, getEpistemicType } from '@/components/shared/EpistemicBadge'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { useToast } from '@/components/ui/use-toast'
import {
  labelForEntityType,
  labelForEntityRole,
  labelForIdentifierSource,
  labelForClaimType,
  truncate,
} from '@/lib/utils'
import { Flag, Merge, Edit3, Save, X } from 'lucide-react'
import type { EntityWithClaimCount, NormalizationStatus } from '@/lib/types'

interface EntityDetailProps {
  entity: EntityWithClaimCount & {
    linked_claims?: Array<{
      claim_id: string
      entity_role: string
      identifier_source: string
      confidence: string
      claim: {
        id: string
        extracted_text: string
        claim_type: string
        verification_status: string
        interpretation_flag: boolean
      }
    }>
  }
  caseId: string
}

export function EntityDetail({ entity, caseId }: EntityDetailProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { logAction } = useAuditLog()
  const { toast } = useToast()

  const [editing, setEditing] = useState(false)
  const [normalizedValue, setNormalizedValue] = useState(entity.normalized_value ?? '')
  const [normStatus, setNormStatus] = useState(entity.normalization_status)
  const [notes, setNotes] = useState(entity.notes ?? '')
  const [newAlias, setNewAlias] = useState('')

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('entities')
        .update({
          normalized_value: normalizedValue || null,
          normalization_status: normStatus,
          notes: notes || null,
        })
        .eq('id', entity.id)

      if (error) throw error

      await logAction({
        action: 'edited',
        target_type: 'entity',
        target_id: entity.id,
        case_id: caseId,
        note: 'Updated normalization',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity', entity.id] })
      setEditing(false)
      toast({ title: 'Entity updated' })
    },
    onError: (error) => {
      toast({ variant: 'destructive', title: 'Failed to update', description: error.message })
    },
  })

  const addAliasMutation = useMutation({
    mutationFn: async (alias: string) => {
      const newAliases = [...(entity.aliases ?? []), alias]
      const { error } = await supabase
        .from('entities')
        .update({ aliases: newAliases })
        .eq('id', entity.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity', entity.id] })
      setNewAlias('')
    },
  })

  const flagMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('entities')
        .update({ flagged_for_review: !entity.flagged_for_review })
        .eq('id', entity.id)
      if (error) throw error

      await logAction({
        action: 'flagged',
        target_type: 'entity',
        target_id: entity.id,
        case_id: caseId,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity', entity.id] })
    },
  })

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Main entity info */}
      <div className="lg:col-span-2 space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{labelForEntityType(entity.entity_type)}</Badge>
                <Badge variant={entity.normalization_status === 'normalized' ? 'success' as never : 'muted' as never}>
                  {entity.normalization_status.replace('_', ' ')}
                </Badge>
                {entity.flagged_for_review && (
                  <Badge variant="warning">Flagged for review</Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => flagMutation.mutate()}
                  className={entity.flagged_for_review ? 'text-amber-600' : ''}
                >
                  <Flag className="h-4 w-4" />
                  {entity.flagged_for_review ? 'Unflag' : 'Flag'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(!editing)}
                >
                  {editing ? <X className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
                  {editing ? 'Cancel' : 'Edit'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Raw value — immutable */}
            <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
              <Label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1">
                Raw value (immutable — as submitted)
              </Label>
              <p className="font-mono text-sm text-slate-800">{entity.raw_value}</p>
            </div>

            {/* Normalized value */}
            <div className="space-y-1.5">
              <Label className="text-xs">Normalized value</Label>
              {editing ? (
                <Input
                  value={normalizedValue}
                  onChange={(e) => setNormalizedValue(e.target.value)}
                  placeholder="Standardized form..."
                />
              ) : (
                <p className="text-sm text-slate-700 bg-white border border-slate-200 rounded p-2.5">
                  {entity.normalized_value ?? <span className="text-slate-400 italic">Not normalized yet</span>}
                </p>
              )}
            </div>

            {/* Normalization status */}
            {editing && (
              <div className="space-y-1.5">
                <Label className="text-xs">Normalization status</Label>
                <Select value={normStatus} onValueChange={(v) => setNormStatus(v as NormalizationStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="raw">Raw</SelectItem>
                    <SelectItem value="normalized">Normalized</SelectItem>
                    <SelectItem value="merged">Merged</SelectItem>
                    <SelectItem value="flagged_ambiguous">Flagged ambiguous</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Aliases */}
            <div className="space-y-2">
              <Label className="text-xs">Aliases / alternate names</Label>
              {entity.aliases && entity.aliases.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {entity.aliases.map((alias, i) => (
                    <span key={i} className="text-xs bg-slate-100 text-slate-600 rounded px-2 py-1 border border-slate-200">
                      {alias}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No aliases recorded</p>
              )}
              {editing && (
                <div className="flex gap-2">
                  <Input
                    placeholder="Add alias..."
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                    className="h-8 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newAlias.trim()) {
                        addAliasMutation.mutate(newAlias.trim())
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => newAlias.trim() && addAliasMutation.mutate(newAlias.trim())}
                    className="h-8"
                  >
                    Add
                  </Button>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              {editing ? (
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Analyst notes..."
                  className="min-h-[80px] text-sm"
                />
              ) : (
                entity.notes && (
                  <p className="text-sm text-slate-600 italic">{entity.notes}</p>
                )
              )}
            </div>

            {editing && (
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <Save className="h-4 w-4" />
                {saveMutation.isPending ? 'Saving...' : 'Save changes'}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Linked claims */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Claims referencing this entity</CardTitle>
          </CardHeader>
          <CardContent>
            {!entity.linked_claims || entity.linked_claims.length === 0 ? (
              <p className="text-sm text-slate-400">No claims reference this entity yet.</p>
            ) : (
              <div className="space-y-3">
                {entity.linked_claims.map((link) => {
                  const claim = link.claim
                  return (
                    <div key={link.claim_id} className="p-3 border border-slate-200 rounded-md">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <EpistemicBadge
                          type={getEpistemicType(claim.verification_status, claim.claim_type, claim.interpretation_flag)}
                        />
                        <Badge variant="outline" className="text-xs">
                          {labelForClaimType(claim.claim_type)}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          Role: <span className="font-medium">{labelForEntityRole(link.entity_role)}</span>
                        </span>
                        <span className="text-xs text-slate-500">
                          Known via: <span className="font-medium">{labelForIdentifierSource(link.identifier_source)}</span>
                        </span>
                      </div>
                      <p className="text-xs font-mono text-slate-700 bg-slate-50 rounded p-2 border border-slate-100">
                        {truncate(claim.extracted_text, 200)}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audit trail */}
      <div>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Audit trail</CardTitle>
          </CardHeader>
          <CardContent>
            <AuditTrail targetId={entity.id} targetType="entity" caseId={caseId} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
