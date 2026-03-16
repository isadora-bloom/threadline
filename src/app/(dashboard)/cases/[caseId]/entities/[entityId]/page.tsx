import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { EntityDetail } from '@/components/entities/EntityDetail'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ caseId: string; entityId: string }>
}) {
  const { caseId, entityId } = await params
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

  const { data: entity } = await supabase
    .from('entities')
    .select('*')
    .eq('id', entityId)
    .eq('case_id', caseId)
    .single()

  if (!entity) notFound()

  // Fetch linked claims with their data
  const { data: claimLinks } = await supabase
    .from('claim_entity_links')
    .select(`
      claim_id,
      entity_role,
      identifier_source,
      confidence,
      claim:claims(
        id,
        extracted_text,
        claim_type,
        verification_status,
        interpretation_flag
      )
    `)
    .eq('entity_id', entityId)

  const { count: claimCount } = await supabase
    .from('claim_entity_links')
    .select('id', { count: 'exact', head: true })
    .eq('entity_id', entityId)

  const enrichedEntity = {
    ...entity,
    claim_count: claimCount ?? 0,
    linked_claims: (claimLinks ?? []).map((link) => ({
      ...link,
      claim: link.claim as {
        id: string
        extracted_text: string
        claim_type: string
        verification_status: string
        interpretation_flag: boolean
      },
    })),
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-5 text-sm">
        <Link
          href={`/cases/${caseId}/entities`}
          className="flex items-center gap-1 text-slate-500 hover:text-slate-700"
        >
          <ChevronLeft className="h-4 w-4" />
          Entities
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-medium text-slate-700">
          {entity.normalized_value ?? entity.raw_value}
        </span>
      </div>

      <EntityDetail entity={enrichedEntity} caseId={caseId} />
    </div>
  )
}
