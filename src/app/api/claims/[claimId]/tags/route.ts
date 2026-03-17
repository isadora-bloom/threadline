import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ claimId: string }> }
) {
  const { claimId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('claim_tags')
    .select('id, tag, tag_type, source, created_at')
    .eq('claim_id', claimId)
    .order('tag_type')
    .order('tag')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tags: data })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ claimId: string }> }
) {
  const { claimId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { tag, tag_type = 'generic' } = body
  if (!tag?.trim()) return NextResponse.json({ error: 'tag required' }, { status: 400 })

  // Get claim to find case_id
  const { data: claim } = await supabase
    .from('claims')
    .select('submission_id, submissions!inner(case_id)')
    .eq('id', claimId)
    .single()

  if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
  const caseId = (claim.submissions as { case_id: string }).case_id

  const { data, error } = await supabase
    .from('claim_tags')
    .insert({ claim_id: claimId, case_id: caseId, tag: tag.trim().toLowerCase(), tag_type, source: 'human', created_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tag: data }, { status: 201 })
}
