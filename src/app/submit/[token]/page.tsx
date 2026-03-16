import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { IntakeFormWrapper } from './IntakeFormWrapper'

// Service role client — token validation runs server-side so the token
// is never exposed in client-side JavaScript bundles.
function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type TokenState = 'valid' | 'not_found' | 'expired' | 'deactivated'

async function resolveTokenState(token: string): Promise<{
  state: TokenState
  tokenData?: { token: string; case_id: string; is_active: boolean; expires_at: string | null }
}> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('submission_tokens')
    .select('token, case_id, is_active, expires_at')
    .eq('token', token)
    .single()

  if (error || !data) {
    return { state: 'not_found' }
  }

  if (!data.is_active) {
    return { state: 'deactivated' }
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { state: 'expired' }
  }

  return { state: 'valid', tokenData: data }
}

function ThreadlineLogo() {
  return (
    <div className="flex flex-col items-center mb-8">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 mb-3">
        <span className="text-lg font-bold text-white">TL</span>
      </div>
      <span className="text-sm font-semibold text-slate-700">Threadline</span>
    </div>
  )
}

function InactiveState({
  heading,
  body,
}: {
  heading: string
  body: string
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <ThreadlineLogo />
        <h1 className="text-lg font-semibold text-slate-900 mb-3">{heading}</h1>
        <p className="text-sm text-slate-500 leading-relaxed">{body}</p>
        <p className="text-sm text-slate-400 mt-4">
          Contact the case team directly if you believe this is an error.
        </p>
      </div>
    </div>
  )
}

export default async function SubmitPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const { state, tokenData } = await resolveTokenState(token)

  if (state === 'not_found') {
    return (
      <InactiveState
        heading="This link doesn't exist."
        body="If you were given a different link, check for typos. If you have information to share, contact the case team directly."
      />
    )
  }

  if (state === 'expired') {
    return (
      <InactiveState
        heading="This submission window has closed."
        body="The case team set an expiry date on this link and it has passed. If you have information to share, contact the case team directly."
      />
    )
  }

  if (state === 'deactivated') {
    return (
      <InactiveState
        heading="This submission link has been deactivated."
        body="The case team has closed this submission channel. If you have information to share, contact the case team directly."
      />
    )
  }

  // Valid token — render the intake form
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8 text-center">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 mb-4">
            <span className="text-lg font-bold text-white">TL</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Share what you know</h1>
          <p className="text-sm text-slate-500 mt-1">
            Your information may help. Take your time.
          </p>
        </div>

        <IntakeFormWrapper
          token={tokenData!.token}
          caseId={tokenData!.case_id}
        />
      </div>
    </div>
  )
}
