import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AcceptInvitationClient } from './AcceptInvitationClient'

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  if (!token) {
    redirect('/login')
  }

  const supabase = await createClient()

  // Validate token
  const { data: invitation } = await supabase
    .from('case_invitations')
    .select('*, case:cases(id, title)')
    .eq('token', token)
    .single()

  if (!invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-md w-full bg-white rounded-lg border border-slate-200 p-8 text-center">
          <h1 className="text-xl font-bold text-slate-900 mb-2">Invalid invitation</h1>
          <p className="text-sm text-slate-500">This invitation link is not valid or has already been used.</p>
        </div>
      </div>
    )
  }

  if (invitation.accepted_at) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-md w-full bg-white rounded-lg border border-slate-200 p-8 text-center">
          <h1 className="text-xl font-bold text-slate-900 mb-2">Already accepted</h1>
          <p className="text-sm text-slate-500">This invitation has already been accepted.</p>
          <a
            href={`/cases/${invitation.case_id}`}
            className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
          >
            Go to case
          </a>
        </div>
      </div>
    )
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-md w-full bg-white rounded-lg border border-slate-200 p-8 text-center">
          <h1 className="text-xl font-bold text-slate-900 mb-2">Invitation expired</h1>
          <p className="text-sm text-slate-500">
            This invitation expired on{' '}
            {new Date(invitation.expires_at).toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric',
            })}.
          </p>
          <p className="text-sm text-slate-400 mt-2">Ask the case lead to send a new invitation.</p>
        </div>
      </div>
    )
  }

  const caseTitle = (invitation.case as { title?: string } | null)?.title ?? 'a case'

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <AcceptInvitationClient
        token={token}
        caseId={invitation.case_id}
        caseTitle={caseTitle}
        role={invitation.role}
        email={invitation.email}
      />
    </div>
  )
}
