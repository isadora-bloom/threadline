import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: Request) {
  try {
    // Verify shared secret
    const secret = process.env.SCAN_WEBHOOK_SECRET
    if (!secret) {
      // If no secret configured, reject all webhook calls
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
    }

    const authHeader = request.headers.get('authorization')
    const providedSecret = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : request.headers.get('x-webhook-secret')

    if (providedSecret !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      fileId,
      scanResult,
      scanner,
    }: { fileId: string; scanResult: 'clean' | 'flagged'; scanner: string } = body

    if (!fileId || !scanResult || !scanner) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (!['clean', 'flagged'].includes(scanResult)) {
      return NextResponse.json({ error: 'Invalid scanResult — must be clean or flagged' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const now = new Date().toISOString()

    // Update scan status on the file
    const { data: fileData, error: fileError } = await supabase
      .from('submission_files')
      .update({
        scan_status: scanResult,
        scan_completed_at: now,
      })
      .eq('id', fileId)
      .select('submission_id')
      .single()

    if (fileError || !fileData) {
      console.error('Scan webhook: file update error', fileError)
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // If flagged, set the submission to under_review and add a note
    if (scanResult === 'flagged') {
      const { data: submissionData } = await supabase
        .from('submissions')
        .select('case_id, notes')
        .eq('id', fileData.submission_id)
        .single()

      const existingNotes = submissionData?.notes ?? ''
      const flagNote = `[SCAN ALERT ${now}] File ${fileId} flagged by virus scanner (${scanner}). Review before proceeding.`
      const updatedNotes = existingNotes
        ? `${existingNotes}\n\n${flagNote}`
        : flagNote

      await supabase
        .from('submissions')
        .update({
          review_status: 'under_review',
          notes: updatedNotes,
        })
        .eq('id', fileData.submission_id)

      // Log audit action
      if (submissionData?.case_id) {
        await supabase.from('review_actions').insert({
          actor_id: '00000000-0000-0000-0000-000000000000', // system actor
          action: 'flagged',
          target_type: 'submission',
          target_id: fileData.submission_id,
          case_id: submissionData.case_id,
          note: `File scan flagged by ${scanner} — submission placed under review`,
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Scan webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
