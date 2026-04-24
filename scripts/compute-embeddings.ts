/**
 * Voyage embedding computer
 *
 * For every import_records row that is AI-processed and has a non-empty
 * circumstances summary or distinguishing marks, compute a voyage-3 embedding
 * and persist it. Re-runs skip rows that were already embedded unless
 * --force is passed. The embedding model used is stored in embedding_model so
 * future migrations to a larger / different model can be detected.
 *
 * Two passes:
 *   - circumstances: uses circumstances_summary OR ai_extraction.circumstances.detailed
 *   - marks: uses ai_extraction.demographics.distinguishing_marks, joined by " | "
 *
 * Requires VOYAGE_API_KEY. Fails fast with a helpful message if missing.
 *
 * Usage:
 *   npx tsx scripts/compute-embeddings.ts [--limit 500] [--which circumstances|marks|both] [--force]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY
const VOYAGE_MODEL = 'voyage-3'
const VOYAGE_DIM = 1024
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings'
// Voyage allows up to 128 docs per request; a smaller batch keeps token caps
// predictable when some circumstances are long.
const BATCH = 64
const DELAY_MS = 250

if (!VOYAGE_API_KEY) {
  console.error('Missing VOYAGE_API_KEY in environment. Add it to .env.local:')
  console.error('  VOYAGE_API_KEY=your_voyage_api_key')
  console.error('Sign up at https://www.voyageai.com/ — free tier covers 200M tokens.')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 10000
const whichIdx = args.indexOf('--which')
const WHICH: 'circumstances' | 'marks' | 'both' = whichIdx !== -1 ? (args[whichIdx + 1] as 'circumstances' | 'marks' | 'both') : 'both'
const FORCE = args.includes('--force')

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: inputs,
      model: VOYAGE_MODEL,
      input_type: 'document',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Voyage API ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json() as { data: Array<{ embedding: number[] }> }
  return data.data.map(d => d.embedding)
}

interface Row {
  id: string
  circumstances_summary: string | null
  ai_extraction: Record<string, unknown> | null
  circumstances_embedded_at: string | null
  marks_embedded_at: string | null
}

function textFor(row: Row, kind: 'circumstances' | 'marks'): string | null {
  if (kind === 'circumstances') {
    if (row.circumstances_summary && row.circumstances_summary.trim().length > 20) {
      return row.circumstances_summary.trim()
    }
    const ext = row.ai_extraction as Record<string, unknown> | null
    const circ = ext?.circumstances as Record<string, unknown> | undefined
    const detailed = circ?.detailed as string | undefined
    if (detailed && detailed.trim().length > 20) return detailed.trim()
    return null
  }

  // marks
  const ext = row.ai_extraction as Record<string, unknown> | null
  const demo = ext?.demographics as Record<string, unknown> | undefined
  const marks = (demo?.distinguishing_marks ?? []) as string[]
  const cleaned = marks.map(m => String(m).trim()).filter(m => m.length >= 3)
  if (!cleaned.length) return null
  return cleaned.join(' | ')
}

async function fetchCandidates(kind: 'circumstances' | 'marks'): Promise<Row[]> {
  const PAGE = 1000
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    if (rows.length >= LIMIT) break
    const remaining = LIMIT - rows.length
    const take = Math.min(PAGE, remaining)

    let q = supabase
      .from('import_records')
      .select('id, circumstances_summary, ai_extraction, circumstances_embedded_at, marks_embedded_at')
      .eq('ai_processed', true)
      .range(from, from + take - 1)

    if (!FORCE) {
      if (kind === 'circumstances') q = q.is('circumstances_embedded_at', null)
      else q = q.is('marks_embedded_at', null)
    }

    const { data, error } = await q
    if (error) {
      console.error('Fetch failed:', error.message)
      process.exit(1)
    }
    if (!data?.length) break
    rows.push(...(data as Row[]))
    if (data.length < take) break
  }
  return rows
}

async function runPass(kind: 'circumstances' | 'marks') {
  console.log(`\n--- Pass: ${kind} ---`)

  const rows = await fetchCandidates(kind)
  const withText: Array<{ row: Row; text: string }> = []
  for (const row of rows) {
    const text = textFor(row, kind)
    if (text) withText.push({ row, text })
  }
  console.log(`Candidates with ${kind} text: ${withText.length} / ${rows.length}`)

  let embedded = 0
  let failed = 0

  for (let i = 0; i < withText.length; i += BATCH) {
    const slice = withText.slice(i, i + BATCH)
    try {
      const vectors = await embedBatch(slice.map(s => s.text))
      if (vectors.length !== slice.length) {
        console.error(`  Batch ${i}: vector count mismatch (${vectors.length} vs ${slice.length})`)
        failed += slice.length
        continue
      }
      for (let j = 0; j < slice.length; j++) {
        const vec = vectors[j]
        if (vec.length !== VOYAGE_DIM) {
          console.error(`  Row ${slice[j].row.id}: unexpected dim ${vec.length}`)
          failed++
          continue
        }
        const update: Record<string, unknown> = { embedding_model: VOYAGE_MODEL }
        if (kind === 'circumstances') {
          update.circumstances_embedding = vec
          update.circumstances_embedded_at = new Date().toISOString()
        } else {
          update.marks_embedding = vec
          update.marks_embedded_at = new Date().toISOString()
        }
        const { error } = await supabase
          .from('import_records')
          .update(update as never)
          .eq('id', slice[j].row.id)
        if (error) {
          console.error(`  Row ${slice[j].row.id} update failed: ${error.message}`)
          failed++
        } else {
          embedded++
        }
      }
      if ((i + BATCH) % (BATCH * 10) === 0) {
        console.log(`  ...${embedded} embedded so far`)
      }
      await sleep(DELAY_MS)
    } catch (err) {
      console.error(`  Batch ${i} failed: ${err instanceof Error ? err.message : err}`)
      failed += slice.length
    }
  }

  console.log(`${kind}: ${embedded} embedded, ${failed} failed`)
}

async function main() {
  console.log(`=== Voyage Embedding Computer (${VOYAGE_MODEL}) ===`)
  console.log(`Limit: ${LIMIT}, Which: ${WHICH}, Force: ${FORCE}`)

  if (WHICH === 'circumstances' || WHICH === 'both') await runPass('circumstances')
  if (WHICH === 'marks' || WHICH === 'both') await runPass('marks')

  console.log('\n=== Done ===')
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
