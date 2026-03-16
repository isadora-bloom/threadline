// Client-side scoring utilities — mirrors the Postgres compute_submission_priority function
// for real-time feedback during intake and workspace.

export const INTERPRETATION_SIGNALS = [
  'i think', 'i believe', 'i suspect', 'probably', 'might be',
  'could be', 'seems like', 'i feel like', 'my guess', 'i reckon',
  'i wonder if', 'possibly', 'maybe', 'i assume', 'not sure but',
]

export function preflaggerInterpretation(text: string): boolean {
  const lower = text.toLowerCase()
  return INTERPRETATION_SIGNALS.some(signal => lower.includes(signal))
}

export const VEHICLE_PATTERNS = [
  /\b(ford|chevy|chevrolet|dodge|gmc|toyota|honda|nissan|ram|jeep)\b/i,
  /\b(f-?150|silverado|tacoma|civic|camry|explorer|f-?250|ranger)\b/i,
  /\b(pickup|truck|suv|sedan|van|minivan|hatchback|coupe|wagon)\b/i,
  /\b[A-Z]{1,3}[-\s]?\d{3,4}[-\s]?[A-Z]{0,3}\b/, // plate-like
]

export const PHONE_PATTERNS = [
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
  /\b\(\d{3}\)[-.\s]\d{3}[-.\s]\d{4}\b/,
  /\b\+1\s?\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
]

export function detectVehicleInText(text: string): string[] {
  const matches: string[] = []
  for (const pattern of VEHICLE_PATTERNS) {
    const match = text.match(pattern)
    if (match) matches.push(match[0])
  }
  return [...new Set(matches)]
}

export function detectPhonesInText(text: string): string[] {
  const matches: string[] = []
  for (const pattern of PHONE_PATTERNS) {
    const match = text.match(pattern)
    if (match) matches.push(match[0])
  }
  return [...new Set(matches)]
}

// Split text into sentences for click-to-claim
export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=\n)\s*(?=\S)/)
    .map(s => s.trim())
    .filter(s => s.length > 10)
}

// Suggest claim type from sentence text
export function suggestClaimType(text: string): string {
  const lower = text.toLowerCase()
  if (preflaggerInterpretation(lower)) return 'interpretation'
  if (VEHICLE_PATTERNS.some(p => p.test(lower))) return 'sighting'
  if (PHONE_PATTERNS.some(p => p.test(lower))) return 'identifier'
  if (/\b(said|told|stated|mentioned|asked)\b/.test(lower)) return 'statement'
  if (/\b(always|usually|often|regularly|never)\b/.test(lower)) return 'behavioral'
  if (/\b(tall|short|heavy|thin|bald|beard|tattoo|wearing)\b/.test(lower)) return 'physical_description'
  if (/\b([a-z]{2}\d{6,}|\bid[\s:]\d+|case\s*#)\b/.test(lower)) return 'official'
  return 'sighting'
}

export const PRIORITY_THRESHOLDS = { high: 70, medium: 35 }

export function priorityLevelFromScore(score: number): 'high' | 'medium' | 'low' {
  if (score >= PRIORITY_THRESHOLDS.high) return 'high'
  if (score >= PRIORITY_THRESHOLDS.medium) return 'medium'
  return 'low'
}

// Client-side priority computation — mirrors compute_submission_priority Postgres function
export interface PriorityInputs {
  submitter_consent: string
  firsthand: boolean
  observation_mode: string
  entity_count_step6: number
  has_date: boolean
  has_location_pin: boolean
  word_count: number
  interpretation_text: string | null
}

export function computePriorityScore(inputs: PriorityInputs): number {
  let score = 0

  if (inputs.submitter_consent === 'on_record') score += 20
  if (inputs.submitter_consent === 'confidential') score += 10
  if (inputs.firsthand) score += 25

  if (inputs.observation_mode === 'observed_directly') score += 20
  if (inputs.observation_mode === 'heard_directly') score += 10

  if (inputs.entity_count_step6 >= 3) score += 15
  if (inputs.entity_count_step6 >= 5) score += 10
  if (inputs.has_date) score += 15
  if (inputs.has_location_pin) score += 10

  if (inputs.word_count >= 50) score += 5
  if (inputs.word_count >= 150) score += 5

  if (inputs.interpretation_text !== null && inputs.word_count < 20) {
    score -= 20
  }

  return Math.max(0, Math.min(score, 100))
}
