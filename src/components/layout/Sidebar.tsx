'use client'

import Link from 'next/link'
import { usePathname, useParams, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Briefcase, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { CaseNav } from './CaseNav'
import { QuickCapture } from '@/components/submissions/QuickCapture'
import { useQuery } from '@tanstack/react-query'

export function Sidebar() {
  const pathname = usePathname()
  const params = useParams()
  const router = useRouter()
  const supabase = createClient()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userInitials, setUserInitials] = useState('U')

  const caseId = params?.caseId as string | undefined

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserEmail(data.user.email ?? null)
        const email = data.user.email ?? ''
        setUserInitials(email.slice(0, 2).toUpperCase())
      }
    })
  }, [supabase])

  // Fetch unreviewed count and untriaged count for case nav badges
  const { data: unreviewedCount } = useQuery({
    queryKey: ['unreviewed-count', caseId],
    queryFn: async () => {
      if (!caseId) return 0
      const { count } = await supabase
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('case_id', caseId)
        .eq('review_status', 'unverified')
      return count ?? 0
    },
    enabled: !!caseId,
  })

  const { data: untriagedCount } = useQuery({
    queryKey: ['untriaged-count', caseId],
    queryFn: async () => {
      if (!caseId) return 0
      const { count } = await supabase
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('case_id', caseId)
        .eq('triage_status', 'untriaged')
      return count ?? 0
    },
    enabled: !!caseId,
  })

  const { data: userRoleData } = useQuery({
    queryKey: ['my-role', caseId],
    queryFn: async () => {
      if (!caseId) return null
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data } = await supabase
        .from('case_user_roles')
        .select('role')
        .eq('case_id', caseId)
        .eq('user_id', user.id)
        .single()
      return data?.role ?? null
    },
    enabled: !!caseId,
  })

  const { data: caseData } = useQuery({
    queryKey: ['case-nav-meta', caseId],
    queryFn: async () => {
      if (!caseId) return null
      const { data } = await supabase
        .from('cases')
        .select('title, legal_hold')
        .eq('id', caseId)
        .single()
      return data
    },
    enabled: !!caseId,
  })

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const mainLinks = [
    { href: '/cases', label: 'My Cases', icon: Briefcase },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-slate-200">
        <Link href="/cases" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-indigo-600">
            <span className="text-xs font-bold text-white">TL</span>
          </div>
          <span className="text-lg font-bold text-slate-900 tracking-tight">Threadline</span>
        </Link>
      </div>

      {/* Quick Capture */}
      <div className="px-3 py-3 border-b border-slate-100">
        <QuickCapture caseId={caseId} />
      </div>

      {/* Main navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <nav className="space-y-0.5">
          {mainLinks.map((link) => {
            const isActive = pathname.startsWith(link.href) && !caseId
            const Icon = link.icon
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {link.label}
              </Link>
            )
          })}
        </nav>

        {/* Case-specific navigation */}
        {caseId && (
          <CaseNav
            caseId={caseId}
            unreviewedCount={unreviewedCount ?? 0}
            untriagedCount={untriagedCount ?? 0}
            userRole={userRoleData ?? undefined}
            legalHold={caseData?.legal_hold ?? false}
            caseTitle={caseData?.title ?? undefined}
          />
        )}
      </div>

      {/* User section */}
      <div className="border-t border-slate-200 p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 truncate">{userEmail}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            className="h-7 w-7 text-slate-400 hover:text-slate-700"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
