import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AuditTrail } from '@/components/shared/AuditTrail'
import {
  labelForCaseType,
  labelForCaseStatus,
  labelForAuditAction,
  formatDate,
  getPublicSubmitUrl,
} from '@/lib/utils'
import {
  Inbox,
  FileText,
  Users,
  Link2,
  Plus,
  Copy,
  ClipboardList,
  Brain,
  AlertTriangle,
} from 'lucide-react'
import { CopyButton } from '@/components/shared/CopyButton'

export default async function CaseDashboardPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: caseData } = await supabase
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .single()

  if (!caseData) notFound()

  // Check user role
  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()

  if (!roleData) notFound()

  const userRole = (roleData as { role: string }).role

  // Fetch counts
  const [submissionsRes, entitiesRes, unreviewedRes, notablePatternFlagsRes] = await Promise.all([
    supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('case_id', caseId),
    supabase.from('entities').select('id', { count: 'exact', head: true }).eq('case_id', caseId),
    supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('case_id', caseId).eq('review_status', 'unverified'),
    supabase.from('pattern_flags').select('id', { count: 'exact', head: true }).eq('case_id', caseId).eq('reviewer_status', 'unreviewed').in('grade', ['notable', 'strong', 'very_strong']),
  ])

  const submissionIds = (await supabase.from('submissions').select('id').eq('case_id', caseId)).data?.map(s => s.id) ?? []
  const claimCount = submissionIds.length > 0
    ? (await supabase.from('claims').select('id', { count: 'exact', head: true }).in('submission_id', submissionIds)).count ?? 0
    : 0

  // Recent activity
  const { data: recentActions } = await supabase
    .from('review_actions')
    .select('*, actor:user_profiles(full_name)')
    .eq('case_id', caseId)
    .order('timestamp', { ascending: false })
    .limit(10)

  // Active submission tokens
  const { data: tokens } = await supabase
    .from('submission_tokens')
    .select('*')
    .eq('case_id', caseId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  const notablePatternFlagCount = notablePatternFlagsRes.count ?? 0

  const stats = [
    { label: 'Submissions', value: submissionsRes.count ?? 0, icon: Inbox, href: `/cases/${caseId}/submissions` },
    { label: 'Claims', value: claimCount, icon: FileText, href: `/cases/${caseId}/claims` },
    { label: 'Entities', value: entitiesRes.count ?? 0, icon: Users, href: `/cases/${caseId}/entities` },
    { label: 'Needs review', value: unreviewedRes.count ?? 0, icon: ClipboardList, href: `/cases/${caseId}/submissions?filter=unverified`, highlight: (unreviewedRes.count ?? 0) > 0 },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Case header */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="muted">{labelForCaseType(caseData.case_type)}</Badge>
              <Badge variant={caseData.status === 'active' ? 'success' as never : 'muted' as never}>
                {labelForCaseStatus(caseData.status)}
              </Badge>
              <Badge variant="outline">{userRole.replace('_', ' ')}</Badge>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{caseData.title}</h1>
            {caseData.jurisdiction && (
              <p className="text-sm text-slate-500 mt-0.5">{caseData.jurisdiction}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/cases/${caseId}/submissions/new`}>
                <Plus className="h-4 w-4" />
                Add submission
              </Link>
            </Button>
          </div>
        </div>
        {caseData.notes && (
          <p className="mt-3 text-sm text-slate-600 bg-slate-50 rounded-md p-3 border border-slate-200">
            {caseData.notes}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Link key={stat.label} href={stat.href}>
              <Card className={`hover:shadow-md transition-shadow cursor-pointer ${stat.highlight ? 'border-amber-200 bg-amber-50' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${stat.highlight ? 'text-amber-700' : 'text-slate-600'}`}>
                      {stat.label}
                    </span>
                    <Icon className={`h-4 w-4 ${stat.highlight ? 'text-amber-500' : 'text-slate-400'}`} />
                  </div>
                  <div className={`text-2xl font-bold mt-1 ${stat.highlight ? 'text-amber-800' : 'text-slate-900'}`}>
                    {stat.value}
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Pattern alerts — only show if notable+ unreviewed flags exist */}
      {notablePatternFlagCount > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              Pattern alerts — {notablePatternFlagCount} unreviewed flag{notablePatternFlagCount !== 1 ? 's' : ''} at notable or above
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              These have been surfaced for investigator review and do not constitute findings.
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="flex-shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100">
            <Link href={`/cases/${caseId}/patterns`}>
              <Brain className="h-4 w-4" />
              Review
            </Link>
          </Button>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {(!recentActions || recentActions.length === 0) ? (
              <p className="text-sm text-slate-400 text-center py-4">No activity yet.</p>
            ) : (
              <div className="space-y-2">
                {recentActions.map((action) => {
                  const actor = action.actor as { full_name?: string } | null
                  return (
                    <div key={action.id} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-50 last:border-0">
                      <span className="text-slate-700">
                        <span className="font-medium">{actor?.full_name ?? 'Someone'}</span>
                        {' '}
                        <span className="text-slate-500">{labelForAuditAction(action.action)}</span>
                        {' '}
                        <span className="text-slate-400 capitalize">{action.target_type}</span>
                      </span>
                      <span className="text-xs text-slate-400 flex-shrink-0 ml-2">
                        {formatDate(action.timestamp)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Public submission links */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Public submission links</CardTitle>
              {(userRole === 'lead_investigator' || userRole === 'admin') && (
                <GenerateTokenButton caseId={caseId} />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {(!tokens || tokens.length === 0) ? (
              <div className="text-center py-6">
                <Link2 className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No active submission links.</p>
                <p className="text-xs text-slate-400 mt-1">
                  Generate a link to allow public submissions.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {tokens.map((token) => (
                  <div key={token.id} className="flex items-center justify-between gap-2 p-2.5 bg-slate-50 rounded-md border border-slate-200">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-700 truncate">
                        {token.label ?? 'Submission form'}
                      </p>
                      <p className="text-xs text-slate-400 truncate font-mono">
                        {getPublicSubmitUrl(token.token)}
                      </p>
                    </div>
                    <CopyButton text={getPublicSubmitUrl(token.token)} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Server component can't use hooks — making this a separate client component
function GenerateTokenButton({ caseId }: { caseId: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={`/cases/${caseId}/settings#submission-links`}>
        <Plus className="h-4 w-4" />
        Generate link
      </Link>
    </Button>
  )
}
