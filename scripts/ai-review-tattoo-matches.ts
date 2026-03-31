/**
 * AI Review Tattoo Matches
 *
 * Reads all tattoo matches from intelligence_queue, fetches both submission
 * texts, sends to Haiku for assessment. Dismisses weak matches (level 1-2),
 * keeps strong ones (level 3+), marks level 4-5 as high priority.
 *
 * Usage: npx tsx scripts/ai-review-tattoo-matches.ts [--limit 100]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

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
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 500

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const SYSTEM_PROMPT = `You are a forensic analyst reviewing a potential match between a missing person and unidentified remains based on their distinguishing marks — tattoos, scars, piercings, birthmarks.

You will receive the FULL case records for both sides. Focus specifically on the distinguishing marks but also consider:
- Do the demographics (sex, age, race) align?
- Is the timeline plausible (person missing before remains found)?
- Does the geographic distance make sense?
- Could differences in mark descriptions be explained by decomposition, fading, imprecise reporting, or different observers describing the same thing?

Rate the tattoo/mark match on a scale of 1-5:

1 — DISMISS: The marks are generic (e.g., both have "a tattoo" or "a scar") with no specific design overlap. OR there are clear contradictions in the marks (one has a specific tattoo the other definitely doesn't).

2 — WEAK: The shared keyword is common (cross, heart, star) and there's nothing else specific linking the descriptions. Thousands of people have cross tattoos. Without additional specificity (design details, exact placement, accompanying text/names), this is noise.

3 — POSSIBLE: The mark descriptions are compatible and share some specificity beyond just a common keyword. Worth a note but not actionable on its own.

4 — STRONG: Multiple specific elements match — design details, body placement, style (professional vs homemade), and/or accompanying text. This warrants active investigative attention.

5 — VERY STRONG: Highly specific match — detailed design elements align precisely (e.g., "heart with dagger and name Donna on upper left arm" matched to "heart and dagger with text on left upper arm"). These are rare and should be top priority.

Be CONSERVATIVE. Most matches will be level 1-2. A "cross" matching another "cross" is level 1-2 unless both descriptions include specific additional details. Reserve 4-5 for genuinely distinctive matches.

Respond with JSON only:
{
  "connection_level": 1-5,
  "summary": "2-3 sentence assessment focusing on the mark comparison",
  "supporting": ["specific details that support this being the same person"],
  "conflicting": ["specific details that argue against — demographics, geography, contradicting marks"],
  "recommendation": "dismiss|keep|investigate|priority"
}`

async function main() {
  console.log('=== AI Review Tattoo Matches ===')
  console.log(`Limit: ${LIMIT}\n`)

  // Fetch unreviewed tattoo matches
  const { data: items, error } = await supabase
    .from('intelligence_queue')
    .select('*')
    .eq('queue_type', 'entity_crossmatch')
    .eq('status', 'new')
    .is('ai_reasoning', null)
    .order('priority_score', { ascending: false })
    .limit(LIMIT)

  if (error) { console.error('Fetch error:', error.message); process.exit(1) }
  if (!items?.length) { console.log('No unreviewed tattoo matches.'); return }

  console.log(`Found ${items.length} unreviewed matches\n`)

  let dismissed = 0
  let kept = 0
  let priority = 0
  let errors = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const details = item.details as Record<string, unknown>
    const missingSubId = details.missing_submission_id as string
    const uidSubId = details.unidentified_submission_id as string

    process.stdout.write(`[${i + 1}/${items.length}] ${(item.title as string).slice(0, 60)}... `)

    // Fetch both submission texts
    const [{ data: mSub }, { data: uSub }] = await Promise.all([
      supabase.from('submissions').select('raw_text').eq('id', missingSubId).single(),
      supabase.from('submissions').select('raw_text').eq('id', uidSubId).single(),
    ])

    if (!mSub?.raw_text || !uSub?.raw_text) {
      console.log('SKIP (missing text)')
      errors++
      continue
    }

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `MISSING PERSON:\n${mSub.raw_text.slice(0, 2000)}\n\n---\n\nUNIDENTIFIED REMAINS:\n${uSub.raw_text.slice(0, 2000)}`,
        }],
      })

      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      let assessment: Record<string, unknown> = { connection_level: 2, summary: 'Could not parse', recommendation: 'keep' }

      try {
        const m = text.match(/\{[\s\S]*\}/)
        if (m) {
          const parsed = JSON.parse(m[0])
          const lvl = parseInt(String(parsed.connection_level ?? 2))
          assessment = { ...parsed, connection_level: Math.max(1, Math.min(5, isNaN(lvl) ? 2 : lvl)) }
        }
      } catch { /* keep default */ }

      const level = assessment.connection_level as number
      const recommendation = assessment.recommendation as string
      const summary = assessment.summary as string

      // Update the queue item
      const update: Record<string, unknown> = {
        ai_reasoning: summary,
      }

      if (level <= 2 || recommendation === 'dismiss') {
        update.status = 'dismissed'
        update.reviewed_at = new Date().toISOString()
        dismissed++
        console.log(`DISMISSED (level ${level})`)
      } else if (level >= 4 || recommendation === 'priority' || recommendation === 'investigate') {
        update.priority_grade = 'high'
        update.priority_score = Math.max(item.priority_score as number, 80 + (level * 4))
        kept++
        priority++
        console.log(`PRIORITY (level ${level}) — ${(summary as string).slice(0, 80)}`)
      } else {
        kept++
        console.log(`KEPT (level ${level})`)
      }

      await supabase
        .from('intelligence_queue')
        .update(update)
        .eq('id', item.id)

    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : err}`)
      errors++
    }

    await sleep(500) // rate limit
  }

  console.log('\n=== Summary ===')
  console.log(`Reviewed: ${items.length}`)
  console.log(`Dismissed (level 1-2): ${dismissed}`)
  console.log(`Kept (level 3): ${kept - priority}`)
  console.log(`Priority (level 4-5): ${priority}`)
  console.log(`Errors: ${errors}`)
  console.log(`\nEstimated cost: ~$${(items.length * 0.004).toFixed(2)}`)
}

main().catch(console.error)
