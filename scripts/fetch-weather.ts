/**
 * Open-Meteo weather fetcher
 *
 * For every record with a date, a city, and a known geocode that has not
 * had its weather resolved yet, ask Open-Meteo Archive for the daily
 * summary at the event date and store it on import_records. Open-Meteo is
 * free, key-less, and covers data back to 1940 — perfect for cold-case
 * dates the audit suggested were investigatively meaningful.
 *
 * The script also computes a coarse severity tag so a UI / flagger can
 * filter for "major weather" without re-deriving from raw values.
 *
 * Optional second pass: --flag emits intelligence_queue rows for any
 * record whose weather severity is 'severe' (heavy snow, blizzard,
 * hurricane-force wind, etc.) — that combination is one of the reasons
 * cases go cold.
 *
 * Usage: npx tsx scripts/fetch-weather.ts [--limit 1000] [--flag]
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 1000
const FLAG = args.includes('--flag')
const DELAY_MS = 600 // Open-Meteo allows ~10 req/s on free tier; stay polite

const OPEN_METEO = 'https://archive-api.open-meteo.com/v1/archive'

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

interface Row {
  id: string
  external_id: string
  city: string | null
  state: string | null
  date_missing: string | null
  date_found: string | null
}

interface GeoPoint { lat: number; lng: number }

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

async function fetchTargets(): Promise<Row[]> {
  const PAGE = 1000
  const rows: Row[] = []
  for (let from = 0; from < LIMIT; from += PAGE) {
    const take = Math.min(PAGE, LIMIT - from)
    const { data, error } = await supabase
      .from('import_records')
      .select('id, external_id, city, state, date_missing, date_found')
      .is('weather_fetched_at', null)
      .range(from, from + take - 1)
    if (error) { console.error('Fetch failed:', error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...(data as Row[]))
    if (data.length < take) break
  }
  return rows
}

interface DailySummary {
  date: string
  temp_max_f: number | null
  temp_min_f: number | null
  precip_in: number | null
  snow_in: number | null
  wind_max_mph: number | null
  weathercode: number | null
  severity: 'none' | 'mild' | 'notable' | 'severe'
  notes: string[]
}

// Open-Meteo / WMO weather codes:
//   0  clear sky
//   1-3  mainly clear / partly / overcast
//   45,48 fog
//   51-57  drizzle
//   61-65  rain (light/moderate/heavy)
//   66-67  freezing rain
//   71-75  snow (light/moderate/heavy)
//   77  snow grains
//   80-82 rain showers
//   85-86 snow showers
//   95-99 thunderstorms / hail
function classifySeverity(d: Omit<DailySummary, 'severity' | 'notes'>): { severity: DailySummary['severity']; notes: string[] } {
  const notes: string[] = []
  let weight = 0

  if (d.snow_in !== null && d.snow_in >= 6) { notes.push(`heavy snow (${d.snow_in.toFixed(1)} in)`); weight += 3 }
  else if (d.snow_in !== null && d.snow_in >= 2) { notes.push(`measurable snow (${d.snow_in.toFixed(1)} in)`); weight += 1 }

  if (d.precip_in !== null && d.precip_in >= 2) { notes.push(`heavy rain (${d.precip_in.toFixed(1)} in)`); weight += 2 }
  else if (d.precip_in !== null && d.precip_in >= 0.5) { notes.push(`steady rain (${d.precip_in.toFixed(1)} in)`); weight += 1 }

  if (d.wind_max_mph !== null && d.wind_max_mph >= 60) { notes.push(`hurricane-force wind (${Math.round(d.wind_max_mph)} mph)`); weight += 3 }
  else if (d.wind_max_mph !== null && d.wind_max_mph >= 35) { notes.push(`high wind (${Math.round(d.wind_max_mph)} mph)`); weight += 1 }

  if (d.temp_min_f !== null && d.temp_min_f <= 0) { notes.push(`subzero low (${Math.round(d.temp_min_f)}°F)`); weight += 2 }
  else if (d.temp_min_f !== null && d.temp_min_f <= 20) { notes.push(`hard freeze (${Math.round(d.temp_min_f)}°F)`); weight += 1 }

  if (d.weathercode !== null && d.weathercode >= 95) { notes.push('thunderstorm/hail'); weight += 2 }

  if (weight >= 3) return { severity: 'severe', notes }
  if (weight === 2) return { severity: 'notable', notes }
  if (weight === 1) return { severity: 'mild', notes }
  return { severity: 'none', notes }
}

async function fetchWeather(point: GeoPoint, dateISO: string): Promise<DailySummary | null> {
  const url = `${OPEN_METEO}?latitude=${point.lat}&longitude=${point.lng}&start_date=${dateISO}&end_date=${dateISO}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,windspeed_10m_max,weathercode&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&timezone=auto`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    const data = await res.json() as { daily?: Record<string, Array<number | null>> }
    const d = data.daily
    if (!d || !d.time || d.time.length === 0) return null
    const idx = 0
    const partial = {
      date: dateISO,
      temp_max_f: d.temperature_2m_max?.[idx] ?? null,
      temp_min_f: d.temperature_2m_min?.[idx] ?? null,
      precip_in: d.precipitation_sum?.[idx] ?? null,
      snow_in: d.snowfall_sum?.[idx] ?? null,
      wind_max_mph: d.windspeed_10m_max?.[idx] ?? null,
      weathercode: d.weathercode?.[idx] ?? null,
    }
    const { severity, notes } = classifySeverity(partial)
    return { ...partial, severity, notes }
  } catch {
    return null
  }
}

function dateForRecord(row: Row): string | null {
  const raw = row.date_missing ?? row.date_found
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  // Normalize to YYYY-MM-DD UTC.
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  // Open-Meteo Archive supports back to 1940; reject earlier dates.
  if (y < 1940) return null
  // Open-Meteo Archive lags ~5 days behind real time.
  const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() - 5)
  if (d > cutoff) return null
  return `${y}-${m}-${day}`
}

async function alreadyWeatherFlagged(): Promise<Set<string>> {
  const PAGE = 1000
  const seen = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from('intelligence_queue')
      .select('related_import_ids, details')
      .eq('queue_type', 'behavioral_pattern')
      .range(from, from + PAGE - 1)
    if (!data?.length) break
    for (const row of data as Array<{ related_import_ids: string[] | null; details: Record<string, unknown> | null }>) {
      if ((row.details ?? {} as Record<string, unknown>).kind !== 'severe_weather') continue
      for (const id of row.related_import_ids ?? []) seen.add(id)
    }
    if (data.length < PAGE) break
  }
  return seen
}

async function main() {
  console.log('=== Open-Meteo weather fetcher ===')
  console.log(`Limit: ${LIMIT}, flag severe: ${FLAG}`)

  const geo = await fetchGeocodes()
  console.log(`Geocodes loaded: ${geo.size}`)

  const targets = await fetchTargets()
  console.log(`Targets: ${targets.length}`)

  const flaggedAlready = FLAG ? await alreadyWeatherFlagged() : new Set<string>()

  let resolved = 0
  let stored = 0
  let severeFlagged = 0
  let skippedNoDate = 0
  let skippedNoGeo = 0
  let upstreamFailed = 0

  for (const row of targets) {
    resolved++
    const dateISO = dateForRecord(row)
    if (!dateISO) { skippedNoDate++; continue }
    if (!row.city || !row.state) { skippedNoGeo++; continue }
    const point = geo.get(`${row.city.toLowerCase()}|${row.state.toLowerCase()}`)
    if (!point) { skippedNoGeo++; continue }

    const summary = await fetchWeather(point, dateISO)
    if (!summary) {
      upstreamFailed++
      // Mark as fetched anyway so we do not retry every run.
      await supabase
        .from('import_records')
        .update({ weather_fetched_at: new Date().toISOString() } as never)
        .eq('id', row.id)
      await sleep(DELAY_MS)
      continue
    }

    const { error } = await supabase
      .from('import_records')
      .update({
        weather_at_event: summary,
        weather_fetched_at: new Date().toISOString(),
      } as never)
      .eq('id', row.id)
    if (error) {
      console.error(`  Update failed for ${row.external_id}: ${error.message}`)
    } else {
      stored++
    }

    if (FLAG && summary.severity === 'severe' && !flaggedAlready.has(row.id)) {
      const { error: flagErr } = await supabase
        .from('intelligence_queue')
        .insert({
          queue_type: 'behavioral_pattern',
          priority_score: 60,
          priority_grade: 'medium',
          title: `Severe weather at event: ${row.external_id} on ${dateISO}`,
          summary: `On ${dateISO} at the event location, conditions were severe: ${summary.notes.join(', ')}. Severe weather covers cases — witnesses are indoors, reports get delayed, search efforts are deferred. The investigation should account for it as a contemporaneous fact.`,
          details: {
            kind: 'severe_weather',
            import_record_id: row.id,
            weather: summary,
          },
          related_import_ids: [row.id],
          signal_count: summary.notes.length,
          ai_confidence: 0.6,
        })
      if (!flagErr) severeFlagged++
    }

    if (resolved % 25 === 0) console.log(`  ...${resolved} processed, ${stored} stored, ${severeFlagged} severe-flagged`)
    await sleep(DELAY_MS)
  }

  console.log('\n=== Done ===')
  console.log(`Processed: ${resolved}`)
  console.log(`Stored: ${stored}`)
  console.log(`Skipped (no date): ${skippedNoDate}`)
  console.log(`Skipped (no geocode): ${skippedNoGeo}`)
  console.log(`Upstream failed: ${upstreamFailed}`)
  if (FLAG) console.log(`Severe weather flagged: ${severeFlagged}`)
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
