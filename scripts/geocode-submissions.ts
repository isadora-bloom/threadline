/**
 * Geocodes unique city+state combos from Doe Network submissions via Nominatim (OpenStreetMap).
 * Results stored in city_geocodes table for use by geographic cluster analyses.
 *
 * Rate-limited to 1 req/sec per Nominatim policy.
 * Safe to re-run — skips already-geocoded combos.
 *
 * Usage:  npx tsx scripts/geocode-submissions.ts
 * Resume: npx tsx scripts/geocode-submissions.ts   (always safe to resume)
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// US state abbreviation → full name (for Nominatim queries)
const STATE_ABBREV: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  DC:'Washington DC',PR:'Puerto Rico',VI:'Virgin Islands',GU:'Guam',
}

function resolveState(raw: string): string {
  const trimmed = raw.trim().replace(/\.$/, '')
  if (trimmed.length === 2) return STATE_ABBREV[trimmed.toUpperCase()] ?? trimmed
  return trimmed
}

// Extract city + state from Doe Network location string "City, County, State"
function parseLocation(loc: string): { city: string; state: string } | null {
  const parts = loc.split(',').map(s => s.trim())
  if (parts.length < 2) return null
  const city = parts[0]
  // State is usually the last part; strip any trailing period or details
  const rawState = parts[parts.length - 1].split(' ')[0].trim()
  const state = resolveState(rawState)
  if (!city || city.length < 2 || !state || state.length < 2) return null
  if (/unknown|unclear|various|anywhere/i.test(city)) return null
  return { city, state }
}

// Call Nominatim geocoder
async function geocodeCity(city: string, state: string): Promise<{ lat: number; lng: number; display_name: string } | null> {
  const query = encodeURIComponent(`${city}, ${state}, United States`)
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=us&addressdetails=0`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Threadline/1.0 (missing-persons-case-intelligence; contact@threadline.app)',
      'Accept': 'application/json',
    },
  })

  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)

  const results = await res.json() as Array<{ lat: string; lon: string; display_name: string }>
  if (!results.length) return null

  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    display_name: results[0].display_name,
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nDoe Network Geocoder')
  console.log('====================')

  // Find the missing persons case
  const { data: cases } = await supabase
    .from('cases').select('id, title').ilike('title', '%Doe Network%Missing%')

  if (!cases?.length) {
    console.error('Missing Persons case not found.')
    process.exit(1)
  }

  const missingCaseId = cases[0].id
  console.log(`Case:  ${cases[0].title}`)

  // Fetch all submissions and extract unique city+state combos
  console.log('\nLoading submissions…')
  const { data: subs } = await supabase
    .from('submissions').select('raw_text').eq('case_id', missingCaseId)

  if (!subs?.length) { console.error('No submissions found.'); process.exit(1) }
  console.log(`Submissions loaded: ${subs.length.toLocaleString()}`)

  const unique = new Map<string, { city: string; state: string }>()
  for (const sub of subs) {
    const m = sub.raw_text.match(/^Last Seen:\s*(.+)$/mi)
    if (!m) continue
    const parsed = parseLocation(m[1].trim())
    if (!parsed) continue
    const key = `${parsed.city.toLowerCase()}|${parsed.state.toLowerCase()}`
    if (!unique.has(key)) unique.set(key, parsed)
  }

  console.log(`Unique city+state combos: ${unique.size.toLocaleString()}`)

  // Check which are already geocoded
  const { data: existing } = await supabase
    .from('city_geocodes' as never)
    .select('city, state') as { data: Array<{ city: string; state: string }> | null }

  const alreadyDone = new Set(
    (existing ?? []).map(r => `${r.city.toLowerCase()}|${r.state.toLowerCase()}`)
  )

  const pending = [...unique.values()].filter(
    loc => !alreadyDone.has(`${loc.city.toLowerCase()}|${loc.state.toLowerCase()}`)
  )

  if (!pending.length) {
    console.log('\nAll combos already geocoded. Nothing to do.')
    process.exit(0)
  }

  console.log(`Already geocoded: ${alreadyDone.size}`)
  console.log(`To geocode:       ${pending.length}`)
  console.log(`Est. time:        ~${Math.ceil(pending.length / 60)} minutes at 1 req/sec`)
  console.log()

  let done = 0, failed = 0, notFound = 0
  const BATCH_STORE = 50
  const toStore: object[] = []

  for (const loc of pending) {
    try {
      await sleep(1100) // Nominatim: max 1 req/sec

      const result = await geocodeCity(loc.city, loc.state)

      if (!result) {
        notFound++
        process.stdout.write(`\r  [${done + failed + notFound}/${pending.length}] ⊘ Not found: ${loc.city}, ${loc.state}       `)
      } else {
        toStore.push({
          city: loc.city,
          state: loc.state,
          lat: result.lat,
          lng: result.lng,
          display_name: result.display_name,
        })
        done++
        process.stdout.write(`\r  [${done + failed + notFound}/${pending.length}] ✓ ${loc.city}, ${loc.state} → ${result.lat.toFixed(3)}, ${result.lng.toFixed(3)}       `)
      }
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      process.stdout.write(`\n  ✗ Error on ${loc.city}, ${loc.state}: ${msg.slice(0, 60)}\n`)
      await sleep(5000) // back off on errors
    }

    // Store in batches
    if (toStore.length >= BATCH_STORE) {
      await supabase.from('city_geocodes' as never).upsert(toStore.splice(0, BATCH_STORE) as never, {
        onConflict: 'city,state,country',
        ignoreDuplicates: true,
      })
    }
  }

  // Store remainder
  if (toStore.length) {
    await supabase.from('city_geocodes' as never).upsert(toStore as never, {
      onConflict: 'city,state,country',
      ignoreDuplicates: true,
    })
  }

  console.log(`\n\n${'═'.repeat(50)}`)
  console.log('Geocoding complete')
  console.log(`  Geocoded:  ${done.toLocaleString()}`)
  console.log(`  Not found: ${notFound}`)
  console.log(`  Errors:    ${failed}`)
  console.log(`\nRun "npx tsx scripts/run-clusters.ts --only highway_proximity,national_park_proximity"`)
  console.log('to re-run geographic clusters using the geocoded coordinates.')
}

main().catch(e => { console.error(e); process.exit(1) })
