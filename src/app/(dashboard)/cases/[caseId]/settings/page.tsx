import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { CaseSettings } from '@/components/cases/CaseSettings'

export default async function CaseSettingsPage({
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

  const userRole = (roleData as { role: string }).role

  const { data: caseData } = await supabase
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .single()

  if (!caseData) notFound()

  // Fetch team members
  const { data: teamMembers } = await supabase
    .from('case_user_roles')
    .select('*, profile:user_profiles(full_name, organization)')
    .eq('case_id', caseId)

  // Fetch submission tokens
  const { data: tokens } = await supabase
    .from('submission_tokens')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })

  // Fetch invitations (for server-side initial data — client will refetch via API)
  // We pass an empty array here since CaseSettings fetches them client-side via React Query

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Case Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Manage case details, team access, and submission links.
        </p>
      </div>

      <CaseSettings
        caseData={caseData}
        teamMembers={teamMembers ?? []}
        tokens={tokens ?? []}
        userRole={userRole}
        currentUserId={user.id}
        caseId={caseId}
      />
    </div>
  )
}
