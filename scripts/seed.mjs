/**
 * Threadline seed script — fictional test data only
 * Run: node scripts/seed.mjs
 *
 * Creates:
 *  - 1 fictional missing persons case
 *  - 18 submissions (mix of priority, consent, observation mode)
 *  - Overlapping entities to trigger corroboration + pattern flags
 *  - A user profile for the seeded admin
 *
 * All names, plates, phones, and details are entirely fictional.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load env from .env.local
const envPath = join(__dirname, '../.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const [k, ...v] = l.split('=')
      return [k.trim(), v.join('=').trim()]
    })
)

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

// ─── Helpers ────────────────────────────────────────────────────────────────

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function hoursAgo(n) {
  return new Date(Date.now() - n * 3600000).toISOString()
}

async function getAdminUserId() {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error || !data.users.length) {
    console.error('No users found. Sign in at least once first, then re-run.')
    process.exit(1)
  }
  // Use first user
  return data.users[0].id
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeding Threadline with fictional test data...\n')

  const adminId = await getAdminUserId()
  console.log(`Using user: ${adminId}`)

  // ── Upsert user profile ─────────────────────────────────────────────────
  await supabase.from('user_profiles').upsert({
    id: adminId,
    full_name: 'Case Lead',
    organization: 'Test Organization',
  })

  // ── Create case ──────────────────────────────────────────────────────────
  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .insert({
      title: 'Maria Elena Vasquez — Route 29 Corridor',
      case_type: 'missing_person',
      jurisdiction: 'Culpeper County, Virginia',
      status: 'active',
      visibility_level: 'team',
      created_by: adminId,
      notes: 'FICTIONAL TEST CASE — all names, dates, and details are invented for platform testing only. Maria Elena Vasquez, 34, last seen March 2 near Culpeper, VA. No real persons are referenced.',
    })
    .select()
    .single()

  if (caseError) {
    console.error('Case create failed:', caseError.message)
    process.exit(1)
  }

  const caseId = caseData.id
  console.log(`✓ Case created: ${caseId}`)

  // ── Case user role ────────────────────────────────────────────────────────
  await supabase.from('case_user_roles').insert({
    case_id: caseId,
    user_id: adminId,
    role: 'lead_investigator',
  })

  // ── Case pattern settings ─────────────────────────────────────────────────
  await supabase.from('case_pattern_settings').insert({
    case_id: caseId,
    proximity_radius_miles: 25,
    temporal_window_days: 90,
    cross_case_matching_enabled: false,
  })

  // ── Submission token ──────────────────────────────────────────────────────
  await supabase.from('submission_tokens').insert({
    case_id: caseId,
    label: 'Primary public form',
    is_active: true,
    expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
    created_by: adminId,
  })

  // ── Submissions ───────────────────────────────────────────────────────────
  // 18 submissions: high/medium/low priority, mix of consent, firsthand, entities
  // Several share vehicle/plate fragments to trigger corroboration + pattern flags

  const submissions = [

    // ── HIGH PRIORITY ────────────────────────────────────────────────────────

    {
      raw_text: "I was at the Sheetz on Route 29 near Culpeper around 8:45 on the night of March 2nd. I saw a woman matching the description — dark hair, maybe mid-thirties, wearing a red jacket — talking to a man near a dark blue pickup truck. The truck had a Virginia plate starting with KJF. She looked agitated. He was taller, heavyset, maybe 50s, gray baseball cap. They drove south on 29. I didn't think anything of it until I saw the flyer.",
      source_type: 'named_individual',
      submitter_consent: 'confidential',
      submitter_name: 'ENCRYPTED_TEST',
      submitter_contact: 'ENCRYPTED_TEST',
      firsthand: true,
      observation_mode: 'observed_directly',
      event_date: daysAgo(14) ,
      event_date_precision: 'exact',
      event_location: 'Sheetz, Route 29, Culpeper VA',
      event_location_lat: 38.4732,
      event_location_lng: -78.0044,
      has_location_pin: true,
      has_date: true,
      word_count: 110,
      entity_count_step6: 4,
      priority_score: 85,
      priority_level: 'high',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'new_entity', label: 'KJF partial plate' },
        { type: 'new_entity', label: 'dark blue pickup truck' },
        { type: 'new_entity', label: 'heavyset male gray cap' },
      ],
    },

    {
      raw_text: "I drive Route 29 every day for work. On March 2nd I passed a dark blue or navy Ford F-150 pulled over near the BP station south of Culpeper, around 9:10pm. A woman was standing outside the passenger side. She was wearing something red. The truck had a KJ plate — I only caught the first two letters because I was passing. I thought it was a breakdown but now I'm not sure.",
      source_type: 'named_individual',
      submitter_consent: 'on_record',
      submitter_name: 'Thomas Ridley',
      submitter_contact: 'tom.ridley@email.com',
      firsthand: true,
      observation_mode: 'observed_directly',
      event_date: daysAgo(14),
      event_date_precision: 'approximate',
      event_location: 'Route 29 south of Culpeper, near BP station',
      event_location_lat: 38.4521,
      event_location_lng: -78.0112,
      has_location_pin: true,
      has_date: true,
      word_count: 97,
      entity_count_step6: 3,
      priority_score: 78,
      priority_level: 'high',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'corroboration', label: 'KJ partial plate', count: 1 },
        { type: 'corroboration', label: 'dark blue pickup', count: 1 },
      ],
    },

    {
      raw_text: "My brother works at the truck stop on 29 south of Culpeper. He told me he saw a woman matching the description around 9:30 that night, walking toward the back of the lot. She looked like she was waiting for someone. He didn't see her leave. He saw a dark colored pickup nearby, couldn't make out the plate. He said she had a red jacket on and dark hair. He's willing to speak to investigators if needed. His name is Derek Okafor.",
      source_type: 'named_individual',
      submitter_consent: 'confidential',
      submitter_name: 'ENCRYPTED_TEST',
      submitter_contact: 'ENCRYPTED_TEST',
      firsthand: false,
      observation_mode: 'reported_by_another',
      event_date: daysAgo(14),
      event_date_precision: 'approximate',
      event_location: 'Truck stop, Route 29 south of Culpeper',
      event_location_lat: 38.4398,
      event_location_lng: -78.0189,
      has_location_pin: true,
      has_date: true,
      word_count: 105,
      entity_count_step6: 3,
      priority_score: 62,
      priority_level: 'medium',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'corroboration', label: 'dark pickup', count: 2 },
        { type: 'corroboration', label: 'red jacket', count: 2 },
        { type: 'new_entity', label: 'Derek Okafor' },
      ],
    },

    {
      raw_text: "I need to report something urgent. On the night in question I was at the Warrenton Walmart on 29 and I saw a navy blue Ford truck — it was a late model F-150 — parked near the garden center entrance around 11pm. Virginia plate KJF-4471. A heavyset man in his 50s was in the driver seat. He was on his phone for a long time. I wrote the plate down because something felt off. I don't know if this is related but the plate stuck with me.",
      source_type: 'named_individual',
      submitter_consent: 'on_record',
      submitter_name: 'Sandra Chen',
      submitter_contact: '5408829341',
      firsthand: true,
      observation_mode: 'observed_directly',
      event_date: daysAgo(13),
      event_date_precision: 'exact',
      event_location: 'Walmart, Route 29, Warrenton VA',
      event_location_lat: 38.7182,
      event_location_lng: -77.7963,
      has_location_pin: true,
      has_date: true,
      word_count: 103,
      entity_count_step6: 4,
      priority_score: 91,
      priority_level: 'high',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'corroboration', label: 'KJF plate', count: 2 },
        { type: 'new_entity', label: 'KJF-4471 full plate' },
        { type: 'corroboration', label: 'navy Ford F-150', count: 3 },
      ],
    },

    {
      raw_text: "Maria is my coworker. She was supposed to be at work on March 3rd and never came in and never called. That was completely unlike her. She mentioned a few weeks before that she'd been getting calls from a blocked number. She seemed nervous about it but wouldn't tell me more. She lives alone in Culpeper. I have her emergency contact number if needed — it's her sister in Woodbridge. Maria's car was still at her apartment when I drove by on March 4th.",
      source_type: 'named_individual',
      submitter_consent: 'on_record',
      submitter_name: 'Priya Nair',
      submitter_contact: 'priya.nair.work@gmail.com',
      firsthand: false,
      observation_mode: 'reported_by_another',
      event_date: daysAgo(13),
      event_date_precision: 'approximate',
      event_location: 'Culpeper, VA',
      has_date: true,
      word_count: 108,
      entity_count_step6: 2,
      priority_score: 55,
      priority_level: 'medium',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'new_entity', label: 'blocked number calls' },
        { type: 'new_entity', label: 'sister in Woodbridge' },
      ],
    },

    // ── MEDIUM PRIORITY ───────────────────────────────────────────────────────

    {
      raw_text: "I work at a rest stop on I-66 near Gainesville. About two nights after the date I keep seeing on the flyers, a woman came in alone around midnight. She seemed distressed, asked to use the phone, said she needed to call someone. I let her use the office phone. She called what sounded like a cell number, no answer. She left after about 10 minutes walking east toward the parking lot. I didn't see her get into any vehicle. I can't say for certain it was the same person.",
      source_type: 'named_individual',
      submitter_consent: 'confidential',
      submitter_name: 'ENCRYPTED_TEST',
      submitter_contact: 'ENCRYPTED_TEST',
      firsthand: true,
      observation_mode: 'observed_directly',
      event_date: daysAgo(12),
      event_date_precision: 'approximate',
      event_location: 'I-66 rest stop near Gainesville VA',
      event_location_lat: 38.8015,
      event_location_lng: -77.6388,
      has_location_pin: true,
      has_date: true,
      word_count: 115,
      entity_count_step6: 1,
      priority_score: 48,
      priority_level: 'medium',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'new_entity', label: 'I-66 rest stop' },
      ],
    },

    {
      raw_text: "I'm a truck driver and I regularly run Route 29 between Culpeper and Warrenton. I've seen a dark blue F-150 with a partial plate KJ at multiple stops on that stretch over the past month. Couldn't tell you exact dates but I'd say at least three times. Once at the Sheetz near Culpeper, once at the BP further south, once near the Warrenton interchange. Always late at night. The driver is a big guy, older. I don't know if it's the same truck each time.",
      source_type: 'named_individual',
      submitter_consent: 'confidential',
      submitter_name: 'ENCRYPTED_TEST',
      submitter_contact: 'ENCRYPTED_TEST',
      firsthand: true,
      observation_mode: 'observed_directly',
      event_date: daysAgo(10),
      event_date_precision: 'approximate',
      event_location: 'Route 29 corridor, Culpeper to Warrenton VA',
      has_date: true,
      word_count: 113,
      entity_count_step6: 3,
      priority_score: 58,
      priority_level: 'medium',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'corroboration', label: 'KJ partial plate', count: 3 },
        { type: 'corroboration', label: 'dark blue F-150', count: 4 },
        { type: 'corroboration', label: 'Sheetz Culpeper', count: 1 },
      ],
    },

    {
      raw_text: "I think I saw the missing woman at the Food Lion in Warrenton on March 4th, around 6pm. She was with a man but seemed okay — they were arguing quietly in the parking lot and then got in a dark truck and left going north. I wasn't sure enough to call 911 at the time. The man was definitely white, heavy, older. I couldn't see the plate from where I was standing.",
      source_type: 'anonymous',
      submitter_consent: 'anonymous',
      firsthand: true,
      observation_mode: 'observed_directly',
      event_date: daysAgo(12),
      event_date_precision: 'approximate',
      event_location: 'Food Lion, Warrenton VA',
      event_location_lat: 38.7143,
      event_location_lng: -77.7981,
      has_location_pin: true,
      has_date: true,
      word_count: 96,
      entity_count_step6: 2,
      priority_score: 44,
      priority_level: 'medium',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'corroboration', label: 'dark truck', count: 4 },
      ],
      interpretation_text: "I think she was okay but the situation looked wrong.",
    },

    {
      raw_text: "Maria has a sister named Catalina who lives in Woodbridge. I know her through a mutual friend. Catalina told me she got a text from Maria's number on March 3rd around 2am that just said 'help' and then nothing. She screenshotted it and reported it to Culpeper PD. I don't know if they followed up. Catalina's number is 7033847201.",
      source_type: 'named_individual',
      submitter_consent: 'on_record',
      submitter_name: 'Darnell Hayes',
      submitter_contact: 'darnell.hayes@outlook.com',
      firsthand: false,
      observation_mode: 'reported_by_another',
      event_date: daysAgo(13),
      event_date_precision: 'approximate',
      has_date: true,
      word_count: 89,
      entity_count_step6: 2,
      priority_score: 52,
      priority_level: 'medium',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'new_entity', label: 'Catalina (sister)' },
        { type: 'new_entity', label: '7033847201' },
        { type: 'new_entity', label: 'help text March 3 2am' },
      ],
    },

    {
      raw_text: "I saw a post about this on Facebook. I don't have any direct information but I wanted to share that there have been several women reported missing along the Route 29 corridor in the past two years. I don't know the details but I feel like someone should look into whether this is connected to those cases. This stretch of highway has had issues for a long time.",
      source_type: 'anonymous',
      submitter_consent: 'anonymous',
      firsthand: false,
      observation_mode: 'reported_by_another',
      word_count: 79,
      entity_count_step6: 0,
      priority_score: 12,
      priority_level: 'low',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [],
      interpretation_text: "I think there's a pattern here involving the 29 corridor and multiple missing persons over the years.",
    },

    // ── LOW PRIORITY / TRIAGE CANDIDATES ─────────────────────────────────────

    {
      raw_text: "I have a gut feeling about a neighbor of mine. He drives a dark truck and keeps weird hours. I don't have any specific information linking him to this case but something about him has always felt off to me. He moved in about a year ago. I think investigators should look at him.",
      source_type: 'anonymous',
      submitter_consent: 'anonymous',
      firsthand: false,
      observation_mode: 'inferred_from_document',
      word_count: 61,
      entity_count_step6: 0,
      priority_score: 8,
      priority_level: 'low',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [],
      interpretation_text: "I think my neighbor is involved. He drives a dark truck and has weird hours.",
    },

    {
      raw_text: "I live near the Culpeper town center and I've noticed a dark blue truck parked on Jefferson Street overnight on March 1st and March 3rd. Virginia plate — I didn't write it down but I think it started with K. It was gone by morning both times. I don't know if this is relevant.",
      source_type: 'named_individual',
      submitter_consent: 'confidential',
      submitter_name: 'ENCRYPTED_TEST',
      submitter_contact: 'ENCRYPTED_TEST',
      firsthand: true,
      observation_mode: 'observed_directly',
      event_date: daysAgo(15),
      event_date_precision: 'approximate',
      event_location: 'Jefferson Street, Culpeper VA',
      event_location_lat: 38.4735,
      event_location_lng: -78.0009,
      has_location_pin: true,
      has_date: true,
      word_count: 82,
      entity_count_step6: 2,
      priority_score: 38,
      priority_level: 'medium',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'corroboration', label: 'K plate dark truck', count: 5 },
      ],
    },

    {
      raw_text: "I am a private investigator and I have been working a separate case involving a blue Ford F-150, Virginia plate KJF-4471, registered to a Harold Benton of Fredericksburg VA. This vehicle has appeared in surveillance footage at two locations I have been investigating over the past 60 days. I can share the footage with authorized investigators. This submission is on record.",
      source_type: 'named_individual',
      submitter_consent: 'on_record',
      submitter_name: 'Raymond Kowalski PI',
      submitter_contact: 'rkowalski.pi@protonmail.com',
      firsthand: true,
      observation_mode: 'inferred_from_document',
      event_date: daysAgo(5),
      event_date_precision: 'approximate',
      has_date: true,
      word_count: 91,
      entity_count_step6: 3,
      priority_score: 72,
      priority_level: 'high',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'corroboration', label: 'KJF-4471', count: 1 },
        { type: 'new_entity', label: 'Harold Benton Fredericksburg' },
      ],
    },

    {
      raw_text: "This is the same as what I submitted last week. I saw the blue pickup at the Sheetz on 29 near Culpeper on the night of March 2nd, Virginia plate KJF something, heavyset older man driving. I wanted to make sure you received it because I didn't hear back.",
      source_type: 'anonymous',
      submitter_consent: 'anonymous',
      firsthand: true,
      observation_mode: 'observed_directly',
      event_date: daysAgo(14),
      event_date_precision: 'approximate',
      has_date: true,
      word_count: 65,
      entity_count_step6: 2,
      priority_score: 22,
      priority_level: 'low',
      review_status: 'unverified',
      triage_status: 'untriaged',
      duplicate_similarity: 0.81,
      novelty_flags: [
        { type: 'duplicate', label: 'Possible duplicate', similarity: 81 },
        { type: 'corroboration', label: 'KJF plate Sheetz', count: 2 },
      ],
    },

    {
      raw_text: "I don't know anything specific but I wanted to say that Maria is a wonderful person and her family is devastated. Please find her. Her mother Rosa checks the Facebook page every day. Is there anything the community can do to help?",
      source_type: 'anonymous',
      submitter_consent: 'anonymous',
      firsthand: false,
      observation_mode: 'reported_by_another',
      word_count: 47,
      entity_count_step6: 0,
      priority_score: 5,
      priority_level: 'low',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [],
    },

    {
      raw_text: "I work at Culpeper Regional Hospital in the emergency department. We treated a woman on March 3rd in the early morning hours — around 3am — who refused to give her name. She had bruising on her left arm and wrist consistent with a grab injury. She left AMA (against medical advice) before we could complete assessment. Our records are protected by HIPAA but I felt I needed to flag this for investigators. I'm submitting anonymously to protect my employment.",
      source_type: 'anonymous',
      submitter_consent: 'anonymous',
      firsthand: true,
      observation_mode: 'observed_directly',
      event_date: daysAgo(13),
      event_date_precision: 'exact',
      event_location: 'Culpeper Regional Hospital, Culpeper VA',
      event_location_lat: 38.4821,
      event_location_lng: -77.9971,
      has_location_pin: true,
      has_date: true,
      word_count: 102,
      entity_count_step6: 1,
      priority_score: 67,
      priority_level: 'medium',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'new_entity', label: 'unnamed female AMA March 3 3am' },
        { type: 'new_entity', label: 'Culpeper Regional Hospital' },
      ],
    },

    {
      raw_text: "I'm a ham radio operator and I monitor local police frequencies. On the night of March 2nd between 9 and 10pm I heard a traffic stop called in on Route 29 south of Culpeper — the officer called in a dark blue F-150, Virginia plate KJF-4471. The stop was called clear after about 8 minutes. I log all my monitoring. I can provide the exact timestamp from my log if useful.",
      source_type: 'named_individual',
      submitter_consent: 'on_record',
      submitter_name: 'Walter Pfeiffer',
      submitter_contact: 'wpfeiffer.radio@gmail.com',
      firsthand: true,
      observation_mode: 'heard_directly',
      event_date: daysAgo(14),
      event_date_precision: 'exact',
      event_location: 'Route 29 south of Culpeper VA',
      event_location_lat: 38.4421,
      event_location_lng: -78.0201,
      has_location_pin: true,
      has_date: true,
      word_count: 107,
      entity_count_step6: 3,
      priority_score: 76,
      priority_level: 'high',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'corroboration', label: 'KJF-4471', count: 2 },
        { type: 'new_entity', label: 'traffic stop 9-10pm March 2' },
      ],
    },

    {
      raw_text: "I have been following this case closely online. I've done some research and I believe the registered owner of the plate KJF-4471 may have a prior record. I'm not going to say more than that because I don't want to get anyone in trouble unfairly. I just think investigators should look into the vehicle owner's background. I could be wrong.",
      source_type: 'anonymous',
      submitter_consent: 'anonymous',
      firsthand: false,
      observation_mode: 'inferred_from_document',
      word_count: 73,
      entity_count_step6: 1,
      priority_score: 18,
      priority_level: 'low',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'corroboration', label: 'KJF-4471', count: 3 },
      ],
      interpretation_text: "I think the vehicle owner has a prior record and is likely involved.",
    },

    {
      raw_text: "I live in Fredericksburg and my next-door neighbor Harold Benton drives a dark blue Ford pickup. He is in his late 50s and is very large. He works for a trucking company. He is often away for days at a time. I don't know his plate number. He has always seemed fine to me but given what's happening I felt I should say something.",
      source_type: 'named_individual',
      submitter_consent: 'confidential',
      submitter_name: 'ENCRYPTED_TEST',
      submitter_contact: 'ENCRYPTED_TEST',
      firsthand: false,
      observation_mode: 'reported_by_another',
      event_date: daysAgo(3),
      event_date_precision: 'approximate',
      event_location: 'Fredericksburg VA',
      has_date: true,
      word_count: 88,
      entity_count_step6: 2,
      priority_score: 61,
      priority_level: 'medium',
      review_status: 'unverified',
      triage_status: 'untriaged',
      novelty_flags: [
        { type: 'corroboration', label: 'Harold Benton', count: 1 },
        { type: 'corroboration', label: 'dark blue pickup Fredericksburg', count: 1 },
      ],
    },

  ]

  // Insert all submissions
  let inserted = 0
  for (const sub of submissions) {
    const { error } = await supabase.from('submissions').insert({
      case_id: caseId,
      intake_date: hoursAgo(Math.floor(Math.random() * 72) + 1),
      ...sub,
    })
    if (error) {
      console.error('  ✗ Submission failed:', error.message, sub.raw_text.slice(0, 60))
    } else {
      inserted++
      process.stdout.write('.')
    }
  }

  console.log(`\n✓ ${inserted}/${submissions.length} submissions created`)

  // ── Entities (pre-seed key entities for the entity registry) ─────────────
  const entities = [
    {
      entity_type: 'vehicle',
      raw_value: 'Dark blue Ford F-150 pickup',
      normalized_value: 'Navy/dark blue Ford F-150 pickup truck',
      normalization_status: 'normalized',
      aliases: ['dark blue pickup', 'navy Ford truck', 'dark F-150', 'blue pickup'],
      confidence: 'high',
      flagged_for_review: false,
    },
    {
      entity_type: 'vehicle',
      raw_value: 'KJF partial plate',
      normalized_value: 'Virginia plate KJF-xxxx',
      normalization_status: 'flagged_ambiguous',
      aliases: ['KJ plate', 'KJF plate', 'Virginia KJF'],
      confidence: 'medium',
      flagged_for_review: true,
    },
    {
      entity_type: 'vehicle',
      raw_value: 'KJF-4471',
      normalized_value: 'Virginia KJF-4471',
      normalization_status: 'normalized',
      aliases: ['plate KJF-4471', 'KJF 4471'],
      confidence: 'high',
      flagged_for_review: false,
    },
    {
      entity_type: 'person',
      raw_value: 'Heavyset male, 50s, gray baseball cap',
      normalized_value: 'Unknown male — heavyset, approx 50s, gray cap',
      normalization_status: 'normalized',
      aliases: ['big guy older', 'heavyset older man', 'large male gray hat'],
      confidence: 'medium',
      flagged_for_review: false,
    },
    {
      entity_type: 'person',
      raw_value: 'Harold Benton, Fredericksburg VA',
      normalized_value: 'Harold Benton',
      normalization_status: 'normalized',
      aliases: ['Harold Benton'],
      confidence: 'high',
      flagged_for_review: true,
      notes: 'Appears in two independent submissions — vehicle PI submission and neighbor submission. Flagged for investigative attention.',
    },
    {
      entity_type: 'person',
      raw_value: 'Derek Okafor — truck stop worker',
      normalized_value: 'Derek Okafor',
      normalization_status: 'normalized',
      aliases: ['Derek Okafor'],
      confidence: 'medium',
      flagged_for_review: false,
      notes: 'Potential witness — brother of submitter, was present at truck stop around 9:30pm. Willing to speak to investigators per submitter.',
    },
    {
      entity_type: 'person',
      raw_value: 'Catalina Vasquez — sister, Woodbridge VA',
      normalized_value: 'Catalina Vasquez',
      normalization_status: 'normalized',
      aliases: ['Catalina', 'Maria\'s sister'],
      confidence: 'high',
      flagged_for_review: false,
      notes: 'Received text reading "help" from subject\'s phone on March 3 approx 2am. Reported to Culpeper PD. Key contact.',
    },
    {
      entity_type: 'phone',
      raw_value: '7033847201',
      normalized_value: '(703) 384-7201',
      normalization_status: 'normalized',
      aliases: ['703-384-7201'],
      confidence: 'high',
      notes: 'Catalina Vasquez — sister of subject',
    },
    {
      entity_type: 'phone',
      raw_value: 'Blocked number — repeated calls before disappearance',
      normalized_value: 'Unknown blocked number',
      normalization_status: 'flagged_ambiguous',
      confidence: 'low',
      flagged_for_review: true,
      notes: 'Subject reportedly receiving calls from blocked number in weeks before disappearance, appeared nervous per coworker submission.',
    },
    {
      entity_type: 'location',
      raw_value: 'Sheetz, Route 29, Culpeper VA',
      normalized_value: 'Sheetz — Route 29 Culpeper VA',
      normalization_status: 'normalized',
      lat: 38.4732,
      lng: -78.0044,
      nearest_highway: 'US-29',
      highway_proximity: 'on_route',
      confidence: 'high',
    },
    {
      entity_type: 'location',
      raw_value: 'BP station south of Culpeper on Route 29',
      normalized_value: 'BP Station — Route 29 S of Culpeper VA',
      normalization_status: 'normalized',
      lat: 38.4521,
      lng: -78.0112,
      nearest_highway: 'US-29',
      highway_proximity: 'on_route',
      confidence: 'medium',
    },
    {
      entity_type: 'location',
      raw_value: 'Truck stop, Route 29 south of Culpeper',
      normalized_value: 'Truck stop — Route 29 S Culpeper VA',
      normalization_status: 'normalized',
      lat: 38.4398,
      lng: -78.0189,
      nearest_highway: 'US-29',
      highway_proximity: 'on_route',
      confidence: 'medium',
    },
    {
      entity_type: 'location',
      raw_value: 'Walmart Route 29 Warrenton VA',
      normalized_value: 'Walmart — Route 29 Warrenton VA',
      normalization_status: 'normalized',
      lat: 38.7182,
      lng: -77.7963,
      nearest_highway: 'US-29',
      highway_proximity: 'near_route',
      confidence: 'high',
    },
    {
      entity_type: 'location',
      raw_value: 'Culpeper Regional Hospital',
      normalized_value: 'Culpeper Regional Hospital — Culpeper VA',
      normalization_status: 'normalized',
      lat: 38.4821,
      lng: -77.9971,
      confidence: 'high',
    },
  ]

  let entityInserted = 0
  const entityIds = {}
  for (const entity of entities) {
    const { data, error } = await supabase.from('entities').insert({
      case_id: caseId,
      created_by: adminId,
      review_state: 'unverified',
      ...entity,
    }).select().single()
    if (error) {
      console.error('  ✗ Entity failed:', error.message, entity.raw_value)
    } else {
      entityIds[entity.raw_value] = data.id
      entityInserted++
      process.stdout.write('·')
    }
  }

  console.log(`\n✓ ${entityInserted}/${entities.length} entities created`)

  // ── Victim profile ────────────────────────────────────────────────────────
  const personEntityId = entityIds['Heavyset male, 50s, gray baseball cap']
  // Find the person entity for the subject - we'll create a victim profile
  const { data: victimEntity } = await supabase
    .from('entities')
    .insert({
      case_id: caseId,
      entity_type: 'person',
      raw_value: 'Maria Elena Vasquez',
      normalized_value: 'Maria Elena Vasquez',
      normalization_status: 'normalized',
      confidence: 'high',
      created_by: adminId,
      notes: 'Subject — FICTIONAL. This is test data.',
    })
    .select().single()

  if (victimEntity) {
    await supabase.from('victim_profiles').insert({
      case_id: caseId,
      person_entity_id: victimEntity.id,
      age_range_min: 32,
      age_range_max: 36,
      gender: 'female',
      last_known_date: daysAgo(14),
      last_confirmed_contact_type: 'text',
      last_confirmed_contact_notes: 'Text message reading "help" received by sister Catalina at approx 2am March 3. Phone has not been active since.',
      employment_status: 'Employed — office worker, Culpeper',
      transportation_mode: 'Own vehicle (car remained at apartment)',
      lifestyle_exposure_level: 'low',
      prior_missing_episodes: 0,
      transience_level: 'stable',
      regular_locations: [
        'Culpeper town center (home)',
        'Office — employer not yet identified',
        'Sheetz Route 29 (per coworker)',
      ],
      known_threats: 'Blocked number calls in weeks before disappearance — nervous per coworker. No restraining orders on record.',
      created_by: adminId,
    })
    console.log('✓ Victim profile created')
  }

  // ── Pre-seed two pattern flags to demonstrate the UI ─────────────────────
  // Get first two submission IDs to attach flags to
  const { data: firstSubmissions } = await supabase
    .from('submissions')
    .select('id')
    .eq('case_id', caseId)
    .limit(4)

  if (firstSubmissions && firstSubmissions.length >= 2) {
    await supabase.from('pattern_flags').insert([
      {
        case_id: caseId,
        flag_type: 'highway_corridor_cluster',
        title: 'Possible corridor pattern — US-29 southbound, 4 claims',
        description: 'Four submissions reference locations on or near US Route 29 between Culpeper and Warrenton within a 14-day window. Three independently describe a dark blue pickup with a KJ-prefix plate. Sequential positioning suggests possible southbound movement. Surfaced for review — human judgment required before any conclusions are drawn.',
        involved_claim_ids: firstSubmissions.slice(0, 2).map(s => s.id),
        involved_entity_ids: Object.values(entityIds).slice(0, 3),
        score: 74,
        grade: 'strong',
        signals: {
          geo_proximity_15mi: 10,
          time_3_days: 15,
          shared_vehicle_entity: 15,
          independent_sources: 15,
          highway_corridor_us29: 20,
          sequential_positioning: 15,
        },
        reviewer_status: 'unreviewed',
      },
      {
        case_id: caseId,
        flag_type: 'entity_frequency',
        title: 'Frequently appearing entity — KJF plate prefix',
        description: 'The partial plate "KJF" (or KJ prefix) appears in 7 of 18 submissions from 6 independent submitters. One submission provides the full plate KJF-4471. A separate submission corroborates this plate via a private investigator. Surfaced for review.',
        involved_entity_ids: [
          entityIds['KJF partial plate'],
          entityIds['KJF-4471'],
        ].filter(Boolean),
        score: 68,
        grade: 'strong',
        signals: {
          entity_frequency_pct: 38,
          independent_sources: 15,
          full_plate_corroboration: 40,
          cross_submission_consistency: 13,
        },
        reviewer_status: 'unreviewed',
      },
    ])
    console.log('✓ Pattern flags pre-seeded')
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Seed complete

Case:         Maria Elena Vasquez — Route 29 Corridor
Case ID:      ${caseId}

Submissions:  ${inserted} (mix of High/Medium/Low priority)
Entities:     ${entityInserted} (vehicles, people, locations, phones)
Pattern flags: 2 pre-seeded (corridor cluster, entity frequency)

THIS IS ENTIRELY FICTIONAL TEST DATA.
All names, plates, and details are invented.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Next steps:
  1. Open http://localhost:3000/cases
  2. Click into the case
  3. Try triage mode on the submissions queue
  4. Review a high-priority submission and extract claims
  5. Check Pattern Intelligence for the pre-seeded flags
`)
}

seed().catch(err => {
  console.error('\n❌ Seed failed:', err.message)
  process.exit(1)
})
