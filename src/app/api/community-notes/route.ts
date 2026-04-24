import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { EXTRACTION_MODEL } from '@/lib/ai-models'

export const maxDuration = 30

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Only extract when the note is substantial enough to carry real signal. Short
// reactions ("watching this") would just generate noise.
const MIN_EXTRACT_LENGTH = 60

interface NoteBody {
  import_record_id: string
  content: string
  note_type?: 'observation' | 'question' | 'lead' | 'research_offer'
  is_public?: boolean
}

const VALID_NOTE_TYPES = new Set(['observation', 'question', 'lead', 'research_offer'])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: NoteBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { import_record_id, content } = body
  const note_type = body.note_type ?? 'observation'
  const is_public = body.is_public ?? true

  if (!import_record_id || !content?.trim()) {
    return NextResponse.json({ error: 'import_record_id and content required' }, { status: 400 })
  }
  if (!VALID_NOTE_TYPES.has(note_type)) {
    return NextResponse.json({ error: 'invalid note_type' }, { status: 400 })
  }
  if (content.length > 10_000) {
    return NextResponse.json({ error: 'content too long (max 10,000 chars)' }, { status: 400 })
  }

  // Insert the note immediately so the contribution is preserved even if the
  // extractor times out or fails.
  const { data: inserted, error: insertErr } = await supabase
    .from('community_notes')
    .insert({
      user_id: user.id,
      import_record_id,
      note_type,
      content,
      is_public,
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return NextResponse.json({ error: insertErr?.message ?? 'insert failed' }, { status: 500 })
  }

  // Record the note as user activity so presence shows this user as
  // investigating the case. Best-effort.
  await supabase
    .from('user_activity_log')
    .insert({ user_id: user.id, activity_type: 'added_note', ref_id: import_record_id } as never)
    .then(({ error }: { error: { message: string } | null }) => { if (error) console.warn('activity log (note):', error.message) })

  // Skip extraction for short notes — not worth the API call.
  if (content.trim().length < MIN_EXTRACT_LENGTH) {
    return NextResponse.json({ id: inserted.id, extracted: false })
  }

  // Run extraction inline. Guarded so failures never corrupt the saved note.
  let extraction: Record<string, unknown> | null = null
  try {
    extraction = await extractFromText(content)
  } catch (err) {
    console.error('Community note extraction failed:', err instanceof Error ? err.message : err)
  }

  if (extraction) {
    // Use service client so the update is not blocked by user RLS on ai_*
    // fields — the column is metadata about AI processing, not user content.
    const svc = await createServiceClient()
    await svc
      .from('community_notes')
      .update({
        ai_extraction: extraction,
        ai_extracted_at: new Date().toISOString(),
        ai_model: EXTRACTION_MODEL,
      } as never)
      .eq('id', inserted.id)
  }

  return NextResponse.json({ id: inserted.id, extracted: !!extraction })
}

async function extractFromText(text: string): Promise<Record<string, unknown> | null> {
  const prompt = `You are analyzing a community-submitted note about a missing person or unidentified-remains case. Extract any investigative signal.

Return ONLY this JSON, no markdown fences:

{
  "summary": "1 sentence of what the note contains",
  "source_type": "one of: firsthand | secondhand | news | public_record | speculation | unknown",
  "event_date": "YYYY-MM-DD if mentioned, or null",
  "event_location": "free text if mentioned, or null",
  "entities": [
    { "entity_type": "person|location|vehicle|phone|username|organization|url|other", "raw_value": "exact value", "role": "subject|associate|witness|vehicle_seen|location_reference|suspect|unknown", "notes": "why notable or null" }
  ],
  "claims": [
    { "text": "one specific claim, quoted or closely paraphrased", "type": "sighting|identifier|association|behavioral|physical_description|official|speculation", "confidence": "low|medium|high" }
  ],
  "urls": ["any http(s) URLs mentioned"],
  "red_flags": ["any concerns about the note itself: contradiction, vagueness, demographic mismatch — or empty"]
}

Be conservative: if you cannot tell, return an empty array. Do not invent entities or claims.

---

NOTE:

${text}`

  const response = await anthropic.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') return null

  const raw = block.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
