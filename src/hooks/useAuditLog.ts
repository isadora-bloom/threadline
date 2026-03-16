'use client'

import { useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AuditAction, AuditTargetType } from '@/lib/types'

interface LogActionParams {
  action: AuditAction
  target_type: AuditTargetType
  target_id: string
  case_id?: string
  note?: string
  diff?: Record<string, unknown>
}

export function useAuditLog() {
  const supabase = createClient()

  const logAction = useCallback(async (params: LogActionParams) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.from('review_actions').insert({
      actor_id: user.id,
      action: params.action,
      target_type: params.target_type,
      target_id: params.target_id,
      case_id: params.case_id ?? null,
      note: params.note ?? null,
      diff: params.diff ?? null,
    })

    if (error) {
      console.error('Failed to log audit action:', error)
    }
  }, [supabase])

  return { logAction }
}
