import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { token }: { token: string } = body

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    // Validate token
    const { data: invitation } = await supabase
      .from('case_invitations')
      .select('*')
      .eq('token', token)
      .single()

    if (!invitation) {
      return NextResponse.json({ error: 'Invalid invitation token' }, { status: 404 })
    }

    if (invitation.accepted_at) {
      return NextResponse.json({ error: 'Invitation already accepted' }, { status: 409 })
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
    }

    // Check user email matches invitation email
    if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      return NextResponse.json(
        { error: 'This invitation is for a different email address' },
        { status: 403 }
      )
    }

    // Check if user already has access
    const { data: existingRole } = await supabase
      .from('case_user_roles')
      .select('id')
      .eq('case_id', invitation.case_id)
      .eq('user_id', user.id)
      .single()

    // Use admin client to bypass RLS for case_user_roles insert
    const adminSupabase = createAdminClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    if (!existingRole) {
      const { error: roleError } = await adminSupabase
        .from('case_user_roles')
        .insert({
          case_id: invitation.case_id,
          user_id: user.id,
          role: invitation.role,
          invited_by: invitation.invited_by,
        })

      if (roleError) {
        console.error('Role insert error:', roleError)
        return NextResponse.json({ error: 'Failed to add case access' }, { status: 500 })
      }
    }

    // Mark invitation as accepted
    const { error: acceptError } = await adminSupabase
      .from('case_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id)

    if (acceptError) {
      console.error('Accept error:', acceptError)
    }

    // Log
    await supabase.from('review_actions').insert({
      actor_id: user.id,
      action: 'created',
      target_type: 'case',
      target_id: invitation.case_id,
      case_id: invitation.case_id,
      note: `Accepted invitation as ${invitation.role}`,
    })

    return NextResponse.json({ ok: true, caseId: invitation.case_id })
  } catch (error) {
    console.error('Accept invitation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
