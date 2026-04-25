import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensurePersonalWorkspace } from '@/lib/personal-workspace'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const caseId = await ensurePersonalWorkspace(supabase, user.id, user.email)
  if (!caseId) {
    return NextResponse.json({ error: 'Failed to resolve personal workspace' }, { status: 500 })
  }
  return NextResponse.json({ case_id: caseId })
}
