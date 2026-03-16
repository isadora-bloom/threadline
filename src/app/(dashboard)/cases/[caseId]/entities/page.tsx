import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { EntityRegistry } from '@/components/entities/EntityRegistry'

export default async function EntitiesPage({
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

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Entity Registry</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          People, locations, vehicles, and identifiers surfaced across submissions.
        </p>
      </div>

      <EntityRegistry caseId={caseId} />
    </div>
  )
}
