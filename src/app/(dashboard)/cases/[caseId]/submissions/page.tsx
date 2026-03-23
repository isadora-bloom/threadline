import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { SmartQueue } from '@/components/submissions/SmartQueue'
import { QuickCapture } from '@/components/submissions/QuickCapture'
import { Inbox } from 'lucide-react'
import type { NoveltyFlag } from '@/lib/types'

export default async function SubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { caseId } = await params
  const { tab } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Verify access
  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()

  if (!roleData) notFound()

  const userRole = (roleData as { role: string }).role

  // Fetch all submissions with counts
  const { data: submissions } = await supabase
    .from('submissions')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })

  const allSubmissions = submissions ?? []

  // Enrich with claim and file counts
  const enriched = await Promise.all(
    allSubmissions.map(async (s) => {
      const [filesRes, claimsRes] = await Promise.all([
        supabase
          .from('submission_files')
          .select('id', { count: 'exact', head: true })
          .eq('submission_id', s.id),
        supabase
          .from('claims')
          .select('id', { count: 'exact', head: true })
          .eq('submission_id', s.id),
      ])
      return {
        ...s,
        file_count: filesRes.count ?? 0,
        claim_count: claimsRes.count ?? 0,
        novelty_flags: (s.novelty_flags as unknown as NoveltyFlag[]) ?? [],
      }
    })
  )

  // Queue stats
  const untriaged = enriched.filter(s => s.triage_status === 'untriaged').length
  const inReview = enriched.filter(s => s.review_status === 'under_review').length

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const reviewedToday = enriched.filter(
    s => s.review_completed_at && new Date(s.review_completed_at) >= todayStart
  ).length

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Submission Queue</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {allSubmissions.length} total submissions
          </p>
          {allSubmissions.length === 0 && (
            <p className="text-xs text-slate-400 mt-1">
              No submissions yet. Add one manually, or share a public submission link with witnesses and tip providers.
            </p>
          )}
          {allSubmissions.length > 0 && (
            <p className="text-xs text-slate-400 mt-1">
              Step 1: triage (claim or discard). Step 2: open and extract claims from each submission.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <QuickCapture caseId={caseId} />
          <a
            href={`/cases/${caseId}/submissions/triage`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
          >
            <Inbox className="h-4 w-4" />
            Triage mode
            {untriaged > 0 && (
              <span className="ml-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white px-1">
                {untriaged}
              </span>
            )}
          </a>
        </div>
      </div>

      <SmartQueue
        submissions={enriched}
        caseId={caseId}
        initialTab={tab ?? 'priority'}
        queueStats={{ untriaged, in_review: inReview, reviewed_today: reviewedToday }}
        userRole={userRole}
      />
    </div>
  )
}
