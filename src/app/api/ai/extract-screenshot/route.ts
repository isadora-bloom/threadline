import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { EXTRACTION_MODEL } from '@/lib/ai-models'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const caseId = formData.get('caseId') as string
  if (!caseId) return NextResponse.json({ error: 'caseId required' }, { status: 400 })

  // Verify access
  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()

  if (!roleData) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const files = formData.getAll('images') as File[]
  if (!files.length) return NextResponse.json({ error: 'No images provided' }, { status: 400 })

  // Build image content blocks (up to 5 images)
  const imageBlocks: Anthropic.ImageBlockParam[] = []
  for (const file of files.slice(0, 5)) {
    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const mediaType = (file.type || 'image/png') as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
    imageBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    })
  }

  const prompt = `You are analyzing screenshots uploaded to a case intelligence platform used by investigators working on missing persons, unidentified remains, homicide, assault, trafficking, and similar public-interest cases.

Extract ALL relevant information from the screenshot(s). Be thorough — investigators are looking for any lead.

Return a JSON object with this exact structure:

{
  "content_type": "one of: social_media_post | news_article | text_message | email | document | forum_post | video_still | map | phone_record | other",
  "platform": "specific platform/app if identifiable (e.g. Facebook, Twitter/X, WhatsApp, Telegram, Reddit) or null",
  "extracted_text": "all visible text, transcribed exactly as it appears",
  "summary": "1-2 sentence plain-English summary of what this screenshot shows",
  "source_type": "one of: named_individual | anonymous | organization | official_record | media | system",
  "observation_mode": "one of: observed_directly | heard_directly | reported_by_another | inferred_from_document | system_generated",
  "firsthand": false,
  "event_date": "ISO date string if a specific date is mentioned (YYYY-MM-DD), or null",
  "event_location": "location mentioned if any, as a human-readable string, or null",
  "entities": [
    {
      "entity_type": "one of: person | location | vehicle | phone | username | organization | document | other",
      "raw_value": "exact value as it appears",
      "confidence": "one of: low | medium | high",
      "entity_role": "one of: subject | vehicle_seen | associate_mentioned | location_reference | identifier_fragment | witness | victim | unknown",
      "notes": "why this entity is notable, or null"
    }
  ],
  "claims": [
    {
      "extracted_text": "the specific claim or piece of information, quoted or closely paraphrased from the source",
      "claim_type": "one of: sighting | identifier | association | statement | interpretation | official | behavioral | physical_description | forensic_countermeasure | scene_staging | disposal_method",
      "confidence": "one of: low | medium | high",
      "notes": "any important caveats about this claim, or null",
      "tags": [
        {
          "tag": "lowercase-hyphenated tag name, e.g. licence-plate, military-marking, clothing-detail, phone-number, vehicle-description",
          "tag_type": "one of: identifier | physical | behavioral | geographic | temporal | generic"
        }
      ]
    }
  ],
  "investigator_notes": "anything else worth flagging to the investigator — metadata, timestamp visibility, account info, red flags, or null"
}

Guidelines:
- Extract every person name, username, phone number, location, vehicle, organization you can see
- For social media: note the username/handle, post date, engagement metrics if visible
- For news articles: note the publication, author, date
- For messages: note both sender and recipient if visible
- Claims should be granular — one specific fact per claim, not a summary
- If you see a date, extract it. If you see a location, extract it.
- source_type guide: named_individual = person's post/message, anonymous = unidentified account, organization = org/agency post, official_record = document/report, media = news/journalism, system = automated/generated
- observation_mode guide: observed_directly = first-person account, heard_directly = direct quote, reported_by_another = hearsay, inferred_from_document = document evidence, system_generated = automated record

Return only the JSON object, no markdown fences.`

  try {
    const response = await anthropic.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: prompt },
          ],
        },
      ],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
    }

    let extracted: unknown
    try {
      // Strip markdown fences if present
      const raw = textBlock.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
      extracted = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw: textBlock.text }, { status: 500 })
    }

    return NextResponse.json({ extraction: extracted })
  } catch (err) {
    console.error('AI extraction error:', err)
    return NextResponse.json({ error: 'AI extraction failed' }, { status: 500 })
  }
}
