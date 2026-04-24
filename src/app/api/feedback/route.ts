import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface FeedbackBody {
  feedback_type: 'feedback' | 'bug' | 'idea' | 'match' | 'data'
  message: string
  contact?: string
  page_url?: string
}

const VALID_TYPES = new Set(['feedback', 'bug', 'idea', 'match', 'data'])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: FeedbackBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { feedback_type, message } = body
  if (!feedback_type || !VALID_TYPES.has(feedback_type)) {
    return NextResponse.json({ error: 'invalid feedback_type' }, { status: 400 })
  }
  if (!message?.trim()) {
    return NextResponse.json({ error: 'message required' }, { status: 400 })
  }
  if (message.length > 5000) {
    return NextResponse.json({ error: 'message too long (max 5,000 chars)' }, { status: 400 })
  }

  const contact = body.contact?.trim().slice(0, 200) || null
  const page_url = body.page_url?.slice(0, 500) || null

  const { error } = await supabase
    .from('feedback')
    .insert({
      user_id: user.id,
      feedback_type,
      message: message.trim(),
      contact,
      page_url,
    } as never)

  if (error) {
    console.error('Feedback insert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
