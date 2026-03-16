import { cn } from '@/lib/utils'
import type { PatternGrade } from '@/lib/types'

const GRADE_STYLES: Record<string, { text: string; bg: string; pulse?: boolean }> = {
  weak: { text: 'text-slate-500', bg: 'bg-slate-100' },
  moderate: { text: 'text-blue-600', bg: 'bg-blue-50' },
  notable: { text: 'text-amber-600', bg: 'bg-amber-50' },
  strong: { text: 'text-orange-600', bg: 'bg-orange-50' },
  very_strong: { text: 'text-red-600', bg: 'bg-red-50', pulse: true },
}

const GRADE_LABELS: Record<string, string> = {
  weak: 'Weak',
  moderate: 'Moderate',
  notable: 'Notable',
  strong: 'Strong',
  very_strong: 'Very strong',
}

interface GradeBadgeProps {
  grade: string | null | undefined
  score?: number | null
  className?: string
}

export function GradeBadge({ grade, score, className }: GradeBadgeProps) {
  if (!grade) return null
  const style = GRADE_STYLES[grade] ?? GRADE_STYLES.weak
  const label = GRADE_LABELS[grade] ?? grade

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold',
        style.bg,
        style.text,
        className
      )}
    >
      {style.pulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
      )}
      {label}
      {score !== undefined && score !== null && (
        <span className="opacity-70">· {score}</span>
      )}
    </span>
  )
}
