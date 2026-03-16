'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
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
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { labelForEntityType } from '@/lib/utils'
import type { EntityType } from '@/lib/types'

interface CreateEntityDialogProps {
  caseId: string
  onClose: () => void
}

export function CreateEntityDialog({ caseId, onClose }: CreateEntityDialogProps) {
  const supabase = createClient()
  const { logAction } = useAuditLog()

  const [entityType, setEntityType] = useState<EntityType>('person')
  const [rawValue, setRawValue] = useState('')
  const [notes, setNotes] = useState('')

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      if (!rawValue.trim()) throw new Error('Value is required')

      const { data: entity, error } = await supabase
        .from('entities')
        .insert({
          case_id: caseId,
          entity_type: entityType,
          raw_value: rawValue.trim(),
          normalization_status: 'raw',
          notes: notes || null,
          created_by: user.id,
        })
        .select()
        .single()

      if (error) throw error

      await logAction({
        action: 'created',
        target_type: 'entity',
        target_id: entity.id,
        case_id: caseId,
      })

      return entity
    },
    onSuccess: onClose,
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add entity</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Entity type *</Label>
            <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
              <SelectTrigger>
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
            <Label className="text-xs">Raw value *</Label>
            <Input
              placeholder="Exactly as it appeared in the source..."
              value={rawValue}
              onChange={(e) => setRawValue(e.target.value)}
            />
            <p className="text-xs text-slate-400">
              Enter the value exactly as it appeared. Normalization can be done separately.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              placeholder="Additional context..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[60px] text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!rawValue.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create entity'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
