import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { flagId?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { flagId, note } = body
  if (!flagId) {
    return NextResponse.json({ error: 'flagId is required' }, { status: 400 })
  }

  // Fetch the flag to get case_id for role check
  const { data: flag } = await supabase
    .from('pattern_flags')
    .select('id, case_id, reviewer_status')
    .eq('id', flagId)
    .single()

  if (!flag) {
    return NextResponse.json({ error: 'Flag not found' }, { status: 404 })
  }

  // Check reviewer+ role
  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', flag.case_id)
    .eq('user_id', user.id)
    .single()

  const reviewerRoles = ['reviewer', 'lead_investigator', 'legal', 'export_only', 'admin']
  if (!roleData || !reviewerRoles.includes(roleData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error: updateError } = await supabase
    .from('pattern_flags')
    .update({
      reviewer_status: 'dismissed',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      reviewer_note: note ?? null,
      dismissed_at: new Date().toISOString(),
    })
    .eq('id', flagId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Log review action
  await supabase.from('review_actions').insert({
    actor_id: user.id,
    action: 'flagged',
    target_type: 'case',
    target_id: flag.case_id,
    case_id: flag.case_id,
    note: `Pattern flag dismissed: ${flagId}${note ? ` — ${note}` : ''}`,
  })

  return NextResponse.json({ success: true })
}
