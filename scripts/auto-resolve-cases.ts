/**
 * Auto-Resolve Cases
 *
 * Scans submission text for resolution language (convicted, confessed, found alive, etc.)
 * Uses Claude to extract:
 *   1. Resolution type (found_alive, perpetrator_convicted, etc.)
 *   2. Perpetrator details — upserts into known_offenders if not already present
 * Updates submissions.resolution_type + submissions.convicted_offender_id.
 *
 * Only processes submissions where resolution_type IS NULL (won't overwrite manual entries).
 * After running, re-run: npx tsx scripts/run-offender-match.ts
 *
 * Run: npx tsx scripts/auto-resolve-cases.ts
 * Dry: npx tsx scripts/auto-resolve-cases.ts --dry-run
 * Single: npx tsx scripts/auto-resolve-cases.ts --name "Kristi Suzanne Krebs"
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { REVIEW_MODEL } from '../src/lib/ai-models'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const isDryRun = process.argv.includes('--dry-run')
const nameFilter = (() => {
  const idx = process.argv.indexOf('--name')
  return idx !== -1 ? process.argv[idx + 1] : null
})()

// ── Resolution keywords (fast pre-filter before Claude) ───────────────────────

const RESOLUTION_KEYWORDS = [
  'convicted', 'confessed', 'found alive', 'identified as', 'sentenced',
  'pleaded guilty', 'pled guilty', 'charged with murder', 'charged with',
  'remains were identified', 'body was identified', 'dna confirmed',
  'case was solved', 'killer was', 'murderer was', 'perpetrator was',
  'arrested for', 'found guilty', 'arrest of', 'was arrested',
  'indicted', 'indicted for', 'murder of', 'case was closed',
  'has been charged', 'has been arrested', 'was charged',
  'admitted to', 'admitted killing', 'pled no contest',
  'announced the arrest', 'taken into custody', 'in custody for',
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface ResolutionResult {
  resolution_type:
    | 'found_alive'
    | 'remains_identified'
    | 'perpetrator_convicted'
    | 'perpetrator_identified'
    | 'closed_unresolved'
    | 'duplicate_case'
    | null
  resolution_notes: string | null
  perpetrator: OffenderExtract | null
}

interface OffenderExtract {
  name: string
  aliases: string[]
  birth_year: number | null
  status: 'convicted' | 'deceased' | 'incarcerated' | 'released' | 'suspected'
  conviction_count: number | null
  suspected_count: number | null
  active_from: number | null
  active_to: number | null
  incarcerated_from: number | null
  home_states: string[]
  operation_states: string[]
  victim_states: string[]
  victim_sex: 'female' | 'male' | 'both' | null
  victim_age_min: number | null
  victim_age_max: number | null
  victim_age_typical: number | null
  victim_races: string[]
  mo_keywords: string[]
  disposal_method: string[]
  cause_of_death: string[]
  signature_details: string | null
  wikipedia_slug: string | null
  source_notes: string
}

// ── Claude analysis ───────────────────────────────────────────────────────────

async function analyzeSubmission(text: string): Promise<ResolutionResult> {
  const prompt = `You are helping a case intelligence platform auto-detect resolution status for missing persons and homicide cases.

Read the following case text and determine:
1. Has this case been resolved? (person found alive, perpetrator convicted/confessed, remains identified, etc.)
2. If yes, what type of resolution?
3. If a perpetrator is named, extract all known details about them for a criminal database.

Return ONLY a JSON object — no markdown, no explanation:
{
  "resolution_type": "found_alive" | "remains_identified" | "perpetrator_convicted" | "perpetrator_identified" | "closed_unresolved" | "duplicate_case" | null,
  "resolution_notes": "brief factual one-sentence summary, or null",
  "perpetrator": {
    "name": "Full legal name",
    "aliases": ["nickname", "aka"],
    "birth_year": 1950,
    "status": "convicted" | "deceased" | "incarcerated" | "released" | "suspected",
    "conviction_count": 3,
    "suspected_count": 12,
    "active_from": 1970,
    "active_to": 1984,
    "incarcerated_from": 1984,
    "home_states": ["FL", "TX"],
    "operation_states": ["FL", "TX", "GA"],
    "victim_states": ["FL", "TX", "GA"],
    "victim_sex": "female" | "male" | "both" | null,
    "victim_age_min": 14,
    "victim_age_max": 35,
    "victim_age_typical": 20,
    "victim_races": ["white", "hispanic"],
    "mo_keywords": ["hitchhiker", "highway_abduction"],
    "disposal_method": ["roadside", "wooded"],
    "cause_of_death": ["strangulation", "stabbing"],
    "signature_details": "brief MO description",
    "wikipedia_slug": "John_Smith_(criminal)" or null,
    "source_notes": "court records / FBI / Wikipedia"
  } or null
}

Resolution rules:
- "perpetrator_convicted": named person was convicted in court for this case
- "perpetrator_identified": named but not convicted (died before trial, case pending, foreign jurisdiction, etc.)
- "found_alive": missing person was located alive
- "remains_identified": unidentified remains were matched to a specific person
- "closed_unresolved": closed with no resolution
- null: case still open / insufficient information

For mo_keywords use only: hitchhiker, sex_worker, truck_stop, runaway, college_campus, home_invasion, dating, foster_care, bar, highway_abduction, beauty_pageant, modeling_lure, good_samaritan, online, abduction_vehicle
For victim_races use: white, black, hispanic, asian, native_american, mixed, unknown
For US states use 2-letter abbreviations

CASE TEXT:
${text.slice(0, 3000)}`

  const response = await anthropic.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = (response.content[0] as { text: string }).text.trim()
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

  try {
    return JSON.parse(cleaned) as ResolutionResult
  } catch {
    return { resolution_type: null, resolution_notes: null, perpetrator: null }
  }
}

// ── Upsert offender ───────────────────────────────────────────────────────────

async function upsertOffender(extract: OffenderExtract): Promise<string | null> {
  // Check by exact name
  const { data: existing } = await supabase
    .from('known_offenders')
    .select('id, name')
    .ilike('name', extract.name)
    .maybeSingle()

  if (existing) {
    console.log(`     already in DB: ${existing.name}`)
    return existing.id
  }

  if (isDryRun) {
    console.log(`     [DRY RUN] would add offender: ${extract.name} (${extract.status}, active ${extract.active_from}–${extract.active_to ?? '?'})`)
    return '__dry_run__'
  }

  const { data: inserted, error } = await supabase
    .from('known_offenders')
    .insert({
      name: extract.name,
      aliases: extract.aliases ?? [],
      birth_year: extract.birth_year,
      status: extract.status ?? 'convicted',
      conviction_count: extract.conviction_count,
      suspected_count: extract.suspected_count,
      active_from: extract.active_from,
      active_to: extract.active_to,
      incarcerated_from: extract.incarcerated_from,
      home_states: extract.home_states ?? [],
      operation_states: extract.operation_states ?? [],
      victim_states: extract.victim_states ?? [],
      victim_sex: extract.victim_sex ?? 'female',
      victim_races: extract.victim_races ?? [],
      victim_age_min: extract.victim_age_min,
      victim_age_max: extract.victim_age_max,
      victim_age_typical: extract.victim_age_typical,
      mo_keywords: extract.mo_keywords ?? [],
      disposal_method: extract.disposal_method ?? [],
      cause_of_death: extract.cause_of_death ?? [],
      signature_details: extract.signature_details,
      wikipedia_slug: extract.wikipedia_slug,
      source_notes: extract.source_notes,
    })
    .select('id')
    .single()

  if (error) {
    console.error(`     ✗ insert failed: ${error.message}`)
    return null
  }

  console.log(`     ✓ added to known_offenders: ${extract.name} (${inserted.id})`)
  return inserted.id
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  Auto-Resolve Submissions${isDryRun ? ' [DRY RUN]' : ''}`)
  if (nameFilter) console.log(`  Filter: "${nameFilter}"`)
  console.log(`${'═'.repeat(60)}\n`)

  // Build keyword filter
  const keywordFilter = RESOLUTION_KEYWORDS.map(k => `raw_text.ilike.%${k}%`).join(',')

  let query = supabase
    .from('submissions')
    .select('id, raw_text')
    .is('resolution_type', null)
    .or(keywordFilter)
    .order('created_at', { ascending: true })

  if (nameFilter) {
    query = query.ilike('raw_text', `%${nameFilter}%`)
  }

  const { data: candidates, error } = await query

  if (error) {
    // Migration 019 may not be applied yet
    if (error.message.includes('resolution_type')) {
      console.error('✗ Column resolution_type not found on submissions.')
      console.error('  Run migration 019_submission_resolution.sql in Supabase first.')
      process.exit(1)
    }
    console.error('Failed to fetch submissions:', error.message)
    process.exit(1)
  }

  console.log(`Found ${candidates?.length ?? 0} candidate submissions\n`)
  if (!candidates?.length) { console.log('Nothing to process.'); return }

  let resolved = 0
  let offendersAdded = 0
  let noResolution = 0

  // Process in batches to avoid rate limits
  const BATCH = 10
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH)

    await Promise.all(batch.map(async (sub) => {
      const name = sub.raw_text?.match(/^Name:\s*(.+)/m)?.[1]?.trim() ?? sub.id
      process.stdout.write(`  ${name} ... `)

      const result = await analyzeSubmission(sub.raw_text ?? '')

      if (!result.resolution_type) {
        console.log('no resolution')
        noResolution++
        return
      }

      console.log(`${result.resolution_type}`)
      if (result.resolution_notes) console.log(`   → ${result.resolution_notes}`)

      let offenderId: string | null = null
      if (result.perpetrator?.name) {
        console.log(`   → perpetrator: ${result.perpetrator.name}`)
        offenderId = await upsertOffender(result.perpetrator)
        if (offenderId && offenderId !== '__dry_run__') offendersAdded++
      }

      if (!isDryRun) {
        const { error: updateErr } = await supabase
          .from('submissions')
          .update({
            resolution_type: result.resolution_type,
            resolution_notes: result.resolution_notes,
            resolved_at: new Date().toISOString(),
            ...(offenderId && offenderId !== '__dry_run__' ? { convicted_offender_id: offenderId } : {}),
          })
          .eq('id', sub.id)

        if (updateErr) {
          console.error(`   ✗ update failed: ${updateErr.message}`)
        } else {
          resolved++
        }
      } else {
        resolved++
      }
    }))

    if (i + BATCH < candidates.length) {
      process.stdout.write(`  [${i + BATCH}/${candidates.length}] `)
    }
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  Resolved:          ${resolved}`)
  console.log(`  New offenders:     ${offendersAdded}`)
  console.log(`  No resolution:     ${noResolution}`)
  console.log(`${'─'.repeat(60)}`)

  if (!isDryRun && resolved > 0) {
    console.log(`\n✓ Done. Re-run the match script to apply resolution-aware scoring:`)
    console.log(`  npx tsx scripts/run-offender-match.ts\n`)
  }
}

main().catch(console.error)
