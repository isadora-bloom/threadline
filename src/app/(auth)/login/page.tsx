'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Mail, CheckCircle, Eye, EyeOff } from 'lucide-react'

type Mode = 'password' | 'magic' | 'reset'

export default function LoginPage() {
  const supabase = createClient()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)
    if (error) {
      const msg = error.message
      setError(
        msg === 'Invalid login credentials'
          ? 'Incorrect email or password.'
          : (!msg || msg === '{}' || msg === 'Failed to fetch')
          ? 'Unable to connect. Please try again in a moment.'
          : msg
      )
    } else {
      window.location.href = '/'
    }
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    setLoading(false)
    if (error) setError(!error.message || error.message === '{}' ? 'Unable to connect. Please try again in a moment.' : error.message)
    else setSent(true)
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset`,
    })

    setLoading(false)
    if (error) setError(!error.message || error.message === '{}' ? 'Unable to connect. Please try again in a moment.' : error.message)
    else setSent(true)
  }

  const titles: Record<Mode, string> = {
    password: 'Sign in',
    magic: 'Sign in with email link',
    reset: 'Reset your password',
  }

  const descriptions: Record<Mode, string> = {
    password: 'Enter your email and password.',
    magic: 'We\'ll send a sign-in link to your inbox.',
    reset: 'We\'ll send a password reset link to your inbox.',
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-600 mb-4">
              <span className="text-xl font-bold text-white">TL</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Threadline</h1>
          </div>
          <Card>
            <CardContent className="pt-6 text-center">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <h3 className="font-semibold text-slate-900 mb-1">Check your email</h3>
              <p className="text-sm text-slate-600">
                We sent a link to <strong>{email}</strong>. It expires in 1 hour.
              </p>
              <button
                onClick={() => { setSent(false); setError(null) }}
                className="mt-4 text-sm text-indigo-600 hover:underline"
              >
                Use a different email
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-600 mb-4">
            <span className="text-xl font-bold text-white">TL</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Threadline</h1>
          <p className="mt-2 text-sm text-slate-500 max-w-xs mx-auto">
            Case intelligence for the people who refuse to give up.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{titles[mode]}</CardTitle>
            <CardDescription>{descriptions[mode]}</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {mode === 'password' && (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@organization.org"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign in'}
                </Button>
                <div className="flex items-center justify-between text-sm pt-1">
                  <button
                    type="button"
                    onClick={() => { setMode('reset'); setError(null) }}
                    className="text-slate-500 hover:text-slate-700 hover:underline"
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('magic'); setError(null) }}
                    className="text-indigo-600 hover:underline"
                  >
                    Use email link instead
                  </button>
                </div>
              </form>
            )}

            {mode === 'magic' && (
              <form onSubmit={handleMagicLink} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email-magic">Email</Label>
                  <Input
                    id="email-magic"
                    type="email"
                    placeholder="you@organization.org"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Sending...' : (
                    <><Mail className="h-4 w-4" /> Send magic link</>
                  )}
                </Button>
                <button
                  type="button"
                  onClick={() => { setMode('password'); setError(null) }}
                  className="w-full text-sm text-slate-500 hover:text-slate-700 hover:underline"
                >
                  Use password instead
                </button>
              </form>
            )}

            {mode === 'reset' && (
              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email-reset">Email</Label>
                  <Input
                    id="email-reset"
                    type="email"
                    placeholder="you@organization.org"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Sending...' : 'Send reset link'}
                </Button>
                <button
                  type="button"
                  onClick={() => { setMode('password'); setError(null) }}
                  className="w-full text-sm text-slate-500 hover:text-slate-700 hover:underline"
                >
                  Back to sign in
                </button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-slate-400">
          Access is by invitation only. Contact your case lead for access.
        </p>
      </div>
    </div>
  )
}
