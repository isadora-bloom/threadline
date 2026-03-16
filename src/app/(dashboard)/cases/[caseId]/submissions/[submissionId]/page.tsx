import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ReviewWorkspace } from '@/components/submissions/ReviewWorkspace'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import type { NoveltyFlag } from '@/lib/types'

export default async function SubmissionReviewPage({
  params,
}: {
  params: Promise<{ caseId: string; submissionId: string }>
}) {
  const { caseId, submissionId } = await params
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

  const { data: submission } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .eq('case_id', caseId)
    .single()

  if (!submission) notFound()

  // Fetch files
  const { data: files } = await supabase
    .from('submission_files')
    .select('id, file_name, file_type')
    .eq('submission_id', submissionId)

  // Fetch step6 entities (entities created within 30 seconds of the submission)
  const { data: step6Entities } = await supabase
    .from('entities')
    .select('id, entity_type, raw_value')
    .eq('case_id', caseId)
    .gte('created_at', new Date(new Date(submission.created_at).getTime() - 1000).toISOString())
    .lte('created_at', new Date(new Date(submission.created_at).getTime() + 30000).toISOString())

  // Queue position — count untriaged submissions with higher priority than this one
  const { count: queuePosition } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .eq('triage_status', 'untriaged')
    .or(`priority_score.gt.${submission.priority_score ?? 0},and(priority_score.eq.${submission.priority_score ?? 0},created_at.lt.${submission.created_at})`)

  const { count: queueTotal } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .eq('triage_status', 'untriaged')

  const enrichedSubmission = {
    ...submission,
    files: files ?? [],
    step6Entities: step6Entities ?? [],
    novelty_flags: (submission.novelty_flags as unknown as NoveltyFlag[]) ?? [],
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 bg-white flex-shrink-0">
        <Link
          href={`/cases/${caseId}/submissions`}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ChevronLeft className="h-4 w-4" />
          Submissions
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-700">Review submission</span>
      </div>

      {/* Workspace */}
      <div className="flex-1 overflow-hidden">
        <ReviewWorkspace
          submission={enrichedSubmission}
          caseId={caseId}
          queuePosition={(queuePosition ?? 0) + 1}
          queueTotal={queueTotal ?? 0}
        />
      </div>
    </div>
  )
}
