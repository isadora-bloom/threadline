'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { labelForEntityType } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import {
  User,
  MapPin,
  Car,
  Phone,
  AtSign,
  Building,
  FileText,
  HelpCircle,
  AlertTriangle,
  Flag,
  Loader2,
  Navigation,
} from 'lucide-react'
import type { EntityWithClaimCount } from '@/lib/types'

function EntityIcon({ type }: { type: string }) {
  const icons: Record<string, React.ComponentType<{ className?: string }>> = {
    person: User,
    location: MapPin,
    vehicle: Car,
    phone: Phone,
    username: AtSign,
    organization: Building,
    document: FileText,
    other: HelpCircle,
  }
  const Icon = icons[type] ?? HelpCircle
  return <Icon className="h-4 w-4" />
}

function normStatusVariant(status: string): 'success' | 'warning' | 'info' | 'muted' | 'destructive' {
  const map: Record<string, 'success' | 'warning' | 'info' | 'muted' | 'destructive'> = {
    raw: 'muted',
    normalized: 'success',
    merged: 'info',
    flagged_ambiguous: 'warning',
  }
  return map[status] ?? 'muted'
}

interface EntityCardProps {
  entity: EntityWithClaimCount & {
    lat?: number | null
    lng?: number | null
    geocoded_at?: string | null
    geocode_source?: string | null
    nearest_highway?: string | null
    highway_proximity?: string | null
  }
  caseId: string
  onNormalize?: () => void
  onFlag?: () => void
}

export function EntityCard({ entity, caseId, onNormalize, onFlag }: EntityCardProps) {
  const { toast } = useToast()
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [isGeocoding, setIsGeocoding] = useState(false)

  const handleGeocode = async () => {
    const addressValue = entity.normalized_value ?? entity.raw_value
    if (!addressValue) return

    setIsGeocoding(true)
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addressValue }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? 'Geocoding failed')
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updatePayload: any = {
        lat: data.lat,
        lng: data.lng,
        geocoded_at: new Date().toISOString(),
        geocode_source: 'address_lookup',
      }

      const { error } = await supabase
        .from('entities')
        .update(updatePayload)
        .eq('id', entity.id)

      if (error) throw error

      toast({
        title: 'Geocoded',
        description: `Located at ${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}`,
      })

      queryClient.invalidateQueries({ queryKey: ['entities', caseId] })
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Geocoding failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setIsGeocoding(false)
    }
  }

  return (
    <Card className={`border-slate-200 hover:shadow-sm transition-shadow ${entity.flagged_for_review ? 'border-amber-200 bg-amber-50/20' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 flex-shrink-0 mt-0.5">
            <EntityIcon type={entity.entity_type} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-xs">
                {labelForEntityType(entity.entity_type)}
              </Badge>
              <Badge variant={normStatusVariant(entity.normalization_status) as never} className="text-xs capitalize">
                {entity.normalization_status.replace('_', ' ')}
              </Badge>
              {entity.flagged_for_review && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                  <Flag className="h-3 w-3" />
                  Flagged
                </span>
              )}
            </div>

            <p className="font-semibold text-slate-900 text-sm truncate">
              {entity.normalized_value ?? entity.raw_value}
            </p>

            {entity.normalized_value && entity.normalized_value !== entity.raw_value && (
              <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">
                Raw: {entity.raw_value}
              </p>
            )}

            {entity.aliases && entity.aliases.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {entity.aliases.slice(0, 3).map((alias, i) => (
                  <span key={i} className="text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">
                    {alias}
                  </span>
                ))}
                {entity.aliases.length > 3 && (
                  <span className="text-xs text-slate-400">+{entity.aliases.length - 3} more</span>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-slate-500">
                {entity.claim_count} {entity.claim_count === 1 ? 'claim' : 'claims'}
              </span>
            </div>

            {/* Geo data for location entities */}
            {entity.entity_type === 'location' && (
              <div className="mt-2 space-y-1">
                {entity.lat != null && entity.lng != null ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 font-mono">
                      {entity.lat.toFixed(4)}, {entity.lng.toFixed(4)}
                    </span>
                    {entity.nearest_highway && (
                      <Badge variant="outline" className="text-[10px]">
                        {entity.nearest_highway}
                        {entity.highway_proximity && (
                          <span className="ml-1 opacity-60">
                            {entity.highway_proximity === 'on_route' ? '· on route' :
                             entity.highway_proximity === 'near_route' ? '· near route' : ''}
                          </span>
                        )}
                      </Badge>
                    )}
                    <span className="text-[10px] text-slate-400">
                      {entity.geocode_source?.replace('_', ' ')}
                    </span>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs text-slate-500 hover:text-slate-700 px-2"
                    onClick={handleGeocode}
                    disabled={isGeocoding}
                  >
                    {isGeocoding ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Navigation className="h-3 w-3" />
                    )}
                    {isGeocoding ? 'Geocoding...' : 'Geocode'}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-1 flex-shrink-0">
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
              <Link href={`/cases/${caseId}/entities/${entity.id}`}>
                View
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
