'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Loader2, MapPin } from 'lucide-react'

interface DoeCluster {
  id: string
  cluster_label: string
  cluster_type: string
  sex: string | null
  race: string | null
  state: string | null
  year_span_start: number | null
  year_span_end: number | null
  case_count: number
  signals: Record<string, unknown> | null
}

interface DoeClusterMember {
  id: string
  cluster_id: string
  submission_id: string
  member_name: string | null
  member_location: string | null
  member_date: string | null
  member_age: string | null
  member_sex: string | null
  member_doe_id: string | null
  confidence: number
  confidence_reason: string | null
}

interface CityGeocode {
  city: string
  state: string
  lat: number
  lng: number
}

const CLUSTER_TYPES = [
  'demographic_temporal',
  'circumstance_signal',
  'same_date_proximity',
  'corridor_cluster',
  'highway_proximity',
  'national_park_proximity',
  'demographic_hotspot',
  'location_runaway_cluster',
  'age_bracket',
]

const CLUSTER_TYPE_LABELS: Record<string, string> = {
  demographic_temporal:    'Demographic',
  circumstance_signal:     'Circumstance',
  same_date_proximity:     'Same Date',
  corridor_cluster:        'Corridor',
  highway_proximity:       'Highway',
  national_park_proximity: 'Wilderness',
  demographic_hotspot:     'Hotspot',
  location_runaway_cluster:'Location Runaway',
  age_bracket:             'Age Bracket',
}

const CLUSTER_COLORS: Record<string, string> = {
  demographic_temporal:    '#6366f1',
  circumstance_signal:     '#8b5cf6',
  same_date_proximity:     '#f59e0b',
  corridor_cluster:        '#06b6d4',
  highway_proximity:       '#eab308',
  national_park_proximity: '#22c55e',
  demographic_hotspot:     '#ef4444',
  location_runaway_cluster:'#f97316',
  age_bracket:             '#a855f7',
}

const STATE_FULL: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  DC:'District of Columbia',PR:'Puerto Rico',
}

function extractCity(loc: string | null): string | null {
  if (!loc) return null
  return loc.split(',')[0].trim().toLowerCase()
}

function extractState(loc: string | null): string | null {
  if (!loc) return null
  const parts = loc.split(',')
  const raw = parts[parts.length - 1].trim().replace(/\.$/, '')
  const word = raw.split(' ')[0].toUpperCase()
  return (STATE_FULL[word] ?? raw).toLowerCase()
}

function jitter() {
  return (Math.random() - 0.5) * 0.06
}

// Skeleton loading row
function SkeletonRow() {
  return (
    <div className="px-3 py-2.5 border-b border-slate-100">
      <div className="h-3 bg-slate-200 rounded w-3/4 mb-1 animate-pulse" />
      <div className="h-2 bg-slate-100 rounded w-1/2 animate-pulse" />
    </div>
  )
}

interface GeoViewProps {
  caseId: string
}

export function GeoView({ caseId }: GeoViewProps) {
  const supabase = createClient()
  const [selectedCluster, setSelectedCluster] = useState<DoeCluster | null>(null)
  const [activeTypeFilter, setActiveTypeFilter] = useState<string | null>(null)
  const [members, setMembers] = useState<DoeClusterMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<import('leaflet').Map | null>(null)
  const markersRef = useRef<import('leaflet').CircleMarker[]>([])

  // Load leaflet CSS
  useEffect(() => {
    import('leaflet/dist/leaflet.css')
  }, [])

  // Find the Doe Network missing persons case ID
  const { data: missingCaseId } = useQuery({
    queryKey: ['doe-missing-case-id', caseId],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from('case_user_roles')
        .select('case_id, cases!inner(id, title)')
        .ilike('cases.title', '%Doe Network%')

      if (!roles || roles.length === 0) return null

      const missingEntry = (roles as Array<{ case_id: string; cases: { id: string; title: string } | null }>)
        .find(r => r.cases?.title?.includes('Missing Persons'))

      return missingEntry?.case_id ?? roles[0]?.case_id ?? null
    },
  })

  // Fetch all clusters
  const { data: clustersData, isLoading: clustersLoading } = useQuery({
    queryKey: ['geo-clusters', missingCaseId],
    enabled: !!missingCaseId,
    queryFn: async () => {
      const res = await fetch(
        `/api/pattern/doe-match?missingCaseId=${missingCaseId}&type=clusters&page=0&limit=1000`
      )
      const data = await res.json()
      return data as { clusters: DoeCluster[]; total: number }
    },
  })

  // Fetch geocodes from Supabase
  const { data: geocodes } = useQuery({
    queryKey: ['city-geocodes'],
    queryFn: async () => {
      const { data } = await supabase
        .from('city_geocodes')
        .select('city, state, lat, lng')
      return (data ?? []) as CityGeocode[]
    },
  })

  const allClusters = clustersData?.clusters ?? []
  const filteredClusters = activeTypeFilter
    ? allClusters.filter(c => c.cluster_type === activeTypeFilter)
    : allClusters

  const sortedClusters = [...filteredClusters].sort((a, b) => b.case_count - a.case_count)

  // Build geocode lookup map
  const geocodeMap = new Map<string, { lat: number; lng: number }>()
  for (const g of geocodes ?? []) {
    geocodeMap.set(`${g.city.toLowerCase()}|${g.state.toLowerCase()}`, { lat: g.lat, lng: g.lng })
  }

  // Load members when cluster selected
  useEffect(() => {
    if (!selectedCluster || !missingCaseId) {
      setMembers([])
      return
    }
    setMembersLoading(true)
    fetch(`/api/pattern/doe-match?missingCaseId=${missingCaseId}&type=cluster_members&clusterId=${selectedCluster.id}`)
      .then(r => r.json())
      .then(d => setMembers(d.members ?? []))
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false))
  }, [selectedCluster, missingCaseId])

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapRef.current) return

    let L: typeof import('leaflet')
    import('leaflet').then(mod => {
      L = mod.default ?? mod
      if (leafletMapRef.current) return // already initialized

      const map = L.map(mapRef.current!, {
        center: [39.5, -98.35],
        zoom: 4,
        zoomControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map)

      leafletMapRef.current = map
    })

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
    }
  }, [])

  // Update markers when members or geocodes change
  useEffect(() => {
    const map = leafletMapRef.current
    if (!map) return

    // Clear existing markers
    for (const m of markersRef.current) {
      m.remove()
    }
    markersRef.current = []

    if (!selectedCluster || members.length === 0) return

    import('leaflet').then(mod => {
      const L = mod.default ?? mod
      const color = CLUSTER_COLORS[selectedCluster.cluster_type] ?? '#6366f1'

      for (const member of members) {
        const city = extractCity(member.member_location)
        const state = extractState(member.member_location)
        const coords = city && state ? geocodeMap.get(`${city}|${state}`) : undefined

        if (!coords) continue

        const lat = coords.lat + jitter()
        const lng = coords.lng + jitter()

        const pct = Math.round(member.confidence * 100)

        const marker = L.circleMarker([lat, lng], {
          radius: 7,
          fillColor: color,
          color: '#fff',
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.75,
        })

        const popupContent = `
          <div style="font-size:12px;min-width:160px;line-height:1.5">
            <strong>${member.member_name ?? 'Unknown'}</strong>
            ${member.member_doe_id ? `<span style="color:#6366f1;font-family:monospace;font-size:10px;display:block">${member.member_doe_id}</span>` : ''}
            <div style="color:#64748b;font-size:11px;margin-top:2px">
              ${[member.member_sex, member.member_age ? `age ${member.member_age}` : null].filter(Boolean).join(', ')}
            </div>
            ${member.member_location ? `<div style="color:#64748b;font-size:11px">📍 ${member.member_location}</div>` : ''}
            ${member.member_date ? `<div style="color:#64748b;font-size:11px">📅 ${member.member_date}</div>` : ''}
            <div style="margin-top:4px;font-size:10px;color:#6366f1">Confidence: ${pct}%</div>
            ${member.confidence_reason ? `<div style="font-size:10px;color:#94a3b8;font-style:italic;margin-top:2px">${member.confidence_reason}</div>` : ''}
          </div>
        `

        marker.bindPopup(popupContent)
        marker.addTo(map)
        markersRef.current.push(marker)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, selectedCluster, geocodeMap.size])

  const typesPresent = Array.from(new Set(allClusters.map(c => c.cluster_type)))

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 220px)', gap: 0, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
      {/* Left sidebar */}
      <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MapPin style={{ width: 14, height: 14, color: '#6366f1' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
              Geographic View
            </span>
          </div>
          {clustersLoading ? (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Loading clusters…</div>
          ) : (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {allClusters.length} clusters · {filteredClusters.length} shown
            </div>
          )}
        </div>

        {/* Type filter chips */}
        {typesPresent.length > 0 && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button
              onClick={() => setActiveTypeFilter(null)}
              style={{
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 999,
                border: '1px solid',
                borderColor: activeTypeFilter === null ? '#6366f1' : '#e2e8f0',
                background: activeTypeFilter === null ? '#eef2ff' : '#fff',
                color: activeTypeFilter === null ? '#6366f1' : '#64748b',
                cursor: 'pointer',
                fontWeight: activeTypeFilter === null ? 700 : 400,
              }}
            >
              All
            </button>
            {typesPresent.map(type => (
              <button
                key={type}
                onClick={() => setActiveTypeFilter(activeTypeFilter === type ? null : type)}
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 999,
                  border: '1px solid',
                  borderColor: activeTypeFilter === type ? CLUSTER_COLORS[type] : '#e2e8f0',
                  background: activeTypeFilter === type ? `${CLUSTER_COLORS[type]}18` : '#fff',
                  color: activeTypeFilter === type ? CLUSTER_COLORS[type] : '#64748b',
                  cursor: 'pointer',
                  fontWeight: activeTypeFilter === type ? 700 : 400,
                }}
              >
                {CLUSTER_TYPE_LABELS[type] ?? type}
              </button>
            ))}
          </div>
        )}

        {/* Cluster list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {clustersLoading ? (
            Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
          ) : sortedClusters.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
              No clusters found.
            </div>
          ) : (
            sortedClusters.map(cluster => {
              const isSelected = selectedCluster?.id === cluster.id
              const color = CLUSTER_COLORS[cluster.cluster_type] ?? '#6366f1'
              return (
                <button
                  key={cluster.id}
                  onClick={() => setSelectedCluster(isSelected ? null : cluster)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 16px',
                    borderBottom: '1px solid #f1f5f9',
                    borderLeft: `3px solid ${isSelected ? color : 'transparent'}`,
                    background: isSelected ? `${color}0d` : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 22,
                      height: 18,
                      background: color,
                      color: '#fff',
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '0 5px',
                    }}>
                      {cluster.case_count}
                    </span>
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      {CLUSTER_TYPE_LABELS[cluster.cluster_type] ?? cluster.cluster_type}
                    </span>
                    {cluster.state && (
                      <span style={{ fontSize: 10, color: '#94a3b8' }}>{cluster.state}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: isSelected ? '#1e293b' : '#475569', fontWeight: isSelected ? 600 : 400, lineHeight: 1.3 }}>
                    {cluster.cluster_label}
                  </div>
                  {cluster.year_span_start && cluster.year_span_end && cluster.year_span_start !== cluster.year_span_end && (
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                      {cluster.year_span_start}–{cluster.year_span_end}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Right map area */}
      <div style={{ flex: 1, position: 'relative', background: '#f8fafc' }}>
        {/* Map container */}
        <div ref={mapRef} style={{ height: '100%', width: '100%' }} />

        {/* No cluster selected overlay */}
        {!selectedCluster && !membersLoading && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '16px 24px',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 1000,
          }}>
            <MapPin style={{ width: 20, height: 20, color: '#6366f1', margin: '0 auto 8px' }} />
            <p style={{ fontSize: 13, color: '#475569', fontWeight: 600, margin: 0 }}>
              Select a cluster to see its cases on the map
            </p>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>
              Choose a cluster from the sidebar to plot members geographically
            </p>
          </div>
        )}

        {/* Members loading spinner overlay */}
        {membersLoading && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(255,255,255,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <Loader2 style={{ width: 24, height: 24, color: '#6366f1', animation: 'spin 1s linear infinite' }} />
          </div>
        )}

        {/* Members loaded but none geocoded */}
        {selectedCluster && !membersLoading && members.length > 0 && markersRef.current.length === 0 && geocodes && geocodes.length > 0 && (
          <div style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid #fde68a',
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 11,
            color: '#92400e',
            zIndex: 1000,
            whiteSpace: 'nowrap',
          }}>
            {members.length} members loaded — location data insufficient to plot on map
          </div>
        )}

        {/* Selected cluster info bar */}
        {selectedCluster && !membersLoading && (
          <div style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.95)',
            border: `1px solid ${CLUSTER_COLORS[selectedCluster.cluster_type] ?? '#6366f1'}`,
            borderRadius: 8,
            padding: '6px 14px',
            fontSize: 11,
            color: '#1e293b',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            <span style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: CLUSTER_COLORS[selectedCluster.cluster_type] ?? '#6366f1',
              display: 'inline-block',
              flexShrink: 0,
            }} />
            <span style={{ fontWeight: 600 }}>{selectedCluster.cluster_label}</span>
            <span style={{ color: '#94a3b8' }}>·</span>
            <span style={{ color: '#64748b' }}>{members.length} members</span>
          </div>
        )}
      </div>

      {/* Inline spin keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
