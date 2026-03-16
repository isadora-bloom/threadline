'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuditLog } from '@/hooks/useAuditLog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { labelForEntityType, labelForEntityRole, labelForIdentifierSource } from '@/lib/utils'
import type { EntityType, EntityRole, IdentifierSource, ConfidenceLevel } from '@/lib/types'

interface EntityLinkModalProps {
  claimId: string
  caseId: string
  onClose: () => void
}

export function EntityLinkModal({ claimId, caseId, onClose }: EntityLinkModalProps) {
  const supabase = createClient()
  const { logAction } = useAuditLog()

  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [search, setSearch] = useState('')
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [newEntityType, setNewEntityType] = useState<EntityType>('person')
  const [newEntityValue, setNewEntityValue] = useState('')
  const [entityRole, setEntityRole] = useState<EntityRole>('unknown')
  const [identifierSource, setIdentifierSource] = useState<IdentifierSource>('unknown')
  const [confidence, setConfidence] = useState<ConfidenceLevel>('medium')
  const [notes, setNotes] = useState('')

  const { data: entities } = useQuery({
    queryKey: ['entities-search', caseId, search],
    queryFn: async () => {
      let query = supabase
        .from('entities')
        .select('id, entity_type, raw_value, normalized_value')
        .eq('case_id', caseId)
        .order('updated_at', { ascending: false })
        .limit(20)

      if (search) {
        query = query.or(`raw_value.ilike.%${search}%,normalized_value.ilike.%${search}%`)
      }

      const { data } = await query
      return data ?? []
    },
  })

  const linkMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      let entityId = selectedEntityId

      if (mode === 'new') {
        if (!newEntityValue.trim()) throw new Error('Entity value is required')

        const { data: entity, error } = await supabase
          .from('entities')
          .insert({
            case_id: caseId,
            entity_type: newEntityType,
            raw_value: newEntityValue.trim(),
            normalization_status: 'raw',
            created_by: user.id,
          })
          .select()
          .single()

        if (error) throw error
        entityId = entity.id

        await logAction({
          action: 'created',
          target_type: 'entity',
          target_id: entity.id,
          case_id: caseId,
        })
      }

      if (!entityId) throw new Error('No entity selected')

      const { error } = await supabase.from('claim_entity_links').insert({
        claim_id: claimId,
        entity_id: entityId,
        entity_role: entityRole,
        identifier_source: identifierSource,
        confidence,
        notes: notes || null,
        created_by: user.id,
      })

      if (error && !error.message.includes('unique')) throw error
    },
    onSuccess: onClose,
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link entity to claim</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode selector */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'existing' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('existing')}
            >
              Use existing entity
            </Button>
            <Button
              variant={mode === 'new' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('new')}
            >
              Create new entity
            </Button>
          </div>

          {mode === 'existing' ? (
            <div className="space-y-2">
              <Label className="text-xs">Search entities in this case</Label>
              <Input
                placeholder="Search by name, phone, username..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-sm"
              />
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {entities?.map((entity) => (
                  <button
                    key={entity.id}
                    onClick={() => setSelectedEntityId(entity.id)}
                    className={`w-full text-left text-sm px-3 py-2 rounded border transition-colors ${
                      selectedEntityId === entity.id
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-xs text-slate-400 mr-2">
                      {labelForEntityType(entity.entity_type)}
                    </span>
                    <span className="font-medium">
                      {entity.normalized_value ?? entity.raw_value}
                    </span>
                  </button>
                ))}
                {entities?.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-3">
                    No entities found. Try a different search or create a new one.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Entity type</Label>
                  <Select value={newEntityType} onValueChange={(v) => setNewEntityType(v as EntityType)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['person', 'location', 'vehicle', 'phone', 'username', 'organization', 'document', 'other'] as EntityType[]).map((t) => (
                        <SelectItem key={t} value={t}>{labelForEntityType(t)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Value *</Label>
                  <Input
                    placeholder="e.g. John Doe, 555-1234..."
                    value={newEntityValue}
                    onChange={(e) => setNewEntityValue(e.target.value)}
                    className="text-sm h-8"
                  />
                </div>
              </div>
            </div>
          )}

          <Separator />

          {/* Link metadata */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Role in claim</Label>
              <Select value={entityRole} onValueChange={(v) => setEntityRole(v as EntityRole)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['subject', 'vehicle_seen', 'associate_mentioned', 'location_reference', 'identifier_fragment', 'witness', 'victim', 'unknown'] as EntityRole[]).map((r) => (
                    <SelectItem key={r} value={r}>{labelForEntityRole(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">How it was known</Label>
              <Select value={identifierSource} onValueChange={(v) => setIdentifierSource(v as IdentifierSource)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['seen_directly', 'heard_stated', 'found_in_document', 'recalled_from_memory', 'inferred', 'unknown'] as IdentifierSource[]).map((s) => (
                    <SelectItem key={s} value={s}>{labelForIdentifierSource(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Confidence</Label>
              <Select value={confidence} onValueChange={(v) => setConfidence(v as ConfidenceLevel)}>
                <SelectTrigger className="h-8 text-xs">
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

          <Input
            placeholder="Notes about this link (optional)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="text-sm"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => linkMutation.mutate()}
            disabled={
              linkMutation.isPending ||
              (mode === 'existing' && !selectedEntityId) ||
              (mode === 'new' && !newEntityValue.trim())
            }
          >
            {linkMutation.isPending ? 'Linking...' : 'Link entity'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
