/**
 * Reporter-pattern flagger
 *
 * Surfaces records where the first reporter and the time-to-report read as
 * investigatively suspicious. Three patterns:
 *
 *   1. Long lag with no explanation. Adult cases where the report was filed
 *      48h+ after last contact and the AI didn't note an explanation. Minor
 *      cases threshold drops to 24h.
 *
 *   2. Non-family reporter when relationships are notable. partner /
 *      ex_partner / employer reporting a missing person whose family was
 *      nearby is the kind of fact a detective would re-interview.
 *
 *   3. Reporter is also the last-known-contact. Captured by AI as a concern
 *      string; we look for that phrasing.
 *
 * Writes queue_type='contradiction' rows with details.kind='reporter_pattern'.
 * Idempotent per record.
 *
 * Usage: npx tsx scripts/reporter-flag.ts [--dry-run]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

const SUSPICIOUS_RELATIONSHIPS = new Set([
  'partner',
  'ex_partner',
  'employer',
  'landlord',
  'neighbor',
])

const LAG_NOTABLE_ADULT_HOURS = 48
const LAG_NOTABLE_MINOR_HOURS = 24

interface Row {
  id: string
  person_name: string | null
  external_id: string
  state: string | null
  age_text: string | null
  date_missing: string | null
  ai_extraction: Record<string, unknown> | null
}

async function fetchAll(): Promise<Row[]> {
  const PAGE = 1000
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('import_records')
      .select('id, person_name, external_id, state, age_text, date_missing, ai_extraction')
      .eq('ai_processed', true)
      .eq('record_type', 'missing_person')
      .range(from, from + PAGE - 1)
    if (error) { console.error('Fetch failed:', error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...(data as Row[]))
    if (data.length < PAGE) break
  }
  return rows
}

async function alreadyFlaggedSet(): Promise<Set<string>> {
  const PAGE = 1000
  const seen = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from('intelligence_queue')
      .select('related_import_ids, details')
      .eq('queue_type', 'contradiction')
      .range(from, from + PAGE - 1)
    if (!data?.length) break
    for (const row of data as Array<{ related_import_ids: string[] | null; details: Record<string, unknown> | null }>) {
      if ((row.details ?? {} as Record<string, unknown>).kind !== 'reporter_pattern') continue
      for (const id of row.related_import_ids ?? []) seen.add(id)
    }
    if (data.length < PAGE) break
  }
  return seen
}

interface Finding {
  signals: string[]
  priority: number
  reporterRelationship: string | null
  hoursToReport: number | null
  concerns: string | null
}

function evaluateRecord(row: Row): Finding | null {
  const ext = row.ai_extraction
  if (!ext) return null
  const reporter = ext.reporter as Record<string, unknown> | undefined
  if (!reporter) return null

  const ageNum = row.age_text ? parseInt(row.age_text) : NaN
  const isMinor = !Number.isNaN(ageNum) && ageNum < 18

  const relationship = (reporter.relationship as string | null) ?? null
  const hoursToReport = typeof reporter.hours_to_report === 'number' ? (reporter.hours_to_report as number) : null
  const concernsRaw = reporter.concerns as string | null | undefined
  const concerns = concernsRaw && concernsRaw !== 'null' ? concernsRaw : null

  const signals: string[] = []
  let priority = 0

  if (relationship && SUSPICIOUS_RELATIONSHIPS.has(relationship)) {
    signals.push(`reporter relationship: ${relationship}`)
    priority += 25
  }

  if (hoursToReport !== null) {
    const threshold = isMinor ? LAG_NOTABLE_MINOR_HOURS : LAG_NOTABLE_ADULT_HOURS
    if (hoursToReport >= threshold) {
      signals.push(`${hoursToReport}h from last contact to report${isMinor ? ' (minor)' : ''}`)
      priority += isMinor ? 30 : 20
    }
  }

  if (concerns) {
    const lower = concerns.toLowerCase()
    // The AI was instructed to flag "reporter is also last-known-contact" in
    // the concerns string. Treat that as a strong addition.
    if (lower.includes('last') && (lower.includes('contact') || lower.includes('seen') || lower.includes('saw'))) {
      signals.push('reporter is also last-known-contact')
      priority += 20
    } else {
      signals.push(`AI concern: ${concerns}`)
      priority += 10
    }
  }

  if (signals.length === 0) return null
  return {
    signals,
    priority: Math.min(95, 40 + priority),
    reporterRelationship: relationship,
    hoursToReport,
    concerns,
  }
}

async function main() {
  console.log('=== Reporter-pattern flagger ===')

  const rows = await fetchAll()
  console.log(`AI-processed missing-person records: ${rows.length}`)

  const seen = DRY_RUN ? new Set<string>() : await alreadyFlaggedSet()

  let candidates = 0
  let flagged = 0
  let skipped = 0

  for (const row of rows) {
    const finding = evaluateRecord(row)
    if (!finding) continue
    candidates++

    if (seen.has(row.id)) { skipped++; continue }

    const who = row.person_name ?? row.external_id
    const where = row.state ? ` (${row.state})` : ''

    if (DRY_RUN) {
      console.log(`  [dry] ${who}${where} P${finding.priority}: ${finding.signals.join(' · ')}`)
      flagged++
      continue
    }

    const grade = finding.priority >= 75 ? 'high' : 'medium'
    const { error } = await supabase.from('intelligence_queue').insert({
      queue_type: 'contradiction',
      priority_score: finding.priority,
      priority_grade: grade,
      title: `Reporter pattern: ${who}${where} — ${finding.signals.length === 1 ? finding.signals[0] : `${finding.signals.length} signals`}`,
      summary: `${who}${where}, ${row.date_missing ?? '?'}. ${finding.signals.join('. ')}.\n\nThe first reporter is investigatively load-bearing. When the lag is long, the relationship is non-family, or the reporter was also the last person to see the subject, those are facts a re-interview should test before any other lead is run down.`,
      details: {
        kind: 'reporter_pattern',
        signals: finding.signals,
        reporter_relationship: finding.reporterRelationship,
        hours_to_report: finding.hoursToReport,
        concerns: finding.concerns,
        import_record_id: row.id,
      },
      related_import_ids: [row.id],
      signal_count: finding.signals.length,
      ai_confidence: 0.6,
    })

    if (error) {
      console.error(`  Insert failed for ${row.id}: ${error.message}`)
      continue
    }
    flagged++
  }

  console.log('\n=== Done ===')
  console.log(`Candidates: ${candidates}`)
  console.log(`Flagged: ${flagged}`)
  console.log(`Skipped (already flagged): ${skipped}`)
  if (candidates === 0) {
    console.log('\nNote: this flagger needs the new reporter field, populated only by ai-batch-process runs after the prompt update. Re-run npm run ai:batch on records you want re-extracted.')
  }
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
