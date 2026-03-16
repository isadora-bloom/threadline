import { cn } from '@/lib/utils'
import type { LinkSignals } from '@/lib/types'

const SIGNAL_LABELS: Record<string, string> = {
  independent_sources: 'Independent sources',
  geo_proximity_5mi: 'Geographic proximity (<5 mi)',
  geo_proximity_15mi: 'Geographic proximity (<15 mi)',
  geo_proximity_radius: 'Geographic proximity (within radius)',
  time_same_day: 'Same day',
  time_3_days: 'Within 3 days',
  time_2_weeks: 'Within 2 weeks',
  time_90_days: 'Within 90 days',
  shared_phone: 'Shared phone entity',
  shared_vehicle_entity: 'Shared vehicle entity',
  same_claim_type: 'Same claim type',
  low_content_confidence_penalty: 'Low content confidence (penalty)',
}

const META_KEYS = new Set(['distance_miles', 'days_apart'])

interface SignalsBreakdownProps {
  signals: Record<string, unknown>
  distanceMiles?: number | null
}

export function SignalsBreakdown({ signals, distanceMiles }: SignalsBreakdownProps) {
  const entries = Object.entries(signals).filter(([k]) => !META_KEYS.has(k))
  if (entries.length === 0) return null

  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => {
        const points = typeof value === 'number' ? value : 0
        const isNegative = points < 0
        const label = SIGNAL_LABELS[key] ?? key.replace(/_/g, ' ')

        return (
          <div key={key} className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                isNegative
                  ? 'bg-red-50 text-red-600 border border-red-100'
                  : 'bg-slate-100 text-slate-600 border border-slate-200'
              )}
            >
              {label}
              {key === 'geo_proximity_5mi' && distanceMiles != null && (
                <span className="ml-1 opacity-60">{distanceMiles.toFixed(1)} mi</span>
              )}
              {key === 'geo_proximity_15mi' && distanceMiles != null && (
                <span className="ml-1 opacity-60">{distanceMiles.toFixed(1)} mi</span>
              )}
              {key === 'geo_proximity_radius' && distanceMiles != null && (
                <span className="ml-1 opacity-60">{distanceMiles.toFixed(1)} mi</span>
              )}
              {key === 'time_3_days' && typeof signals.days_apart === 'number' && (
                <span className="ml-1 opacity-60">{signals.days_apart.toFixed(1)}d apart</span>
              )}
              {key === 'time_2_weeks' && typeof signals.days_apart === 'number' && (
                <span className="ml-1 opacity-60">{signals.days_apart.toFixed(1)}d apart</span>
              )}
              {key === 'time_90_days' && typeof signals.days_apart === 'number' && (
                <span className="ml-1 opacity-60">{signals.days_apart.toFixed(1)}d apart</span>
              )}
            </span>
            <span
              className={cn(
                'text-xs font-mono font-semibold flex-shrink-0',
                isNegative ? 'text-red-500' : 'text-slate-500'
              )}
            >
              {points > 0 ? `+${points}` : points}
            </span>
          </div>
        )
      })}
    </div>
  )
}
