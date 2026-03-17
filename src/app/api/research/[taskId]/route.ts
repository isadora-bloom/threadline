import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: task } = await supabase
    .from('research_tasks')
    .select('*')
    .eq('id', taskId)
    .single()

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: role } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', task.case_id)
    .eq('user_id', user.id)
    .single()
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ task })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: task } = await supabase
    .from('research_tasks')
    .select('case_id')
    .eq('id', taskId)
    .single()
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: role } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', task.case_id)
    .eq('user_id', user.id)
    .single()
  if (!role || !['lead_investigator', 'admin'].includes(role.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { status } = body

  const { data: updated, error } = await supabase
    .from('research_tasks')
    .update({ status })
    .eq('id', taskId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: updated })
}
