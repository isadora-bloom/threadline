'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download, Loader2 } from 'lucide-react'

/**
 * Triggers a download of the per-record dossier as a Markdown file.
 * The endpoint streams the file with Content-Disposition: attachment, but the
 * browser still needs a click target. We use fetch + blob so the user does
 * not navigate away, and so a stale auth cookie surfaces as a clear error
 * rather than redirecting them to the login page mid-download.
 */
export function DossierButton({ recordId }: { recordId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handle = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/registry/${recordId}/dossier`)
      if (!res.ok) {
        throw new Error(`Download failed (${res.status})`)
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `threadline-dossier-${recordId}.md`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke later so the browser has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handle}
        disabled={loading}
        type="button"
        title="Download a Markdown dossier of everything Threadline knows about this person"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {loading ? 'Building…' : 'Dossier'}
      </Button>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  )
}
