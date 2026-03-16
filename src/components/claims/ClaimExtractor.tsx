'use client'

// ClaimExtractor is incorporated into the ReviewWorkspace for the full two-panel experience.
// This component exposes a simpler standalone version for future use.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuditLog } from '@/hooks/useAuditLog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'
import type { ClaimType, ConfidenceLevel } from '@/lib/types'

interface ClaimExtractorProps {
  submissionId: string
  caseId: string
  claimCount: number
  onAdded?: () => void
}

export function ClaimExtractor({ submissionId, caseId, claimCount, onAdded }: ClaimExtractorProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { logAction } = useAuditLog()
  const { toast } = useToast()

  const [text, setText] = useState('')
  const [claimType, setClaimType] = useState<ClaimType>('statement')
  const [isInterpretation, setIsInterpretation] = useState(false)
  const [sourceConf, setSourceConf] = useState<ConfidenceLevel>('medium')
  const [contentConf, setContentConf] = useState<ConfidenceLevel>('medium')

  const mutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: claim, error } = await supabase
        .from('claims')
        .insert({
          submission_id: submissionId,
          original_submission_id: submissionId,
          claim_position: claimCount + 1,
          extracted_text: text.trim(),
          claim_type: claimType,
          interpretation_flag: isInterpretation,
          source_confidence: sourceConf,
          content_confidence: contentConf,
          created_by: user.id,
        })
        .select()
        .single()

      if (error) throw error

      await logAction({
        action: 'created',
        target_type: 'claim',
        target_id: claim.id,
        case_id: caseId,
      })

      return claim
    },
    onSuccess: () => {
      setText('')
      setClaimType('statement')
      setIsInterpretation(false)
      queryClient.invalidateQueries({ queryKey: ['claims', submissionId] })
      onAdded?.()
      toast({ title: 'Claim added' })
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Error', description: e.message }),
  })

  return (
    <div className="space-y-3 p-4 border border-slate-200 rounded-lg">
      <Label className="text-sm font-medium">Extract claim</Label>

      <Textarea
        placeholder="Exact text from the submission..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[80px] text-sm"
      />

      <div className="grid grid-cols-3 gap-2">
        <Select value={claimType} onValueChange={(v) => setClaimType(v as ClaimType)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="statement">Statement</SelectItem>
            <SelectItem value="sighting">Sighting</SelectItem>
            <SelectItem value="identifier">Identifier</SelectItem>
            <SelectItem value="association">Association</SelectItem>
            <SelectItem value="interpretation">Interpretation</SelectItem>
            <SelectItem value="official">Official</SelectItem>
            <SelectItem value="behavioral">Behavioral</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sourceConf} onValueChange={(v) => setSourceConf(v as ConfidenceLevel)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Source: Low</SelectItem>
            <SelectItem value="medium">Source: Medium</SelectItem>
            <SelectItem value="high">Source: High</SelectItem>
          </SelectContent>
        </Select>

        <Select value={contentConf} onValueChange={(v) => setContentConf(v as ConfidenceLevel)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Certainty: Low</SelectItem>
            <SelectItem value="medium">Certainty: Medium</SelectItem>
            <SelectItem value="high">Certainty: High</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="interp"
          checked={isInterpretation}
          onCheckedChange={(c) => setIsInterpretation(!!c)}
        />
        <Label htmlFor="interp" className="text-xs cursor-pointer">
          This is an interpretation, not a direct observation
        </Label>
      </div>

      <Button
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={!text.trim() || mutation.isPending}
      >
        {mutation.isPending ? 'Adding...' : 'Add claim'}
      </Button>
    </div>
  )
}
