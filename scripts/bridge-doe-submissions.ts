/**
 * Bridge Doe Network Submissions → import_records
 *
 * Reads existing Doe Network submissions (already in the submissions table)
 * and creates matching import_records rows so they appear in the registry
 * and intelligence dashboard alongside NamUs data.
 *
 * Parses the structured raw_text to extract demographics.
 * Links each import_record back to its submission_id.
 *
 * Usage: npx tsx scripts/bridge-doe-submissions.ts
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DOE_CASES = {
  missing: '920fa7c7-16bd-43a6-9700-60cecefcbf59',
  unidentified_persons: 'c815abc2-8541-4d15-961a-8b332bbc6a15',
  unidentified_remains: '4838c55f-a4cd-49f8-8011-22536a2ea75e',
}

function parseField(text: string, field: string): string | null {
  const regex = new RegExp(`^${field}:\\s*(.+)$`, 'mi')
  const match = text.match(regex)
  return match ? match[1].trim() : null
}

function parseState(location: string | null): string | null {
  if (!location) return null
  // "Crestview, Okaloosa County, Florida" → "Florida"
  const parts = location.split(',').map(s => s.trim())
  return parts[parts.length - 1] || null
}

function parseCity(location: string | null): string | null {
  if (!location) return null
  const parts = location.split(',').map(s => s.trim())
  return parts[0] || null
}

function parseAge(text: string): string | null {
  const ageField = parseField(text, 'Age')
  if (!ageField) return null
  const match = ageField.match(/(\d+)/)
  return match ? match[1] : null
}

function parseDateField(text: string, field: string): string | null {
  const val = parseField(text, field)
  if (!val) return null
  try {
    const d = new Date(val)
    if (isNaN(d.getTime())) return null
    return d.toISOString().split('T')[0]
  } catch {
    return null
  }
}

function extractDoeId(text: string): string | null {
  // Look for Doe Network case number patterns like "Case #1234DFFL"
  const match = text.match(/(?:Case\s*#?\s*|Doe Network\s*(?:Case\s*)?#?\s*)(\d+\w+)/i)
  if (match) return match[1]
  // Look for NamUs number
  const namusMatch = text.match(/NamUs\s*(?:MP|UP|Case)?\s*#?\s*(\d+)/i)
  if (namusMatch) return `NAMUS-${namusMatch[1]}`
  return null
}

async function main() {
  console.log('=== Bridge Doe Network Submissions → import_records ===\n')

  // Get doe_network source ID
  const { data: source } = await supabase
    .from('import_sources')
    .select('id')
    .eq('slug', 'doe_network')
    .single()

  if (!source) {
    console.error('No doe_network source found in import_sources')
    process.exit(1)
  }

  const sourceId = source.id
  console.log('Doe Network source ID:', sourceId)

  // Check how many already bridged
  const { count: alreadyBridged } = await supabase
    .from('import_records')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', sourceId)

  console.log('Already bridged:', alreadyBridged)

  let totalInserted = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const [caseType, caseId] of Object.entries(DOE_CASES)) {
    const recordType = caseType === 'missing' ? 'missing_person' : 'unidentified_remains'
    console.log(`\n--- ${caseType} (${caseId}) ---`)

    // Fetch all submissions in batches
    let offset = 0
    const BATCH = 500

    while (true) {
      const { data: submissions, error } = await supabase
        .from('submissions')
        .select('id, raw_text, event_date, event_location')
        .eq('case_id', caseId)
        .range(offset, offset + BATCH - 1)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('  Fetch error:', error.message)
        totalErrors++
        break
      }

      if (!submissions || submissions.length === 0) break

      const inserts = []

      for (const sub of submissions) {
        const text = sub.raw_text ?? ''

        // Parse fields from structured text
        const name = parseField(text, 'Name')
        const sex = parseField(text, 'Sex')
        const race = parseField(text, 'Race/Ethnicity') ?? parseField(text, 'Race')
        const age = parseAge(text)
        const location = sub.event_location ?? parseField(text, 'Last Seen') ?? parseField(text, 'Found')
        const state = parseState(location)
        const city = parseCity(location)
        const dateMissing = recordType === 'missing_person'
          ? (sub.event_date?.split('T')[0] ?? parseDateField(text, 'Date Missing'))
          : null
        const dateFound = recordType === 'unidentified_remains'
          ? (sub.event_date?.split('T')[0] ?? parseDateField(text, 'Date Found') ?? parseDateField(text, 'Date Recovered'))
          : null

        // Generate external ID from submission or parsed Doe ID
        const doeId = extractDoeId(text)
        const externalId = doeId ?? `DOE-SUB-${sub.id.slice(0, 8)}`

        const rawData = {
          source: 'doe_network_submission_bridge',
          submission_id: sub.id,
          case_id: caseId,
          raw_text: text,
          event_date: sub.event_date,
          event_location: sub.event_location,
        }

        const hash = createHash('sha256').update(JSON.stringify(rawData)).digest('hex')

        inserts.push({
          source_id: sourceId,
          external_id: externalId,
          external_url: null,
          case_id: caseId,
          submission_id: sub.id,
          raw_data: rawData,
          record_type: recordType,
          person_name: name,
          age_text: age,
          sex: sex,
          race: race,
          state: state,
          city: city,
          date_missing: dateMissing,
          date_found: dateFound,
          ai_processed: false,
          sync_hash: hash,
        })
      }

      // Upsert batch (skip conflicts)
      if (inserts.length > 0) {
        const { data: result, error: upsertErr } = await supabase
          .from('import_records')
          .upsert(inserts, { onConflict: 'source_id,external_id', ignoreDuplicates: true })
          .select('id')

        if (upsertErr) {
          // Try one by one on batch failure
          let batchInserted = 0
          for (const record of inserts) {
            const { error: singleErr } = await supabase
              .from('import_records')
              .upsert(record, { onConflict: 'source_id,external_id', ignoreDuplicates: true })

            if (singleErr) {
              totalSkipped++
            } else {
              batchInserted++
            }
          }
          totalInserted += batchInserted
        } else {
          totalInserted += result?.length ?? inserts.length
        }
      }

      offset += submissions.length
      if (offset % 2000 === 0) {
        console.log(`  Progress: ${offset} processed`)
      }

      if (submissions.length < BATCH) break
    }

    console.log(`  Processed ${offset} submissions`)
  }

  // Update source totals
  const { count: finalCount } = await supabase
    .from('import_records')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', sourceId)

  await supabase.from('import_sources').update({
    total_records: finalCount,
    last_import_at: new Date().toISOString(),
  }).eq('id', sourceId)

  console.log('\n=== Summary ===')
  console.log('Inserted:', totalInserted)
  console.log('Skipped (dupes):', totalSkipped)
  console.log('Errors:', totalErrors)
  console.log('Total Doe Network records in import_records:', finalCount)
}

main().catch(console.error)
