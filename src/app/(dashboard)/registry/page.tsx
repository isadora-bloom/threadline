'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Search,
  User,
  MapPin,
  Calendar,
  ChevronRight,
  Eye,
  Flame,
} from 'lucide-react'

const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
  'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
  'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire',
  'New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio',
  'Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota',
  'Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia',
  'Wisconsin','Wyoming','District of Columbia','Puerto Rico',
]

export default function RegistryPage() {
  const supabase = createClient()

  const [search, setSearch] = useState('')
  const [city, setCity] = useState('')
  const [recordType, setRecordType] = useState<string>('all')
  const [state, setState] = useState<string>('all')
  const [sex, setSex] = useState<string>('all')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25

  const { data, isLoading } = useQuery({
    queryKey: ['registry', search, city, recordType, state, sex, page],
    queryFn: async () => {
      let query = supabase
        .from('import_records')
        .select('*, source:import_sources(display_name, slug)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (recordType !== 'all') query = query.eq('record_type', recordType)
      if (state !== 'all') query = query.ilike('state', `%${state}%`)
      if (sex !== 'all') query = query.ilike('sex', `${sex}%`)
      if (city.trim()) query = query.ilike('city', `%${city.trim()}%`)
      if (search.trim()) {
        query = query.or(`person_name.ilike.%${search}%,external_id.ilike.%${search}%`)
      }

      const { data: records, count, error } = await query
      if (error) throw error
      return { records: records ?? [], count: count ?? 0 }
    },
  })

  const { data: stats } = useQuery({
    queryKey: ['registry-stats'],
    queryFn: async () => {
      const [missing, unidentified, processed] = await Promise.all([
        supabase.from('import_records').select('id', { count: 'exact', head: true }).eq('record_type', 'missing_person'),
        supabase.from('import_records').select('id', { count: 'exact', head: true }).eq('record_type', 'unidentified_remains'),
        supabase.from('import_records').select('id', { count: 'exact', head: true }).eq('ai_processed', true),
      ])
      return {
        missing: missing.count ?? 0,
        unidentified: unidentified.count ?? 0,
        processed: processed.count ?? 0,
      }
    },
  })

  const records = data?.records ?? []
  const totalCount = data?.count ?? 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // Fetch match/overlap counts for visible records
  const submissionIds = records.map(r => r.submission_id).filter(Boolean) as string[]
  const { data: matchCounts } = useQuery({
    queryKey: ['registry-match-counts', submissionIds.join(',')],
    queryFn: async () => {
      if (!submissionIds.length) return {}

      const counts: Record<string, { matches: number; offenders: number }> = {}

      for (let i = 0; i < submissionIds.length; i += 20) {
        const chunk = submissionIds.slice(i, i + 20)

        const [missingMatches, unidentifiedMatches, offenderData] = await Promise.all([
          // Matches where this person is the missing side
          supabase
            .from('doe_match_candidates')
            .select('missing_submission_id')
            .in('missing_submission_id', chunk)
            .in('grade', ['very_strong', 'strong']),
          // Matches where this person is the unidentified side
          supabase
            .from('doe_match_candidates')
            .select('unidentified_submission_id')
            .in('unidentified_submission_id', chunk)
            .in('grade', ['very_strong', 'strong']),
          supabase
            .from('offender_case_overlaps')
            .select('submission_id')
            .in('submission_id', chunk)
            .gte('composite_score', 65),
        ])

        for (const m of missingMatches.data ?? []) {
          const sid = (m as Record<string, string>).missing_submission_id
          if (!counts[sid]) counts[sid] = { matches: 0, offenders: 0 }
          counts[sid].matches++
        }
        for (const m of unidentifiedMatches.data ?? []) {
          const sid = (m as Record<string, string>).unidentified_submission_id
          if (!counts[sid]) counts[sid] = { matches: 0, offenders: 0 }
          counts[sid].matches++
        }
        for (const o of offenderData.data ?? []) {
          const sid = (o as Record<string, string>).submission_id
          if (!counts[sid]) counts[sid] = { matches: 0, offenders: 0 }
          counts[sid].offenders++
        }
      }

      return counts
    },
    enabled: submissionIds.length > 0,
  })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Search className="h-5 w-5 text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900">Registry</h1>
        </div>
        <p className="text-sm text-slate-500">
          {stats ? (
            <>
              {stats.missing.toLocaleString()} missing persons &middot;{' '}
              {stats.unidentified.toLocaleString()} unidentified remains &middot;{' '}
              {stats.processed.toLocaleString()} AI-processed
            </>
          ) : 'Loading...'}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[180px]">
          <Input
            placeholder="Search by name or case ID..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            className="w-full"
          />
        </div>
        <div className="w-[180px]">
          <Input
            placeholder="City (e.g. Salt Lake City)"
            value={city}
            onChange={(e) => { setCity(e.target.value); setPage(0) }}
            className="w-full"
          />
        </div>
        <Select value={state} onValueChange={(v) => { setState(v); setPage(0) }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {US_STATES.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={recordType} onValueChange={(v) => { setRecordType(v); setPage(0) }}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="missing_person">Missing persons</SelectItem>
            <SelectItem value="unidentified_remains">Unidentified remains</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sex} onValueChange={(v) => { setSex(v); setPage(0) }}>
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="Sex" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      <div className="text-sm text-slate-500">
        {totalCount.toLocaleString()} results
        {totalPages > 1 && ` — page ${page + 1} of ${totalPages}`}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-20 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
          <Search className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <h3 className="font-semibold text-slate-700 mb-1">No records found</h3>
          <p className="text-sm text-slate-400">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((record) => {
            const isMissing = record.record_type === 'missing_person'
            const source = record.source as { display_name: string; slug: string } | null
            const mc = record.submission_id ? (matchCounts ?? {})[record.submission_id as string] : undefined

            return (
              <Link key={record.id} href={`/registry/${record.id}`}>
                <Card className={`hover:shadow-md transition-shadow cursor-pointer ${
                  mc && mc.matches > 0 ? 'border-l-4 border-l-indigo-400' : ''
                }`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                        isMissing ? 'bg-blue-100' : 'bg-slate-100'
                      }`}>
                        <User className={`h-5 w-5 ${isMissing ? 'text-blue-600' : 'text-slate-500'}`} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900 text-sm">
                            {record.person_name ?? 'Unidentified'}
                          </span>
                          <Badge variant={isMissing ? 'default' : 'secondary'} className="text-xs">
                            {isMissing ? 'Missing' : 'Unidentified'}
                          </Badge>
                          {mc && mc.matches > 0 && (
                            <Badge className="text-xs bg-indigo-100 text-indigo-700 border-indigo-200">
                              {mc.matches} match{mc.matches !== 1 ? 'es' : ''}
                            </Badge>
                          )}
                          {mc && mc.offenders > 0 && (
                            <Badge className="text-xs bg-red-100 text-red-700 border-red-200">
                              {mc.offenders} offender overlap{mc.offenders !== 1 ? 's' : ''}
                            </Badge>
                          )}
                          {record.classification && (
                            <Badge variant="outline" className="text-xs">
                              {record.classification as string}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                          {record.sex && <span>{record.sex}</span>}
                          {record.age_text && <span>Age {record.age_text}</span>}
                          {record.race && <span>{record.race}</span>}
                          {(record.city || record.state) && (
                            <span className="flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" />
                              {[record.city, record.state].filter(Boolean).join(', ')}
                            </span>
                          )}
                          {(record.date_missing || record.date_found) && (
                            <span className="flex items-center gap-0.5">
                              <Calendar className="h-3 w-3" />
                              {isMissing ? `Missing ${record.date_missing}` : `Found ${record.date_found}`}
                            </span>
                          )}
                          {source && (
                            <span className="text-slate-400">{source.display_name}</span>
                          )}
                        </div>
                      </div>

                      <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </Button>
          <span className="text-sm text-slate-500">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
