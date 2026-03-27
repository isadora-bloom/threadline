/**
 * AI Batch Processor
 *
 * Processes unprocessed import_records through Claude to extract:
 * - Structured entities (people, locations, vehicles, phones)
 * - Claims (sightings, identifiers, behavioral signals)
 * - Solvability signals
 * - Connection candidates
 *
 * Everything is tagged as AI-extracted / unverified.
 *
 * Usage: npx tsx scripts/ai-batch-process.ts [--limit 50] [--type missing_person|unidentified_remains]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const BATCH_SIZE = 10 // process 10 at a time
const DELAY_MS = 1500 // between API calls to avoid rate limits

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Parse CLI args
const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 100
const typeIdx = args.indexOf('--type')
const TYPE_FILTER = typeIdx !== -1 ? args[typeIdx + 1] : null

async function extractWithAI(record: {
  id: string
  record_type: string
  person_name: string | null
  age_text: string | null
  sex: string | null
  race: string | null
  state: string | null
  city: string | null
  date_missing: string | null
  date_found: string | null
  raw_data: Record<string, unknown>
  external_id: string
  external_url: string | null
}): Promise<Record<string, unknown> | null> {
  const isMissing = record.record_type === 'missing_person'

  const caseText = buildCaseText(record)

  const prompt = `You are analyzing a ${isMissing ? 'missing person' : 'unidentified remains'} case from a public database. Extract ALL investigative intelligence from this record.

Return a JSON object with this structure:

{
  "summary": "2-3 sentence plain-English summary of this case",

  "demographics": {
    "name": "full name or null",
    "aliases": ["known aliases"],
    "age_at_event": "number or null",
    "age_range_min": "number or null",
    "age_range_max": "number or null",
    "sex": "male|female|unknown",
    "race": "string or null",
    "height_inches": "number or null",
    "weight_lbs": "number or null",
    "hair_color": "string or null",
    "eye_color": "string or null",
    "distinguishing_marks": ["tattoos, scars, piercings, dental, etc."]
  },

  "geography": {
    "last_known_city": "string or null",
    "last_known_state": "string or null",
    "recovery_city": "string or null (for remains)",
    "recovery_state": "string or null (for remains)",
    "mentioned_locations": ["any other locations referenced"],
    "possible_destination": "string or null (if heading somewhere)",
    "nearest_highway": "string or null (e.g. I-35, US-101)"
  },

  "timeline": {
    "date_of_event": "YYYY-MM-DD or null",
    "date_precision": "exact|approximate|unknown",
    "last_contact_date": "YYYY-MM-DD or null",
    "recovery_date": "YYYY-MM-DD or null (for remains)",
    "year_range_start": "number or null",
    "year_range_end": "number or null"
  },

  "circumstances": {
    "brief": "1 sentence summary of circumstances",
    "detailed": "full circumstance text",
    "classification": "one of: stranger_abduction | family_abduction | runaway | voluntary_missing | endangered | lost | disaster | unknown | homicide | suicide | accidental | undetermined",
    "risk_factors": ["hitchhiking", "sex_work", "substance_abuse", "domestic_violence", "foster_care", "homelessness", "truck_stop", "highway", "college_campus", etc.],
    "cause_of_death": "string or null (for remains)",
    "manner_of_death": "string or null (for remains)",
    "body_condition": "intact|partially_decomposed|advanced_decomposition|skeletal|unknown or null"
  },

  "entities": [
    {
      "entity_type": "person|location|vehicle|phone|username|organization",
      "raw_value": "exact value",
      "role": "subject|associate|witness|vehicle_seen|location_reference|poi",
      "notes": "why notable"
    }
  ],

  "claims": [
    {
      "text": "specific factual claim extracted from the case",
      "type": "sighting|identifier|association|behavioral|physical_description|official",
      "confidence": "low|medium|high"
    }
  ],

  "behavioral_signals": {
    "mo_keywords": ["from: hitchhiker, sex_worker, truck_stop, runaway, college_campus, home_invasion, dating, foster_care, bar, highway_abduction, rest_area, motel, transient, camping"],
    "disposal_indicators": ["from: roadside, wooded, water, buried, left_in_place, remote, dumpster, abandoned_building"],
    "forensic_awareness": ["any signs of forensic countermeasures, staging, cleanup"]
  },

  "solvability_signals": {
    "has_named_poi": false,
    "has_vehicle_description": false,
    "has_specific_location": true,
    "has_witness_accounts": false,
    "has_physical_evidence": false,
    "has_dna_available": false,
    "has_dental_records": false,
    "stall_indicators": ["classified as runaway, voluntary departure with no followup, etc."],
    "investigative_gaps": ["things that should have been done but weren't mentioned"],
    "solvability_score": 0,
    "solvability_reasoning": "why this score"
  },

  "investigator_notes": "anything notable — red flags, inconsistencies, things that stand out, possible connections to look for"
}

Guidelines:
- Be thorough. Every name, location, vehicle, phone number, physical description matters.
- For solvability_score: 0-100. High (70+) = specific leads exist, evidence available. Medium (35-69) = some leads, needs work. Low (<35) = very cold, limited evidence.
- For stall_indicators: flag if a teen was classified as "runaway" or "voluntary" with no follow-up, if a case was closed quickly, if classification seems wrong.
- Extract behavioral signals even if subtle — "last seen at a truck stop" = truck_stop keyword.
- Return only the JSON object, no markdown fences.

---

CASE RECORD:

${caseText}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return null

    const raw = textBlock.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(raw)
  } catch (err) {
    console.error(`  AI error for ${record.external_id}:`, err instanceof Error ? err.message : err)
    return null
  }
}

function buildCaseText(record: {
  record_type: string
  person_name: string | null
  age_text: string | null
  sex: string | null
  race: string | null
  state: string | null
  city: string | null
  date_missing: string | null
  date_found: string | null
  raw_data: Record<string, unknown>
  external_id: string
  external_url: string | null
}): string {
  const lines: string[] = []
  const isMissing = record.record_type === 'missing_person'

  lines.push(`Type: ${isMissing ? 'Missing Person' : 'Unidentified Remains'}`)
  lines.push(`Source ID: ${record.external_id}`)
  if (record.person_name) lines.push(`Name: ${record.person_name}`)
  if (record.age_text) lines.push(`Age: ${record.age_text}`)
  if (record.sex) lines.push(`Sex: ${record.sex}`)
  if (record.race) lines.push(`Race: ${record.race}`)
  if (record.city) lines.push(`City: ${record.city}`)
  if (record.state) lines.push(`State: ${record.state}`)
  if (record.date_missing) lines.push(`Date Missing: ${record.date_missing}`)
  if (record.date_found) lines.push(`Date Found: ${record.date_found}`)

  // Include all raw data fields
  const rawData = record.raw_data
  if (rawData && typeof rawData === 'object') {
    lines.push('')
    lines.push('--- Full Record Data ---')
    for (const [key, value] of Object.entries(rawData)) {
      if (value !== null && value !== undefined && value !== '') {
        if (typeof value === 'object') {
          lines.push(`${key}: ${JSON.stringify(value)}`)
        } else {
          lines.push(`${key}: ${value}`)
        }
      }
    }
  }

  return lines.join('\n')
}

async function processBatch(records: Array<{
  id: string
  record_type: string
  person_name: string | null
  age_text: string | null
  sex: string | null
  race: string | null
  state: string | null
  city: string | null
  date_missing: string | null
  date_found: string | null
  raw_data: Record<string, unknown>
  external_id: string
  external_url: string | null
}>) {
  let processed = 0
  let failed = 0

  for (const record of records) {
    console.log(`  Processing ${record.external_id} (${record.person_name ?? 'unidentified'})...`)

    const extraction = await extractWithAI(record)

    if (extraction) {
      // Update import_record with AI extraction
      const { error } = await supabase
        .from('import_records')
        .update({
          ai_processed: true,
          ai_processed_at: new Date().toISOString(),
          ai_extraction: extraction,
        })
        .eq('id', record.id)

      if (error) {
        console.error(`  DB update error for ${record.external_id}:`, error.message)
        failed++
      } else {
        processed++

        // Insert solvability score if present
        const solvability = extraction.solvability_signals as {
          solvability_score?: number
          solvability_reasoning?: string
        } | undefined
        if (solvability?.solvability_score !== undefined) {
          const score = solvability.solvability_score
          const grade = score >= 70 ? 'high' : score >= 35 ? 'moderate' : 'low'

          const nextSteps = extraction.solvability_signals as { investigative_gaps?: string[] } | undefined

          await supabase
            .from('solvability_scores')
            .upsert({
              import_record_id: record.id,
              score,
              grade,
              signals: extraction.solvability_signals as Record<string, unknown>,
              ai_summary: solvability.solvability_reasoning ?? '',
              ai_next_steps: (nextSteps?.investigative_gaps ?? []) as string[],
              model_used: 'claude-sonnet-4-6-20250514',
              computed_at: new Date().toISOString(),
            }, { onConflict: 'import_record_id' })
        }
      }
    } else {
      failed++
    }

    await sleep(DELAY_MS)
  }

  return { processed, failed }
}

async function main() {
  console.log('=== Threadline AI Batch Processor ===')
  console.log(`Limit: ${LIMIT}, Type filter: ${TYPE_FILTER ?? 'all'}`)

  // Fetch unprocessed records
  let query = supabase
    .from('import_records')
    .select('*')
    .eq('ai_processed', false)
    .order('created_at', { ascending: true })
    .limit(LIMIT)

  if (TYPE_FILTER) {
    query = query.eq('record_type', TYPE_FILTER)
  }

  const { data: records, error } = await query

  if (error) {
    console.error('Failed to fetch records:', error.message)
    process.exit(1)
  }

  if (!records || records.length === 0) {
    console.log('No unprocessed records found.')
    return
  }

  console.log(`Found ${records.length} unprocessed records.`)

  let totalProcessed = 0
  let totalFailed = 0

  // Process in batches
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1} (records ${i + 1}-${i + batch.length})...`)

    const { processed, failed } = await processBatch(batch as never)
    totalProcessed += processed
    totalFailed += failed

    console.log(`  Batch complete: ${processed} processed, ${failed} failed`)
  }

  console.log(`\n=== Done ===`)
  console.log(`Total processed: ${totalProcessed}`)
  console.log(`Total failed: ${totalFailed}`)
}

main().catch(console.error)
