import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { pathname } = request.nextUrl

  // Public routes — no auth required
  const publicRoutes = ['/login', '/auth/callback', '/terms', '/accept-terms', '/privacy']
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))
  const isSubmitRoute = pathname.startsWith('/submit/')
  const isApiSubmitRoute = pathname.startsWith('/api/submit')
  const isApiRoute = pathname.startsWith('/api/')

  // Rate limit public submission routes (submit page POST and /api/submit POST)
  if ((isSubmitRoute || isApiSubmitRoute) && request.method === 'POST') {
    // Only rate-limit if Upstash is configured
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      try {
        const ratelimit = new Ratelimit({
          redis: Redis.fromEnv(),
          limiter: Ratelimit.slidingWindow(10, '1 h'),
          prefix: 'threadline_submit',
        })
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          ?? request.headers.get('x-real-ip')
          ?? '127.0.0.1'
        const { success, limit, remaining, reset } = await ratelimit.limit(ip)
        if (!success) {
          return new NextResponse(
            JSON.stringify({ error: 'Too many submissions from this IP. Please try again later.' }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'X-RateLimit-Limit': String(limit),
                'X-RateLimit-Remaining': String(remaining),
                'X-RateLimit-Reset': String(reset),
                'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
              },
            }
          )
        }
      } catch (err) {
        // Rate limiting failure should never block a submission — log and continue
        console.warn('Rate limit check failed (degrading gracefully):', err)
      }
    } else {
      // Upstash not configured — skip rate limiting (local dev)
    }
  }

  if (isPublicRoute || isSubmitRoute || isApiRoute) {
    return supabaseResponse
  }

  // Refresh session if expired — required for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Dashboard routes require auth
  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Require ToS acceptance — checked via user_metadata to avoid extra DB query
  const CURRENT_TOS_VERSION = '2026-03'
  const tosVersion = user.user_metadata?.tos_accepted_version
  if (tosVersion !== CURRENT_TOS_VERSION) {
    const tosUrl = request.nextUrl.clone()
    tosUrl.pathname = '/accept-terms'
    return NextResponse.redirect(tosUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
