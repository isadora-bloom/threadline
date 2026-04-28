/**
 * Offender range-drift detector
 *
 * The current offender overlap scoring treats victim_states as a flat list:
 * a state appears or it does not. Real serial offenders shift over time.
 * Early victims tend to cluster near home; later victims often appear
 * further afield as the offender becomes more mobile, or alternately
 * cluster tighter as the offender settles. Either pattern is a behavioral
 * signal.
 *
 * This script reconstructs each known offender's per-year geographic
 * centroid from the records that overlap their case at composite_score
 * >= 65. It looks at the year-to-year displacement of those centroids and
 * flags offenders whose range expanded or contracted notably across their
 * active period.
 *
 * Writes queue_type='behavioral_pattern' rows with details.kind=
 * 'offender_drift'. One row per offender. Idempotent per offender_id.
 *
 * Note: drift accuracy depends on city_geocodes coverage. For cities that
 * are not geocoded the script falls back to a baked-in state-center map so
 * partial coverage does not silently corrupt the centroid.
 *
 * Usage: npx tsx scripts/offender-drift-flag.ts [--dry-run]
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

const MIN_OVERLAPS = 4
const MIN_YEARS_SPAN = 2
const MIN_DRIFT_MILES = 150

// Approximate state centers (lat, lng) — fallback when a city is not in
// city_geocodes. Coarse but adequate for distinguishing "stayed in TN" from
// "moved to OR".
const STATE_CENTER: Record<string, [number, number]> = {
  Alabama: [32.806671, -86.791130], Alaska: [61.370716, -152.404419],
  Arizona: [33.729759, -111.431221], Arkansas: [34.969704, -92.373123],
  California: [36.116203, -119.681564], Colorado: [39.059811, -105.311104],
  Connecticut: [41.597782, -72.755371], Delaware: [39.318523, -75.507141],
  'District of Columbia': [38.897438, -77.026817],
  Florida: [27.766279, -81.686783], Georgia: [33.040619, -83.643074],
  Hawaii: [21.094318, -157.498337], Idaho: [44.240459, -114.478828],
  Illinois: [40.349457, -88.986137], Indiana: [39.849426, -86.258278],
  Iowa: [42.011539, -93.210526], Kansas: [38.526600, -96.726486],
  Kentucky: [37.668140, -84.670067], Louisiana: [31.169546, -91.867805],
  Maine: [44.693947, -69.381927], Maryland: [39.063946, -76.802101],
  Massachusetts: [42.230171, -71.530106], Michigan: [43.326618, -84.536095],
  Minnesota: [45.694454, -93.900192], Mississippi: [32.741646, -89.678696],
  Missouri: [38.456085, -92.288368], Montana: [46.921925, -110.454353],
  Nebraska: [41.125370, -98.268082], Nevada: [38.313515, -117.055374],
  'New Hampshire': [43.452492, -71.563896], 'New Jersey': [40.298904, -74.521011],
  'New Mexico': [34.840515, -106.248482], 'New York': [42.165726, -74.948051],
  'North Carolina': [35.630066, -79.806419], 'North Dakota': [47.528912, -99.784012],
  Ohio: [40.388783, -82.764915], Oklahoma: [35.565342, -96.928917],
  Oregon: [44.572021, -122.070938], Pennsylvania: [40.590752, -77.209755],
  'Rhode Island': [41.680893, -71.511780], 'South Carolina': [33.856892, -80.945007],
  'South Dakota': [44.299782, -99.438828], Tennessee: [35.747845, -86.692345],
  Texas: [31.054487, -97.563461], Utah: [40.150032, -111.862434],
  Vermont: [44.045876, -72.710686], Virginia: [37.769337, -78.169968],
  Washington: [47.400902, -121.490494], 'West Virginia': [38.491226, -80.954453],
  Wisconsin: [44.268543, -89.616508], Wyoming: [42.755966, -107.302490],
  'Puerto Rico': [18.220833, -66.590149],
}

interface GeoPoint { lat: number; lng: number }

function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 3959
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

interface Overlap {
  offender_id: string
  submission_id: string
  composite_score: number
  // Joined fields
  year: number | null
  city: string | null
  state: string | null
}

async function fetchGeocodes(): Promise<Map<string, GeoPoint>> {
  const PAGE = 1000
  const m = new Map<string, GeoPoint>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('city_geocodes')
      .select('city, state, lat, lng')
      .range(from, from + PAGE - 1)
    if (error) { console.error('city_geocodes fetch failed:', error.message); break }
    if (!data?.length) break
    for (const r of data as Array<{ city: string; state: string; lat: number; lng: number }>) {
      m.set(`${r.city.toLowerCase()}|${r.state.toLowerCase()}`, { lat: r.lat, lng: r.lng })
    }
    if (data.length < PAGE) break
  }
  return m
}

async function fetchOffenders(): Promise<Array<{ id: string; name: string; active_from: number | null; active_to: number | null }>> {
  const { data, error } = await supabase
    .from('known_offenders')
    .select('id, name, active_from, active_to')
  if (error) { console.error('known_offenders fetch failed:', error.message); process.exit(1) }
  return (data ?? []) as Array<{ id: string; name: string; active_from: number | null; active_to: number | null }>
}

async function fetchOverlapsForOffender(offenderId: string): Promise<Overlap[]> {
  const { data, error } = await supabase
    .from('offender_case_overlaps')
    .select('offender_id, submission_id, composite_score')
    .eq('offender_id', offenderId)
    .gte('composite_score', 65)
  if (error) {
    console.error(`overlap fetch failed for ${offenderId}: ${error.message}`)
    return []
  }
  const overlaps = (data ?? []) as Array<{ offender_id: string; submission_id: string; composite_score: number }>
  if (overlaps.length === 0) return []

  // Resolve each submission to (year, city, state) via the linked import_record.
  const subIds = overlaps.map(o => o.submission_id)
  const { data: recs } = await supabase
    .from('import_records')
    .select('submission_id, city, state, date_missing, date_found')
    .in('submission_id', subIds)

  type RecRow = { submission_id: string | null; city: string | null; state: string | null; date_missing: string | null; date_found: string | null }
  const byId = new Map<string, RecRow>()
  for (const r of (recs ?? []) as RecRow[]) {
    if (r.submission_id) byId.set(r.submission_id, r)
  }

  return overlaps.map(o => {
    const rec = byId.get(o.submission_id)
    let year: number | null = null
    if (rec?.date_missing) {
      const y = new Date(rec.date_missing).getUTCFullYear()
      if (Number.isFinite(y)) year = y
    } else if (rec?.date_found) {
      const y = new Date(rec.date_found).getUTCFullYear()
      if (Number.isFinite(y)) year = y
    }
    return {
      offender_id: o.offender_id,
      submission_id: o.submission_id,
      composite_score: o.composite_score,
      year,
      city: rec?.city ?? null,
      state: rec?.state ?? null,
    }
  })
}

function locate(geo: Map<string, GeoPoint>, city: string | null, state: string | null): GeoPoint | null {
  if (state) {
    if (city) {
      const hit = geo.get(`${city.toLowerCase()}|${state.toLowerCase()}`)
      if (hit) return hit
    }
    const stateClean = state.replace(/\.$/, '').trim()
    const center = STATE_CENTER[stateClean]
    if (center) return { lat: center[0], lng: center[1] }
  }
  return null
}

function centroid(points: GeoPoint[]): GeoPoint {
  let sumLat = 0
  let sumLng = 0
  for (const p of points) { sumLat += p.lat; sumLng += p.lng }
  return { lat: sumLat / points.length, lng: sumLng / points.length }
}

async function alreadyFlaggedSet(): Promise<Set<string>> {
  const PAGE = 1000
  const seen = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from('intelligence_queue')
      .select('details')
      .eq('queue_type', 'behavioral_pattern')
      .range(from, from + PAGE - 1)
    if (!data?.length) break
    for (const row of data as Array<{ details: Record<string, unknown> | null }>) {
      const d = row.details ?? {}
      if ((d as Record<string, unknown>).kind !== 'offender_drift') continue
      const oid = (d as Record<string, unknown>).offender_id as string | undefined
      if (oid) seen.add(oid)
    }
    if (data.length < PAGE) break
  }
  return seen
}

async function main() {
  console.log('=== Offender range-drift detector ===')

  const geo = await fetchGeocodes()
  console.log(`Geocodes loaded: ${geo.size}`)

  const offenders = await fetchOffenders()
  console.log(`Known offenders: ${offenders.length}`)

  const seen = DRY_RUN ? new Set<string>() : await alreadyFlaggedSet()
  let evaluated = 0
  let flagged = 0
  let skipped = 0

  for (const off of offenders) {
    const overlaps = await fetchOverlapsForOffender(off.id)
    if (overlaps.length < MIN_OVERLAPS) continue

    // Group locatable overlaps by year.
    const byYear = new Map<number, GeoPoint[]>()
    for (const o of overlaps) {
      if (o.year === null) continue
      const p = locate(geo, o.city, o.state)
      if (!p) continue
      if (!byYear.has(o.year)) byYear.set(o.year, [])
      byYear.get(o.year)!.push(p)
    }
    const years = Array.from(byYear.keys()).sort((a, b) => a - b)
    if (years.length < MIN_YEARS_SPAN) continue
    evaluated++

    const yearCentroids = years.map(y => ({ year: y, centroid: centroid(byYear.get(y)!) }))

    const earliest = yearCentroids[0].centroid
    const latest = yearCentroids[yearCentroids.length - 1].centroid
    const overallDrift = haversineMiles(earliest, latest)

    let maxConsecutive = 0
    let maxConsecutiveYears: [number, number] = [years[0], years[0]]
    for (let i = 1; i < yearCentroids.length; i++) {
      const d = haversineMiles(yearCentroids[i - 1].centroid, yearCentroids[i].centroid)
      if (d > maxConsecutive) {
        maxConsecutive = d
        maxConsecutiveYears = [yearCentroids[i - 1].year, yearCentroids[i].year]
      }
    }

    const significant = overallDrift >= MIN_DRIFT_MILES || maxConsecutive >= MIN_DRIFT_MILES * 1.5
    if (!significant) continue

    if (seen.has(off.id)) { skipped++; continue }

    const direction = overallDrift >= MIN_DRIFT_MILES ? 'expanding range' : 'sharp year-over-year shift'
    const priority = Math.min(85, 50 + Math.round(overallDrift / 50))
    const grade = priority >= 75 ? 'high' : 'medium'

    const summary = `${off.name} has ${overlaps.length} matched cases at composite_score >= 65. Earliest centroid (${years[0]}): ${earliest.lat.toFixed(2)}, ${earliest.lng.toFixed(2)}. Latest centroid (${years[years.length - 1]}): ${latest.lat.toFixed(2)}, ${latest.lng.toFixed(2)}. Overall drift across active years: ${Math.round(overallDrift)} mi. Largest year-over-year jump: ${Math.round(maxConsecutive)} mi between ${maxConsecutiveYears[0]} and ${maxConsecutiveYears[1]}. Pattern reads as ${direction} — match scoring should weight cases inside the late-period range higher than early-period range.`

    if (DRY_RUN) {
      console.log(`  [dry] ${off.name} P${priority}: drift ${Math.round(overallDrift)}mi over ${years.length} years`)
      flagged++
      continue
    }

    const { error } = await supabase.from('intelligence_queue').insert({
      queue_type: 'behavioral_pattern',
      priority_score: priority,
      priority_grade: grade,
      title: `Range drift: ${off.name} — ${direction}, ${Math.round(overallDrift)} mi across active years`,
      summary,
      details: {
        kind: 'offender_drift',
        offender_id: off.id,
        offender_name: off.name,
        overall_drift_miles: Math.round(overallDrift),
        max_consecutive_drift_miles: Math.round(maxConsecutive),
        max_consecutive_years: maxConsecutiveYears,
        years: years,
        year_centroids: yearCentroids,
        overlap_count: overlaps.length,
      },
      related_import_ids: [],
      signal_count: overlaps.length,
      ai_confidence: 0.55,
    })
    if (error) {
      console.error(`  Insert failed for ${off.name}: ${error.message}`)
      continue
    }
    flagged++
  }

  console.log('\n=== Done ===')
  console.log(`Offenders evaluated (>=${MIN_OVERLAPS} overlaps, >=${MIN_YEARS_SPAN} year span): ${evaluated}`)
  console.log(`Flagged: ${flagged}`)
  console.log(`Skipped (already flagged): ${skipped}`)
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
