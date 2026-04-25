/**
 * Global Connection Scorer
 *
 * Runs across ALL AI-processed import records and scores potential connections:
 * - Missing person ↔ Unidentified remains (demographic + geographic + temporal)
 * - Missing person ↔ Missing person (geographic cluster, shared circumstances)
 * - Any record ↔ Known offender (MO, geography, victimology overlap)
 *
 * Populates: global_connections + intelligence_queue
 *
 * Usage: npx tsx scripts/compute-global-connections.ts [--limit 500] [--state VA]
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
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 500
const stateIdx = args.indexOf('--state')
const STATE_FILTER = stateIdx !== -1 ? args[stateIdx + 1] : null

interface ImportRecord {
  id: string
  record_type: string
  person_name: string | null
  age_text: string | null
  sex: string | null
  race: string | null
  state: string | null
  city: string | null
  date_missing: string | null
  date_found: string | null
  ai_extraction: Record<string, unknown> | null
  external_id: string
}

function parseAge(ageText: string | null): { min: number; max: number } | null {
  if (!ageText) return null
  const range = ageText.match(/(\d+)\s*-\s*(\d+)/)
  if (range) return { min: parseInt(range[1]), max: parseInt(range[2]) }
  const single = ageText.match(/(\d+)/)
  if (single) return { min: parseInt(single[1]) - 3, max: parseInt(single[1]) + 3 }
  return null
}

function daysBetween(d1: string | null, d2: string | null): number | null {
  if (!d1 || !d2) return null
  const ms = Math.abs(new Date(d1).getTime() - new Date(d2).getTime())
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function normSex(s: string | null): string {
  if (!s) return 'unknown'
  const lower = s.toLowerCase().trim()
  if (lower.startsWith('m')) return 'male'
  if (lower.startsWith('f')) return 'female'
  return 'unknown'
}

function normRace(r: string | null): string {
  if (!r) return 'unknown'
  return r.toLowerCase().trim()
}

interface GeoPoint { lat: number; lng: number }
type GeoMap = Map<string, GeoPoint>

function geoKey(city: string | null, state: string | null): string | null {
  if (!city || !state) return null
  return `${city.toLowerCase().trim()}|${state.toLowerCase().trim()}`
}

// Great-circle distance in miles via haversine.
function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 3959 // Earth radius in miles
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

function scoreConnection(missing: ImportRecord, remains: ImportRecord, geo: GeoMap): {
  score: number
  signals: Record<string, number>
  distance_miles: number | null
  days_apart: number | null
} {
  const signals: Record<string, number> = {}
  let score = 0

  // Sex match
  const mSex = normSex(missing.sex)
  const rSex = normSex(remains.sex)
  if (mSex !== 'unknown' && rSex !== 'unknown') {
    if (mSex === rSex) {
      signals.sex_match = 15
      score += 15
    } else {
      signals.sex_mismatch = -50
      score -= 50
    }
  }

  // Age overlap
  const mAge = parseAge(missing.age_text)
  const rAge = parseAge(remains.age_text)
  if (mAge && rAge) {
    const overlap = Math.min(mAge.max, rAge.max) - Math.max(mAge.min, rAge.min)
    if (overlap >= 0) {
      const overlapScore = Math.min(20, overlap * 3)
      signals.age_overlap = overlapScore
      score += overlapScore
    } else {
      const gap = -overlap
      if (gap <= 5) {
        signals.age_close = 5
        score += 5
      } else {
        signals.age_mismatch = -20
        score -= 20
      }
    }
  }

  // Race match
  const mRace = normRace(missing.race)
  const rRace = normRace(remains.race)
  if (mRace !== 'unknown' && rRace !== 'unknown') {
    if (mRace === rRace) {
      signals.race_match = 10
      score += 10
    } else {
      signals.race_mismatch = -30
      score -= 30
    }
  }

  // Same state
  if (missing.state && remains.state) {
    if (missing.state === remains.state) {
      signals.same_state = 15
      score += 15
    } else {
      // Adjacent states get partial credit (simplified)
      signals.different_state = 0
    }
  }

  // Temporal proximity
  const days = daysBetween(missing.date_missing, remains.date_found)
  if (days !== null) {
    if (days <= 30) {
      signals.temporal_very_close = 20
      score += 20
    } else if (days <= 180) {
      signals.temporal_close = 12
      score += 12
    } else if (days <= 365) {
      signals.temporal_moderate = 6
      score += 6
    } else if (days <= 365 * 3) {
      signals.temporal_wide = 2
      score += 2
    }
    // Penalty if remains found BEFORE person went missing
    if (missing.date_missing && remains.date_found) {
      if (new Date(remains.date_found) < new Date(missing.date_missing)) {
        signals.temporal_impossible = -100
        score -= 100
      }
    }
  }

  // AI extraction signals
  const mExtract = missing.ai_extraction as Record<string, unknown> | null
  const rExtract = remains.ai_extraction as Record<string, unknown> | null
  if (mExtract && rExtract) {
    const mDemo = mExtract.demographics as Record<string, unknown> | undefined
    const rDemo = rExtract.demographics as Record<string, unknown> | undefined

    // Hair color match
    if (mDemo?.hair_color && rDemo?.hair_color) {
      const mHair = String(mDemo.hair_color).toLowerCase()
      const rHair = String(rDemo.hair_color).toLowerCase()
      if (mHair === rHair) {
        signals.hair_match = 8
        score += 8
      }
    }

    // Eye color match
    if (mDemo?.eye_color && rDemo?.eye_color) {
      const mEyes = String(mDemo.eye_color).toLowerCase()
      const rEyes = String(rDemo.eye_color).toLowerCase()
      if (mEyes === rEyes) {
        signals.eye_match = 5
        score += 5
      }
    }

    // Distinguishing marks overlap
    const mMarks = (mDemo?.distinguishing_marks ?? []) as string[]
    const rMarks = (rDemo?.distinguishing_marks ?? []) as string[]
    if (mMarks.length > 0 && rMarks.length > 0) {
      const mLower = mMarks.map(m => m.toLowerCase())
      const rLower = rMarks.map(m => m.toLowerCase())
      const shared = mLower.filter(m => rLower.some(r => r.includes(m) || m.includes(r)))
      if (shared.length > 0) {
        signals.mark_overlap = 25 * shared.length
        score += 25 * shared.length
      }
    }

    // Highway corridor match
    const mGeo = mExtract.geography as Record<string, unknown> | undefined
    const rGeo = rExtract.geography as Record<string, unknown> | undefined
    if (mGeo?.nearest_highway && rGeo?.nearest_highway) {
      if (String(mGeo.nearest_highway) === String(rGeo.nearest_highway)) {
        signals.corridor_match = 12
        score += 12
      }
    }
  }

  // Geographic distance — interpreted as travel-from-where-they-vanished to
  // where-remains-were-found. Not all distances are equally suspicious. Local
  // crimes cluster near home; vehicular abduction shows up as 100-700 mi.
  // Beyond that, the signal flattens because matches that far apart are
  // dominated by noise unless other signals carry them.
  let distanceMiles: number | null = null
  const mKey = geoKey(missing.city, missing.state)
  const rKey = geoKey(remains.city, remains.state)
  if (mKey && rKey) {
    const mLoc = geo.get(mKey)
    const rLoc = geo.get(rKey)
    if (mLoc && rLoc) {
      distanceMiles = Math.round(haversineMiles(mLoc, rLoc))
      if (distanceMiles <= 30) {
        signals.distance_local = 5 // co-located is itself a signal
        score += 5
      } else if (distanceMiles <= 300) {
        signals.distance_regional = 10
        score += 10
      } else if (distanceMiles <= 700) {
        signals.distance_long = 8
        score += 8
      } else if (distanceMiles <= 1500) {
        signals.distance_very_long = 3
        score += 3
      } else {
        signals.distance_cross_country = 0
      }
    }
  }

  // Clamp
  score = Math.max(0, Math.min(100, score))

  return { score, signals, distance_miles: distanceMiles, days_apart: days }
}

function gradeScore(score: number): string {
  if (score >= 86) return 'very_strong'
  if (score >= 66) return 'strong'
  if (score >= 41) return 'notable'
  if (score >= 21) return 'moderate'
  return 'weak'
}

async function main() {
  console.log('=== Global Connection Scorer ===')
  console.log(`Limit: ${LIMIT}, State: ${STATE_FILTER ?? 'all'}`)

  // Fetch AI-processed missing persons
  let missingQuery = supabase
    .from('import_records')
    .select('*')
    .eq('record_type', 'missing_person')
    .eq('ai_processed', true)
    .limit(LIMIT)

  if (STATE_FILTER) missingQuery = missingQuery.eq('state', STATE_FILTER)

  const { data: missingRecords, error: mErr } = await missingQuery
  if (mErr) { console.error('Error fetching missing:', mErr.message); process.exit(1) }

  // Fetch AI-processed unidentified remains
  let remainsQuery = supabase
    .from('import_records')
    .select('*')
    .eq('record_type', 'unidentified_remains')
    .eq('ai_processed', true)
    .limit(LIMIT)

  if (STATE_FILTER) remainsQuery = remainsQuery.eq('state', STATE_FILTER)

  const { data: remainsRecords, error: rErr } = await remainsQuery
  if (rErr) { console.error('Error fetching remains:', rErr.message); process.exit(1) }

  console.log(`Missing persons: ${missingRecords?.length ?? 0}`)
  console.log(`Unidentified remains: ${remainsRecords?.length ?? 0}`)

  if (!missingRecords?.length || !remainsRecords?.length) {
    console.log('Need both missing persons and unidentified remains to compute connections.')
    return
  }

  // Load city_geocodes once into memory so per-pair distance lookups are O(1).
  // The table has at most low tens of thousands of rows; fits easily.
  const geo: GeoMap = new Map()
  {
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('city_geocodes')
        .select('city, state, lat, lng')
        .range(from, from + PAGE - 1)
      if (error) { console.error('city_geocodes fetch failed:', error.message); break }
      if (!data?.length) break
      for (const row of data as Array<{ city: string; state: string; lat: number; lng: number }>) {
        const key = geoKey(row.city, row.state)
        if (key) geo.set(key, { lat: row.lat, lng: row.lng })
      }
      if (data.length < PAGE) break
    }
  }
  console.log(`Geocodes loaded: ${geo.size}`)

  let connectionsCreated = 0
  let queueItemsCreated = 0
  let skipped = 0

  for (let i = 0; i < missingRecords.length; i++) {
    const missing = missingRecords[i] as ImportRecord

    if (i % 50 === 0) {
      console.log(`Processing missing person ${i + 1}/${missingRecords.length} (${missing.person_name ?? missing.external_id})...`)
    }

    for (const remains of remainsRecords as ImportRecord[]) {
      const { score, signals, distance_miles, days_apart } = scoreConnection(missing, remains, geo)

      // Only store connections that are at least moderate
      if (score < 21) continue

      const grade = gradeScore(score)
      const aiSummary = buildSummary(missing, remains, signals)

      // Upsert connection with the human-readable reasoning baked in so the UI
      // can render a sentence without regenerating it every page load.
      const { error: connErr } = await supabase
        .from('global_connections')
        .upsert({
          record_a_id: missing.id,
          record_b_id: remains.id,
          connection_type: 'composite',
          composite_score: score,
          grade,
          signals,
          distance_miles,
          days_apart,
          ai_summary: aiSummary,
          ai_confidence: score / 100,
          generated_at: new Date().toISOString(),
        }, { onConflict: 'record_a_id,record_b_id' })

      if (connErr) {
        if (connErr.code === '23505') { skipped++; continue } // duplicate
        console.error(`  Connection error:`, connErr.message)
        continue
      }

      connectionsCreated++

      // Add notable+ connections to intelligence queue. Reuses the same
      // aiSummary computed above so the connection row and the queue row
      // tell a consistent story.
      if (score >= 41) {
        const missingName = missing.person_name ?? `NamUs ${missing.external_id}`
        const remainsName = `Unidentified (${remains.state ?? '??'}, ${remains.date_found ?? '??'})`

        await supabase
          .from('intelligence_queue')
          .insert({
            queue_type: 'possible_match',
            priority_score: score,
            priority_grade: score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low',
            title: `Possible match: ${missingName} ↔ ${remainsName}`,
            summary: aiSummary,
            details: { missing_id: missing.id, remains_id: remains.id, signals },
            related_import_ids: [missing.id, remains.id],
            signal_count: Object.keys(signals).filter(k => !k.includes('mismatch') && !k.includes('impossible')).length,
            ai_confidence: score / 100,
          })

        queueItemsCreated++
      }
    }
  }

  console.log(`\n=== Done ===`)
  console.log(`Connections created: ${connectionsCreated}`)
  console.log(`Queue items created: ${queueItemsCreated}`)
  console.log(`Skipped (duplicates): ${skipped}`)
}

function buildSummary(missing: ImportRecord, remains: ImportRecord, signals: Record<string, number>): string {
  const parts: string[] = []
  const name = missing.person_name ?? `NamUs ${missing.external_id}`

  parts.push(`${name} (${missing.sex ?? '?'}, age ${missing.age_text ?? '?'}, ${missing.state ?? '?'})`)
  parts.push(`went missing ${missing.date_missing ?? '(date unknown)'}`)

  parts.push(`may match unidentified remains found in ${remains.state ?? '?'}`)
  parts.push(`on ${remains.date_found ?? '(date unknown)'}.`)

  // Positive signals — things that support the match.
  const supports: string[] = []
  if (signals.sex_match) supports.push('sex matches')
  if (signals.age_overlap) supports.push('age overlaps')
  if (signals.age_close) supports.push('age within 5 years')
  if (signals.race_match) supports.push('race matches')
  if (signals.same_state) supports.push('same state')
  if (signals.temporal_very_close) supports.push('dates within 30 days')
  else if (signals.temporal_close) supports.push('dates within 6 months')
  else if (signals.temporal_moderate) supports.push('dates within a year')
  else if (signals.temporal_wide) supports.push('dates within 3 years')
  if (signals.corridor_match) supports.push('same highway corridor')
  if (signals.mark_overlap) supports.push('distinguishing marks overlap')
  if (signals.hair_match) supports.push('hair color matches')
  if (signals.eye_match) supports.push('eye color matches')
  if (signals.distance_local) supports.push('co-located')
  else if (signals.distance_regional) supports.push('regional travel (≤300mi)')
  else if (signals.distance_long) supports.push('long-distance travel (300–700mi, vehicular signal)')
  else if (signals.distance_very_long) supports.push('very long distance (700–1500mi)')

  if (supports.length > 0) {
    parts.push(`Supports: ${supports.join(', ')}.`)
  }

  // Contradictions — penalties that keep a reader honest about why the
  // overall score might still be lower than the supports suggest.
  const contradicts: string[] = []
  if (signals.sex_mismatch) contradicts.push('sex differs')
  if (signals.age_mismatch) contradicts.push('age incompatible')
  if (signals.race_mismatch) contradicts.push('race differs')
  if (signals.temporal_impossible) contradicts.push('remains found BEFORE person went missing — likely not the same person')

  if (contradicts.length > 0) {
    parts.push(`Against: ${contradicts.join(', ')}.`)
  }

  return parts.join(' ')
}

main().catch(console.error)
