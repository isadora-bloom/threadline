/**
 * Seed: Goochland Boy — Unidentified Child, Oilville VA (1951)
 *
 * Creates a fully structured Threadline case for the Goochland Boy cold case:
 *   - Case record (unidentified_remains)
 *   - 3 Submissions (official record, physical evidence, unverified theories/gaps)
 *   - ~25 Claims across all three submissions
 *   - 5 Entities (victim, discovery location, duffel bag, raincoat, unknown person)
 *   - Claim-entity links
 *   - 3 manual Pattern Flags (military connection, concealment indicators, care indicators)
 *
 * Designed to be a rich test case for the Pattern Intelligence + Thread Generator pipeline.
 * The military/clothing angle and evidence tracking gaps are deliberately prominent.
 *
 * Sources:
 *   - Doe Network 3801UMVA: https://doenetwork.org/cases/3801umva.html
 *   - NamUs UP82515
 *   - Dale Brumfield / Medium writeup
 *
 * Run: npx tsx scripts/seed-goochland-boy.ts
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Env ──────────────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const envPath = join(__dirname, '../.env.local')
  if (!existsSync(envPath)) {
    console.error('✗ .env.local not found')
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

const env = loadEnv()
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAdminUserId(): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error || !data.users.length) {
    console.error('✗ Could not fetch users:', error?.message)
    process.exit(1)
  }
  const user = data.users[0]
  console.log(`  → Running as ${user.email} (${user.id})`)
  return user.id
}

function ok<T>(label: string, data: T | null, error: unknown): T {
  if (error || !data) {
    console.error(`✗ ${label}:`, (error as { message?: string })?.message ?? 'null result')
    process.exit(1)
  }
  return data
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n── Goochland Boy Seed ─────────────────────────────────────────')

  const userId = await getAdminUserId()

  // ── 0. Clean up any previous run ──────────────────────────────────────────
  console.log('\n[0/7] Cleaning up previous seed run...')
  const { data: existing } = await supabase
    .from('cases')
    .select('id')
    .eq('title', 'Goochland Boy — Unidentified Child, Oilville VA (1951)')
  if (existing && existing.length > 0) {
    for (const c of existing) {
      await supabase.from('cases').delete().eq('id', c.id)
    }
    console.log(`  ✓ Deleted ${existing.length} previous case(s)`)
  } else {
    console.log('  ✓ No previous seed found')
  }

  // ── 1. Case ────────────────────────────────────────────────────────────────

  console.log('\n[1/7] Creating case...')
  const { data: caseRow, error: caseErr } = await supabase
    .from('cases')
    .insert({
      title: 'Goochland Boy — Unidentified Child, Oilville VA (1951)',
      case_type: 'unidentified_remains',
      jurisdiction: 'Goochland County, Virginia',
      status: 'active',
      visibility_level: 'team',
      created_by: userId,
      notes:
        'An unidentified white male child, estimated 3–6 years old, found on March 5, 1951 near Oilville, Goochland County, Virginia. ' +
        'He was inside a blue Army-style duffel bag marked "R 9700." No matching missing-child report has ever been publicly confirmed. ' +
        'Doe Network: 3801UMVA. NamUs: UP82515. DNA unavailable; body reportedly cremated. ' +
        'Primary investigative gaps: (1) the military laundry marking "R 9700" has never been publicly confirmed as traced; ' +
        '(2) the preserved fingerprints and footprints have not been confirmed as re-run in modern databases; ' +
        '(3) the gray women\'s raincoat found with the child has never been linked to a specific person. ' +
        'This case is a major test case for Threadline\'s Pattern Intelligence and Investigative Thread Generator.',
    })
    .select()
    .single()

  const theCase = ok('Create case', caseRow, caseErr)
  const caseId = theCase.id
  console.log(`  ✓ Case created: ${caseId}`)

  // ── 2. Role + Pattern Settings ─────────────────────────────────────────────

  console.log('\n[2/7] Creating role and pattern settings...')

  const { error: roleErr } = await supabase
    .from('case_user_roles')
    .insert({ case_id: caseId, user_id: userId, role: 'lead_investigator' })

  if (roleErr) console.warn('  ⚠ Role insert:', roleErr.message)
  else console.log('  ✓ Role: lead_investigator')

  const { error: settingsErr } = await supabase
    .from('case_pattern_settings')
    .insert({
      case_id: caseId,
      proximity_radius_miles: 50,
      corridor_radius_meters: 1000,
      temporal_window_days: 365,
      cross_case_matching_enabled: true,
    })

  if (settingsErr) console.warn('  ⚠ Pattern settings:', settingsErr.message)
  else console.log('  ✓ Pattern settings created')

  // ── 3. Submissions ─────────────────────────────────────────────────────────

  console.log('\n[3/7] Creating submissions...')

  const DISCOVERY_DATE = '1951-03-05T00:00:00Z'

  const { data: sub1, error: sub1Err } = await supabase
    .from('submissions')
    .insert({
      case_id: caseId,
      raw_text:
        'Official Doe Network record 3801UMVA / NamUs UP82515. ' +
        'Unidentified white male child, ~3–6 years old, found March 5, 1951, near Oilville, Goochland County, Virginia, near Route 670 and Route 250. ' +
        'Height ~3\'6", weight ~44 lbs, auburn/reddish hair, blue eyes, fair complexion, uncircumcised. ' +
        'Bruises and two cuts on head, believed possibly postmortem. No broken bones on x-ray. ' +
        'Cause of death unknown/undetermined; exposure, asphyxiation, or natural causes possible. Foul play not ruled out. ' +
        'Dentals, fingerprints, and footprints preserved. DNA not available. ' +
        'Estimated dead ~1 week; estimated at dump site hours to ~1 day (ground under bag dry despite rain prior night).',
      source_type: 'official_record',
      submitter_name: 'Doe Network (3801UMVA)',
      submitter_consent: 'on_record',
      firsthand: false,
      observation_mode: 'inferred_from_document',
      review_status: 'corroborated',
      event_date: DISCOVERY_DATE,
      event_date_precision: 'exact',
      event_location: 'Near Oilville, Goochland County, Virginia (Route 670 / Route 250)',
      submitted_by: userId,
      notes: 'Primary official record. Source: https://doenetwork.org/cases/3801umva.html',
    })
    .select('id')
    .single()

  const submission1 = ok('Submission 1', sub1, sub1Err)
  console.log('  ✓ Submission 1: Official record')

  const { data: sub2, error: sub2Err } = await supabase
    .from('submissions')
    .insert({
      case_id: caseId,
      raw_text:
        'Physical evidence detail from official record. ' +
        'Child found inside a blue Army-style duffel bag with only part of his head protruding. ' +
        'Inside the bag: a well-worn gray women\'s raincoat. ' +
        'Bag interior marked "R 9700" — investigators at the time believed this could be a laundry or military identification marking. ' +
        'Child was blindfolded when placed in the bag. Fully clothed except for shoes. ' +
        'Clothing: red-and-pink checked cardigan with a mismatched repaired bottom button; brown shirt with red, white, and blue stripes; ' +
        'striped socks; denim pants; white union-suit underwear.',
      source_type: 'official_record',
      submitter_name: 'Doe Network (3801UMVA) — Physical Evidence Detail',
      submitter_consent: 'on_record',
      firsthand: false,
      observation_mode: 'inferred_from_document',
      review_status: 'corroborated',
      event_date: DISCOVERY_DATE,
      event_date_precision: 'exact',
      event_location: 'Near Oilville, Goochland County, Virginia',
      submitted_by: userId,
      notes: 'Physical evidence and clothing detail from official record. Clothing details are significant for identification.',
    })
    .select('id')
    .single()

  const submission2 = ok('Submission 2', sub2, sub2Err)
  console.log('  ✓ Submission 2: Physical evidence detail')

  const { data: sub3, error: sub3Err } = await supabase
    .from('submissions')
    .insert({
      case_id: caseId,
      raw_text:
        'Investigative analysis and unverified theories compiled from case researchers and public record review. ' +
        'Body storage theory: since investigators estimated death ~1 week before discovery but dump site exposure only hours-to-1 day, ' +
        'it is possible the body was stored somewhere for several days before disposal. ' +
        'Military connection: the "R 9700" duffel marking has fueled repeated speculation about a military family, ' +
        'ex-serviceman, or surplus gear connection. No public source confirms this line of inquiry produced a match. ' +
        'Origin question: no widely publicized missing-child report matched the child; he may not have been from Goochland or Virginia. ' +
        'Concealment indicators: blindfold, bagging, remote dump site, and post-death transport suggest deliberate concealment. ' +
        'Care indicators: clothing was repaired/mended (mismatched button); layered garments; child was not undressed or nude — ' +
        'suggests some level of household familiarity and routine care before death. ' +
        'Modern forensic gaps: body reportedly cremated; ash location unclear; ' +
        'fingerprints/footprints not confirmed re-run in modern databases; ' +
        'no confirmed biological material recovered from clothing or evidence for modern DNA testing. ' +
        'Women\'s raincoat: never publicly linked to a specific person.',
      source_type: 'media',
      submitter_name: 'Case researcher compilation (public record)',
      submitter_consent: 'on_record',
      firsthand: false,
      observation_mode: 'inferred_from_document',
      review_status: 'unverified',
      event_date: DISCOVERY_DATE,
      event_date_precision: 'exact',
      submitted_by: userId,
      notes: 'Compiled from Doe Network community discussion, Dale Brumfield / Medium writeup, and public case analysis. All claims marked unverified — require investigator evaluation.',
    })
    .select('id')
    .single()

  const submission3 = ok('Submission 3', sub3, sub3Err)
  console.log('  ✓ Submission 3: Investigative theories / gaps')

  const s1 = submission1.id
  const s2 = submission2.id
  const s3 = submission3.id

  // ── 4. Claims ──────────────────────────────────────────────────────────────

  console.log('\n[4/7] Creating claims...')

  // Submission 1 claims — official record facts
  const s1Claims = [
    {
      submission_id: s1,
      original_submission_id: s1,
      claim_position: 0,
      extracted_text: 'Unidentified white male child, estimated 3–6 years old. Height approximately 3\'6" (106 cm), weight approximately 44 lbs (20 kg). Auburn/reddish hair, blue eyes, fair complexion, uncircumcised.',
      claim_type: 'physical_description',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'Core physical description from Doe Network official record 3801UMVA.',
      created_by: userId,
    },
    {
      submission_id: s1,
      original_submission_id: s1,
      claim_position: 1,
      extracted_text: 'Found on March 5, 1951, near Oilville in Goochland County, Virginia, close to Route 670 and Route 250.',
      claim_type: 'official',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      event_date: DISCOVERY_DATE,
      event_date_precision: 'exact',
      notes: 'Discovery date and location — confirmed in official record.',
      created_by: userId,
    },
    {
      submission_id: s1,
      original_submission_id: s1,
      claim_position: 2,
      extracted_text: 'Estimated to have been dead approximately one week, but likely had been at the dump site for only hours to one day. The ground under the duffel bag was still dry despite rain the previous night, supporting a recent dump timeline.',
      claim_type: 'official',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'Forensic timing from investigators at scene. The dry ground detail is a key physical observation.',
      created_by: userId,
    },
    {
      submission_id: s1,
      original_submission_id: s1,
      claim_position: 3,
      extracted_text: 'Bruises and two cuts observed on the head, believed to be possibly postmortem. X-rays showed no broken bones.',
      claim_type: 'physical_description',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'Injury detail from official record.',
      created_by: userId,
    },
    {
      submission_id: s1,
      original_submission_id: s1,
      claim_position: 4,
      extracted_text: 'Cause of death recorded as unknown/undetermined. Possibilities noted by investigators include exposure, asphyxiation, or natural causes. Foul play was not ruled out.',
      claim_type: 'official',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'Official cause of death classification.',
      created_by: userId,
    },
    {
      submission_id: s1,
      original_submission_id: s1,
      claim_position: 5,
      extracted_text: 'Dental records, fingerprints, and footprints were preserved at time of discovery. DNA is not available. Body reportedly cremated at a later date; location of remains/ashes is unclear.',
      claim_type: 'official',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'Forensic preservation status. Cremation detail is a significant barrier to modern identification.',
      created_by: userId,
    },
    {
      submission_id: s1,
      original_submission_id: s1,
      claim_position: 6,
      extracted_text: 'Case identifiers: Doe Network 3801UMVA, NamUs UP82515. Source: https://doenetwork.org/cases/3801umva.html',
      claim_type: 'identifier',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'confirmed',
      interpretation_flag: false,
      notes: 'Official case identifiers.',
      created_by: userId,
    },
  ]

  // Submission 2 claims — physical evidence
  const s2Claims = [
    {
      submission_id: s2,
      original_submission_id: s2,
      claim_position: 0,
      extracted_text: 'Child was found inside a blue Army-style duffel bag, with only part of his head protruding from the bag.',
      claim_type: 'official',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'Container/disposal method — key physical evidence.',
      created_by: userId,
    },
    {
      submission_id: s2,
      original_submission_id: s2,
      claim_position: 1,
      extracted_text: 'Inside the duffel bag, a well-worn gray women\'s raincoat was also found. No person has ever been publicly linked to this garment.',
      claim_type: 'official',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'Co-located evidence item. The raincoat is a potential link to a female household member or the transporter.',
      created_by: userId,
    },
    {
      submission_id: s2,
      original_submission_id: s2,
      claim_position: 2,
      extracted_text: 'The duffel bag had "R 9700" printed inside it. Investigators at the time believed this could be a laundry marking or military identification serial number.',
      claim_type: 'official',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'Critical physical evidence. The "R 9700" marking is one of the primary unresolved investigative leads.',
      created_by: userId,
    },
    {
      submission_id: s2,
      original_submission_id: s2,
      claim_position: 3,
      extracted_text: 'The child was blindfolded when placed in the bag.',
      claim_type: 'official',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'Behavioral/staging detail — suggests deliberate concealment.',
      created_by: userId,
    },
    {
      submission_id: s2,
      original_submission_id: s2,
      claim_position: 4,
      extracted_text: 'Child was fully clothed except for shoes.',
      claim_type: 'physical_description',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      created_by: userId,
    },
    {
      submission_id: s2,
      original_submission_id: s2,
      claim_position: 5,
      extracted_text: 'Wearing a red-and-pink checked cardigan with a mismatched repaired bottom button — the bottom button differed from the others, suggesting it had been replaced or mended.',
      claim_type: 'physical_description',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'The repaired/mismatched button is one of the most distinctive clothing details and suggests someone was actively maintaining the child\'s wardrobe.',
      created_by: userId,
    },
    {
      submission_id: s2,
      original_submission_id: s2,
      claim_position: 6,
      extracted_text: 'Also wearing: a brown shirt with red, white, and blue stripes; striped socks; denim pants; white union-suit underwear.',
      claim_type: 'physical_description',
      source_confidence: 'high',
      content_confidence: 'high',
      verification_status: 'corroborated',
      interpretation_flag: false,
      notes: 'Additional clothing items. Layered garments (union suit + denim + cardigan) suggest cold-weather dressing and continued household care.',
      created_by: userId,
    },
  ]

  // Submission 3 claims — unverified theories and investigative gaps
  const s3Claims = [
    {
      submission_id: s3,
      original_submission_id: s3,
      claim_position: 0,
      extracted_text: 'Possible hypothesis: The body may have been stored for several days between time of death and disposal, based on the discrepancy between estimated time of death (~1 week) and estimated time at dump site (hours to ~1 day). Surfaced for investigator review.',
      claim_type: 'interpretation',
      source_confidence: 'medium',
      content_confidence: 'medium',
      verification_status: 'unverified',
      interpretation_flag: true,
      notes: 'Timing inference — grounded in physical evidence but unconfirmed.',
      created_by: userId,
    },
    {
      submission_id: s3,
      original_submission_id: s3,
      claim_position: 1,
      extracted_text: 'Possible hypothesis: The "R 9700" duffel bag marking may indicate a military laundry or property serial number, possibly linking the child or the person who transported him to military service, a military family, or military surplus supply. No public source confirms this line of inquiry was exhaustively pursued or produced a match. Surfaced for investigator review.',
      claim_type: 'interpretation',
      source_confidence: 'medium',
      content_confidence: 'low',
      verification_status: 'unverified',
      interpretation_flag: true,
      notes: 'Military connection theory. This is the most actionable unresolved lead according to community researchers.',
      created_by: userId,
    },
    {
      submission_id: s3,
      original_submission_id: s3,
      claim_position: 2,
      extracted_text: 'Possible hypothesis: The child may not have been from Goochland County or even from Virginia. No widely publicized missing-child report matched him. The remote dump site may have been chosen specifically to break the investigative trail. Surfaced for investigator review.',
      claim_type: 'interpretation',
      source_confidence: 'low',
      content_confidence: 'low',
      verification_status: 'unverified',
      interpretation_flag: true,
      notes: 'Origin/transport theory — commonly cited in community discussions.',
      created_by: userId,
    },
    {
      submission_id: s3,
      original_submission_id: s3,
      claim_position: 3,
      extracted_text: 'Possible hypothesis: The combination of the blindfold, deliberate bagging, remote dump location, and apparent post-death transport suggests intentional concealment rather than panic. The person who deposited the body had likely planned the disposal. Surfaced for investigator review.',
      claim_type: 'interpretation',
      source_confidence: 'medium',
      content_confidence: 'medium',
      verification_status: 'unverified',
      interpretation_flag: true,
      behavioral_category: 'staging',
      behavioral_consistency_flag: false,
      notes: 'Behavioral staging analysis.',
      created_by: userId,
    },
    {
      submission_id: s3,
      original_submission_id: s3,
      claim_position: 4,
      extracted_text: 'The child\'s clothing suggests he was receiving regular household care before death: layered garments appropriate for the season, repaired clothing (mismatched button), and no signs of prolonged neglect or destitution. He was not undressed or nude.',
      claim_type: 'interpretation',
      source_confidence: 'medium',
      content_confidence: 'medium',
      verification_status: 'unverified',
      interpretation_flag: true,
      notes: 'Care indicators — suggests a household context, not abandonment by a stranger.',
      created_by: userId,
    },
    {
      submission_id: s3,
      original_submission_id: s3,
      claim_position: 5,
      extracted_text: 'Investigative gap: The "R 9700" duffel bag marking has never been publicly confirmed as traced to a specific military unit, laundry facility, or individual. Whether this line of inquiry was exhaustively pursued in 1951 is not publicly documented.',
      claim_type: 'statement',
      source_confidence: 'medium',
      content_confidence: 'high',
      verification_status: 'unverified',
      interpretation_flag: false,
      notes: 'Explicit investigative gap — highest priority for modern follow-up.',
      created_by: userId,
    },
    {
      submission_id: s3,
      original_submission_id: s3,
      claim_position: 6,
      extracted_text: 'Investigative gap: The preserved fingerprints and footprints from 1951 have not been publicly confirmed as re-entered into modern databases (e.g., AFIS, NamUs biometrics). No confirmation exists that this re-submission has been attempted.',
      claim_type: 'statement',
      source_confidence: 'medium',
      content_confidence: 'high',
      verification_status: 'unverified',
      interpretation_flag: false,
      notes: 'Explicit investigative gap — modern database re-submission may be actionable.',
      created_by: userId,
    },
    {
      submission_id: s3,
      original_submission_id: s3,
      claim_position: 7,
      extracted_text: 'Investigative gap: The body was reportedly cremated after the 1951 investigation. The location of the cremated remains or ashes is unclear. No confirmed biological material has been recovered from clothing or associated evidence for modern DNA testing.',
      claim_type: 'statement',
      source_confidence: 'medium',
      content_confidence: 'medium',
      verification_status: 'unverified',
      interpretation_flag: false,
      notes: 'Remains status — critical barrier to modern DNA-based identification.',
      created_by: userId,
    },
    {
      submission_id: s3,
      original_submission_id: s3,
      claim_position: 8,
      extracted_text: 'Investigative gap: The gray women\'s raincoat found in the duffel bag has never been publicly linked to a specific person. The garment may carry trace evidence (fibers, hair, biological material) if the original evidence was preserved.',
      claim_type: 'statement',
      source_confidence: 'medium',
      content_confidence: 'medium',
      verification_status: 'unverified',
      interpretation_flag: false,
      notes: 'Raincoat provenance gap — may be actionable if physical evidence was retained.',
      created_by: userId,
    },
  ]

  const allClaimRows = [...s1Claims, ...s2Claims, ...s3Claims]
  const { data: insertedClaims, error: claimsErr } = await supabase
    .from('claims')
    .insert(allClaimRows)
    .select('id, extracted_text, claim_type, submission_id')

  if (claimsErr) {
    console.error('✗ Claims insert:', claimsErr.message)
    process.exit(1)
  }
  console.log(`  ✓ ${insertedClaims!.length} claims created`)

  // Index claims by position for linking
  const claimsBySubmission: Record<string, typeof insertedClaims> = {}
  for (const c of insertedClaims!) {
    if (!claimsBySubmission[c.submission_id]) claimsBySubmission[c.submission_id] = []
    claimsBySubmission[c.submission_id]!.push(c)
  }

  // ── 5. Entities ────────────────────────────────────────────────────────────

  console.log('\n[5/7] Creating entities...')

  const entityInserts = [
    {
      case_id: caseId,
      entity_type: 'person',
      raw_value: 'Goochland Boy (unidentified white male child)',
      normalized_value: 'Unidentified White Male Child — Goochland County VA 1951',
      normalization_status: 'normalized',
      confidence: 'high',
      review_state: 'unverified',
      notes: 'Victim. Age 3–6. Auburn/reddish hair, blue eyes, ~3\'6", ~44 lbs. Doe Network 3801UMVA / NamUs UP82515.',
      created_by: userId,
      flagged_for_review: false,
    },
    {
      case_id: caseId,
      entity_type: 'location',
      raw_value: 'Near Oilville, Goochland County, Virginia (Route 670 / Route 250)',
      normalized_value: 'Oilville, Goochland County, VA',
      normalization_status: 'normalized',
      confidence: 'high',
      review_state: 'corroborated',
      notes: 'Discovery location. Roadside dump site near Route 670 and Route 250 intersection. Rural area.',
      created_by: userId,
      flagged_for_review: false,
      nearest_highway: 'Route 250 / Route 670',
      highway_proximity: 'on_route',
    },
    {
      case_id: caseId,
      entity_type: 'other',
      raw_value: 'Blue Army-style duffel bag — interior marking "R 9700"',
      normalized_value: 'Blue Army-style duffel bag (marking: R 9700)',
      normalization_status: 'normalized',
      confidence: 'high',
      review_state: 'corroborated',
      notes: '"R 9700" printed inside. Investigators believed possible military laundry/ID marking. Never publicly confirmed as traced. This is one of the primary unresolved investigative leads.',
      created_by: userId,
      flagged_for_review: true,
    },
    {
      case_id: caseId,
      entity_type: 'other',
      raw_value: 'Gray women\'s raincoat (found inside duffel bag with victim)',
      normalized_value: 'Gray women\'s raincoat',
      normalization_status: 'normalized',
      confidence: 'high',
      review_state: 'corroborated',
      notes: 'Well-worn gray women\'s raincoat found inside the duffel bag alongside the child. Never linked to a specific person. Potential trace evidence source if physical evidence was preserved.',
      created_by: userId,
      flagged_for_review: true,
    },
    {
      case_id: caseId,
      entity_type: 'person',
      raw_value: 'Unknown person(s) who transported and deposited the child',
      normalized_value: null,
      normalization_status: 'raw',
      confidence: 'low',
      review_state: 'unverified',
      notes: 'Inferred from physical evidence: duffel bag, post-death transport, remote dump site, blindfold. Sex unknown; women\'s raincoat may suggest female household connection. No suspect ever publicly identified.',
      created_by: userId,
      flagged_for_review: true,
    },
  ]

  const { data: insertedEntities, error: entErr } = await supabase
    .from('entities')
    .insert(entityInserts)
    .select('id, raw_value, entity_type')

  if (entErr) {
    console.error('✗ Entities insert:', entErr.message)
    process.exit(1)
  }
  console.log(`  ✓ ${insertedEntities!.length} entities created`)

  // Name entities for linking
  const victimEntity = insertedEntities!.find(e => e.raw_value.startsWith('Goochland Boy'))!
  const locationEntity = insertedEntities!.find(e => e.entity_type === 'location')!
  const duffelEntity = insertedEntities!.find(e => e.raw_value.includes('duffel bag'))!
  const raincoatEntity = insertedEntities!.find(e => e.raw_value.includes('raincoat'))!
  const unknownPersonEntity = insertedEntities!.find(e => e.raw_value.includes('Unknown person'))!

  // ── 6. Claim-Entity Links ──────────────────────────────────────────────────

  console.log('\n[6/7] Creating claim-entity links...')

  // Get all claims for easy access
  const allClaims = insertedClaims!

  const findClaim = (submissionId: string, position: number) =>
    allClaims.find(c => c.submission_id === submissionId)

  // We'll link by matching position manually using the claim arrays
  const s1Inserted = allClaims.filter(c => c.submission_id === s1).sort((a, b) => 0)
  const s2Inserted = allClaims.filter(c => c.submission_id === s2).sort((a, b) => 0)
  const s3Inserted = allClaims.filter(c => c.submission_id === s3).sort((a, b) => 0)

  const links: Array<{
    claim_id: string
    entity_id: string
    entity_role: string
    identifier_source: string
    confidence: string
    notes?: string
    created_by: string
  }> = []

  // S1: physical description → victim
  if (s1Inserted[0]) links.push({ claim_id: s1Inserted[0].id, entity_id: victimEntity.id, entity_role: 'victim', identifier_source: 'found_in_document', confidence: 'high', created_by: userId })
  // S1: discovery location → location
  if (s1Inserted[1]) links.push({ claim_id: s1Inserted[1].id, entity_id: locationEntity.id, entity_role: 'location_reference', identifier_source: 'found_in_document', confidence: 'high', created_by: userId })
  // S1: timing → victim
  if (s1Inserted[2]) links.push({ claim_id: s1Inserted[2].id, entity_id: victimEntity.id, entity_role: 'victim', identifier_source: 'found_in_document', confidence: 'high', created_by: userId })
  // S1: injuries → victim
  if (s1Inserted[3]) links.push({ claim_id: s1Inserted[3].id, entity_id: victimEntity.id, entity_role: 'victim', identifier_source: 'found_in_document', confidence: 'high', created_by: userId })

  // S2: duffel bag claim → duffel entity
  if (s2Inserted[0]) links.push({ claim_id: s2Inserted[0].id, entity_id: duffelEntity.id, entity_role: 'identifier_fragment', identifier_source: 'found_in_document', confidence: 'high', created_by: userId })
  // S2: raincoat claim → raincoat entity
  if (s2Inserted[1]) links.push({ claim_id: s2Inserted[1].id, entity_id: raincoatEntity.id, entity_role: 'identifier_fragment', identifier_source: 'found_in_document', confidence: 'high', created_by: userId })
  // S2: R 9700 marking → duffel entity
  if (s2Inserted[2]) links.push({ claim_id: s2Inserted[2].id, entity_id: duffelEntity.id, entity_role: 'identifier_fragment', identifier_source: 'found_in_document', confidence: 'high', notes: 'The "R 9700" marking on the duffel bag is the primary physical identifier for the military connection theory.', created_by: userId })
  // S2: clothing → victim
  if (s2Inserted[5]) links.push({ claim_id: s2Inserted[5].id, entity_id: victimEntity.id, entity_role: 'victim', identifier_source: 'found_in_document', confidence: 'high', created_by: userId })
  if (s2Inserted[6]) links.push({ claim_id: s2Inserted[6].id, entity_id: victimEntity.id, entity_role: 'victim', identifier_source: 'found_in_document', confidence: 'high', created_by: userId })

  // S3: transport theory → unknown person
  if (s3Inserted[0]) links.push({ claim_id: s3Inserted[0].id, entity_id: unknownPersonEntity.id, entity_role: 'unknown', identifier_source: 'inferred', confidence: 'low', created_by: userId })
  // S3: military theory → duffel entity
  if (s3Inserted[1]) links.push({ claim_id: s3Inserted[1].id, entity_id: duffelEntity.id, entity_role: 'identifier_fragment', identifier_source: 'inferred', confidence: 'low', notes: 'Military connection theory links to the "R 9700" duffel bag.', created_by: userId })
  // S3: staging theory → unknown person
  if (s3Inserted[3]) links.push({ claim_id: s3Inserted[3].id, entity_id: unknownPersonEntity.id, entity_role: 'unknown', identifier_source: 'inferred', confidence: 'medium', created_by: userId })
  // S3: raincoat gap → raincoat entity
  if (s3Inserted[8]) links.push({ claim_id: s3Inserted[8].id, entity_id: raincoatEntity.id, entity_role: 'identifier_fragment', identifier_source: 'found_in_document', confidence: 'medium', created_by: userId })

  const { error: linkErr } = await supabase.from('claim_entity_links').insert(links)
  if (linkErr) console.warn('  ⚠ Some links failed:', linkErr.message)
  else console.log(`  ✓ ${links.length} claim-entity links created`)

  // ── 7. Pattern Flags ───────────────────────────────────────────────────────

  console.log('\n[7/7] Creating pattern flags...')

  const flags = [
    {
      case_id: caseId,
      flag_type: 'entity_frequency',
      title: 'Military-linked evidence: "R 9700" duffel bag marking — unresolved',
      description:
        'The blue Army-style duffel bag in which the child was found bears the marking "R 9700" on its interior. ' +
        'Investigators at the time believed this may represent a military laundry serial or property identification number. ' +
        'No public record confirms this line of inquiry was exhaustively traced. ' +
        'Military laundry markings from the early 1950s may be researchable through National Archives military records, ' +
        'veteran service records, or WWII/Korean War surplus documentation.',
      grade: 'strong',
      score: 85,
      reviewer_status: 'unreviewed',
    },
    {
      case_id: caseId,
      flag_type: 'forensic_sophistication',
      title: 'Deliberate concealment indicators: blindfold, contained transport, remote dump site',
      description:
        'Multiple physical details converge on deliberate, premeditated concealment rather than panicked disposal: ' +
        '(1) the child was blindfolded before being placed in the bag; ' +
        '(2) the body was enclosed in a duffel bag rather than left exposed; ' +
        '(3) the dump site was a rural roadside; ' +
        '(4) the body was transported after death (likely stored for several days). ' +
        'This behavioral cluster warrants analysis for forensic awareness and staging.',
      grade: 'notable',
      score: 70,
      reviewer_status: 'unreviewed',
    },
    {
      case_id: caseId,
      flag_type: 'victimology_similarity',
      title: 'Household care indicators: maintained, clothed, repaired garments — no signs of street abandonment',
      description:
        'The child\'s condition at discovery suggests he was receiving regular household care before death: ' +
        'he was fully clothed in layered, season-appropriate garments (union suit, denim, cardigan); ' +
        'the cardigan had a repaired mismatched button, indicating active mending; ' +
        'he was not nude, not dirty, and showed no signs consistent with street living or prolonged neglect. ' +
        'This profile is inconsistent with a child who was abandoned or homeless. ' +
        'It suggests a household context and warrants investigation into households in a geographic radius that had a young child unaccounted for after March 1951.',
      grade: 'notable',
      score: 65,
      reviewer_status: 'unreviewed',
    },
    {
      case_id: caseId,
      flag_type: 'signature_consistency',
      title: 'Clothing identification opportunity: distinctive garments may be traceable',
      description:
        'The child\'s clothing is described with unusual specificity: a red-and-pink checked cardigan (repaired button), ' +
        'a brown shirt with red/white/blue stripes, striped socks, denim pants, white union-suit underwear. ' +
        'Distinctive patterns like the cardigan check and striped shirt may correspond to regional or manufacturer-specific ' +
        'patterns from the late 1940s/early 1950s. Textile archives, vintage clothing researchers, and regional department store records ' +
        'from that period may offer identification pathways. The mismatched button is especially distinctive.',
      grade: 'notable',
      score: 60,
      reviewer_status: 'unreviewed',
    },
  ]

  const { data: insertedFlags, error: flagErr } = await supabase
    .from('pattern_flags')
    .insert(flags)
    .select('id')

  if (flagErr) console.warn('  ⚠ Flags insert:', flagErr.message)
  else console.log(`  ✓ ${insertedFlags!.length} pattern flags created`)

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log('\n── Seed complete ──────────────────────────────────────────────')
  console.log(`  Case ID:       ${caseId}`)
  console.log(`  Claims:        ${allClaimRows.length}`)
  console.log(`  Entities:      ${entityInserts.length}`)
  console.log(`  Entity links:  ${links.length}`)
  console.log(`  Pattern flags: ${flags.length}`)
  console.log('\n  The case is ready. Open Threadline → Pattern Intelligence → Threads')
  console.log('  and click "Generate Investigative Threads" to test the AI pipeline.\n')
}

main().catch(err => {
  console.error('\n✗ Unhandled error:', err)
  process.exit(1)
})
