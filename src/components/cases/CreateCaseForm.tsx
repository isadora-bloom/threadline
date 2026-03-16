'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { CreateCaseFormData } from '@/lib/types'

const schema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters').max(200),
  case_type: z.enum(['missing_person', 'unidentified_remains', 'homicide', 'assault', 'trafficking', 'other']),
  jurisdiction: z.string().optional(),
  status: z.enum(['active', 'inactive', 'closed', 'archived']),
  notes: z.string().optional(),
})

export function CreateCaseForm() {
  const router = useRouter()
  const supabase = createClient()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateCaseFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      case_type: 'other',
      status: 'active',
    },
  })

  const onSubmit = async (data: CreateCaseFormData) => {
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Not authenticated')
      return
    }

    // Create case
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .insert({
        title: data.title,
        case_type: data.case_type,
        jurisdiction: data.jurisdiction || null,
        status: data.status,
        notes: data.notes || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (caseError || !caseData) {
      setError(caseError?.message ?? 'Failed to create case')
      return
    }

    // Add creator as lead_investigator
    const { error: roleError } = await supabase.from('case_user_roles').insert({
      case_id: caseData.id,
      user_id: user.id,
      role: 'lead_investigator',
      invited_by: user.id,
    })

    if (roleError) {
      console.error('Failed to set role:', roleError)
    }

    // Log creation
    await supabase.from('review_actions').insert({
      actor_id: user.id,
      action: 'created',
      target_type: 'case',
      target_id: caseData.id,
      case_id: caseData.id,
    })

    router.push(`/cases/${caseData.id}`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="title">Case title *</Label>
        <Input
          id="title"
          placeholder="e.g. Jane Doe — Missing 04/2024"
          {...register('title')}
        />
        {errors.title && (
          <p className="text-xs text-red-600">{errors.title.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="case_type">Case type *</Label>
          <Select
            defaultValue="other"
            onValueChange={(value) => setValue('case_type', value as CreateCaseFormData['case_type'])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="missing_person">Missing Person</SelectItem>
              <SelectItem value="unidentified_remains">Unidentified Remains</SelectItem>
              <SelectItem value="homicide">Homicide</SelectItem>
              <SelectItem value="assault">Assault</SelectItem>
              <SelectItem value="trafficking">Trafficking</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Status *</Label>
          <Select
            defaultValue="active"
            onValueChange={(value) => setValue('status', value as CreateCaseFormData['status'])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="jurisdiction">Jurisdiction</Label>
        <Input
          id="jurisdiction"
          placeholder="e.g. Travis County, TX"
          {...register('jurisdiction')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          placeholder="Internal notes about this case..."
          rows={3}
          {...register('notes')}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating...' : 'Create case'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
