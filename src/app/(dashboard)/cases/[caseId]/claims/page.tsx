import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ClaimCard } from '@/components/claims/ClaimCard'
import { ClaimFilters } from '@/components/claims/ClaimFilters'
import { FileText, Inbox } from 'lucide-react'
import Link from 'next/link'
import type { ClaimWithLinks } from '@/lib/types'

export default async function ClaimsPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>
  searchParams: Promise<{
    claim_type?: string
    status?: string
    interpretation?: string
    search?: string
    source_confidence?: string
    content_confidence?: string
  }>
}) {
  const { caseId } = await params
  const sp = await searchParams

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

  // Fetch all submission IDs for this case
  const { data: subs } = await supabase
    .from('submissions')
    .select('id')
    .eq('case_id', caseId)

  const submissionIds = subs?.map(s => s.id) ?? []

  if (submissionIds.length === 0) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-xl font-bold text-slate-900 mb-2">Claims</h1>
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
          <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="font-semibold text-slate-700 text-base">No claims yet</p>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            Claims are extracted from submissions during the review process. Open a submission, highlight a sentence, and save it as a claim.
          </p>
          <Link
            href={`/cases/${caseId}/submissions`}
            className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            <Inbox className="h-4 w-4" />
            Go to submissions
          </Link>
        </div>
      </div>
    )
  }

  // Build claims query
  let query = supabase
    .from('claims')
    .select(`
      *,
      entities:claim_entity_links(
        entity_id,
        entity_role,
        identifier_source,
        confidence,
        entity:entities(id, entity_type, raw_value, normalized_value)
      )
    `)
    .in('submission_id', submissionIds)
    .order('created_at', { ascending: false })

  if (sp.claim_type) query = query.eq('claim_type', sp.claim_type)
  if (sp.status) query = query.eq('verification_status', sp.status)
  if (sp.interpretation === 'true') query = query.eq('interpretation_flag', true)
  if (sp.interpretation === 'false') query = query.eq('interpretation_flag', false)
  if (sp.source_confidence) query = query.eq('source_confidence', sp.source_confidence)
  if (sp.content_confidence) query = query.eq('content_confidence', sp.content_confidence)

  const { data: claimsData } = await query

  // Client-side full text search fallback
  let claims = (claimsData ?? []) as unknown as ClaimWithLinks[]
  if (sp.search) {
    const s = sp.search.toLowerCase()
    claims = claims.filter(c => c.extracted_text.toLowerCase().includes(s))
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Claims</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {claims.length} {claims.length === 1 ? 'claim' : 'claims'}
          </p>
        </div>
      </div>

      <ClaimFilters
        currentFilters={{
          claim_type: sp.claim_type,
          status: sp.status,
          interpretation: sp.interpretation,
          search: sp.search,
          source_confidence: sp.source_confidence,
          content_confidence: sp.content_confidence,
        }}
      />

      <div className="mt-4 space-y-3">
        {claims.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
            <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="font-medium text-slate-600">No claims match your filters</p>
            <p className="text-sm text-slate-400 mt-1">Try adjusting your search or filters.</p>
          </div>
        ) : (
          claims.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} caseId={caseId} />
          ))
        )}
      </div>
    </div>
  )
}
