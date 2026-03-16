import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { TriageMode } from '@/components/submissions/TriageMode'
import type { NoveltyFlag } from '@/lib/types'

export default async function TriagePage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()

  if (!roleData) notFound()

  // Fetch untriaged submissions sorted by priority
  const { data: submissions } = await supabase
    .from('submissions')
    .select('*')
    .eq('case_id', caseId)
    .eq('triage_status', 'untriaged')
    .order('priority_score', { ascending: false })

  const allCount = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)

  const enriched = (submissions ?? []).map(s => ({
    ...s,
    novelty_flags: (s.novelty_flags as unknown as NoveltyFlag[]) ?? [],
  }))

  return (
    <TriageMode
      submissions={enriched}
      caseId={caseId}
      totalCount={allCount.count ?? 0}
    />
  )
}
