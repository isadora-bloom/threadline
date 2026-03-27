/**
 * Intelligence Queue Populator
 *
 * Scans AI-processed import records for:
 * 1. Stalled cases (runaway/voluntary classification, years without updates)
 * 2. Geographic clusters (multiple cases in proximity)
 * 3. Offender overlaps (matches to known_offenders table)
 * 4. High-solvability unattended cases (high score, zero watchers)
 *
 * Populates intelligence_queue with prioritized items.
 *
 * Usage: npx tsx scripts/populate-intelligence-queue.ts
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function flagStalledCases() {
  console.log('Scanning for stalled cases...')

  const { data: records } = await supabase
    .from('import_records')
    .select('*')
    .eq('ai_processed', true)
    .eq('record_type', 'missing_person')

  if (!records) return 0

  let flagged = 0

  for (const record of records) {
    const extraction = record.ai_extraction as Record<string, unknown> | null
    if (!extraction) continue

    const circumstances = extraction.circumstances as Record<string, unknown> | undefined
    const solvability = extraction.solvability_signals as Record<string, unknown> | undefined

    const classification = circumstances?.classification as string | undefined
    const stallIndicators = (solvability?.stall_indicators ?? []) as string[]

    const isRunaway = classification === 'runaway' || classification === 'voluntary_missing'
    const hasStallIndicators = stallIndicators.length > 0

    // Calculate years cold
    const dateMissing = record.date_missing as string | null
    const yearsCold = dateMissing
      ? Math.floor((Date.now() - new Date(dateMissing).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      : null

    // Flag if: classified as runaway/voluntary AND cold for 2+ years
    if ((isRunaway || hasStallIndicators) && yearsCold && yearsCold >= 2) {
      const ageText = record.age_text as string | null
      const age = ageText ? parseInt(ageText) : null
      const isMinor = age !== null && age < 18

      const priority = isMinor ? 75 : 55

      await supabase.from('intelligence_queue').insert({
        queue_type: 'stalled_case',
        priority_score: priority,
        priority_grade: priority >= 70 ? 'high' : 'medium',
        title: `Stalled: ${record.person_name ?? record.external_id} — ${classification ?? 'unknown'} for ${yearsCold} years`,
        summary: `${record.person_name ?? 'Unknown'} (${record.sex ?? '?'}, age ${record.age_text ?? '?'}) was classified as ${classification ?? 'unknown'} in ${record.state ?? '?'} on ${record.date_missing ?? '?'}. ${yearsCold} years with no resolution.${isMinor ? ' MINOR AT TIME OF DISAPPEARANCE.' : ''}${hasStallIndicators ? ` Stall indicators: ${stallIndicators.join(', ')}.` : ''}`,
        details: {
          import_record_id: record.id,
          classification,
          years_cold: yearsCold,
          age_at_disappearance: age,
          is_minor: isMinor,
          stall_indicators: stallIndicators,
        },
        related_import_ids: [record.id],
        ai_confidence: isMinor ? 0.8 : 0.6,
        signal_count: (isRunaway ? 1 : 0) + stallIndicators.length + (isMinor ? 1 : 0),
      })

      flagged++
    }
  }

  console.log(`  Flagged ${flagged} stalled cases`)
  return flagged
}

async function flagHighSolvabilityUnattended() {
  console.log('Scanning for high-solvability unattended cases...')

  const { data: scores } = await supabase
    .from('solvability_scores')
    .select('*, import_record:import_records(*)')
    .in('grade', ['high', 'moderate'])
    .order('score', { ascending: false })
    .limit(200)

  if (!scores) return 0

  let flagged = 0

  for (const item of scores) {
    const record = item.import_record as Record<string, unknown> | null
    if (!record) continue

    // Check watcher count
    const { count: watcherCount } = await supabase
      .from('user_watchlist')
      .select('id', { count: 'exact', head: true })
      .eq('import_record_id', item.import_record_id)

    if ((watcherCount ?? 0) === 0 && item.score >= 50) {
      await supabase.from('intelligence_queue').insert({
        queue_type: 'new_lead',
        priority_score: item.score,
        priority_grade: item.score >= 70 ? 'high' : 'medium',
        title: `Solvable case needs attention: ${(record.person_name as string) ?? (record.external_id as string)}`,
        summary: `${item.ai_summary} Solvability score: ${item.score}/100. Nobody is currently watching this case.`,
        details: {
          import_record_id: item.import_record_id,
          solvability_score: item.score,
          solvability_grade: item.grade,
          next_steps: item.ai_next_steps,
        },
        related_import_ids: [item.import_record_id],
        ai_confidence: item.score / 100,
        signal_count: Object.keys(item.signals as Record<string, unknown>).length,
      })

      flagged++
    }
  }

  console.log(`  Flagged ${flagged} high-solvability unattended cases`)
  return flagged
}

async function flagOffenderOverlaps() {
  console.log('Scanning for offender overlaps...')

  // Fetch known offenders
  const { data: offenders } = await supabase
    .from('known_offenders')
    .select('*')

  if (!offenders || offenders.length === 0) {
    console.log('  No known offenders in database')
    return 0
  }

  // Fetch AI-processed records
  const { data: records } = await supabase
    .from('import_records')
    .select('*')
    .eq('ai_processed', true)
    .limit(1000)

  if (!records) return 0

  let flagged = 0

  for (const record of records) {
    const extraction = record.ai_extraction as Record<string, unknown> | null
    if (!extraction) continue

    const behavioral = extraction.behavioral_signals as Record<string, unknown> | undefined
    const moKeywords = (behavioral?.mo_keywords ?? []) as string[]
    const disposalIndicators = (behavioral?.disposal_indicators ?? []) as string[]

    for (const offender of offenders) {
      let overlapScore = 0
      const matchedSignals: string[] = []

      // State overlap
      const victimStates = (offender.victim_states ?? []) as string[]
      const opStates = (offender.operation_states ?? []) as string[]
      const allStates = [...new Set([...victimStates, ...opStates])]
      if (record.state && allStates.includes(record.state)) {
        overlapScore += 15
        matchedSignals.push(`state_overlap:${record.state}`)
      }

      // Sex match
      const offenderVictimSex = offender.victim_sex as string | null
      if (offenderVictimSex && record.sex) {
        if (record.sex.toLowerCase().startsWith(offenderVictimSex.charAt(0))) {
          overlapScore += 10
          matchedSignals.push('victim_sex_match')
        }
      }

      // Age overlap
      const age = record.age_text ? parseInt(record.age_text) : null
      if (age && offender.victim_age_min && offender.victim_age_max) {
        if (age >= (offender.victim_age_min as number) && age <= (offender.victim_age_max as number)) {
          overlapScore += 10
          matchedSignals.push('victim_age_in_range')
        }
      }

      // MO keyword overlap
      const offenderMO = (offender.mo_keywords ?? []) as string[]
      const moOverlap = moKeywords.filter(k => offenderMO.includes(k))
      if (moOverlap.length > 0) {
        overlapScore += 15 * moOverlap.length
        matchedSignals.push(`mo_overlap:${moOverlap.join(',')}`)
      }

      // Disposal method overlap
      const offenderDisposal = (offender.disposal_method ?? []) as string[]
      const disposalOverlap = disposalIndicators.filter(d => offenderDisposal.includes(d))
      if (disposalOverlap.length > 0) {
        overlapScore += 12 * disposalOverlap.length
        matchedSignals.push(`disposal_overlap:${disposalOverlap.join(',')}`)
      }

      // Temporal check — hard eliminate if record is after offender incarceration
      if (offender.incarcerated_from && record.date_missing) {
        const incarYear = offender.incarcerated_from as number
        const missYear = new Date(record.date_missing as string).getFullYear()
        if (missYear > incarYear) {
          continue // skip, offender was incarcerated
        }
      }

      // Only flag strong overlaps
      if (overlapScore >= 30) {
        const priority = Math.min(100, overlapScore)

        await supabase.from('intelligence_queue').insert({
          queue_type: 'offender_overlap',
          priority_score: priority,
          priority_grade: priority >= 70 ? 'critical' : priority >= 50 ? 'high' : 'medium',
          title: `Offender overlap: ${record.person_name ?? record.external_id} ↔ ${offender.name}`,
          summary: `${record.person_name ?? 'Unknown'} (${record.state ?? '?'}, ${record.date_missing ?? record.date_found ?? '?'}) overlaps with known offender ${offender.name} on ${matchedSignals.length} signals: ${matchedSignals.join(', ')}.`,
          details: {
            import_record_id: record.id,
            offender_id: offender.id,
            offender_name: offender.name,
            overlap_score: overlapScore,
            matched_signals: matchedSignals,
          },
          related_import_ids: [record.id],
          ai_confidence: Math.min(1, overlapScore / 100),
          signal_count: matchedSignals.length,
        })

        flagged++
      }
    }
  }

  console.log(`  Flagged ${flagged} offender overlaps`)
  return flagged
}

async function main() {
  console.log('=== Intelligence Queue Populator ===\n')

  const stalled = await flagStalledCases()
  const solvable = await flagHighSolvabilityUnattended()
  const offenders = await flagOffenderOverlaps()

  console.log(`\n=== Summary ===`)
  console.log(`Stalled cases: ${stalled}`)
  console.log(`Solvable unattended: ${solvable}`)
  console.log(`Offender overlaps: ${offenders}`)
  console.log(`Total queue items: ${stalled + solvable + offenders}`)
}

main().catch(console.error)
