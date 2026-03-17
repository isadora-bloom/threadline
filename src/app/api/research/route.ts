import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const caseId = req.nextUrl.searchParams.get('caseId')
  if (!caseId) return NextResponse.json({ error: 'caseId required' }, { status: 400 })

  const { data: role } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('research_tasks')
    .select('id, question, status, trigger_type, trigger_ref_type, confidence_summary, created_at, completed_at, created_by')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tasks: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { caseId, question, context, trigger_type = 'manual', trigger_ref_id, trigger_ref_type } = body

  if (!caseId || !question?.trim()) {
    return NextResponse.json({ error: 'caseId and question required' }, { status: 400 })
  }

  const { data: role } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()

  if (!role || !['lead_investigator', 'admin'].includes(role.role)) {
    return NextResponse.json({ error: 'Requires lead investigator or admin' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('research_tasks')
    .insert({
      case_id: caseId,
      question: question.trim(),
      context: context?.trim() || null,
      trigger_type,
      trigger_ref_id: trigger_ref_id || null,
      trigger_ref_type: trigger_ref_type || null,
      status: 'queued',
      created_by: user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data }, { status: 201 })
}
