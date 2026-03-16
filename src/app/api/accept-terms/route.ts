import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const CURRENT_TOS_VERSION = '2026-03'

export async function POST() {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const acceptedAt = new Date().toISOString()

  // Store in auth user_metadata — checked by middleware without extra DB query
  const { error: metaError } = await supabase.auth.updateUser({
    data: {
      tos_accepted_at: acceptedAt,
      tos_accepted_version: CURRENT_TOS_VERSION,
    },
  })

  if (metaError) {
    return NextResponse.json({ error: metaError.message }, { status: 500 })
  }

  // Also persist to user_profiles for record-keeping and audit
  await supabase
    .from('user_profiles')
    .upsert({
      id: user.id,
      accepted_tos_at: acceptedAt,
      accepted_tos_version: CURRENT_TOS_VERSION,
    })

  return NextResponse.json({ ok: true })
}
