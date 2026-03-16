'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MapPin, Loader2, AlertTriangle, Navigation } from 'lucide-react'
import type { Entity, CorridorReferencePoint } from '@/lib/types'

interface CorridorViewProps {
  caseId: string
}

type LocationEntity = Entity & {
  lat: number
  lng: number
  nearest_highway: string | null
  highway_proximity: string | null
  claim_count?: number
}

interface EntityPopupData {
  entity: LocationEntity
  claims: Array<{ id: string; extracted_text: string }>
}

// Mapbox GL JS is imported dynamically to avoid SSR issues
let mapboxgl: typeof import('mapbox-gl') | null = null

export function CorridorView({ caseId }: CorridorViewProps) {
  const supabase = createClient()
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('mapbox-gl').Map | null>(null)
  const markersRef = useRef<import('mapbox-gl').Marker[]>([])
  const [mapLoaded, setMapLoaded] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [selectedEntity, setSelectedEntity] = useState<EntityPopupData | null>(null)
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false)

  const { data: locationEntities, isLoading: entitiesLoading } = useQuery({
    queryKey: ['corridor-entities', caseId],
    queryFn: async (): Promise<LocationEntity[]> => {
      const { data, error } = await supabase
        .from('entities')
        .select('*')
        .eq('case_id', caseId)
        .eq('entity_type', 'location')
        .not('lat', 'is', null)
        .not('lng', 'is', null)

      if (error) throw error

      // Fetch claim counts
      const entityIds = (data ?? []).map((e) => e.id)
      if (entityIds.length === 0) return []

      const { data: linkData } = await supabase
        .from('claim_entity_links')
        .select('entity_id')
        .in('entity_id', entityIds)

      const claimCounts = new Map<string, number>()
      for (const link of linkData ?? []) {
        claimCounts.set(link.entity_id, (claimCounts.get(link.entity_id) ?? 0) + 1)
      }

      return (data ?? []).map((e) => ({
        ...(e as LocationEntity),
        claim_count: claimCounts.get(e.id) ?? 0,
      }))
    },
  })

  const { data: corridorPoints } = useQuery({
    queryKey: ['corridor-reference-points'],
    queryFn: async (): Promise<CorridorReferencePoint[]> => {
      const { data, error } = await supabase
        .from('corridor_reference_points')
        .select('*')

      if (error) throw error
      return data ?? []
    },
  })

  const fetchEntityClaims = useCallback(
    async (entityId: string) => {
      const { data } = await supabase
        .from('claim_entity_links')
        .select('claim_id')
        .eq('entity_id', entityId)

      const claimIds = (data ?? []).map((l) => l.claim_id)
      if (claimIds.length === 0) return []

      const { data: claims } = await supabase
        .from('claims')
        .select('id, extracted_text')
        .in('id', claimIds)
        .limit(5)

      return claims ?? []
    },
    [supabase]
  )

  // Initialize Mapbox
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token) {
      setMapError('Mapbox token not configured. Add NEXT_PUBLIC_MAPBOX_TOKEN to your environment.')
      return
    }

    import('mapbox-gl').then((mb) => {
      mapboxgl = mb.default as unknown as typeof import('mapbox-gl')
      ;(mapboxgl as unknown as { accessToken: string }).accessToken = token

      if (!mapContainerRef.current) return

      const map = new (mapboxgl as unknown as { Map: new (opts: unknown) => import('mapbox-gl').Map }).Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [-98.5, 39.5],
        zoom: 4,
      })

      map.on('load', () => {
        setMapLoaded(true)
      })

      map.on('error', (e: { error?: { message?: string } }) => {
        setMapError(e?.error?.message ?? 'Map failed to load')
      })

      mapRef.current = map
    }).catch(() => {
      setMapError('Failed to load mapping library. Ensure mapbox-gl is installed.')
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Add markers when entities load and map is ready
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !locationEntities) return
    if (!mapboxgl) return

    // Clear existing markers
    for (const m of markersRef.current) m.remove()
    markersRef.current = []

    const bounds = new (mapboxgl as unknown as { LngLatBounds: new () => import('mapbox-gl').LngLatBounds }).LngLatBounds()
    let hasBounds = false

    // Add location entity markers
    for (const entity of locationEntities) {
      if (entity.lat == null || entity.lng == null) continue

      const el = document.createElement('div')
      el.className = 'cursor-pointer'

      const proximityColor =
        entity.highway_proximity === 'on_route'
          ? '#f97316'
          : entity.highway_proximity === 'near_route'
          ? '#eab308'
          : '#6366f1'

      el.innerHTML = `
        <div style="
          width: 28px; height: 28px; border-radius: 50%;
          background: ${proximityColor};
          border: 2px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          display: flex; align-items: center; justify-content: center;
          color: white; font-size: 11px; font-weight: bold;
        ">
          ${entity.claim_count ?? 0}
        </div>
      `

      const marker = new (mapboxgl as unknown as {
        Marker: new (opts: { element: HTMLElement }) => import('mapbox-gl').Marker
      }).Marker({ element: el })
        .setLngLat([entity.lng, entity.lat])
        .addTo(mapRef.current!)

      el.addEventListener('click', async () => {
        const claims = await fetchEntityClaims(entity.id)
        setSelectedEntity({ entity, claims })
      })

      markersRef.current.push(marker)
      bounds.extend([entity.lng, entity.lat])
      hasBounds = true
    }

    // Add corridor reference point markers
    for (const cp of corridorPoints ?? []) {
      const el = document.createElement('div')
      const iconMap: Record<string, string> = {
        truck_stop: '🚛',
        rest_area: '🛑',
        weigh_station: '⚖️',
        known_location: '📍',
      }

      el.innerHTML = `
        <div style="
          font-size: 20px; cursor: default;
          filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
        " title="${cp.name}">
          ${iconMap[cp.point_type] ?? '📌'}
        </div>
      `

      const marker = new (mapboxgl as unknown as {
        Marker: new (opts: { element: HTMLElement }) => import('mapbox-gl').Marker
      }).Marker({ element: el })
        .setLngLat([cp.lng, cp.lat])
        .addTo(mapRef.current!)

      markersRef.current.push(marker)
      bounds.extend([cp.lng, cp.lat])
      hasBounds = true
    }

    // Draw corridor lines by grouping entities by highway
    if (mapRef.current && locationEntities.length > 1) {
      const highwayGroups = new Map<string, LocationEntity[]>()
      for (const e of locationEntities) {
        if (e.nearest_highway && e.highway_proximity === 'on_route') {
          if (!highwayGroups.has(e.nearest_highway)) {
            highwayGroups.set(e.nearest_highway, [])
          }
          highwayGroups.get(e.nearest_highway)!.push(e)
        }
      }

      for (const [highway, entities] of highwayGroups) {
        if (entities.length < 2) continue
        const sorted = [...entities].sort((a, b) => a.lng - b.lng)
        const sourceId = `corridor-${highway.replace(/\s+/g, '-')}`

        if (mapRef.current.getSource(sourceId)) {
          mapRef.current.removeLayer(`${sourceId}-line`)
          mapRef.current.removeSource(sourceId)
        }

        mapRef.current.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: { highway },
            geometry: {
              type: 'LineString',
              coordinates: sorted.map((e) => [e.lng, e.lat]),
            },
          },
        })

        mapRef.current.addLayer({
          id: `${sourceId}-line`,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#f97316',
            'line-width': 2,
            'line-dasharray': [2, 2],
            'line-opacity': 0.7,
          },
        })
      }
    }

    if (hasBounds && mapRef.current) {
      mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 10 })
    }
  }, [mapLoaded, locationEntities, corridorPoints, fetchEntityClaims])

  const handleRunAnalysis = async () => {
    setIsRunningAnalysis(true)
    try {
      await fetch('/api/pattern/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId }),
      })
    } finally {
      setIsRunningAnalysis(false)
    }
  }

  if (mapError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-400" />
        <p className="text-sm font-medium text-slate-700">Map unavailable</p>
        <p className="text-xs text-slate-500 max-w-sm">{mapError}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full bg-orange-500" />
            On-route entity
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full bg-yellow-500" />
            Near-route entity
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded-full bg-indigo-500" />
            Off-route entity
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRunAnalysis}
          disabled={isRunningAnalysis}
        >
          {isRunningAnalysis ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Navigation className="h-4 w-4" />
          )}
          Run corridor analysis
        </Button>
      </div>

      <div className="flex gap-4">
        {/* Map */}
        <div className="flex-1 min-h-0">
          <div className="relative rounded-lg overflow-hidden border border-slate-200" style={{ height: '480px' }}>
            {(entitiesLoading || !mapLoaded) && (
              <div className="absolute inset-0 bg-slate-100 flex items-center justify-center z-10">
                <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
              </div>
            )}
            <div ref={mapContainerRef} className="w-full h-full" />
          </div>

          {(!locationEntities || locationEntities.length === 0) && mapLoaded && (
            <div className="mt-3 text-center text-sm text-slate-400">
              <MapPin className="h-5 w-5 mx-auto mb-1 text-slate-300" />
              No geocoded location entities yet. Geocode entities to see them on the map.
            </div>
          )}
        </div>

        {/* Entity detail panel */}
        {selectedEntity && (
          <Card className="w-72 flex-shrink-0 border-slate-200">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">
                    {selectedEntity.entity.normalized_value ?? selectedEntity.entity.raw_value}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Location entity</p>
                </div>
                <button
                  onClick={() => setSelectedEntity(null)}
                  className="text-slate-300 hover:text-slate-500 text-lg leading-none"
                >
                  ×
                </button>
              </div>

              {selectedEntity.entity.nearest_highway && (
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-xs">
                    {selectedEntity.entity.nearest_highway}
                  </Badge>
                  {selectedEntity.entity.highway_proximity && (
                    <span className="text-xs text-slate-500">
                      {selectedEntity.entity.highway_proximity.replace('_', ' ')}
                    </span>
                  )}
                </div>
              )}

              {selectedEntity.entity.lat != null && (
                <p className="text-xs text-slate-400 font-mono">
                  {selectedEntity.entity.lat.toFixed(5)}, {selectedEntity.entity.lng?.toFixed(5)}
                </p>
              )}

              {selectedEntity.claims.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                    Linked claims
                  </p>
                  {selectedEntity.claims.map((claim) => (
                    <div
                      key={claim.id}
                      className="text-xs font-mono text-slate-600 bg-slate-50 rounded p-2 border border-slate-100 leading-relaxed"
                    >
                      &ldquo;{claim.extracted_text.slice(0, 100)}{claim.extracted_text.length > 100 ? '…' : ''}&rdquo;
                    </div>
                  ))}
                  {selectedEntity.entity.claim_count && selectedEntity.entity.claim_count > 5 && (
                    <p className="text-xs text-slate-400">
                      +{selectedEntity.entity.claim_count - 5} more claims
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
