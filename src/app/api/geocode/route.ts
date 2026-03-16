import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Nominatim geocoding — OpenStreetMap, free, no key required
// Rate limit: 1 request/second per Nominatim usage policy

let lastRequestTime = 0

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { address?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { address } = body
  if (!address || typeof address !== 'string' || !address.trim()) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 })
  }

  // Respect Nominatim's 1 request/second rate limit
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed))
  }
  lastRequestTime = Date.now()

  const params = new URLSearchParams({
    q: address.trim(),
    format: 'json',
    limit: '1',
    addressdetails: '1',
  })

  let nominatimResponse: Response
  try {
    nominatimResponse = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          'User-Agent': 'Threadline/1.0',
          'Accept-Language': 'en',
        },
      }
    )
  } catch (err) {
    return NextResponse.json({ error: 'Failed to reach geocoding service' }, { status: 502 })
  }

  if (!nominatimResponse.ok) {
    return NextResponse.json(
      { error: `Geocoding service returned ${nominatimResponse.status}` },
      { status: 502 }
    )
  }

  let results: Array<{
    lat: string
    lon: string
    display_name: string
  }>

  try {
    results = await nominatimResponse.json()
  } catch {
    return NextResponse.json({ error: 'Invalid response from geocoding service' }, { status: 502 })
  }

  if (!results || results.length === 0) {
    return NextResponse.json({ error: 'No results found for this address' }, { status: 404 })
  }

  const top = results[0]

  return NextResponse.json({
    lat: parseFloat(top.lat),
    lng: parseFloat(top.lon),
    display_name: top.display_name,
  })
}
