import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type TriageAction = 'claim' | 'defer' | 'discard'
type DiscardReason = 'off_topic' | 'duplicate' | 'spam' | 'insufficient_detail'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      submissionId,
      action,
      discardReason,
    }: { submissionId: string; action: TriageAction; discardReason?: DiscardReason } = body

    if (!submissionId || !action) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (action === 'discard' && !discardReason) {
      return NextResponse.json({ error: 'Discard reason required' }, { status: 400 })
    }

    // Verify user has access to this submission's case
    const { data: submission } = await supabase
      .from('submissions')
      .select('id, case_id')
      .eq('id', submissionId)
      .single()

    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }

    const { data: roleData } = await supabase
      .from('case_user_roles')
      .select('role')
      .eq('case_id', submission.case_id)
      .eq('user_id', user.id)
      .single()

    if (!roleData) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatePayload: any = {
      triage_status: action === 'claim' ? 'claimed' : action === 'defer' ? 'deferred' : 'discarded',
      triage_by: user.id,
      triage_at: now,
    }

    if (action === 'claim') {
      updatePayload.claimed_by = user.id
    }

    if (action === 'discard' && discardReason) {
      updatePayload.triage_discard_reason = discardReason
      // Soft delete: set discarded_at timestamp — never hard-delete
      updatePayload.discarded_at = now
    }

    const { error: updateError } = await supabase
      .from('submissions')
      .update(updatePayload)
      .eq('id', submissionId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Log review action
    await supabase.from('review_actions').insert({
      actor_id: user.id,
      action: 'edited',
      target_type: 'submission',
      target_id: submissionId,
      case_id: submission.case_id,
      note: `Triage: ${action}${discardReason ? ` (${discardReason})` : ''}`,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Triage API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
