import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV === 'development'

const ContentSecurityPolicy = [
  "default-src 'self'",
  // Supabase
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.resend.com`,
  // Mapbox
  `script-src 'self' ${isDev ? "'unsafe-eval'" : ''} 'unsafe-inline' https://api.mapbox.com`,
  `worker-src blob:`,
  `child-src blob:`,
  `img-src 'self' data: blob: https://*.supabase.co https://*.mapbox.com`,
  `style-src 'self' 'unsafe-inline' https://api.mapbox.com https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com`,
  `frame-ancestors 'none'`,
  `form-action 'self'`,
  `base-uri 'self'`,
].join('; ')

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
  },
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy,
  },
]

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
