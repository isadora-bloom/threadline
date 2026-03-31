/**
 * Populate needs_skills on import_records
 *
 * Reads each record's flags, circumstances, and submission text to determine
 * what skills would be most useful for investigating that case.
 *
 * Skill mapping:
 *   genealogy      — DNA or dental available, unidentified remains
 *   osint          — circumstances mention social media, phone, online
 *   journalism     — no media coverage keywords, long-cold cases
 *   legal          — foul play, court/legal mentions in circumstances
 *   forensic_art   — unidentified remains without facial reconstruction
 *   local_knowledge — all cases (matched by user's region)
 *   geospatial     — highway/corridor/wilderness mentions
 *   medical_forensic — cause of death mentioned, forensic evidence
 *   languages      — Hispanic, international, non-English names
 *   law_enforcement — foul play, sex offender involvement
 *   victim_advocacy — child cases, family abduction
 *   data_analysis   — cases with many matches needing review
 *
 * Usage: npx tsx scripts/populate-needs-skills.ts
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function determineSkills(record: {
  record_type: string
  key_flags: string[]
  circumstances_summary: string | null
  classification: string | null
  race: string | null
  state: string | null
}): string[] {
  const skills: string[] = []
  const flags = record.key_flags ?? []
  const circ = (record.circumstances_summary ?? '').toLowerCase()
  const classif = (record.classification ?? '').toLowerCase()

  // Genealogy — DNA/dental available on unidentified remains
  if (flags.includes('dna_available') || flags.includes('dental_available')) {
    skills.push('genealogy')
  }
  if (record.record_type === 'unidentified_remains') {
    skills.push('genealogy') // all UID could benefit from genealogy
    skills.push('forensic_art') // all UID could use reconstruction
  }

  // OSINT — social media, phone, online presence mentions
  if (circ.includes('facebook') || circ.includes('social media') || circ.includes('online') ||
      circ.includes('internet') || circ.includes('phone') || circ.includes('cell') ||
      circ.includes('text') || circ.includes('message') || circ.includes('dating') ||
      circ.includes('craigslist') || circ.includes('app')) {
    skills.push('osint')
  }

  // Journalism — cold cases with no media keywords, long-missing
  if (!circ.includes('news') && !circ.includes('media') && !circ.includes('article') &&
      !circ.includes('report') && !circ.includes('coverage') && circ.length > 10) {
    skills.push('journalism') // no media coverage found
  }

  // Legal — foul play, legal mentions
  if (flags.includes('foul_play_suspected') || circ.includes('court') || circ.includes('trial') ||
      circ.includes('arrest') || circ.includes('warrant') || circ.includes('custody') ||
      circ.includes('restraining order') || circ.includes('protective order')) {
    skills.push('legal')
  }

  // Geospatial — highway, corridor, wilderness, park
  if (circ.includes('highway') || circ.includes('interstate') || circ.includes('i-') ||
      circ.includes('trail') || circ.includes('wilderness') || circ.includes('forest') ||
      circ.includes('park') || circ.includes('mountain') || circ.includes('river') ||
      circ.includes('lake') || circ.includes('desert') || circ.includes('remote')) {
    skills.push('geospatial')
  }

  // Medical/forensic — cause of death, medical conditions
  if (circ.includes('cause of death') || circ.includes('autopsy') || circ.includes('toxicology') ||
      circ.includes('medication') || circ.includes('medical') || circ.includes('hospital') ||
      circ.includes('mental health') || circ.includes('psychiatric') ||
      flags.includes('fingerprints_available')) {
    skills.push('medical_forensic')
  }

  // Languages — Hispanic, international
  if (flags.includes('international') || (record.race ?? '').toLowerCase().includes('hispanic')) {
    skills.push('languages')
  }

  // Law enforcement — foul play, sex offender
  if (flags.includes('foul_play_suspected') || flags.includes('sex_offender_involvement')) {
    skills.push('law_enforcement')
  }

  // Victim advocacy — children, family abduction
  if (flags.includes('child') || flags.includes('family_abduction') ||
      classif.includes('abduction') || classif.includes('endangered')) {
    skills.push('victim_advocacy')
  }

  return [...new Set(skills)]
}

async function main() {
  console.log('=== Populate needs_skills ===\n')

  let offset = 0
  let updated = 0
  const BATCH = 500

  while (true) {
    const { data: records, error } = await supabase
      .from('import_records')
      .select('id, record_type, key_flags, circumstances_summary, classification, race, state')
      .range(offset, offset + BATCH - 1)
      .order('created_at', { ascending: true })

    if (error) { console.error('Error:', error.message); break }
    if (!records || records.length === 0) break

    for (const record of records) {
      const skills = determineSkills(record as never)
      if (skills.length > 0) {
        await supabase
          .from('import_records')
          .update({ needs_skills: skills })
          .eq('id', record.id)
        updated++
      }
    }

    offset += records.length
    if (offset % 5000 === 0) console.log(`${offset} processed, ${updated} updated`)
  }

  console.log(`\nDone. ${offset} processed, ${updated} updated`)
}

main().catch(console.error)
