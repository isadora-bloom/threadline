import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: role } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Aggregate tag frequencies for the case
  const { data, error } = await supabase
    .from('claim_tags')
    .select('tag, tag_type')
    .eq('case_id', caseId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Count frequencies
  const freq: Record<string, { tag: string; tag_type: string; count: number }> = {}
  for (const row of data ?? []) {
    if (!freq[row.tag]) freq[row.tag] = { tag: row.tag, tag_type: row.tag_type, count: 0 }
    freq[row.tag].count++
  }

  const tags = Object.values(freq).sort((a, b) => b.count - a.count)
  return NextResponse.json({ tags })
}
