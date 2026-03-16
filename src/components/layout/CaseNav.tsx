'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Inbox,
  FileText,
  Users,
  Download,
  ClipboardList,
  Settings,
  Brain,
  BarChart2,
} from 'lucide-react'
import { GlobalSearch } from '@/components/search/GlobalSearch'
import type { UserRole } from '@/lib/types'

interface CaseNavProps {
  caseId: string
  unreviewedCount?: number
  unreviewedPatternFlags?: number
  untriagedCount?: number
  userRole?: UserRole
  legalHold?: boolean
  caseTitle?: string
}

export function CaseNav({
  caseId,
  unreviewedCount = 0,
  unreviewedPatternFlags = 0,
  untriagedCount = 0,
  userRole,
  legalHold = false,
  caseTitle,
}: CaseNavProps) {
  const pathname = usePathname()
  const base = `/cases/${caseId}`

  const isLeadOrAdmin = userRole === 'lead_investigator' || userRole === 'admin'

  const links = [
    { href: base, label: 'Overview', icon: LayoutDashboard, exact: true },
    {
      href: `${base}/submissions`,
      label: 'Submissions',
      icon: Inbox,
      badge: untriagedCount > 0 ? untriagedCount : unreviewedCount,
    },
    { href: `${base}/claims`, label: 'Claims', icon: FileText },
    { href: `${base}/entities`, label: 'Entities', icon: Users },
    {
      href: `${base}/patterns`,
      label: 'Pattern Intelligence',
      icon: Brain,
      badge: unreviewedPatternFlags,
    },
    ...(isLeadOrAdmin ? [{
      href: `${base}/review-dashboard`,
      label: 'Review Dashboard',
      icon: BarChart2,
    }] : []),
    { href: `${base}/exports`, label: 'Exports', icon: Download },
    { href: `${base}/audit`, label: 'Audit Log', icon: ClipboardList },
    { href: `${base}/settings`, label: 'Settings', icon: Settings },
  ]

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="px-3 mb-2 flex items-center gap-2">
        <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
          {caseTitle ?? 'Case'}
        </p>
        {legalHold && (
          <span className="bg-red-600 text-white text-xs px-1.5 py-0.5 rounded font-bold leading-none">
            HOLD
          </span>
        )}
      </div>

      {/* Global search */}
      <GlobalSearch caseId={caseId} />

      <nav className="space-y-0.5 mt-2">
        {links.map((link) => {
          const isActive = link.exact
            ? pathname === link.href
            : pathname.startsWith(link.href)
          const Icon = link.icon

          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 flex-shrink-0" />
                {link.label}
              </span>
              {link.badge && link.badge > 0 ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                  {link.badge > 99 ? '99+' : link.badge}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
