import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { submissionId }: { submissionId: string } = body

    if (!submissionId) {
      return NextResponse.json({ error: 'Missing submissionId' }, { status: 400 })
    }

    // Verify access
    const { data: submission } = await supabase
      .from('submissions')
      .select('id, case_id, review_started_at')
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

    // Only set review_started_at if not already set
    if (!submission.review_started_at) {
      const { error: updateError } = await supabase
        .from('submissions')
        .update({
          review_started_at: new Date().toISOString(),
          review_status: 'under_review',
        })
        .eq('id', submissionId)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    }

    // Log viewed action
    await supabase.from('review_actions').insert({
      actor_id: user.id,
      action: 'viewed',
      target_type: 'submission',
      target_id: submissionId,
      case_id: submission.case_id,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Start-review API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
