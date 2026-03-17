import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action, reason, assignedTo } = body

  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  // Fetch thread + verify access
  const { data: thread, error: fetchErr } = await supabase
    .from('investigative_threads')
    .select('id, case_id, status')
    .eq('id', threadId)
    .single()

  if (fetchErr || !thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }

  // Role check
  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', thread.case_id)
    .eq('user_id', user.id)
    .single()

  if (!roleData || !['lead_investigator', 'admin'].includes(roleData.role)) {
    return NextResponse.json({ error: 'Requires lead investigator or admin role' }, { status: 403 })
  }

  // Build update payload
  let update: Record<string, unknown> = { reviewed_by: user.id, reviewed_at: new Date().toISOString() }
  let auditNotes = ''

  if (action === 'accept') {
    update = { ...update, status: 'active' }
    auditNotes = 'Thread accepted into active investigation.'
  } else if (action === 'dismiss') {
    update = { ...update, status: 'dismissed', status_reason: reason ?? null }
    auditNotes = `Thread dismissed.${reason ? ` Reason: ${reason}` : ''}`
  } else if (action === 'assign') {
    if (!assignedTo) return NextResponse.json({ error: 'assignedTo required for assign action' }, { status: 400 })
    update = { ...update, assigned_to: assignedTo }
    auditNotes = `Thread assigned to user ${assignedTo}.`
  } else if (action === 'export') {
    update = { ...update, status: 'exported_to_handoff' }
    auditNotes = 'Thread exported to handoff package.'
  } else if (action === 'reopen') {
    update = { ...update, status: 'unreviewed', status_reason: null, reviewed_by: null, reviewed_at: null }
    auditNotes = 'Thread reopened for review.'
  } else {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }

  const { data: updated, error: updateErr } = await supabase
    .from('investigative_threads')
    .update(update)
    .eq('id', threadId)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // Log to audit trail
  await supabase.from('review_actions').insert({
    actor_id: user.id,
    action: 'hypothesis_generated',  // reusing for thread lifecycle events
    target_type: 'case',
    target_id: thread.case_id,
    case_id: thread.case_id,
    notes: `[Thread ${threadId}] ${auditNotes}`,
  })

  return NextResponse.json({ thread: updated })
}
