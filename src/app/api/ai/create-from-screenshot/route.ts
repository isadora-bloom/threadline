import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface ExtractedClaim {
  extracted_text: string
  claim_type: string
  confidence: string
  notes?: string | null
}

interface ExtractedEntity {
  entity_type: string
  raw_value: string
  confidence: string
  entity_role: string
  notes?: string | null
}

interface SubmissionPayload {
  caseId: string
  raw_text: string
  summary: string
  source_type: string
  observation_mode: string
  firsthand: boolean
  event_date?: string | null
  event_location?: string | null
  notes?: string | null
  claims: ExtractedClaim[]
  entities: ExtractedEntity[]
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: SubmissionPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { caseId, raw_text, summary, source_type, observation_mode, firsthand, event_date, event_location, notes, claims, entities } = body

  if (!caseId || !raw_text) return NextResponse.json({ error: 'caseId and raw_text required' }, { status: 400 })

  // Verify access
  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()

  if (!roleData) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Create the submission
  const { data: submission, error: subError } = await supabase
    .from('submissions')
    .insert({
      case_id: caseId,
      raw_text,
      source_type: source_type as never,
      observation_mode: observation_mode as never,
      submitter_consent: 'on_record',
      firsthand,
      submitted_by: user.id,
      review_status: 'unverified',
      event_date: event_date || null,
      event_location: event_location || null,
      notes: [summary && `AI Screenshot Summary: ${summary}`, notes].filter(Boolean).join('\n\n') || null,
      has_date: !!event_date,
      has_location_pin: false,
      word_count: raw_text.split(/\s+/).filter(Boolean).length,
      entity_count_step6: entities?.length ?? 0,
    })
    .select('id')
    .single()

  if (subError || !submission) {
    console.error('Submission insert error:', subError)
    return NextResponse.json({ error: 'Failed to create submission' }, { status: 500 })
  }

  const submissionId = submission.id

  // Create claims
  if (claims?.length) {
    const claimRows = claims.map((c: ExtractedClaim) => ({
      submission_id: submissionId,
      case_id: caseId,
      extracted_text: c.extracted_text,
      claim_type: c.claim_type as never,
      source_confidence: c.confidence as never,
      content_confidence: c.confidence as never,
      verification_status: 'unverified' as never,
      interpretation_flag: c.claim_type === 'interpretation',
      notes: c.notes || null,
      created_by: user.id,
    }))

    const { error: claimError } = await supabase.from('claims').insert(claimRows)
    if (claimError) console.error('Claims insert error:', claimError)
  }

  // Create entities and link them
  if (entities?.length) {
    for (const e of entities) {
      // Upsert entity
      const { data: entityRow } = await supabase
        .from('entities')
        .insert({
          case_id: caseId,
          entity_type: e.entity_type as never,
          raw_value: e.raw_value,
          created_by: user.id,
        })
        .select('id')
        .single()

      if (entityRow) {
        // Get the first claim ID to link to (or skip linking if no claims)
        const { data: firstClaim } = await supabase
          .from('claims')
          .select('id')
          .eq('submission_id', submissionId)
          .limit(1)
          .single()

        if (firstClaim) {
          await supabase.from('claim_entity_links').insert({
            claim_id: firstClaim.id,
            entity_id: entityRow.id,
            entity_role: e.entity_role as never,
            identifier_source: 'found_in_document' as never,
            confidence: e.confidence as never,
            notes: e.notes || null,
          })
        }
      }
    }
  }

  return NextResponse.json({ submissionId })
}
