import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { VictimologyForm } from '@/components/patterns/VictimologyForm'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default async function VictimologyPage({
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

  // Only reviewer+ can access
  const reviewerRoles = ['reviewer', 'lead_investigator', 'legal', 'export_only', 'admin']
  if (!reviewerRoles.includes(roleData.role)) notFound()

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          href={`/cases/${caseId}/patterns`}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Pattern Intelligence
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Victimology</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Structured victim profile data for pattern analysis. Never used to assign blame.
        </p>
      </div>

      <VictimologyForm caseId={caseId} />
    </div>
  )
}
