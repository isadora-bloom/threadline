import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tag = req.nextUrl.searchParams.get('tag')
  if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 })

  // Get all cases user has access to
  const { data: roles } = await supabase
    .from('case_user_roles')
    .select('case_id')
    .eq('user_id', user.id)

  const caseIds = (roles ?? []).map(r => r.case_id)
  if (!caseIds.length) return NextResponse.json({ results: [] })

  // Find all claim_tags matching this tag across those cases
  const { data, error } = await supabase
    .from('claim_tags')
    .select(`
      id, tag, tag_type, case_id,
      claims!inner(
        id, extracted_text, claim_type, verification_status
      ),
      cases!inner(
        id, title, case_type, status
      )
    `)
    .eq('tag', tag.toLowerCase())
    .in('case_id', caseIds)
    .order('case_id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ results: data ?? [], tag })
}
