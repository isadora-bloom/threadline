/**
 * Bridge Charley Project import_records → submissions
 *
 * Creates submissions from Charley Project import_records so the existing
 * DOE matcher can score them. Same pattern as NamUs bridging.
 *
 * Creates system cases:
 *   - "Charley Project Import — Missing Persons"
 *
 * Usage: npx tsx scripts/bridge-charley-submissions.ts
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getOrCreateCase(title: string, caseType: string): Promise<string> {
  const { data: existing } = await supabase
    .from('cases')
    .select('id')
    .eq('title', title)
    .single()

  if (existing) return existing.id

  const { data: newCase, error } = await supabase
    .from('cases')
    .insert({
      title,
      case_type: caseType,
      status: 'active',
      visibility_level: 'team',
      notes: `System-generated case for Charley Project imported data.`,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create case: ${error.message}`)
  return newCase.id
}

function buildSubmissionText(record: Record<string, unknown>): string {
  const raw = record.raw_data as Record<string, unknown> | null
  const lines: string[] = []

  if (record.person_name) lines.push(`Name: ${record.person_name}`)

  // Extract from raw_data which has the full Charley Project scrape
  if (raw) {
    if (raw.sex) lines.push(`Sex: ${raw.sex}`)
    if (raw.race) lines.push(`Race/Ethnicity: ${raw.race}`)
    if (raw.dob) lines.push(`Date of Birth: ${raw.dob}`)
    if (raw.age) lines.push(`Age: ${raw.age}`)
    if (record.date_missing) lines.push(`Date Missing: ${record.date_missing}`)
    if (raw.missingFrom) lines.push(`Last Seen: ${raw.missingFrom}`)
    if (raw.classification) lines.push(`Case Classification: ${raw.classification}`)
    if (raw.height) lines.push(`Height: ${raw.height}`)
    if (raw.weight) lines.push(`Weight: ${raw.weight}`)
    if (raw.hair) lines.push(`Hair: ${raw.hair}`)
    if (raw.eyes) lines.push(`Eyes: ${raw.eyes}`)
    if (raw.distinguishingCharacteristics) lines.push(`Distinguishing Marks: ${raw.distinguishingCharacteristics}`)
    if (raw.clothing) lines.push(`Clothing: ${raw.clothing}`)
    if (raw.medicalConditions) lines.push(`Medical Conditions: ${raw.medicalConditions}`)
    if (raw.investigatingAgency) lines.push(`Investigating Agency: ${raw.investigatingAgency}`)
    if (raw.details) lines.push(`Circumstances: ${raw.details}`)
    if (raw.vehicles) lines.push(`Vehicles: ${raw.vehicles}`)
    if (raw.namusNumber) lines.push(`NamUs ID: ${raw.namusNumber}`)
  } else {
    // Fallback to structured fields
    if (record.sex) lines.push(`Sex: ${record.sex}`)
    if (record.race) lines.push(`Race/Ethnicity: ${record.race}`)
    if (record.age_text) lines.push(`Age: ${record.age_text} years old`)
    if (record.date_missing) lines.push(`Date Missing: ${record.date_missing}`)
    if (record.city && record.state) lines.push(`Last Seen: ${record.city}, ${record.state}`)
    if (record.classification) lines.push(`Case Classification: ${record.classification}`)
    if (record.circumstances_summary) lines.push(`Circumstances: ${record.circumstances_summary}`)
  }

  return lines.join('\n')
}

async function main() {
  console.log('=== Bridge Charley Project → Submissions ===\n')

  const caseId = await getOrCreateCase(
    'Charley Project Import — Missing Persons',
    'missing_person'
  )
  console.log('Case ID:', caseId)

  // Get Charley Project source
  const { data: source } = await supabase
    .from('import_sources')
    .select('id')
    .eq('slug', 'charley_project')
    .single()

  if (!source) { console.error('No charley_project source'); process.exit(1) }

  // Check existing
  const { count: existing } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
  console.log('Existing submissions:', existing)

  // Fetch Charley Project records without submission_id
  let offset = 0
  let totalInserted = 0
  const BATCH = 200

  while (true) {
    const { data: records, error } = await supabase
      .from('import_records')
      .select('*')
      .eq('source_id', source.id)
      .is('submission_id', null)
      .range(offset, offset + BATCH - 1)
      .order('created_at', { ascending: true })

    if (error) { console.error('Fetch error:', error.message); break }
    if (!records || records.length === 0) break

    const submissions = records.map(r => ({
      case_id: caseId,
      raw_text: buildSubmissionText(r),
      source_type: 'official_record' as const,
      review_status: 'confirmed' as const,
      event_date: r.date_missing ?? null,
      event_location: [r.city, r.state].filter(Boolean).join(', ') || null,
      submitter_consent: 'on_record' as const,
      firsthand: false,
      observation_mode: 'inferred_from_document' as const,
      triage_status: 'claimed',
      notes: `Imported from The Charley Project (${r.external_id})`,
    }))

    const { data: inserted, error: insertErr } = await supabase
      .from('submissions')
      .insert(submissions)
      .select('id')

    if (insertErr) {
      console.error('Insert error:', insertErr.message)
      offset += records.length
      continue
    }

    // Link back
    if (inserted) {
      for (let i = 0; i < inserted.length && i < records.length; i++) {
        await supabase
          .from('import_records')
          .update({ submission_id: inserted[i].id, case_id: caseId })
          .eq('id', records[i].id)
      }
      totalInserted += inserted.length
    }

    offset += records.length
    if (offset % 500 === 0) {
      console.log(`Progress: ${offset} processed, ${totalInserted} inserted`)
    }
  }

  // Assign user role
  const { data: anyUser } = await supabase
    .from('user_profiles')
    .select('id')
    .limit(1)
    .single()

  if (anyUser) {
    await supabase.from('case_user_roles').upsert({
      case_id: caseId,
      user_id: anyUser.id,
      role: 'lead_investigator',
    }, { onConflict: 'case_id,user_id' })
  }

  console.log('\n=== Done ===')
  console.log('Inserted:', totalInserted)
  console.log('Case:', caseId)
}

main().catch(console.error)
