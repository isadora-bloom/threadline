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
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as never)
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

  // Auto-assign new user as reviewer on all system cases
  // This gives them access to the full intelligence base
  const systemCaseTitles = [
    'NamUs Import — Missing Persons',
    'NamUs Import — Unidentified Remains',
    'Doe Network Import — Missing Persons',
    'Doe Network Import — Unidentified Persons',
    'Doe Network Import — Unidentified Remains',
    'Charley Project Import — Missing Persons',
  ]

  const { data: systemCases } = await supabase
    .from('cases')
    .select('id')
    .in('title', systemCaseTitles)

  if (systemCases?.length) {
    const roles = systemCases.map(c => ({
      case_id: (c as { id: string }).id,
      user_id: user.id,
      role: 'reviewer',
    }))

    for (const role of roles) {
      await supabase.from('case_user_roles').upsert(role, { onConflict: 'case_id,user_id' })
    }
  }

  return NextResponse.json({ ok: true })
}
