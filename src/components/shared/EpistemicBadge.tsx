import { CheckCircle, AlertTriangle, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

export type EpistemicType = 'fact' | 'claim' | 'inference'

interface EpistemicBadgeProps {
  type: EpistemicType
  className?: string
}

export function EpistemicBadge({ type, className }: EpistemicBadgeProps) {
  if (type === 'fact') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold tracking-wide',
          'bg-slate-900 text-white border border-slate-900',
          className
        )}
      >
        <CheckCircle className="h-3 w-3" />
        CONFIRMED
      </span>
    )
  }

  if (type === 'inference') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold tracking-wide',
          'bg-amber-50 border-2 border-dashed border-amber-400 text-amber-700',
          className
        )}
      >
        <AlertTriangle className="h-3 w-3" />
        POSSIBLE CONNECTION
      </span>
    )
  }

  // default: claim
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold tracking-wide',
        'bg-white border-2 border-slate-400 text-slate-600',
        className
      )}
    >
      <FileText className="h-3 w-3" />
      REPORTED
    </span>
  )
}

/**
 * Determine the epistemic type from claim flags.
 * A claim is a 'fact' only if confirmed AND official type.
 * A claim is an 'inference' if interpretation_flag is true.
 * Otherwise it's a plain 'claim'.
 */
export function getEpistemicType(
  verificationStatus: string,
  claimType: string,
  interpretationFlag: boolean
): EpistemicType {
  if (interpretationFlag) return 'inference'
  if (verificationStatus === 'confirmed' && claimType === 'official') return 'fact'
  return 'claim'
}
