import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      caseId,
      enabled,
      reason,
    }: { caseId: string; enabled: boolean; reason?: string } = body

    if (!caseId || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (enabled && !reason?.trim()) {
      return NextResponse.json({ error: 'A reason is required when enabling legal hold' }, { status: 400 })
    }

    // Only lead_investigator or admin can set legal hold
    const { data: roleData } = await supabase
      .from('case_user_roles')
      .select('role')
      .eq('case_id', caseId)
      .eq('user_id', user.id)
      .single()

    if (!roleData || !['lead_investigator', 'admin'].includes(roleData.role)) {
      return NextResponse.json({ error: 'Only lead investigators and admins can manage legal hold' }, { status: 403 })
    }

    const now = new Date().toISOString()

    const updatePayload = enabled
      ? {
          legal_hold: true,
          legal_hold_set_at: now,
          legal_hold_set_by: user.id,
          legal_hold_reason: reason?.trim() ?? null,
        }
      : {
          legal_hold: false,
          legal_hold_set_at: null,
          legal_hold_set_by: null,
          legal_hold_reason: null,
        }

    const { error: updateError } = await supabase
      .from('cases')
      .update(updatePayload)
      .eq('id', caseId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Log audit action
    await supabase.from('review_actions').insert({
      actor_id: user.id,
      action: 'edited',
      target_type: 'case',
      target_id: caseId,
      case_id: caseId,
      note: enabled
        ? `Legal hold enabled. Reason: ${reason}`
        : 'Legal hold removed',
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Legal hold API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
