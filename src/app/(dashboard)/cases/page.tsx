import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { CaseCard } from '@/components/cases/CaseCard'
import { Plus, Briefcase } from 'lucide-react'
import type { CaseWithCounts } from '@/lib/types'

export default async function CasesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  // Fetch cases with user roles
  const { data: caseRoles } = await supabase
    .from('case_user_roles')
    .select('case_id, role')
    .eq('user_id', user.id)

  const caseIds = caseRoles?.map(r => r.case_id) ?? []

  let cases: CaseWithCounts[] = []

  if (caseIds.length > 0) {
    const { data: casesData } = await supabase
      .from('cases')
      .select('*')
      .in('id', caseIds)
      .order('updated_at', { ascending: false })

    if (casesData) {
      // Fetch counts for all cases
      cases = await Promise.all(
        casesData.map(async (c) => {
          const [submissionsRes, entitiesRes, unreviewedRes] = await Promise.all([
            supabase
              .from('submissions')
              .select('id', { count: 'exact', head: true })
              .eq('case_id', c.id),
            supabase
              .from('entities')
              .select('id', { count: 'exact', head: true })
              .eq('case_id', c.id),
            supabase
              .from('submissions')
              .select('id', { count: 'exact', head: true })
              .eq('case_id', c.id)
              .eq('review_status', 'unverified'),
          ])

          const submissionIds = (await supabase
            .from('submissions')
            .select('id')
            .eq('case_id', c.id)).data?.map(s => s.id) ?? []

          const claimCount = submissionIds.length > 0
            ? (await supabase
                .from('claims')
                .select('id', { count: 'exact', head: true })
                .in('submission_id', submissionIds)).count ?? 0
            : 0

          const roleEntry = caseRoles?.find(r => r.case_id === c.id)

          return {
            ...c,
            submission_count: submissionsRes.count ?? 0,
            claim_count: claimCount,
            entity_count: entitiesRes.count ?? 0,
            unreviewed_count: unreviewedRes.count ?? 0,
            user_role: roleEntry?.role,
          } as CaseWithCounts
        })
      )
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Cases</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {cases.length} {cases.length === 1 ? 'case' : 'cases'}
          </p>
        </div>
        <Button asChild>
          <Link href="/cases/new">
            <Plus className="h-4 w-4" />
            New Case
          </Link>
        </Button>
      </div>

      {cases.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
          <Briefcase className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h3 className="font-semibold text-slate-700 mb-1">No cases yet</h3>
          <p className="text-sm text-slate-400 mb-4">
            Create your first case or ask a case lead to invite you.
          </p>
          <Button asChild>
            <Link href="/cases/new">
              <Plus className="h-4 w-4" />
              Create case
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {cases.map((c) => (
            <CaseCard key={c.id} caseData={c} />
          ))}
        </div>
      )}
    </div>
  )
}
