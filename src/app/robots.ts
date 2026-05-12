import type { MetadataRoute } from 'next'

// Conservative stance: registry data is sourced from NamUs, Doe Network, Charley Project
// and contains case details for missing persons. Until an access model is decided, allow
// only the public marketing surface and explicitly block the dashboard, registry, case
// detail, and submission token routes from any crawler.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/landing', '/terms', '/privacy'],
        disallow: ['/api/', '/cases', '/registry', '/submit/', '/login', '/intelligence'],
      },
      // Be extra explicit with AI training crawlers — case data should not be ingested
      // into general LLM training corpora without an upstream-source decision.
      { userAgent: 'GPTBot', disallow: '/' },
      { userAgent: 'ClaudeBot', disallow: '/' },
      { userAgent: 'anthropic-ai', disallow: '/' },
      { userAgent: 'CCBot', disallow: '/' },
      { userAgent: 'PerplexityBot', disallow: '/' },
      { userAgent: 'Google-Extended', disallow: '/' },
    ],
    sitemap: 'https://threadline.app/sitemap.xml',
  }
}
