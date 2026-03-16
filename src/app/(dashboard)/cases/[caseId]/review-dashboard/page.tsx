import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ReviewDashboardClient } from '@/components/submissions/ReviewDashboardClient'

export default async function ReviewDashboardPage({
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

  // Only lead_investigator and admin can view this
  if (!['lead_investigator', 'admin'].includes(roleData.role)) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center py-20">
        <p className="text-slate-500">You need lead investigator or admin access to view the review dashboard.</p>
      </div>
    )
  }

  // Fetch all submissions for stats
  const { data: submissions } = await supabase
    .from('submissions')
    .select('id, review_status, triage_status, review_started_at, review_completed_at, priority_level, created_at, claimed_by')
    .eq('case_id', caseId)

  const allSubmissions = submissions ?? []

  // Queue health stats
  const untriaged = allSubmissions.filter(s => s.triage_status === 'untriaged').length
  const inReview = allSubmissions.filter(s => s.review_status === 'under_review').length

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const reviewedToday = allSubmissions.filter(
    s => s.review_completed_at && new Date(s.review_completed_at) >= todayStart
  ).length

  // Average review time (ms → minutes)
  const completedWithTimes = allSubmissions.filter(
    s => s.review_started_at && s.review_completed_at
  )
  const avgReviewMinutes = completedWithTimes.length > 0
    ? completedWithTimes.reduce((sum, s) => {
        const start = new Date(s.review_started_at!).getTime()
        const end = new Date(s.review_completed_at!).getTime()
        return sum + (end - start)
      }, 0) / completedWithTimes.length / 60000
    : null

  // Priority breakdown (untriaged only)
  const untriagedSubs = allSubmissions.filter(s => s.triage_status === 'untriaged')
  const priorityBreakdown = {
    high: untriagedSubs.filter(s => s.priority_level === 'high').length,
    medium: untriagedSubs.filter(s => s.priority_level === 'medium').length,
    low: untriagedSubs.filter(s => s.priority_level === 'low').length,
  }

  // Submissions per day for last 30 days
  const last30 = new Date()
  last30.setDate(last30.getDate() - 30)
  const volumeByDay: Record<string, number> = {}
  for (let i = 0; i < 30; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    volumeByDay[key] = 0
  }
  for (const s of allSubmissions) {
    const key = s.created_at.slice(0, 10)
    if (key in volumeByDay) volumeByDay[key]++
  }
  const volumeData = Object.entries(volumeByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  // Reviewer activity today — group completed reviews by claimed_by
  const reviewerActivity: Record<string, { count: number; times: number[] }> = {}
  for (const s of allSubmissions) {
    if (s.review_completed_at && new Date(s.review_completed_at) >= todayStart && s.claimed_by) {
      if (!reviewerActivity[s.claimed_by]) {
        reviewerActivity[s.claimed_by] = { count: 0, times: [] }
      }
      reviewerActivity[s.claimed_by].count++
      if (s.review_started_at) {
        const duration = new Date(s.review_completed_at).getTime() - new Date(s.review_started_at).getTime()
        reviewerActivity[s.claimed_by].times.push(duration)
      }
    }
  }

  // Fetch user profiles for reviewers
  const reviewerIds = Object.keys(reviewerActivity)
  const { data: profiles } = reviewerIds.length > 0
    ? await supabase
        .from('user_profiles')
        .select('id, full_name')
        .in('id', reviewerIds)
    : { data: [] }

  const reviewerRows = Object.entries(reviewerActivity).map(([userId, data]) => {
    const profile = (profiles ?? []).find(p => p.id === userId)
    const avgTime = data.times.length > 0
      ? data.times.reduce((a, b) => a + b, 0) / data.times.length / 60000
      : null
    return {
      userId,
      name: profile?.full_name ?? 'Unknown',
      count: data.count,
      avgMinutes: avgTime,
    }
  })

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Review Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Queue health and reviewer activity for this case.</p>
      </div>

      <ReviewDashboardClient
        untriaged={untriaged}
        inReview={inReview}
        reviewedToday={reviewedToday}
        avgReviewMinutes={avgReviewMinutes}
        totalSubmissions={allSubmissions.length}
        priorityBreakdown={priorityBreakdown}
        volumeData={volumeData}
        reviewerRows={reviewerRows}
        caseId={caseId}
      />
    </div>
  )
}
