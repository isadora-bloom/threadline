/**
 * Tattoo/Mark Matching Engine
 *
 * Dedicated matching system for distinguishing marks (tattoos, scars, piercings, birthmarks).
 * Pre-filters by sex/age/race, then compares mark descriptions and body placement.
 *
 * Two match strengths:
 *   - DESCRIPTION MATCH: same keyword/theme (e.g., both have "cross" or "rose")
 *   - DESCRIPTION + LOCATION: same keyword AND same body region+side (much stronger)
 *
 * Body location normalization:
 *   Side: left, right, center/midline
 *   Region: arm, shoulder, chest, back, torso/abdomen, leg, ankle/foot, neck, face, hand/wrist
 *
 * Usage:
 *   npx tsx scripts/tattoo-match.ts [--limit 5000]
 *
 * Stores results in doe_match_candidates with match_type='tattoo_mark_match'
 * and in intelligence_queue as 'entity_crossmatch' type.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 5000

// ── Body location normalization ──────────────────────────────────────────────

interface NormalizedLocation {
  side: 'left' | 'right' | 'center' | 'unknown'
  region: string
}

const SIDE_PATTERNS: Array<[string, 'left' | 'right' | 'center']> = [
  ['left', 'left'],
  ['right', 'right'],
  ['center', 'center'],
  ['midline', 'center'],
  ['middle', 'center'],
]

const REGION_MAP: Array<[string[], string]> = [
  [['upper arm', 'bicep', 'forearm', 'arm'], 'arm'],
  [['shoulder', 'shoulder blade', 'deltoid'], 'shoulder'],
  [['chest', 'breast', 'pectoral'], 'chest'],
  [['upper back', 'lower back', 'back', 'spine'], 'back'],
  [['abdomen', 'stomach', 'belly', 'torso', 'side', 'rib', 'hip'], 'torso'],
  [['thigh', 'calf', 'shin', 'leg', 'knee'], 'leg'],
  [['ankle', 'foot', 'toe'], 'ankle_foot'],
  [['neck', 'throat', 'nape'], 'neck'],
  [['face', 'cheek', 'forehead', 'chin', 'jaw', 'temple', 'ear', 'eyebrow', 'lip'], 'face'],
  [['hand', 'wrist', 'finger', 'palm', 'knuckle'], 'hand_wrist'],
  [['buttock', 'butt', 'rear', 'gluteal'], 'buttock'],
]

function normalizeLocation(text: string): NormalizedLocation {
  const lower = text.toLowerCase()

  let side: 'left' | 'right' | 'center' | 'unknown' = 'unknown'
  for (const [pattern, s] of SIDE_PATTERNS) {
    if (lower.includes(pattern)) { side = s; break }
  }

  let region = 'unknown'
  for (const [keywords, r] of REGION_MAP) {
    if (keywords.some(k => lower.includes(k))) { region = r; break }
  }

  return { side, region }
}

// ── Tattoo/mark description keywords ─────────────────────────────────────────

const TATTOO_KEYWORDS = [
  // Symbols
  'cross', 'crucifix', 'star', 'moon', 'sun', 'heart', 'diamond', 'arrow', 'infinity',
  'anchor', 'crown', 'shield', 'sword', 'dagger', 'key', 'lock', 'clock', 'compass',
  'peace', 'yin yang', 'pentagram', 'swastika', 'iron cross',
  // Nature
  'rose', 'flower', 'floral', 'butterfly', 'bird', 'eagle', 'dove', 'phoenix', 'dragon',
  'snake', 'scorpion', 'spider', 'wolf', 'lion', 'tiger', 'bear', 'horse', 'dolphin',
  'fish', 'shark', 'tree', 'leaf', 'vine', 'feather', 'paw',
  // Text/names
  'mom', 'mother', 'dad', 'father', 'love', 'hate', 'rip', 'rest in peace',
  'thug life', 'born to die', 'only god can judge',
  // Cultural/religious
  'jesus', 'christ', 'virgin mary', 'praying hands', 'angel', 'devil', 'demon',
  'rosary', 'bible', 'buddhist', 'om', 'mandala', 'tribal',
  // Gang/street
  'teardrop', 'three dots', 'five point', 'crown', 'pitchfork',
  'latin kings', 'sureno', 'norteno', 'ms-13', 'ms13',
  // Military
  'military', 'army', 'navy', 'marine', 'usmc', 'airborne', 'special forces',
  'american flag', 'flag', 'eagle globe anchor', 'dog tags',
  // Misc identifiers
  'skull', 'skeleton', 'flames', 'barbed wire', 'chain', 'handcuff',
  'music note', 'treble clef', 'guitar', 'dice', 'cards', 'poker',
  'pin-up', 'pinup', 'mermaid', 'fairy', 'unicorn', 'clown', 'joker',
  'spider web', 'spiderweb', 'web', 'dream catcher', 'dreamcatcher',
  // Scar types
  'surgical scar', 'c-section', 'appendectomy', 'bypass', 'pacemaker',
  'burn scar', 'keloid', 'self-harm', 'cutting',
]

function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase()
  return TATTOO_KEYWORDS.filter(kw => lower.includes(kw))
}

// ── Mark parsing from submission text ────────────────────────────────────────

interface ParsedMark {
  description: string
  keywords: string[]
  location: NormalizedLocation
  rawLocation: string
  type: 'tattoo' | 'scar' | 'piercing' | 'birthmark' | 'other'
}

function parseMarks(rawText: string): ParsedMark[] {
  const marksLine = rawText.match(/^Distinguishing Marks:\s*(.+)$/mi)?.[1]
  if (!marksLine || marksLine.length < 3) return []

  // Split by semicolons or common separators
  const segments = marksLine.split(/[;]/).map(s => s.trim()).filter(s => s.length > 2)

  const marks: ParsedMark[] = []

  for (const seg of segments) {
    const lower = seg.toLowerCase()

    // Determine type
    let type: ParsedMark['type'] = 'other'
    if (lower.includes('tattoo') || lower.includes('tat ') || lower.includes('tattooed')) type = 'tattoo'
    else if (lower.includes('scar') || lower.includes('surgical') || lower.includes('keloid')) type = 'scar'
    else if (lower.includes('piercing') || lower.includes('pierced') || lower.includes('earring')) type = 'piercing'
    else if (lower.includes('birthmark') || lower.includes('mole') || lower.includes('nevus')) type = 'birthmark'

    const location = normalizeLocation(seg)
    const keywords = extractKeywords(seg)

    marks.push({
      description: seg,
      keywords,
      location,
      rawLocation: seg,
      type,
    })
  }

  return marks
}

// ── Demographic pre-filter ───────────────────────────────────────────────────

function normSex(s: string | null): string | null {
  if (!s) return null
  const l = s.toLowerCase()
  if (l.startsWith('m')) return 'male'
  if (l.startsWith('f')) return 'female'
  return null
}

function parseAgeRange(s: string | null): [number, number] | null {
  if (!s) return null
  const range = s.match(/(\d+)\s*[-–]\s*(\d+)/)
  if (range) return [parseInt(range[1]), parseInt(range[2])]
  const single = s.match(/(\d+)/)
  if (single) { const n = parseInt(single[1]); return [Math.max(0, n - 5), n + 5] }
  return null
}

function demographicsCompatible(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  // Sex must match (or one unknown)
  const aSex = normSex(a.sex as string | null)
  const bSex = normSex(b.sex as string | null)
  if (aSex && bSex && aSex !== bSex) return false

  // Age must overlap (with generous window)
  const aAge = parseAgeRange(a.age as string | null)
  const bAge = parseAgeRange(b.age as string | null)
  if (aAge && bAge) {
    if (aAge[1] < bAge[0] - 10 || bAge[1] < aAge[0] - 10) return false
  }

  return true
}

// ── Main matching ────────────────────────────────────────────────────────────

interface TattooMatch {
  missing_submission_id: string
  unidentified_submission_id: string
  missing_name: string | null
  unidentified_location: string | null
  shared_keywords: string[]
  location_match: boolean
  missing_mark: string
  unidentified_mark: string
  score: number  // 0-100
  strength: 'description_only' | 'description_and_location'
}

async function main() {
  console.log('=== Tattoo/Mark Matching Engine ===')
  console.log(`Limit: ${LIMIT}\n`)

  // Fetch submissions with distinguishing marks
  console.log('Fetching submissions with marks...')

  const missingCaseIds = [
    '51a14fde-81b8-4d0e-9f14-a731602f77d0', // NamUs Missing
    '920fa7c7-16bd-43a6-9700-60cecefcbf59', // Doe Network Missing
    '560b3c82-c258-4b43-a52b-3b5438d5411f', // Charley Project
  ]
  const unidentifiedCaseIds = [
    '6b82cf6e-bb31-4335-a3b9-e29d59af5500', // NamUs Unidentified
    '4838c55f-a4cd-49f8-8011-22536a2ea75e', // Doe Network UID Remains
    'c815abc2-8541-4d15-961a-8b332bbc6a15', // Doe Network UID Persons
  ]

  // Fetch missing persons with marks
  const missingParsed: Array<{ sub_id: string; name: string | null; sex: string | null; age: string | null; marks: ParsedMark[] }> = []
  for (const caseId of missingCaseIds) {
    const { data: subs } = await supabase
      .from('submissions')
      .select('id, raw_text')
      .eq('case_id', caseId)
      .ilike('raw_text', '%Distinguishing Marks:%')
      .limit(LIMIT)

    for (const s of subs ?? []) {
      const marks = parseMarks(s.raw_text)
      if (marks.length === 0 || marks.every(m => m.keywords.length === 0)) continue
      const name = s.raw_text.match(/^Name:\s*(.+)$/m)?.[1] ?? null
      const sex = s.raw_text.match(/^Sex:\s*(.+)$/m)?.[1] ?? null
      const age = s.raw_text.match(/^Age:\s*(\d+)/m)?.[1] ?? null
      missingParsed.push({ sub_id: s.id, name, sex, age, marks })
    }
  }

  // Fetch unidentified with marks
  const unidentifiedParsed: Array<{ sub_id: string; location: string | null; sex: string | null; age: string | null; marks: ParsedMark[] }> = []
  for (const caseId of unidentifiedCaseIds) {
    const { data: subs } = await supabase
      .from('submissions')
      .select('id, raw_text')
      .eq('case_id', caseId)
      .ilike('raw_text', '%Distinguishing Marks:%')
      .limit(LIMIT)

    for (const s of subs ?? []) {
      const marks = parseMarks(s.raw_text)
      if (marks.length === 0 || marks.every(m => m.keywords.length === 0)) continue
      const loc = s.raw_text.match(/^(?:Last Seen|Location Found):\s*(.+)$/m)?.[1] ?? null
      const sex = s.raw_text.match(/^Sex:\s*(.+)$/m)?.[1] ?? null
      const age = s.raw_text.match(/^Age:\s*(\d+)/m)?.[1] ?? null
      unidentifiedParsed.push({ sub_id: s.id, location: loc, sex, age, marks })
    }
  }

  console.log(`Missing with marks: ${missingParsed.length}`)
  console.log(`Unidentified with marks: ${unidentifiedParsed.length}`)

  // Match
  const matches: TattooMatch[] = []
  let compared = 0
  let eliminated = 0

  for (const missing of missingParsed) {
    for (const uid of unidentifiedParsed) {
      compared++

      // Demographic pre-filter
      if (!demographicsCompatible(
        { sex: missing.sex, age: missing.age },
        { sex: uid.sex, age: uid.age }
      )) {
        eliminated++
        continue
      }

      // Compare marks
      for (const mMark of missing.marks) {
        for (const uMark of uid.marks) {
          // Find shared keywords
          const shared = mMark.keywords.filter(k => uMark.keywords.includes(k))
          if (shared.length === 0) continue

          // Check location match
          const locMatch =
            mMark.location.region !== 'unknown' &&
            uMark.location.region !== 'unknown' &&
            mMark.location.region === uMark.location.region &&
            (mMark.location.side === uMark.location.side ||
             mMark.location.side === 'unknown' ||
             uMark.location.side === 'unknown')

          const sideMatch = locMatch &&
            mMark.location.side !== 'unknown' &&
            uMark.location.side !== 'unknown' &&
            mMark.location.side === uMark.location.side

          // Score
          let score = 30 + (shared.length * 15) // base 30 + 15 per shared keyword
          if (locMatch) score += 20              // same body region
          if (sideMatch) score += 15             // same side too
          if (mMark.type === uMark.type) score += 5 // same mark type (both tattoos, both scars)
          score = Math.min(100, score)

          matches.push({
            missing_submission_id: missing.sub_id,
            unidentified_submission_id: uid.sub_id,
            missing_name: missing.name,
            unidentified_location: uid.location,
            shared_keywords: shared,
            location_match: locMatch,
            missing_mark: mMark.description.slice(0, 200),
            unidentified_mark: uMark.description.slice(0, 200),
            score,
            strength: locMatch ? 'description_and_location' : 'description_only',
          })
        }
      }
    }

    if (missingParsed.indexOf(missing) % 100 === 0 && missingParsed.indexOf(missing) > 0) {
      console.log(`  ${missingParsed.indexOf(missing)}/${missingParsed.length} missing processed, ${matches.length} matches found`)
    }
  }

  console.log(`\nComparisons: ${compared}`)
  console.log(`Eliminated by demographics: ${eliminated}`)
  console.log(`Raw matches: ${matches.length}`)

  // Deduplicate: keep highest score per missing+unidentified pair
  const deduped = new Map<string, TattooMatch>()
  for (const m of matches) {
    const key = `${m.missing_submission_id}__${m.unidentified_submission_id}`
    const existing = deduped.get(key)
    if (!existing || m.score > existing.score) {
      deduped.set(key, m)
    }
  }

  const uniqueMatches = [...deduped.values()].sort((a, b) => b.score - a.score)
  console.log(`Unique matches (deduped): ${uniqueMatches.length}`)

  // Store top matches in intelligence_queue
  const strong = uniqueMatches.filter(m => m.score >= 60)
  console.log(`Strong matches (score >= 60): ${strong.length}`)

  let queued = 0
  for (const m of strong.slice(0, 500)) {
    const { error } = await supabase.from('intelligence_queue').insert({
      queue_type: 'entity_crossmatch',
      priority_score: m.score,
      priority_grade: m.score >= 80 ? 'high' : m.score >= 60 ? 'medium' : 'low',
      title: `Tattoo match: ${m.missing_name ?? 'Unknown'} ↔ ${m.unidentified_location ?? 'Unidentified'}`,
      summary: `Shared mark: "${m.shared_keywords.join(', ')}"${m.location_match ? ' — SAME BODY LOCATION' : ''}. Missing: ${m.missing_mark.slice(0, 100)}. Unidentified: ${m.unidentified_mark.slice(0, 100)}.`,
      details: {
        type: 'tattoo_mark_match',
        missing_submission_id: m.missing_submission_id,
        unidentified_submission_id: m.unidentified_submission_id,
        shared_keywords: m.shared_keywords,
        location_match: m.location_match,
        strength: m.strength,
        missing_mark: m.missing_mark,
        unidentified_mark: m.unidentified_mark,
      },
      related_submission_ids: [m.missing_submission_id, m.unidentified_submission_id],
      signal_count: m.shared_keywords.length + (m.location_match ? 2 : 0),
      ai_confidence: m.score / 100,
    })
    if (!error) queued++
  }

  console.log(`\nQueued to intelligence: ${queued}`)

  // Print top 20
  console.log('\n=== Top 20 Tattoo Matches ===')
  for (const m of uniqueMatches.slice(0, 20)) {
    console.log(`\n  ${m.missing_name ?? 'Unknown'} ↔ ${m.unidentified_location ?? 'Unidentified'} — Score: ${m.score} (${m.strength})`)
    console.log(`    Keywords: ${m.shared_keywords.join(', ')}`)
    console.log(`    Missing:  ${m.missing_mark.slice(0, 120)}`)
    console.log(`    Unident:  ${m.unidentified_mark.slice(0, 120)}`)
  }
}

main().catch(console.error)
