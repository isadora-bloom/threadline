/**
 * Backfill Case Status & Flags
 *
 * Parses EXISTING enriched submission text to populate import_records with:
 * - classification (from "Case Classification:" line)
 * - circumstances_summary (from "Circumstances:" line)
 * - key_flags (international, family_abduction, foul_play, child, dna, dental)
 *
 * NO API calls. Just reads submission text already in the database.
 *
 * Usage: npx tsx scripts/backfill-status.ts
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function parseFlags(text: string, age: string | null): string[] {
  const flags: string[] = []
  const lower = text.toLowerCase()

  // Child
  if (age) {
    const ageNum = parseInt(age)
    if (!isNaN(ageNum) && ageNum < 13) flags.push('child')
  }

  // International
  if (lower.includes('international') || lower.includes('mexico') ||
      lower.includes('canada') || lower.includes('abroad') ||
      lower.includes('overseas') || lower.includes('another country') ||
      lower.includes('left the country') || lower.includes('taken to') && lower.includes('country')) {
    flags.push('international')
  }

  // Family abduction
  if ((lower.includes('abduct') || lower.includes('taken by') || lower.includes('took the child') ||
       lower.includes('custod') || lower.includes('non-custodial')) &&
      (lower.includes('family') || lower.includes('father') || lower.includes('mother') ||
       lower.includes('parent') || lower.includes('husband') || lower.includes('wife') ||
       lower.includes('ex-') || lower.includes('estranged'))) {
    flags.push('family_abduction')
  }

  // Foul play
  if (lower.includes('foul play') || lower.includes('homicide') || lower.includes('murder') ||
      lower.includes('killed') || lower.includes('shot') || lower.includes('stabbed') ||
      lower.includes('strangled') || lower.includes('suspicious death') ||
      lower.includes('body found') || lower.includes('remains found')) {
    flags.push('foul_play_suspected')
  }

  // Sex offender
  if (lower.includes('sex offend') || lower.includes('predator') ||
      lower.includes('registered offend') || lower.includes('sexual assault') ||
      lower.includes('molestation') || lower.includes('trafficking')) {
    flags.push('sex_offender_involvement')
  }

  // Endangered
  if (lower.includes('endangered') || lower.includes('mental health') ||
      lower.includes('medication') || lower.includes('suicidal') ||
      lower.includes('dementia') || lower.includes('alzheimer') ||
      lower.includes('disability') || lower.includes('special needs')) {
    flags.push('endangered')
  }

  // DNA available
  if (lower.includes('dna sample') || lower.includes('dna collected') ||
      lower.includes('dna available') || lower.includes('dna on file') ||
      /\bdna\b/.test(lower)) {
    flags.push('dna_available')
  }

  // Dental
  if (lower.includes('dental record') || lower.includes('dental x-ray') ||
      lower.includes('dentals:') || lower.includes('dental available')) {
    flags.push('dental_available')
  }

  // Fingerprints
  if (lower.includes('fingerprint') && !lower.includes('no fingerprint') &&
      !lower.includes('fingerprints not')) {
    flags.push('fingerprints_available')
  }

  // No media coverage (absence signal — if circumstances are detailed but no news keywords)
  // Skip this — too noisy without external data

  return [...new Set(flags)]
}

function parseClassification(text: string): string | null {
  // Doe Network format: "Case Classification: Endangered Missing"
  const match = text.match(/Case Classification:\s*(.+)/m)
  if (match) return match[1].trim()

  // Try to infer from circumstances
  const lower = text.toLowerCase()
  if (lower.includes('runaway') || lower.includes('ran away')) return 'Runaway'
  if (lower.includes('voluntary') || lower.includes('voluntarily')) return 'Voluntary Missing'
  if (lower.includes('family abduction') || lower.includes('parental abduction') ||
      lower.includes('custodial interference')) return 'Family Abduction'
  if (lower.includes('non-family abduction') || lower.includes('stranger abduction') ||
      lower.includes('kidnap')) return 'Non-Family Abduction'
  if (lower.includes('lost') && lower.includes('injured')) return 'Lost, Injured, Missing'
  if (lower.includes('endangered missing') || lower.includes('endangered')) return 'Endangered Missing'

  return null
}

function parseCircumstancesSummary(text: string): string | null {
  const match = text.match(/Circumstances:\s*(.+)/m)
  if (!match) return null
  const circ = match[1].trim()
  return circ.length > 200 ? circ.slice(0, 197) + '...' : circ
}

async function main() {
  console.log('=== Backfill Case Status & Flags ===\n')

  // Process all import_records that have a linked submission
  let offset = 0
  let updated = 0
  let skipped = 0
  const BATCH = 500

  while (true) {
    const { data: records, error } = await supabase
      .from('import_records')
      .select('id, external_id, submission_id, age_text, record_type')
      .not('submission_id', 'is', null)
      .is('circumstances_summary', null)
      .range(offset, offset + BATCH - 1)
      .order('created_at', { ascending: true })

    if (error) { console.error('Fetch error:', error.message); break }
    if (!records || records.length === 0) break

    // Batch fetch the linked submissions in chunks of 50 (Supabase URL length limit)
    const subIds = records.map(r => r.submission_id).filter(Boolean) as string[]
    const subMap = new Map<string, string>()
    for (let si = 0; si < subIds.length; si += 50) {
      const chunk = subIds.slice(si, si + 50)
      const { data: subs } = await supabase
        .from('submissions')
        .select('id, raw_text')
        .in('id', chunk)
      for (const s of subs ?? []) {
        subMap.set(s.id, s.raw_text)
      }
    }

    for (const record of records) {
      const text = subMap.get(record.submission_id) ?? ''
      if (!text) { skipped++; continue }

      const classification = parseClassification(text)
      const summary = parseCircumstancesSummary(text)
      const flags = parseFlags(text, record.age_text)

      const update: Record<string, unknown> = {}
      if (classification) update.classification = classification
      if (summary) update.circumstances_summary = summary
      if (flags.length > 0) update.key_flags = flags

      if (Object.keys(update).length > 0) {
        await supabase.from('import_records').update(update).eq('id', record.id)
        updated++
      } else {
        skipped++
      }
    }

    offset += records.length
    if (offset % 2000 === 0) {
      console.log(`Progress: ${offset} processed, ${updated} updated, ${skipped} skipped`)
    }
  }

  console.log(`\n=== Done ===`)
  console.log(`Total processed: ${offset}`)
  console.log(`Updated: ${updated}`)
  console.log(`Skipped: ${skipped}`)
}

main().catch(console.error)
