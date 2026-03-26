/**
 * Targeted AI Extraction
 *
 * ONLY runs on records flagged by rule-based-match.ts (ai_extraction._needs_ai = true).
 * ONLY extracts what rule-based analysis can't:
 *
 *   1. Tattoos, scars, distinguishing marks (from narrative text)
 *   2. MO keywords (method of approach, control, disposal)
 *   3. Disposal indicators
 *   4. Disappearance indicators
 *   5. Geographic corridor detection
 *
 * Does NOT extract: demographics, dates, locations (scrapers already have those).
 * Does NOT score solvability (that happens in a separate step, only for flagged records).
 *
 * Uses Haiku for cost efficiency. ~$0.009/record.
 *
 * Usage:
 *   npx tsx scripts/ai-targeted-extract.ts [--limit 100] [--model haiku]
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 100
const modelIdx = args.indexOf('--model')
const MODEL_FLAG = modelIdx !== -1 ? args[modelIdx + 1] : 'haiku'

const MODEL = MODEL_FLAG === 'sonnet'
  ? 'claude-sonnet-4-6-20250514'
  : 'claude-haiku-4-5-20251001'

const DELAY_MS = MODEL_FLAG === 'haiku' ? 500 : 1500

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  console.log(`=== Targeted AI Extraction ===`)
  console.log(`Model: ${MODEL}`)
  console.log(`Limit: ${LIMIT}`)
  console.log(`Est. cost: ~$${(LIMIT * (MODEL_FLAG === 'haiku' ? 0.009 : 0.027)).toFixed(2)}\n`)

  // Fetch records that rule-based-match flagged for AI
  const { data: records, error } = await supabase
    .from('import_records')
    .select('*')
    .eq('ai_processed', false)
    .not('ai_extraction', 'is', null)
    .order('created_at', { ascending: true })
    .limit(LIMIT)

  if (error) { console.error('Fetch error:', error.message); process.exit(1) }

  // Filter to only records with _needs_ai flag
  const needsAi = (records ?? []).filter(r => {
    const ext = r.ai_extraction as Record<string, unknown> | null
    return ext?._needs_ai === true
  })

  console.log(`Records needing AI: ${needsAi.length}`)
  if (needsAi.length === 0) { console.log('Nothing to process.'); return }

  let processed = 0
  let failed = 0

  for (const record of needsAi) {
    const aiReasons = ((record.ai_extraction as Record<string, unknown>)?._ai_reasons ?? []) as string[]
    console.log(`  [${processed + 1}/${needsAi.length}] ${record.external_id} (${record.person_name ?? 'unidentified'}) — reasons: ${aiReasons.join(', ')}`)

    const rawText = buildNarrativeText(record)
    if (!rawText || rawText.length < 50) {
      console.log(`    Skipping — insufficient narrative text`)
      await markProcessed(record.id, { _skipped: true, _reason: 'insufficient_text' })
      continue
    }

    try {
      const extraction = await extractSignals(rawText, aiReasons, record)

      if (extraction) {
        // Merge with existing rule-based data
        const existing = (record.ai_extraction as Record<string, unknown>) ?? {}
        const merged = {
          ...existing,
          _needs_ai: false,
          _ai_processed: true,
          _model: MODEL,
          _processed_at: new Date().toISOString(),
          ...extraction,
        }

        await supabase.from('import_records').update({
          ai_processed: true,
          ai_processed_at: new Date().toISOString(),
          ai_extraction: merged,
        }).eq('id', record.id)

        processed++
      } else {
        await markProcessed(record.id, { _ai_failed: true })
        failed++
      }
    } catch (err) {
      console.error(`    Error: ${err instanceof Error ? err.message : err}`)
      failed++
    }

    await sleep(DELAY_MS)
  }

  console.log(`\n=== Done ===`)
  console.log(`Processed: ${processed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Actual cost: ~$${(processed * (MODEL_FLAG === 'haiku' ? 0.009 : 0.027)).toFixed(2)}`)
}

async function markProcessed(id: string, extraction: Record<string, unknown>) {
  await supabase.from('import_records').update({
    ai_processed: true,
    ai_processed_at: new Date().toISOString(),
    ai_extraction: extraction,
  }).eq('id', id)
}

function buildNarrativeText(record: Record<string, unknown>): string {
  const raw = record.raw_data as Record<string, unknown> | null
  if (!raw) return ''

  // Collect all text-like fields from raw data
  const textParts: string[] = []
  const textFields = [
    'circumstances', 'circumstancesOfDisappearance', 'bodyCondition',
    'description', 'physicalDescription', 'clothing', 'distinguishingCharacteristics',
    'dentalInformation', 'additionalInformation', 'notes', 'narrative',
    'circumstancesOfRecovery', 'possibleCauseOfDeath', 'possibleMannerOfDeath',
    // Doe Network fields
    'details', 'dentalInfo', 'otherInfo', 'additionalInfo',
  ]

  for (const field of textFields) {
    const val = raw[field]
    if (typeof val === 'string' && val.trim().length > 10) {
      textParts.push(`${field}: ${val}`)
    }
  }

  return textParts.join('\n\n')
}

async function extractSignals(
  text: string,
  reasons: string[],
  record: Record<string, unknown>
): Promise<Record<string, unknown> | null> {

  const prompt = `You are extracting specific investigative signals from a ${record.record_type === 'missing_person' ? 'missing person' : 'unidentified remains'} case record. Extract ONLY the following categories — nothing else.

Return a JSON object with ONLY these fields (omit any that have no data):

{
  "distinguishing_marks": [
    {
      "type": "tattoo|scar|piercing|birthmark|dental|prosthetic|other",
      "description": "exact description",
      "location": "body location if mentioned"
    }
  ],

  "mo_keywords": ["from this list ONLY: hitchhiker, sex_worker, truck_stop, runaway, college_campus, home_invasion, dating, foster_care, bar, highway_abduction, rest_area, motel, transient, camping, lured, domestic_violence, drug_related, gang_related, workplace, school, church, park, parking_lot"],

  "disposal_indicators": ["from this list ONLY: roadside, wooded, water, buried, left_in_place, remote, dumpster, abandoned_building, shallow_grave, wrapped, dismembered, burned, weighted, concealed"],

  "disappearance_indicators": ["from this list ONLY: last_seen_hitchhiking, left_home_voluntarily, left_work, last_seen_with_person, last_seen_at_bar, left_after_argument, failed_to_arrive, last_seen_walking, last_seen_driving, left_note, no_indication, vehicle_found_abandoned, belongings_found, phone_went_dead, social_media_stopped"],

  "geographic_signals": {
    "highways_mentioned": ["I-10", "US-101", etc.],
    "landmarks": ["specific places mentioned"],
    "corridor_pattern": "description if the case mentions travel along a route"
  },

  "forensic_indicators": {
    "cause_of_death": "if mentioned",
    "manner_of_death": "if mentioned",
    "body_condition": "intact|partially_decomposed|advanced_decomposition|skeletal|unknown",
    "evidence_of_restraint": false,
    "evidence_of_sexual_assault": false,
    "evidence_of_staging": false,
    "evidence_of_cleanup": false
  }
}

RULES:
- Only extract what is EXPLICITLY stated or very clearly implied. Do not infer.
- For keyword lists, only use values from the provided lists.
- If a category has no relevant data, omit it entirely.
- Return ONLY the JSON object, no markdown fences, no explanation.

---

CASE TEXT:

${text.slice(0, 3000)}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return null

  try {
    const raw = textBlock.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(raw)
  } catch {
    console.log(`    Failed to parse AI response`)
    return null
  }
}

main().catch(console.error)
