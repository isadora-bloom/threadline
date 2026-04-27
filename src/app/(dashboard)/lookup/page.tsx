import { redirect } from 'next/navigation'

/**
 * /lookup is now a thin redirect into /registry.
 *
 * The audit flagged that having both a "Search" and a "Browse All Cases"
 * page meant two different search UIs with different filter capabilities for
 * the same goal. /registry has the richer filter set (name, city, state,
 * sex, type) and /lookup added nothing /registry did not already cover, so
 * we collapse to one entry point. Existing links (?q=...) are preserved.
 */
export default async function LookupRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = params.q ?? params.search ?? params.query
  const q = Array.isArray(raw) ? raw[0] : raw
  if (q) redirect(`/registry?q=${encodeURIComponent(q)}`)
  redirect('/registry')
}
