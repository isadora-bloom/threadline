import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/photo-proxy?url=<encoded source URL>
 *
 * Streams an image from a whitelisted source through Threadline. Two reasons
 * we proxy rather than hot-link:
 *
 *   1. NamUs serves images with strict CORS / Referer policies; loading a
 *      <img src="https://www.namus.gov/..."> from threadline.app may break.
 *   2. Going through us means we control the User-Agent and can cache.
 *
 * Only URLs starting with the namus.gov image API path are allowed —
 * accepting arbitrary URLs would turn this into an open SSRF.
 */

const ALLOWED_PREFIXES = [
  'https://www.namus.gov/api/CaseSets/NamUs/',
]

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const FETCH_TIMEOUT_MS = 12_000

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('url')
  if (!target) return NextResponse.json({ error: 'url required' }, { status: 400 })

  if (!ALLOWED_PREFIXES.some(prefix => target.startsWith(prefix))) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 })
  }

  let res: Response
  try {
    res = await fetch(target, {
      headers: {
        'User-Agent': 'Threadline Case Intelligence Platform - public interest research (threadline.app)',
        'Accept': 'image/*',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    return NextResponse.json({ error: 'upstream fetch failed' }, { status: 502 })
  }

  if (!res.ok) {
    return NextResponse.json({ error: `upstream ${res.status}` }, { status: res.status === 404 ? 404 : 502 })
  }

  const contentType = res.headers.get('Content-Type') ?? 'image/jpeg'
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'upstream returned non-image' }, { status: 502 })
  }

  // Buffer the response so we can enforce the size cap. Image responses are
  // small enough that streaming is not worth the complexity here.
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'image too large' }, { status: 502 })
  }

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buf.byteLength),
      // Cache aggressively — these images do not change.
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
    },
  })
}
