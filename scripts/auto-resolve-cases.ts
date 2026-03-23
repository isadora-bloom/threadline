/**
 * Auto-Resolve Cases
 *
 * Uses Claude to read each case's notes + submission text and determine:
 *   1. Whether the case has a resolution (found alive, remains ID'd, perpetrator convicted, etc.)
 *   2. If a perpetrator is named — extracts structured data and upserts into known_offenders
 *   3. Updates cases.resolution_type + cases.convicted_offender_id accordingly
 *
 * Only processes cases where resolution_type IS NULL (won't overwrite manual entries).
 * After running, re-run: npx tsx scripts/run-offender-match.ts
 *
 * Run: npx tsx scripts/auto-resolve-cases.ts
 * Dry: npx tsx scripts/auto-resolve-cases.ts --dry-run
 * Single: npx tsx scripts/auto-resolve-cases.ts --case "Kristi Suzanne Krebs"
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const isDryRun = process.argv.includes('--dry-run')
const singleCaseFilter = (() => {
  const idx = process.argv.indexOf('--case')
  return idx !== -1 ? process.argv[idx + 1] : null
})()

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

// ── Claude prompt ─────────────────────────────────────────────────────────────

async function analyzeCase(
  title: string,
  notes: string,
  submissionTexts: string[],
): Promise<ResolutionResult> {
  const context = [
    `CASE TITLE: ${title}`,
    notes ? `CASE NOTES:\n${notes}` : '',
    submissionTexts.length > 0
      ? `SUBMISSION EXCERPTS:\n${submissionTexts.map((t, i) => `[${i + 1}] ${t.slice(0, 800)}`).join('\n\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const prompt = `You are helping a case intelligence platform auto-detect resolution status for missing persons and homicide cases.

Read the following case information and determine:
1. Has this case been resolved? (someone found alive, remains identified, perpetrator convicted, etc.)
2. If yes, what type of resolution?
3. If a perpetrator is named who was convicted or formally identified, extract all known details.

Return ONLY a JSON object — no markdown, no explanation — matching this exact structure:
{
  "resolution_type": "found_alive" | "remains_identified" | "perpetrator_convicted" | "perpetrator_identified" | "closed_unresolved" | "duplicate_case" | null,
  "resolution_notes": "brief factual summary of the resolution, or null",
  "perpetrator": {
    "name": "Full legal name",
    "aliases": ["nickname", "aka"],
    "birth_year": 1950 or null,
    "status": "convicted" | "deceased" | "incarcerated" | "released" | "suspected",
    "conviction_count": 3 or null,
    "suspected_count": 12 or null,
    "active_from": 1970 or null,
    "active_to": 1984 or null,
    "incarcerated_from": 1984 or null,
    "home_states": ["FL", "TX"],
    "operation_states": ["FL", "TX", "GA"],
    "victim_states": ["FL", "TX", "GA"],
    "victim_sex": "female" | "male" | "both" | null,
    "victim_age_min": 14 or null,
    "victim_age_max": 35 or null,
    "victim_age_typical": 20 or null,
    "victim_races": ["white", "hispanic"],
    "mo_keywords": ["hitchhiker", "highway_abduction", "beauty_pageant"],
    "disposal_method": ["roadside", "wooded"],
    "cause_of_death": ["strangulation", "stabbing"],
    "signature_details": "brief description of signature MO and distinguishing behaviors",
    "wikipedia_slug": "Christopher_Wilder" or null,
    "source_notes": "source for this information (e.g. FBI, Wikipedia, court records)"
  } or null (if no named perpetrator)
}

Resolution type rules:
- "found_alive": person was located alive
- "remains_identified": unidentified remains were successfully identified
- "perpetrator_convicted": offender was convicted in court
- "perpetrator_identified": offender named/identified but not convicted (died before trial, case pending, etc.)
- "closed_unresolved": case closed without resolution
- "duplicate_case": duplicate entry
- null: case is open / unresolved / unknown

For mo_keywords use only these values where applicable:
hitchhiker, sex_worker, truck_stop, runaway, college_campus, home_invasion, dating, foster_care, bar,
highway_abduction, beauty_pageant, modeling_lure, good_samaritan, online, abduction_vehicle

For victim_races use: white, black, hispanic, asian, native_american, mixed, unknown

For US states use 2-letter abbreviations (FL, TX, CA etc.)

CASE DATA:
${context}`

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = (response.content[0] as { text: string }).text.trim()

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

  try {
    return JSON.parse(cleaned) as ResolutionResult
  } catch {
    console.error('  ⚠ Failed to parse Claude response:', raw.slice(0, 200))
    return { resolution_type: null, resolution_notes: null, perpetrator: null }
  }
}

// ── Upsert offender ───────────────────────────────────────────────────────────

async function upsertOffender(
  extract: OffenderExtract,
): Promise<string | null> {
  // Check if already exists by name (case-insensitive)
  const { data: existing } = await supabase
    .from('known_offenders')
    .select('id, name')
    .ilike('name', extract.name)
    .maybeSingle()

  if (existing) {
    console.log(`  → Offender already in DB: ${existing.name} (${existing.id})`)
    return existing.id
  }

  // Also check aliases
  const { data: byAlias } = await supabase
    .from('known_offenders')
    .select('id, name')
    .contains('aliases', [extract.name])
    .maybeSingle()

  if (byAlias) {
    console.log(`  → Found via alias: ${byAlias.name} (${byAlias.id})`)
    return byAlias.id
  }

  // New offender — insert
  const insert = {
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
  }

  if (isDryRun) {
    console.log(`  [DRY RUN] Would insert offender: ${extract.name}`)
    console.log(`    Status: ${insert.status}, Active: ${insert.active_from}–${insert.active_to}`)
    console.log(`    States: ${insert.operation_states.join(', ')}`)
    console.log(`    MO: ${insert.mo_keywords.join(', ')}`)
    return '__dry_run__'
  }

  const { data: inserted, error } = await supabase
    .from('known_offenders')
    .insert(insert)
    .select('id')
    .single()

  if (error) {
    console.error(`  ✗ Failed to insert offender ${extract.name}:`, error.message)
    return null
  }

  console.log(`  ✓ Inserted new offender: ${extract.name} (${inserted.id})`)
  return inserted.id
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  Auto-Resolve Cases${isDryRun ? ' [DRY RUN]' : ''}`)
  if (singleCaseFilter) console.log(`  Filtering to: "${singleCaseFilter}"`)
  console.log(`${'═'.repeat(60)}\n`)

  // Fetch cases without resolution_type
  let query = supabase
    .from('cases')
    .select('id, title, notes, resolution_type, convicted_offender_id')
    .is('resolution_type', null)

  if (singleCaseFilter) {
    query = query.ilike('title', `%${singleCaseFilter}%`)
  }

  const { data: cases, error } = await query

  if (error) {
    console.error('Failed to fetch cases:', error.message)
    process.exit(1)
  }

  console.log(`Found ${cases?.length ?? 0} cases without resolution_type\n`)

  if (!cases?.length) {
    console.log('Nothing to process.')
    return
  }

  let resolved = 0
  let offendersAdded = 0
  let skipped = 0

  for (const c of cases) {
    console.log(`Processing: ${c.title}`)

    // Fetch up to 5 submission texts for this case
    const { data: subs } = await supabase
      .from('submissions')
      .select('raw_text')
      .eq('case_id', c.id)
      .order('created_at', { ascending: true })
      .limit(5)

    const texts = (subs ?? []).map(s => s.raw_text ?? '').filter(Boolean)

    if (!c.notes && texts.length === 0) {
      console.log(`  → No text data, skipping\n`)
      skipped++
      continue
    }

    // Ask Claude
    const result = await analyzeCase(c.title, c.notes ?? '', texts)

    if (!result.resolution_type) {
      console.log(`  → No resolution detected\n`)
      skipped++
      continue
    }

    console.log(`  → Resolution: ${result.resolution_type}`)
    if (result.resolution_notes) console.log(`     ${result.resolution_notes}`)

    let offenderId: string | null = null

    if (result.perpetrator) {
      console.log(`  → Perpetrator: ${result.perpetrator.name}`)
      offenderId = await upsertOffender(result.perpetrator)
      if (offenderId && offenderId !== '__dry_run__') offendersAdded++
    }

    // Update the case
    if (!isDryRun) {
      const update: Record<string, unknown> = {
        resolution_type: result.resolution_type,
        resolution_notes: result.resolution_notes,
        resolved_at: new Date().toISOString(),
      }
      if (offenderId && offenderId !== '__dry_run__') {
        update.convicted_offender_id = offenderId
      }

      const { error: updateErr } = await supabase
        .from('cases')
        .update(update)
        .eq('id', c.id)

      if (updateErr) {
        console.error(`  ✗ Failed to update case:`, updateErr.message)
      } else {
        console.log(`  ✓ Case updated\n`)
        resolved++
      }
    } else {
      console.log(`  [DRY RUN] Would update case: resolution_type=${result.resolution_type}`)
      if (offenderId) console.log(`  [DRY RUN] Would link convicted_offender_id`)
      console.log()
      resolved++
    }
  }

  console.log(`${'─'.repeat(60)}`)
  console.log(`  Cases resolved:    ${resolved}`)
  console.log(`  New offenders:     ${offendersAdded}`)
  console.log(`  Skipped:           ${skipped}`)
  console.log(`${'─'.repeat(60)}`)

  if (!isDryRun && resolved > 0) {
    console.log(`\n✓ Done. Now re-run the match script to apply resolution-aware scoring:`)
    console.log(`  npx tsx scripts/run-offender-match.ts\n`)
  }
}

main().catch(console.error)
