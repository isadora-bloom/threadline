'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function AcceptTermsPage() {
  const router = useRouter()
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAccept = async () => {
    if (!checked) return
    setLoading(true)
    setError(null)

    const res = await fetch('/api/accept-terms', { method: 'POST' })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Something went wrong. Please try again.')
      setLoading(false)
      return
    }

    // Hard redirect so middleware re-reads the updated user metadata
    window.location.href = '/cases'
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-600 mb-4">
            <span className="text-xl font-bold text-white">TL</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Before you continue</h1>
          <p className="mt-2 text-sm text-slate-500">
            Please read and accept the terms of use.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-6 mb-6 space-y-4">

          {/* The mandatory paragraph — verbatim */}
          <div className="rounded-md border border-slate-300 bg-slate-50 p-4 text-sm text-slate-800 leading-relaxed">
            Threadline is a tool for organizing and reviewing information submitted by others. It
            does not draw conclusions, make accusations, or verify the accuracy of any information
            submitted to it. All information on this platform is unverified unless explicitly
            marked otherwise. Users agree not to use information accessed through this platform to
            contact, confront, publicly identify, or take any action against any individual.
            Threadline is not responsible for the actions of users who violate these terms.
          </div>

          <div className="text-sm text-slate-700 space-y-2">
            <p>By using this platform you also agree that you will not:</p>
            <ul className="list-disc list-inside space-y-1 text-slate-600 ml-2">
              <li>Share information outside authorized channels without case lead approval</li>
              <li>Present pattern flags or system suggestions as confirmed facts</li>
              <li>Attempt to identify anonymous or confidential submitters</li>
              <li>Use the platform for any purpose other than legitimate investigative, journalistic, legal, or advocacy work</li>
            </ul>
          </div>

          <p className="text-sm text-slate-500">
            Read the{' '}
            <Link href="/terms" target="_blank" className="text-indigo-600 hover:underline">
              full terms of use
            </Link>
            .
          </p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="accept"
              checked={checked}
              onCheckedChange={(val) => setChecked(val === true)}
              className="mt-0.5"
            />
            <Label htmlFor="accept" className="text-sm text-slate-700 leading-relaxed cursor-pointer">
              I have read and agree to the terms of use. I understand that all information on this
              platform is unverified unless explicitly marked otherwise, and I will not use it to
              take any action against any individual.
            </Label>
          </div>
        </div>

        <Button
          className="w-full"
          disabled={!checked || loading}
          onClick={handleAccept}
        >
          {loading ? 'Saving...' : 'Accept and continue'}
        </Button>

      </div>
    </div>
  )
}
