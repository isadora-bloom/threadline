'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { labelForUserRole } from '@/lib/utils'
import type { UserRole } from '@/lib/types'

interface AcceptInvitationClientProps {
  token: string
  caseId: string
  caseTitle: string
  role: UserRole
  email: string
}

export function AcceptInvitationClient({
  token,
  caseId,
  caseTitle,
  role,
  email,
}: AcceptInvitationClientProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAccept = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to accept invitation')
        setLoading(false)
        return
      }

      router.push(`/cases/${caseId}`)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md w-full bg-white rounded-lg border border-slate-200 p-8">
      <div className="flex h-10 w-10 items-center justify-center rounded bg-indigo-600 mb-6">
        <span className="text-sm font-bold text-white">TL</span>
      </div>

      <h1 className="text-xl font-bold text-slate-900 mb-1">You&apos;ve been invited</h1>
      <p className="text-sm text-slate-500 mb-6">
        You&apos;ve been invited to join{' '}
        <span className="font-medium text-slate-700">{caseTitle}</span>{' '}
        as a{' '}
        <span className="font-medium text-indigo-700">{labelForUserRole(role)}</span>.
      </p>

      <div className="bg-slate-50 rounded-md border border-slate-200 p-3 mb-6 text-sm text-slate-600">
        <span className="font-medium">Invitation sent to:</span> {email}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      <Button onClick={handleAccept} disabled={loading} className="w-full">
        {loading ? 'Accepting...' : 'Accept invitation & join case'}
      </Button>

      <p className="mt-4 text-xs text-center text-slate-400">
        By accepting, you agree to handle all case data with appropriate care.
      </p>
    </div>
  )
}
