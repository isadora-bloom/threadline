import { cn } from '@/lib/utils'
import type { ConfidenceLevel } from '@/lib/types'

interface ConfidenceBadgeProps {
  sourceConfidence: ConfidenceLevel
  contentConfidence: ConfidenceLevel
  layout?: 'horizontal' | 'stacked'
  className?: string
}

function confidenceColors(level: ConfidenceLevel) {
  const map: Record<ConfidenceLevel, string> = {
    low: 'bg-red-100 text-red-700',
    medium: 'bg-yellow-100 text-yellow-700',
    high: 'bg-green-100 text-green-700',
  }
  return map[level]
}

function ConfidencePill({ label, level }: { label: string; level: ConfidenceLevel }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide leading-none">
        {label}
      </span>
      <span
        className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold',
          confidenceColors(level)
        )}
      >
        {level.charAt(0).toUpperCase() + level.slice(1)}
      </span>
    </span>
  )
}

/**
 * ALWAYS displays source_confidence and content_confidence as two SEPARATE indicators.
 * These are fundamentally different and must never be conflated.
 * - Source reliability: how trustworthy is the person reporting
 * - Claim certainty: how precise/certain is this particular claim
 */
export function ConfidenceBadge({
  sourceConfidence,
  contentConfidence,
  layout = 'horizontal',
  className,
}: ConfidenceBadgeProps) {
  return (
    <div
      className={cn(
        'flex gap-3',
        layout === 'stacked' ? 'flex-col' : 'flex-row items-start',
        className
      )}
    >
      <ConfidencePill label="Source reliability" level={sourceConfidence} />
      <ConfidencePill label="Claim certainty" level={contentConfidence} />
    </div>
  )
}
