import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { Lock } from 'lucide-react'

export default async function AuditPage({
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

  const role = (roleData as { role: string }).role
  const allowedRoles = ['lead_investigator', 'legal', 'admin']
  if (!allowedRoles.includes(role)) {
    return (
      <div className="p-6 text-center py-16">
        <Lock className="h-12 w-12 text-slate-300 mx-auto mb-3" />
        <h2 className="font-semibold text-slate-700">Access restricted</h2>
        <p className="text-sm text-slate-500 mt-1">
          Audit logs are accessible to lead investigators, legal, and admins only.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Audit Log</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Complete history of all actions taken in this case. Immutable.
        </p>
      </div>

      <AuditTrail caseId={caseId} limit={200} />
    </div>
  )
}
