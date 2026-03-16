import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendInvitationEmail } from '@/lib/email'
import type { UserRole } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      caseId,
      email,
      role,
    }: { caseId: string; email: string; role: UserRole } = body

    if (!caseId || !email || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Check that current user is lead_investigator or admin
    const { data: currentRole } = await supabase
      .from('case_user_roles')
      .select('role')
      .eq('case_id', caseId)
      .eq('user_id', user.id)
      .single()

    if (!currentRole || !['lead_investigator', 'admin'].includes(currentRole.role)) {
      return NextResponse.json({ error: 'Only lead investigators and admins can invite' }, { status: 403 })
    }

    // Check that user doesn't already have access (case_user_roles lookup by email requires admin)
    // We check case_invitations instead for pending invites
    const { data: existingInvite } = await supabase
      .from('case_invitations')
      .select('id')
      .eq('case_id', caseId)
      .eq('email', email.toLowerCase())
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (existingInvite) {
      return NextResponse.json(
        { error: 'A pending invitation already exists for this email' },
        { status: 409 }
      )
    }

    // Create invitation record
    const { data: invitation, error: inviteError } = await supabase
      .from('case_invitations')
      .insert({
        case_id: caseId,
        email: email.toLowerCase(),
        role,
        invited_by: user.id,
      })
      .select()
      .single()

    if (inviteError || !invitation) {
      console.error('Invitation insert error:', inviteError)
      return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
    }

    // Get case name and inviter profile for email
    const { data: caseData } = await supabase
      .from('cases')
      .select('title')
      .eq('id', caseId)
      .single()

    const { data: inviterProfile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const acceptUrl = `${appUrl}/invitations/accept?token=${invitation.token}`

    try {
      await sendInvitationEmail({
        to: email.toLowerCase(),
        caseName: caseData?.title ?? 'a case',
        role,
        invitedBy: inviterProfile?.full_name ?? user.email ?? 'A team member',
        acceptUrl,
      })
    } catch (emailErr) {
      console.error('Email send error (non-fatal):', emailErr)
      // Don't fail the whole request if email fails — invitation is still created
    }

    // Log review action
    await supabase.from('review_actions').insert({
      actor_id: user.id,
      action: 'created',
      target_type: 'case',
      target_id: caseId,
      case_id: caseId,
      note: `Invited ${email} as ${role}`,
    })

    return NextResponse.json({ ok: true, invitationId: invitation.id })
  } catch (error) {
    console.error('Invitations API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const caseId = searchParams.get('caseId')

    if (!caseId) {
      return NextResponse.json({ error: 'Missing caseId' }, { status: 400 })
    }

    const { data: invitations, error } = await supabase
      .from('case_invitations')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ invitations: invitations ?? [] })
  } catch (error) {
    console.error('GET invitations error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const invitationId = searchParams.get('id')

    if (!invitationId) {
      return NextResponse.json({ error: 'Missing invitation id' }, { status: 400 })
    }

    const { data: invitation } = await supabase
      .from('case_invitations')
      .select('case_id')
      .eq('id', invitationId)
      .single()

    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    // Verify caller is lead_investigator or admin
    const { data: roleData } = await supabase
      .from('case_user_roles')
      .select('role')
      .eq('case_id', invitation.case_id)
      .eq('user_id', user.id)
      .single()

    if (!roleData || !['lead_investigator', 'admin'].includes(roleData.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { error: deleteError } = await supabase
      .from('case_invitations')
      .delete()
      .eq('id', invitationId)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE invitation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
