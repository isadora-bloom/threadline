import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/types'
import type { NoveltyFlag } from '@/lib/types'
import { encrypt } from '@/lib/encryption'

// Service role client to bypass RLS for public intake submissions
function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const supabase = createServiceClient()

    const {
      token,
      observation_mode,
      event_date_known,
      event_date,
      event_time,
      occurred_multiple_times,
      event_location,
      event_location_lat,
      event_location_lng,
      raw_text,
      firsthand,
      step6_entities,
      interpretation_text,
      submitter_consent,
      submitter_name,
      submitter_contact,
    } = body

    if (!token || !raw_text?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Validate token
    const { data: tokenData, error: tokenError } = await supabase
      .from('submission_tokens')
      .select('id, case_id, is_active, expires_at')
      .eq('token', token)
      .single()

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: 'Invalid submission link' }, { status: 404 })
    }

    if (!tokenData.is_active) {
      return NextResponse.json({ error: 'This submission link has been deactivated' }, { status: 410 })
    }

    if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This submission link has expired' }, { status: 410 })
    }

    // Determine source type
    let source_type: Database['public']['Enums']['source_type'] = 'anonymous'
    if (submitter_consent === 'named_individual' || submitter_consent === 'on_record') {
      source_type = 'named_individual'
    }

    // Build event_date timestamp
    let event_date_ts: string | null = null
    if (event_date) {
      const dateStr = event_date + (event_time ? `T${event_time}` : 'T00:00:00')
      event_date_ts = new Date(dateStr).toISOString()
    }

    const date_precision: Database['public']['Enums']['date_precision'] =
      event_date_known === 'exact' ? 'exact' :
      event_date_known === 'approximate' ? 'approximate' :
      'unknown'

    // Compute derived fields
    const word_count = countWords(raw_text)
    const entity_count_step6 = Array.isArray(step6_entities)
      ? step6_entities.filter((e: { value?: string }) => e.value?.trim()).length
      : 0
    const has_date = !!event_date
    const has_location_pin = !!(event_location_lat && event_location_lng)

    // Encrypt confidential submitter identity fields
    const shouldEncrypt = submitter_consent === 'confidential'

    // Create submission
    const { data: submission, error: submissionError } = await supabase
      .from('submissions')
      .insert({
        case_id: tokenData.case_id,
        raw_text: raw_text.trim(),
        source_type,
        submitter_name: submitter_consent !== 'anonymous'
          ? (shouldEncrypt && submitter_name ? encrypt(submitter_name) : submitter_name ?? null)
          : null,
        submitter_contact: submitter_consent !== 'anonymous'
          ? (shouldEncrypt && submitter_contact ? encrypt(submitter_contact) : submitter_contact ?? null)
          : null,
        submitter_consent,
        firsthand: firsthand === true,
        observation_mode,
        review_status: 'unverified',
        event_date: event_date_ts,
        event_date_precision: date_precision,
        event_location: event_location || null,
        event_location_lat: event_location_lat || null,
        event_location_lng: event_location_lng || null,
        occurred_multiple_times: occurred_multiple_times || false,
        interpretation_text: interpretation_text || null,
        word_count,
        entity_count_step6,
        has_date,
        has_location_pin,
        triage_status: 'untriaged',
      })
      .select()
      .single()

    if (submissionError || !submission) {
      console.error('Submission insert error:', submissionError)
      return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
    }

    // Create entities from step 6
    const insertedEntityValues: string[] = []
    if (step6_entities && step6_entities.length > 0) {
      const validEntities = step6_entities.filter(
        (e: { value?: string }) => e.value?.trim()
      )

      if (validEntities.length > 0) {
        const entityInserts = validEntities.map(
          (e: {
            entity_type: string
            value: string
            identifier_source: string
            confidence: string
          }) => {
            insertedEntityValues.push(e.value.trim().toLowerCase())
            return {
              case_id: tokenData.case_id,
              entity_type: e.entity_type as Database['public']['Enums']['entity_type'],
              raw_value: e.value.trim(),
              normalization_status: 'raw' as Database['public']['Enums']['normalization_status'],
              confidence: e.confidence as Database['public']['Enums']['confidence_level'],
            }
          }
        )

        const { error: entityError } = await supabase
          .from('entities')
          .insert(entityInserts)

        if (entityError) {
          console.error('Entity insert error:', entityError)
        }
      }
    }

    // Compute priority score via Postgres RPC
    let priority_score = 0
    let priority_level = 'medium'
    try {
      const { data: priorityData } = await supabase
        .rpc('compute_submission_priority', { p_submission_id: submission.id })

      if (priorityData && priorityData.length > 0) {
        priority_score = priorityData[0].score
        priority_level = priorityData[0].level
      }
    } catch (err) {
      console.error('Priority RPC error:', err)
    }

    // Novelty check — compare submitted entities against existing case entities
    const novelty_flags: NoveltyFlag[] = []
    if (insertedEntityValues.length > 0) {
      const { data: existingEntities } = await supabase
        .from('entities')
        .select('id, raw_value, normalized_value')
        .eq('case_id', tokenData.case_id)
        .neq('created_at', submission.created_at) // exclude just-inserted ones (approximate)

      if (existingEntities) {
        const existingValues = existingEntities.map(e =>
          (e.normalized_value ?? e.raw_value).toLowerCase()
        )

        for (const submittedVal of insertedEntityValues) {
          const isExisting = existingValues.some(ev => {
            // Simple fuzzy match: check if one contains the other or they share 80%+ chars
            if (ev === submittedVal) return true
            if (ev.includes(submittedVal) || submittedVal.includes(ev)) return true
            // Token-level similarity
            const tokensA = submittedVal.split(/\s+/)
            const tokensB = ev.split(/\s+/)
            const shared = tokensA.filter(t => tokensB.includes(t)).length
            const total = Math.max(tokensA.length, tokensB.length)
            return total > 0 && shared / total >= 0.8
          })

          if (isExisting) {
            // Count how many existing entities match
            const matchCount = existingValues.filter(ev =>
              ev === submittedVal || ev.includes(submittedVal) || submittedVal.includes(ev)
            ).length

            novelty_flags.push({
              type: 'corroboration',
              label: submittedVal,
              count: matchCount,
            })
          } else {
            novelty_flags.push({
              type: 'new_entity',
              label: submittedVal,
            })
          }
        }
      }
    }

    // Duplicate similarity check — simple text-based comparison
    // In production this would use pg_trgm; here we use a lightweight approach
    let duplicate_similarity: number | null = null
    let duplicate_of_submission_id: string | null = null

    try {
      const { data: otherSubmissions } = await supabase
        .from('submissions')
        .select('id, raw_text')
        .eq('case_id', tokenData.case_id)
        .neq('id', submission.id)
        .limit(50)

      if (otherSubmissions && otherSubmissions.length > 0) {
        const rawNormalized = raw_text.toLowerCase().trim()
        let maxSim = 0
        let mostSimilarId: string | null = null

        for (const other of otherSubmissions) {
          const otherNorm = other.raw_text.toLowerCase().trim()
          // Jaccard similarity on word tokens
          const setA = new Set(rawNormalized.split(/\s+/))
          const setB = new Set(otherNorm.split(/\s+/))
          const intersection = [...setA].filter(w => setB.has(w)).length
          const union = new Set([...setA, ...setB]).size
          const sim = union > 0 ? intersection / union : 0

          if (sim > maxSim) {
            maxSim = sim
            mostSimilarId = other.id
          }
        }

        if (maxSim > 0.6) {
          duplicate_similarity = Math.round(maxSim * 100) / 100
          duplicate_of_submission_id = mostSimilarId

          if (maxSim > 0.75) {
            novelty_flags.push({
              type: 'duplicate',
              label: `Possible duplicate`,
              similarity: Math.round(maxSim * 100),
            })
          }

          // Create similarity record
          if (mostSimilarId) {
            await supabase.from('submission_similarity').insert({
              submission_a_id: submission.id,
              submission_b_id: mostSimilarId,
              similarity_score: maxSim,
            }).then(({ error }) => {
              if (error) console.error('Similarity insert error:', error)
            })
          }
        }
      }
    } catch (err) {
      console.error('Duplicate check error:', err)
    }

    // Update submission with computed fields
    const { error: updateError } = await supabase
      .from('submissions')
      .update({
        priority_score,
        priority_level,
        novelty_flags: novelty_flags as unknown as Json,
        duplicate_similarity,
        duplicate_of_submission_id,
      })
      .eq('id', submission.id)

    if (updateError) {
      console.error('Priority update error:', updateError)
    }

    // Log audit action
    await supabase.from('review_actions').insert({
      actor_id: '00000000-0000-0000-0000-000000000000', // system actor for public submissions
      action: 'created',
      target_type: 'submission',
      target_id: submission.id,
      case_id: tokenData.case_id,
      note: 'Public intake form submission',
    })

    return NextResponse.json({ submission_id: submission.id }, { status: 201 })

  } catch (error) {
    console.error('Intake API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
