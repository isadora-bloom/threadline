import type { MetadataRoute } from 'next'

// Only the public marketing surface is indexed. Registry / cases / submit routes
// are auth-gated and excluded.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://threadline.app'
  const now = new Date()
  return [
    { url: `${base}/landing`,  lastModified: now, changeFrequency: 'monthly', priority: 1.0 },
    { url: `${base}/terms`,    lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${base}/privacy`,  lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
  ]
}
