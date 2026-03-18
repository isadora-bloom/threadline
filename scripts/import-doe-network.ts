/**
 * Doe Network Importer
 *
 * Reads the three scraped JSON files and imports each case into Threadline as:
 *   - Three master Cases (one per category)
 *   - One Submission per Doe Network case
 *   - Person entity (name/designation)
 *   - Location entity (city/state)
 *   - Vehicle entities (if vehicle mentions present)
 *   - Claims (physical description, circumstances, discovery, reference)
 *
 * Uses the service role key to bypass RLS — runs as admin.
 *
 * Run: npx tsx scripts/import-doe-network.ts
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { DoeCase } from './scrape-doe-network.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')

// ─── Environment ──────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const envPath = join(__dirname, '../.env.local')
  if (!existsSync(envPath)) {
    console.error('✗ .env.local not found. Copy .env.local.example and fill in your keys.')
    process.exit(1)
  }
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => {
        const [k, ...v] = l.split('=')
        return [k.trim(), v.join('=').trim()]
      })
  )
}

// ─── Case configs ─────────────────────────────────────────────────────────────

interface CaseConfig {
  file: string
  title: string
  caseType: 'missing_person' | 'unidentified_remains'
  notes: string
}

const CASE_CONFIGS: CaseConfig[] = [
  {
    file: 'doe-missing.json',
    title: 'Doe Network Import — Missing Persons',
    caseType: 'missing_person',
    notes: 'Bulk import from the Doe Network (doenetwork.org). Contains known-identity missing persons cases from the United States and Canada. All records are publicly listed by the Doe Network. Review each submission and verify against the source URL before treating as confirmed.',
  },
  {
    file: 'doe-unidentified.json',
    title: 'Doe Network Import — Unidentified Persons',
    caseType: 'missing_person',
    notes: 'Bulk import from the Doe Network (doenetwork.org). Contains unidentified living persons cases from the United States — individuals found alive whose identity is unknown. All records are publicly listed. Review each submission and verify against the source URL before treating as confirmed.',
  },
  {
    file: 'doe-remains.json',
    title: 'Doe Network Import — Unidentified Remains',
    caseType: 'unidentified_remains',
    notes: 'Bulk import from the Doe Network (doenetwork.org). Contains unidentified decedent cases from the United States and Canada. All records are publicly listed by the Doe Network. Review each submission and verify against the source URL before treating as confirmed.',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function parseEventDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  // Attempt to parse common date formats
  const cleaned = dateStr.replace(/[^0-9a-zA-Z\s,/-]/g, '').trim()
  if (!cleaned) return null
  try {
    const d = new Date(cleaned)
    if (!isNaN(d.getTime()) && d.getFullYear() > 1900) {
      return d.toISOString()
    }
  } catch { /* ignore */ }
  return null
}

function buildRawText(c: DoeCase): string {
  const parts: string[] = []

  if (c.name) parts.push(`Name: ${c.name}`)
  if (c.sex) parts.push(`Sex: ${c.sex}`)
  if (c.race) parts.push(`Race/Ethnicity: ${c.race}`)
  if (c.dateOfBirth) parts.push(`Date of Birth: ${c.dateOfBirth}`)
  if (c.dateMissing) parts.push(`Date Missing: ${c.dateMissing}`)
  if (c.dateFound) parts.push(`Date Found: ${c.dateFound}`)
  if (c.estimatedDateOfDeath) parts.push(`Estimated Date of Death: ${c.estimatedDateOfDeath}`)
  if (c.caseClassification) parts.push(`Case Classification: ${c.caseClassification}`)

  if (c.locationLastSeen) parts.push(`Last Seen: ${c.locationLastSeen}`)
  if (c.locationOfDiscovery) parts.push(`Location Found: ${c.locationOfDiscovery}`)

  if (c.age) parts.push(`Age: ${c.age}`)
  if (c.height) parts.push(`Height: ${c.height}`)
  if (c.weight) parts.push(`Weight: ${c.weight}`)
  if (c.hair) parts.push(`Hair: ${c.hair}`)
  if (c.eyes) parts.push(`Eyes: ${c.eyes}`)
  if (c.distinguishingMarks) parts.push(`Distinguishing Marks: ${c.distinguishingMarks}`)
  if (c.stateOfRemains) parts.push(`State of Remains: ${c.stateOfRemains}`)

  if (c.clothing) parts.push(`Clothing: ${c.clothing}`)
  if (c.jewelry) parts.push(`Jewelry: ${c.jewelry}`)
  if (c.additionalPersonalItems) parts.push(`Additional Items: ${c.additionalPersonalItems}`)
  if (c.dentals) parts.push(`Dentals: ${c.dentals}`)
  if (c.fingerprints) parts.push(`Fingerprints: ${c.fingerprints}`)
  if (c.dna) parts.push(`DNA: ${c.dna}`)

  if (c.circumstances) parts.push(`\nCircumstances: ${c.circumstances}`)
  if (c.informationSources) parts.push(`Information Sources: ${c.informationSources}`)

  if (c.namusNumber) parts.push(`NamUs: ${c.namusNumber}`)
  if (c.ncicNumber) parts.push(`NCIC: ${c.ncicNumber}`)
  if (c.ncmecNumber) parts.push(`NCMEC: ${c.ncmecNumber}`)

  parts.push(`Doe Network ID: ${c.id}`)
  parts.push(`Source: ${c.url}`)

  return parts.join('\n')
}

// ─── Import logic ─────────────────────────────────────────────────────────────

async function importCaseFile(
  supabase: SupabaseClient,
  userId: string,
  config: CaseConfig
): Promise<void> {
  const filePath = join(DATA_DIR, config.file)

  if (!existsSync(filePath)) {
    console.warn(`  ⚠ ${config.file} not found — run scrape:doe first. Skipping.`)
    return
  }

  const cases: DoeCase[] = JSON.parse(readFileSync(filePath, 'utf-8'))
  if (!cases.length) {
    console.warn(`  ⚠ ${config.file} is empty. Skipping.`)
    return
  }

  console.log(`\nImporting "${config.title}"`)
  console.log(`  ${cases.length} records from ${config.file}`)

  // ── Create the master Case ────────────────────────────────────────────────
  const { data: caseRow, error: caseErr } = await supabase
    .from('cases')
    .insert({
      title: config.title,
      case_type: config.caseType,
      jurisdiction: 'United States / Canada',
      status: 'active',
      visibility_level: 'team',
      created_by: userId,
      notes: config.notes,
    })
    .select('id')
    .single()

  if (caseErr || !caseRow) {
    console.error(`  ✗ Failed to create case: ${caseErr?.message}`)
    return
  }

  const caseId = caseRow.id
  console.log(`  ✓ Case created: ${caseId}`)

  // Assign role
  await supabase.from('case_user_roles').insert({
    case_id: caseId,
    user_id: userId,
    role: 'lead_investigator',
  })

  // Create case pattern settings
  await supabase.from('case_pattern_settings').insert({
    case_id: caseId,
    proximity_radius_miles: 50,
    temporal_window_days: 365,
    cross_case_matching_enabled: true,
  })

  // ── Import each Doe case as a submission ──────────────────────────────────
  let subCreated = 0
  let subFailed = 0
  let claimsCreated = 0
  let entitiesCreated = 0

  for (let i = 0; i < cases.length; i++) {
    const doe = cases[i]

    if ((i + 1) % 25 === 0 || i === 0 || i === cases.length - 1) {
      console.log(`  Importing record ${i + 1} of ${cases.length}…`)
    }

    const rawText = buildRawText(doe)
    const eventDate = parseEventDate(doe.dateMissing || doe.dateFound || doe.estimatedDateOfDeath)
    const location = doe.locationLastSeen || doe.locationOfDiscovery || null

    // ── Submission ───────────────────────────────────────────────────────────
    const { data: submission, error: subErr } = await supabase
      .from('submissions')
      .insert({
        raw_text: rawText,
        source_type: 'official_record',
        submitter_consent: 'on_record',
        firsthand: false,
        observation_mode: 'inferred_from_document',
        review_status: 'unverified',
        triage_status: 'untriaged',
        priority_level: 'medium',
        priority_score: 50,
        notes: `Imported from Doe Network. Case #${doe.id}. Source: ${doe.url}`,
        event_date: eventDate,
        event_date_precision: 'approximate',
        event_location: location,
        has_date: !!eventDate,
        has_location_pin: false,
        word_count: countWords(rawText),
        entity_count_step6: 0,
        novelty_flags: [],
      })
      .select('id')
      .single()

    if (subErr || !submission) {
      subFailed++
      if (subFailed <= 5) {
        console.error(`    ✗ Submission failed for ${doe.id}: ${subErr?.message}`)
      }
      continue
    }

    subCreated++
    const submissionId = submission.id

    // ── Claims ───────────────────────────────────────────────────────────────
    const claimRows: object[] = []
    let claimPosition = 0

    // 1. Physical description claim
    const physText = [
      doe.height && `Height: ${doe.height}`,
      doe.weight && `Weight: ${doe.weight}`,
      doe.hair && `Hair: ${doe.hair}`,
      doe.eyes && `Eyes: ${doe.eyes}`,
      doe.race && `Race: ${doe.race}`,
      doe.distinguishingMarks && `Distinguishing marks: ${doe.distinguishingMarks}`,
      doe.clothing && `Clothing: ${doe.clothing}`,
      doe.jewelry && `Jewelry: ${doe.jewelry}`,
      doe.stateOfRemains && `State of remains: ${doe.stateOfRemains}`,
    ].filter(Boolean).join('. ')

    if (physText.length > 10) {
      claimRows.push({
        submission_id: submissionId,
        original_submission_id: submissionId,
        claim_position: claimPosition++,
        extracted_text: `Reported physical description: ${physText}`,
        claim_type: 'physical_description',
        source_confidence: 'medium',
        content_confidence: 'medium',
        verification_status: 'unverified',
        interpretation_flag: false,
        notes: 'Extracted from Doe Network listing. Marked as reported — not verified.',
        created_by: userId,
      })
    }

    // 2. Circumstances claim (for missing persons / unidentified persons)
    if (doe.circumstances && doe.circumstances.length > 30) {
      claimRows.push({
        submission_id: submissionId,
        original_submission_id: submissionId,
        claim_position: claimPosition++,
        extracted_text: doe.circumstances,
        claim_type: 'statement',
        source_confidence: 'medium',
        content_confidence: 'medium',
        verification_status: 'unverified',
        interpretation_flag: false,
        notes: 'Reported circumstances from Doe Network listing.',
        created_by: userId,
      })
    }

    // 3. Discovery circumstances claim (unidentified remains only)
    if (doe.category === 'unidentified_remains') {
      const discoveryParts = [
        doe.locationOfDiscovery && `Found at: ${doe.locationOfDiscovery}`,
        doe.estimatedDateOfDeath && `Estimated time of death: ${doe.estimatedDateOfDeath}`,
        doe.dentals && doe.dentals !== 'Unknown' && `Dentals: ${doe.dentals}`,
        doe.fingerprints && doe.fingerprints !== 'Unknown' && `Fingerprints: ${doe.fingerprints}`,
        doe.dna && doe.dna !== 'Unknown' && `DNA: ${doe.dna}`,
      ].filter(Boolean).join('. ')

      if (discoveryParts.length > 10) {
        claimRows.push({
          submission_id: submissionId,
          original_submission_id: submissionId,
          claim_position: claimPosition++,
          extracted_text: `Discovery circumstances: ${discoveryParts}`,
          claim_type: 'official',
          source_confidence: 'medium',
          content_confidence: 'medium',
          verification_status: 'unverified',
          interpretation_flag: false,
          notes: 'Discovery and recovery information from Doe Network listing.',
          created_by: userId,
        })
      }
    }

    // 4. Reference number / identifier claim
    const refParts = [
      `Doe Network ID: ${doe.id}`,
      doe.namusNumber && `NamUs: ${doe.namusNumber}`,
      doe.ncicNumber && doe.ncicNumber !== 'Unknown' && `NCIC: ${doe.ncicNumber}`,
      doe.ncmecNumber && `NCMEC: ${doe.ncmecNumber}`,
    ].filter(Boolean).join('. ')

    claimRows.push({
      submission_id: submissionId,
      original_submission_id: submissionId,
      claim_position: claimPosition++,
      extracted_text: `${refParts}. Source: ${doe.url}`,
      claim_type: 'identifier',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'unverified',
      interpretation_flag: false,
      notes: 'Official Doe Network case identifiers and source URL.',
      created_by: userId,
    })

    // Insert claims
    if (claimRows.length) {
      const { data: insertedClaims, error: claimErr } = await supabase
        .from('claims')
        .insert(claimRows)
        .select('id')

      if (claimErr) {
        // Non-fatal — log and continue
        if (subCreated <= 5) console.error(`    ✗ Claims failed for ${doe.id}: ${claimErr.message}`)
      } else {
        claimsCreated += insertedClaims?.length ?? 0
      }
    }

    // ── Entities ──────────────────────────────────────────────────────────────

    // 1. Person entity
    const personValue = doe.name || `Unknown ${doe.sex || 'Person'} — ${doe.id}`
    const { data: personEntity } = await supabase
      .from('entities')
      .insert({
        entity_type: 'person',
        raw_value: personValue,
        normalized_value: doe.name || null,
        normalization_status: doe.name ? 'normalized' : 'raw',
        confidence: doe.name ? 'high' : 'low',
        review_state: 'unverified',
        notes: [
          doe.sex && `Sex: ${doe.sex}`,
          doe.race && `Race: ${doe.race}`,
          doe.age && `Age: ${doe.age}`,
          doe.category === 'unidentified_remains' ? 'Unidentified decedent' : null,
          doe.category === 'unidentified_person' ? 'Unidentified living person' : null,
        ].filter(Boolean).join('. ') || null,
        created_by: userId,
      })
      .select('id')
      .single()

    if (personEntity) entitiesCreated++

    // 2. Location entity
    const locationValue = doe.locationLastSeen || doe.locationOfDiscovery
    if (locationValue) {
      const { data: locEntity } = await supabase
        .from('entities')
        .insert({
          entity_type: 'location',
          raw_value: locationValue,
          normalization_status: 'raw',
          confidence: 'medium',
          review_state: 'unverified',
          notes: doe.category === 'missing_person' ? 'Last known location' : 'Location where remains/person found',
          created_by: userId,
        })
        .select('id')
        .single()

      if (locEntity) entitiesCreated++

      // Link location entity to the first claim (circumstances or physical description)
      const firstClaimId = (await supabase
        .from('claims')
        .select('id')
        .eq('submission_id', submissionId)
        .order('claim_position')
        .limit(1)
        .single()).data?.id

      if (firstClaimId && locEntity) {
        await supabase.from('claim_entity_links').insert({
          claim_id: firstClaimId,
          entity_id: locEntity.id,
          entity_role: 'location_reference',
          identifier_source: 'found_in_document',
          confidence: 'medium',
          created_by: userId,
        })
      }
    }

    // 3. Vehicle entities — extract from circumstances text
    const vehiclePattern = /\b(?:(?:19|20)\d{2}\s+)?(?:ford|chevy|chevrolet|dodge|toyota|honda|nissan|gmc|chrysler|buick|jeep|pontiac|oldsmobile|cadillac|mercury|lincoln|saturn|subaru|volvo|bmw|mercedes|volkswagen|vw|hyundai|kia)\b[^.]{3,80}/gi
    const vehicleMatches = doe.circumstances ? [...doe.circumstances.matchAll(vehiclePattern)].map(m => m[0].trim().slice(0, 200)) : []
    for (const vehicleText of vehicleMatches) {
      const { data: vehicleEntity } = await supabase
        .from('entities')
        .insert({
          entity_type: 'vehicle',
          raw_value: vehicleText.slice(0, 500),
          normalization_status: 'raw',
          confidence: 'low',
          review_state: 'unverified',
          notes: 'Vehicle mentioned in Doe Network listing — review before acting on.',
          created_by: userId,
        })
        .select('id')
        .single()

      if (vehicleEntity) entitiesCreated++
    }

    // Link person entity to identifier claim if both exist
    if (personEntity) {
      const identifierClaim = (await supabase
        .from('claims')
        .select('id')
        .eq('submission_id', submissionId)
        .eq('claim_type', 'identifier')
        .limit(1)
        .single()).data

      if (identifierClaim) {
        await supabase.from('claim_entity_links').insert({
          claim_id: identifierClaim.id,
          entity_id: personEntity.id,
          entity_role: doe.category === 'unidentified_remains' ? 'subject' : 'subject',
          identifier_source: 'found_in_document',
          confidence: doe.name ? 'high' : 'low',
          created_by: userId,
        })
      }
    }
  }

  console.log(`  ✓ Import complete for "${config.title}"`)
  console.log(`    Submissions: ${subCreated} created, ${subFailed} failed`)
  console.log(`    Claims: ${claimsCreated}`)
  console.log(`    Entities: ${entitiesCreated}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Doe Network Importer')
  console.log('====================\n')

  const env = loadEnv()
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // Get the admin user to assign as case creator
  const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers()
  if (usersErr || !usersData.users.length) {
    console.error('✗ No users found. Sign in at least once first, then re-run.')
    process.exit(1)
  }
  const userId = usersData.users[0].id
  console.log(`Running as user: ${userId}\n`)

  for (const config of CASE_CONFIGS) {
    await importCaseFile(supabase, userId, config)
  }

  console.log('\n═══════════════════════════════════════')
  console.log('Import complete.')
  console.log('\nNext steps:')
  console.log('  1. Open Threadline and find the three Doe Network import cases')
  console.log('  2. Use Triage mode to work through the submission queue')
  console.log('  3. Review claims — all are marked "unverified" and require human review')
  console.log('  4. Verify details against the source URL in each submission note')
  console.log('\nRemember: all data is REPORTED. Nothing is confirmed without verification.')
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err.message)
  process.exit(1)
})
