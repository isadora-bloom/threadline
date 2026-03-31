/**
 * /api/followups
 *
 * GET  ?caseId=...               — all follow-ups for the case
 * GET  ?submissionId=...         — follow-ups for a specific submission
 * POST { caseId, text, submissionId?, claimId?, dueDate? }
 * PATCH { id, status }           — toggle open/done
 * DELETE ?id=...                 — delete a follow-up
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const caseId = params.get('caseId')
  const submissionId = params.get('submissionId')

  if (!caseId && !submissionId) {
    return NextResponse.json({ error: 'caseId or submissionId required' }, { status: 400 })
  }

  let query = supabase
    .from('submission_follow_ups' as never)
    .select('id,case_id,submission_id,claim_id,text,status,due_date,created_by,completed_by,created_at,completed_at,creator:user_profiles!created_by(full_name)')
    .order('created_at', { ascending: false })

  if (submissionId) {
    query = query.eq('submission_id', submissionId as never) as typeof query
  } else {
    query = query.eq('case_id', caseId as never) as typeof query
  }

  const { data, error } = await query as { data: unknown[] | null; error: unknown }
  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  return NextResponse.json({ followUps: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { caseId, submissionId, claimId, text, dueDate } = await req.json()
  if (!caseId || !text?.trim()) {
    return NextResponse.json({ error: 'caseId and text required' }, { status: 400 })
  }

  // Verify case access
  const { data: role } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('submission_follow_ups' as never)
    .insert({
      case_id:       caseId,
      submission_id: submissionId ?? null,
      claim_id:      claimId ?? null,
      text:          text.trim(),
      due_date:      dueDate ?? null,
      created_by:    user.id,
    } as never)
    .select()
    .single() as { data: unknown; error: unknown }

  if (error) return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  return NextResponse.json({ ok: true, followUp: data })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, status } = await req.json()
  if (!id || !['open', 'done'].includes(status)) {
    return NextResponse.json({ error: 'id and status (open|done) required' }, { status: 400 })
  }

  const update: Record<string, unknown> = { status }
  if (status === 'done') {
    update.completed_by = user.id
    update.completed_at = new Date().toISOString()
  } else {
    update.completed_by = null
    update.completed_at = null
  }

  const { error } = await supabase
    .from('submission_follow_ups' as never)
    .update(update as never)
    .eq('id', id as never) as { error: unknown }

  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await supabase.from('submission_follow_ups' as never).delete().eq('id', id as never)
  return NextResponse.json({ ok: true })
}
