/**
 * NamUs Case Detail Enrichment
 *
 * Fetches full case details from NamUs individual case endpoints to get
 * physical descriptions that the search API doesn't return:
 *   - Hair color, eye color
 *   - Height, weight
 *   - Distinguishing marks (tattoos, scars, piercings, birthmarks)
 *   - Clothing / jewelry
 *   - Dental info, DNA status, fingerprint status
 *   - Full circumstances narrative
 *   - State of remains / body condition
 *
 * Updates existing submissions with enriched text so the DOE matcher
 * can use all 16 signals instead of just 6.
 *
 * Rate: 1 request per second. NamUs is a government resource.
 *
 * Usage:
 *   npx tsx scripts/enrich-namus-details.ts [--limit 500] [--type missing|unidentified]
 *   npx tsx scripts/enrich-namus-details.ts --top-matches   # prioritize records with existing matches
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const NAMUS_BASE = 'https://www.namus.gov'
const DELAY_MS = 1000
const HEADERS = {
  'User-Agent': 'Threadline Case Intelligence Platform - public interest research (threadline.app)',
  'Accept': 'application/json',
}

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 500
const typeIdx = args.indexOf('--type')
const TYPE_FILTER = typeIdx !== -1 ? args[typeIdx + 1] : null
const TOP_MATCHES = args.includes('--top-matches')

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWithRetry(url: string, retries = 2): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        if (res.status === 404) return null // case doesn't exist
        if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue }
        return null
      }
      return await res.json() as Record<string, unknown>
    } catch {
      if (attempt < retries) await sleep(2000 * (attempt + 1))
    }
  }
  return null
}

function extractNamusNumber(notes: string | null, rawText: string): { type: 'MP' | 'UP'; number: number } | null {
  const text = (notes ?? '') + ' ' + rawText
  const match = text.match(/NamUs\s*ID:\s*(MP|UP)(\d+)/i)
  if (match) return { type: match[1].toUpperCase() as 'MP' | 'UP', number: parseInt(match[2]) }

  // Try from import_records external_id
  const extMatch = text.match(/(MP|UP)(\d+)/)
  if (extMatch) return { type: extMatch[1].toUpperCase() as 'MP' | 'UP', number: parseInt(extMatch[2]) }

  return null
}

function buildEnrichedText(
  existing: string,
  detail: Record<string, unknown>,
  caseType: 'MP' | 'UP',
): string {
  const lines = existing.split('\n')
  const existingKeys = new Set(lines.map(l => l.split(':')[0].trim()))

  const addLine = (key: string, value: unknown) => {
    if (!value || value === 'Unknown' || value === 'Not Available') return
    if (existingKeys.has(key)) {
      // Update existing line
      const idx = lines.findIndex(l => l.startsWith(`${key}:`))
      if (idx !== -1) lines[idx] = `${key}: ${value}`
    } else {
      lines.push(`${key}: ${value}`)
    }
  }

  // NamUs API structure:
  // subjectDescription: { heightFrom, heightTo, weightFrom, weightTo, sex, ethnicities }
  // physicalDescription: { hairColor: { name }, leftEyeColor: { name }, rightEyeColor: { name } }
  // physicalFeatureDescriptions: [{ description, location }] — tattoos, scars, marks
  // clothingAndAccessoriesArticles: [{ article: { name }, description }]
  // circumstances: { circumstancesOfDisappearance } (MP) or { circumstancesOfRecovery } (UP)
  // caseInformation: { conditionOfRemains, possibleCauseOfDeath, possibleMannerOfDeath } (UP)

  const subjDesc = detail.subjectDescription as Record<string, unknown> | undefined
  const physDesc = detail.physicalDescription as Record<string, unknown> | undefined
  const features = (detail.physicalFeatureDescriptions ?? []) as Array<Record<string, unknown>>
  const clothingArticles = (detail.clothingAndAccessoriesArticles ?? []) as Array<Record<string, unknown>>
  const circumstances = detail.circumstances as Record<string, unknown> | undefined

  // Height & Weight (from subjectDescription)
  if (subjDesc) {
    addLine('Height', formatHeight(subjDesc.heightFrom as number, subjDesc.heightTo as number))
    addLine('Weight', formatWeight(subjDesc.weightFrom as number, subjDesc.weightTo as number))
  }

  // Hair & Eyes (from physicalDescription — nested objects with .name)
  if (physDesc) {
    const hairObj = physDesc.hairColor as Record<string, unknown> | undefined
    if (hairObj?.name) addLine('Hair', hairObj.name)

    const eyeObj = physDesc.rightEyeColor as Record<string, unknown> ?? physDesc.leftEyeColor as Record<string, unknown>
    if (eyeObj?.name) addLine('Eyes', eyeObj.name)
  }

  // Distinguishing marks (from physicalFeatureDescriptions array)
  if (features.length > 0) {
    const markDescs = features
      .map(f => {
        const desc = f.description as string | undefined
        const loc = (f.location as Record<string, unknown>)?.name as string | undefined
        return [loc, desc].filter(Boolean).join(': ')
      })
      .filter(Boolean)
    if (markDescs.length > 0) {
      addLine('Distinguishing Marks', markDescs.join('; '))
    }
  }

  // Clothing (from clothingAndAccessoriesArticles array)
  const clothingDescs = clothingArticles
    .filter(a => (a.article as Record<string, unknown>)?.name === 'Clothing')
    .map(a => a.description as string)
    .filter(Boolean)
  if (clothingDescs.length > 0) addLine('Clothing', clothingDescs.join('; '))

  const jewelryDescs = clothingArticles
    .filter(a => (a.article as Record<string, unknown>)?.name === 'Jewelry')
    .map(a => a.description as string)
    .filter(Boolean)
  if (jewelryDescs.length > 0) addLine('Jewelry', jewelryDescs.join('; '))

  if (caseType === 'MP') {
    if (circumstances?.circumstancesOfDisappearance) {
      addLine('Circumstances', circumstances.circumstancesOfDisappearance)
    }
  } else {
    if (circumstances?.circumstancesOfRecovery) {
      addLine('Circumstances', circumstances.circumstancesOfRecovery)
    }

    const caseInfo = detail.caseInformation as Record<string, unknown> | undefined
    if (caseInfo?.conditionOfRemains) {
      const cond = caseInfo.conditionOfRemains as Record<string, unknown> | string
      addLine('State of Remains', typeof cond === 'object' ? (cond.name as string) : cond)
    }
    if (caseInfo?.possibleCauseOfDeath) addLine('Cause of Death', caseInfo.possibleCauseOfDeath)
    if (caseInfo?.possibleMannerOfDeath) addLine('Manner of Death', caseInfo.possibleMannerOfDeath)
  }

  return lines.join('\n')
}

function formatHeight(from: number | null | undefined, to: number | null | undefined): string | null {
  if (!from) return null
  const ft = Math.floor(from / 12)
  const inches = from % 12
  if (to && to !== from) {
    const ft2 = Math.floor(to / 12)
    const in2 = to % 12
    return `${ft}'${inches}" - ${ft2}'${in2}"`
  }
  return `${ft}'${inches}"`
}

function formatWeight(from: number | null | undefined, to: number | null | undefined): string | null {
  if (!from) return null
  if (to && to !== from) return `${from} - ${to} lbs`
  return `${from} lbs`
}

async function main() {
  console.log('=== NamUs Case Detail Enrichment ===')
  console.log(`Limit: ${LIMIT}, Type: ${TYPE_FILTER ?? 'all'}, Top matches: ${TOP_MATCHES}\n`)

  // Get submissions that need enrichment
  // Priority: submissions involved in high-scoring matches
  let submissionIds: string[] = []

  if (TOP_MATCHES) {
    console.log('Prioritizing submissions with existing strong matches...')
    const { data: topMatches } = await supabase
      .from('doe_match_candidates')
      .select('missing_submission_id, unidentified_submission_id')
      .gte('composite_score', 40)
      .order('composite_score', { ascending: false })
      .limit(LIMIT)

    const ids = new Set<string>()
    for (const m of topMatches ?? []) {
      ids.add(m.missing_submission_id)
      ids.add(m.unidentified_submission_id)
    }
    submissionIds = [...ids].slice(0, LIMIT)
    console.log(`Found ${submissionIds.length} submissions to enrich from top matches`)
  }

  // Determine which NamUs cases to enrich
  const namusCases = []
  if (!TYPE_FILTER || TYPE_FILTER === 'missing') {
    namusCases.push({ caseId: '51a14fde-81b8-4d0e-9f14-a731602f77d0', type: 'MP' as const })
  }
  if (!TYPE_FILTER || TYPE_FILTER === 'unidentified') {
    namusCases.push({ caseId: '6b82cf6e-bb31-4335-a3b9-e29d59af5500', type: 'UP' as const })
  }

  let totalEnriched = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const { caseId, type } of namusCases) {
    console.log(`\n--- ${type === 'MP' ? 'MISSING PERSONS' : 'UNIDENTIFIED REMAINS'} ---`)

    // Loop: fetch batches of 1000 un-enriched records until done or limit reached
    let batchNum = 0
    let caseEnriched = 0

    while (caseEnriched < LIMIT) {
      batchNum++
      const batchLimit = Math.min(1000, LIMIT - caseEnriched)

      let query = supabase
        .from('submissions')
        .select('id, raw_text, notes')
        .eq('case_id', caseId)
        .not('raw_text', 'ilike', '%Height:%')
        .not('raw_text', 'ilike', '%Distinguishing Marks:%')
        .order('created_at', { ascending: true })
        .limit(batchLimit)

      if (submissionIds.length > 0) {
        query = supabase
          .from('submissions')
          .select('id, raw_text, notes')
          .eq('case_id', caseId)
          .in('id', submissionIds)
          .not('raw_text', 'ilike', '%Height:%')
          .not('raw_text', 'ilike', '%Distinguishing Marks:%')
          .limit(batchLimit)
      }

      const { data: subs, error } = await query
      if (error || !subs) {
        console.error('  Fetch error:', error?.message)
        break
      }

      if (subs.length === 0) {
        console.log(`  No more un-enriched submissions. Done.`)
        break
      }

      console.log(`  Batch ${batchNum}: ${subs.length} submissions to process`)

    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i]
      const namus = extractNamusNumber(sub.notes, sub.raw_text)

      if (!namus) {
        totalSkipped++
        continue
      }

      // Skip if already enriched (has Height or Distinguishing Marks line)
      if (sub.raw_text.includes('Height:') || sub.raw_text.includes('Distinguishing Marks:')) {
        totalSkipped++
        continue
      }

      // Fetch case detail from NamUs
      const endpoint = type === 'MP'
        ? `${NAMUS_BASE}/api/CaseSets/NamUs/MissingPersons/Cases/${namus.number}`
        : `${NAMUS_BASE}/api/CaseSets/NamUs/UnidentifiedPersons/Cases/${namus.number}`

      const detail = await fetchWithRetry(endpoint)

      if (!detail) {
        totalErrors++
        if ((i + 1) % 50 === 0) console.log(`  [${i + 1}/${subs.length}] ${totalEnriched} enriched, ${totalSkipped} skipped, ${totalErrors} errors`)
        await sleep(DELAY_MS)
        continue
      }

      // Build enriched text
      const enrichedText = buildEnrichedText(sub.raw_text, detail, type)

      if (enrichedText !== sub.raw_text) {
        await supabase
          .from('submissions')
          .update({ raw_text: enrichedText })
          .eq('id', sub.id)

        totalEnriched++
      } else {
        totalSkipped++
      }

      // Update import_record with case status, classification, and circumstances
      const namusId = `${type}${namus.number}`
      const importUpdate: Record<string, unknown> = {}

      // Case resolved status
      if (detail.caseIsResolved === true) {
        importUpdate.case_status = 'resolved_other'
      }

      // Classification from circumstances text or Doe Network field
      const circText = type === 'MP'
        ? (detail.circumstances as Record<string, unknown>)?.circumstancesOfDisappearance as string | undefined
        : (detail.circumstances as Record<string, unknown>)?.circumstancesOfRecovery as string | undefined

      // Extract classification from Doe Network records
      const classMatch = sub.raw_text.match(/Case Classification:\s*(.+)/m)
      if (classMatch) {
        importUpdate.classification = classMatch[1].trim()
      }

      // Circumstances summary (first 200 chars)
      if (circText) {
        importUpdate.circumstances_summary = circText.length > 200
          ? circText.slice(0, 197) + '...'
          : circText
      }

      // Key flags from circumstances
      const flags: string[] = []
      const circLower = (circText ?? '').toLowerCase()
      if (circLower.includes('international') || circLower.includes('mexico') || circLower.includes('canada') || circLower.includes('abroad') || circLower.includes('overseas') || circLower.includes('country')) flags.push('international')
      if (circLower.includes('abduct') && (circLower.includes('family') || circLower.includes('father') || circLower.includes('mother') || circLower.includes('parent') || circLower.includes('custod'))) flags.push('family_abduction')
      if (circLower.includes('foul play') || circLower.includes('homicide') || circLower.includes('murder') || circLower.includes('killed')) flags.push('foul_play_suspected')
      if (circLower.includes('sex offend') || circLower.includes('predator') || circLower.includes('registered offend')) flags.push('sex_offender_involvement')

      // Check age for child flag
      const ageMatch = sub.raw_text.match(/Age:\s*(\d+)/m)
      if (ageMatch && parseInt(ageMatch[1]) < 13) flags.push('child')

      // DNA/dental from enriched text
      if (enrichedText.includes('DNA')) flags.push('dna_available')
      if (enrichedText.includes('Dental') || enrichedText.includes('Dentals')) flags.push('dental_available')

      if (flags.length > 0) importUpdate.key_flags = flags
      if (detail.caseIsResolved !== undefined) importUpdate.case_status = detail.caseIsResolved ? 'resolved_other' : 'open'

      if (Object.keys(importUpdate).length > 0) {
        await supabase
          .from('import_records')
          .update(importUpdate)
          .eq('external_id', namusId)
      }

      if ((i + 1) % 50 === 0) {
        console.log(`  [${i + 1}/${subs.length}] ${totalEnriched} enriched, ${totalSkipped} skipped, ${totalErrors} errors`)
      }

      await sleep(DELAY_MS)
    }

      caseEnriched += subs.length
      console.log(`  Batch ${batchNum} done. Total enriched so far: ${totalEnriched}`)
    } // end while loop
  } // end for namusCases

  console.log('\n=== Summary ===')
  console.log(`Enriched: ${totalEnriched}`)
  console.log(`Skipped: ${totalSkipped}`)
  console.log(`Errors: ${totalErrors}`)
}

main().catch(console.error)
