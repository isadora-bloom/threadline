/**
 * Bridge import_records → submissions
 *
 * Creates submissions from NamUs import_records so the existing DOE matcher,
 * offender analysis, cluster detection, stall flags, entity extraction etc.
 * all work on the NamUs data using the same 16-signal scoring engine.
 *
 * Creates two system cases:
 *   - "NamUs Import — Missing Persons"
 *   - "NamUs Import — Unidentified Remains"
 *
 * Each import_record becomes a submission with its raw_data converted to
 * the same structured text format the Doe Network data uses.
 *
 * Usage: npx tsx scripts/import-records-to-submissions.ts [--limit 5000]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 50000

async function getOrCreateCase(title: string, caseType: string): Promise<string> {
  // Check if case already exists
  const { data: existing } = await supabase
    .from('cases')
    .select('id')
    .eq('title', title)
    .single()

  if (existing) return existing.id

  // Create the case
  const { data: newCase, error } = await supabase
    .from('cases')
    .insert({
      title,
      case_type: caseType,
      status: 'active',
      visibility_level: 'team',
      notes: `System-generated case for imported ${caseType === 'missing_person' ? 'missing persons' : 'unidentified remains'} data from NamUs.`,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create case "${title}": ${error.message}`)
  return newCase.id
}

function buildStructuredText(record: Record<string, unknown>): string {
  const raw = record.raw_data as Record<string, unknown> | null
  const lines: string[] = []

  // Build in the same format as Doe Network data so the parser works identically
  if (record.person_name) lines.push(`Name: ${record.person_name}`)
  if (record.sex) lines.push(`Sex: ${record.sex}`)
  if (record.race) lines.push(`Race/Ethnicity: ${record.race}`)

  // Age — try to get from raw data first for richer info
  const ageMin = raw?.computedMissingMinAge ?? raw?.estimatedAgeFrom
  const ageMax = raw?.computedMissingMaxAge ?? raw?.estimatedAgeTo
  if (ageMin && ageMax && ageMin !== ageMax) {
    lines.push(`Age: ${ageMin}-${ageMax} years old`)
  } else if (record.age_text) {
    lines.push(`Age: ${record.age_text} years old`)
  }

  // Dates
  if (record.date_missing) lines.push(`Date Missing: ${record.date_missing}`)
  if (record.date_found) lines.push(`Date Found: ${record.date_found}`)

  // Location
  const city = record.city as string | null
  const state = record.state as string | null
  const county = (raw?.countyOfLastContact ?? raw?.countyOfRecovery) as string | null
  const locationParts = [city, county ? `${county} County` : null, state].filter(Boolean)
  if (locationParts.length > 0) {
    if (record.record_type === 'missing_person') {
      lines.push(`Last Seen: ${locationParts.join(', ')}`)
    } else {
      lines.push(`Location Found: ${locationParts.join(', ')}`)
    }
  }

  // Physical description from raw NamUs data
  const hair = raw?.hairColor as string | null
  if (hair) lines.push(`Hair: ${hair}`)

  // NamUs unidentified specific fields
  const conditionOfRemains = raw?.conditionOfRemains as string | null
  if (conditionOfRemains) lines.push(`State of Remains: ${conditionOfRemains}`)

  // NamUs case number for cross-reference
  const namusNumber = raw?.namus2Number as number | null
  if (namusNumber) {
    const prefix = record.record_type === 'missing_person' ? 'MP' : 'UP'
    lines.push(`NamUs ID: ${prefix}${namusNumber}`)
  }

  return lines.join('\n')
}

async function main() {
  console.log('=== Import Records → Submissions Bridge ===')
  console.log(`Limit: ${LIMIT}\n`)

  // Get or create the NamUs system cases
  const missingCaseId = await getOrCreateCase(
    'NamUs Import — Missing Persons',
    'missing_person'
  )
  const unidentifiedCaseId = await getOrCreateCase(
    'NamUs Import — Unidentified Remains',
    'unidentified_remains'
  )

  console.log('Missing case:', missingCaseId)
  console.log('Unidentified case:', unidentifiedCaseId)

  // Get NamUs source IDs
  const { data: sources } = await supabase
    .from('import_sources')
    .select('id, slug')
    .in('slug', ['namus_missing', 'namus_unidentified'])

  const namusMissingSourceId = sources?.find(s => s.slug === 'namus_missing')?.id
  const namusUnidentifiedSourceId = sources?.find(s => s.slug === 'namus_unidentified')?.id

  if (!namusMissingSourceId || !namusUnidentifiedSourceId) {
    console.error('NamUs sources not found in import_sources')
    process.exit(1)
  }

  // Check how many submissions already exist for these cases
  const { count: existingMissing } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', missingCaseId)

  const { count: existingUnidentified } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', unidentifiedCaseId)

  console.log(`Existing submissions: ${existingMissing} missing, ${existingUnidentified} unidentified`)

  // Fetch import records that don't already have a submission_id
  for (const [sourceId, caseId, recordType, label] of [
    [namusMissingSourceId, missingCaseId, 'missing_person', 'MISSING PERSONS'],
    [namusUnidentifiedSourceId, unidentifiedCaseId, 'unidentified_remains', 'UNIDENTIFIED REMAINS'],
  ] as [string, string, string, string][]) {

    console.log(`\n--- ${label} ---`)

    let offset = 0
    let totalInserted = 0
    let totalSkipped = 0
    const BATCH = 200

    while (offset < LIMIT) {
      const { data: records, error } = await supabase
        .from('import_records')
        .select('*')
        .eq('source_id', sourceId)
        .eq('record_type', recordType)
        .is('submission_id', null) // only records not yet bridged
        .range(offset, offset + BATCH - 1)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('  Fetch error:', error.message)
        break
      }
      if (!records || records.length === 0) break

      // Build submissions
      const submissions = records.map(r => ({
        case_id: caseId,
        raw_text: buildStructuredText(r),
        source_type: 'official_record' as const,
        review_status: 'confirmed' as const,
        event_date: r.date_missing ?? r.date_found ?? null,
        event_location: [r.city, r.state].filter(Boolean).join(', ') || null,
        submitter_consent: 'on_record' as const,
        firsthand: false,
        observation_mode: 'inferred_from_document' as const,
        triage_status: 'claimed',
        notes: `Imported from NamUs (${r.external_id})`,
      }))

      // Insert submissions
      const { data: inserted, error: insertErr } = await supabase
        .from('submissions')
        .insert(submissions)
        .select('id')

      if (insertErr) {
        console.error('  Insert error:', insertErr.message)
        totalSkipped += records.length
        offset += records.length
        continue
      }

      // Link import_records back to their submissions
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
      if (offset % 1000 === 0) {
        console.log(`  Progress: ${offset} processed, ${totalInserted} inserted`)
      }
    }

    console.log(`  Total inserted: ${totalInserted}`)
    console.log(`  Skipped: ${totalSkipped}`)
  }

  // Add user role so the matcher can access these cases
  const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))

  // Get any existing user to assign as lead
  const { data: anyUser } = await supabase
    .from('user_profiles')
    .select('id')
    .limit(1)
    .single()

  if (anyUser) {
    for (const caseId of [missingCaseId, unidentifiedCaseId]) {
      await supabase.from('case_user_roles').upsert({
        case_id: caseId,
        user_id: anyUser.id,
        role: 'lead_investigator',
      }, { onConflict: 'case_id,user_id' })
    }
    console.log(`\nAssigned ${anyUser.id} as lead investigator on both NamUs cases`)
  }

  console.log('\n=== Done ===')
  console.log('Now you can run the full DOE matcher:')
  console.log(`  POST /api/pattern/doe-match { action: "cross_match", missingCaseId: "${missingCaseId}", unidentifiedCaseId: "<unidentified_case_id>" }`)
}

main().catch(console.error)
