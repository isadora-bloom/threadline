'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Search,
  Loader2,
  User,
  MapPin,
  Calendar,
  ChevronRight,
  Brain,
  ExternalLink,
  Fingerprint,
  Star,
} from 'lucide-react'
import { DeepResearchButton } from '@/components/registry/DeepResearchButton'

export default function LookupPage() {
  const supabase = createClient()
  const [input, setInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const { data: results, isLoading, error } = useQuery({
    queryKey: ['lookup', searchTerm],
    queryFn: async () => {
      if (!searchTerm.trim()) return null

      const term = searchTerm.trim()

      // Try NamUs number format: MP12345, UP12345, 12345
      const namusMatch = term.match(/^(MP|UP)?(\d+)$/i)
      if (namusMatch) {
        const prefix = namusMatch[1]?.toUpperCase()
        const num = namusMatch[2]

        // Search by external_id
        const patterns = []
        if (prefix) {
          patterns.push(`MP${num}`, `UP${num}`)
        } else {
          patterns.push(`MP${num}`, `UP${num}`)
        }

        const { data } = await supabase
          .from('import_records')
          .select('*, source:import_sources(display_name)')
          .in('external_id', patterns)
          .limit(10)

        if (data && data.length > 0) return { type: 'namus_id' as const, records: data }
      }

      // Try name search
      const { data: nameResults } = await supabase
        .from('import_records')
        .select('*, source:import_sources(display_name)')
        .ilike('person_name', `%${term}%`)
        .limit(20)

      if (nameResults && nameResults.length > 0) {
        return { type: 'name' as const, records: nameResults }
      }

      // Try city search
      const { data: cityResults } = await supabase
        .from('import_records')
        .select('*, source:import_sources(display_name)')
        .ilike('city', `%${term}%`)
        .limit(20)

      if (cityResults && cityResults.length > 0) {
        return { type: 'city' as const, records: cityResults }
      }

      return { type: 'none' as const, records: [] }
    },
    enabled: !!searchTerm.trim(),
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchTerm(input)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Hero */}
      <div className="text-center py-8">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-indigo-600 mb-4">
          <Fingerprint className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Case Lookup</h1>
        <p className="text-slate-500 max-w-lg mx-auto">
          Enter a NamUs number (e.g. MP12345), a name, or a city.
          Get instant access to everything Threadline knows — matches, patterns, AI analysis.
        </p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 max-w-xl mx-auto">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="NamUs number, name, or city..."
          className="text-lg h-12"
          autoFocus
        />
        <Button type="submit" size="lg" disabled={!input.trim() || isLoading}>
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
        </Button>
      </form>

      {/* Examples */}
      {!searchTerm && (
        <div className="flex items-center justify-center gap-3 text-sm text-slate-400">
          <span>Try:</span>
          <button onClick={() => { setInput('MP12345'); setSearchTerm('MP12345') }} className="text-indigo-500 hover:text-indigo-700">MP12345</button>
          <span>&middot;</span>
          <button onClick={() => { setInput('Jane Doe'); setSearchTerm('Jane Doe') }} className="text-indigo-500 hover:text-indigo-700">Jane Doe</button>
          <span>&middot;</span>
          <button onClick={() => { setInput('Houston'); setSearchTerm('Houston') }} className="text-indigo-500 hover:text-indigo-700">Houston</button>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          {results.records.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
              <Search className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <h3 className="font-semibold text-slate-700">No results found</h3>
              <p className="text-sm text-slate-400 mt-1">
                Try a different NamUs number, name, or city.
              </p>
            </div>
          ) : (
            <>
              <div className="text-sm text-slate-500">
                {results.records.length} result{results.records.length !== 1 ? 's' : ''}
                {results.type === 'namus_id' && ' by NamUs ID'}
                {results.type === 'name' && ' by name'}
                {results.type === 'city' && ' by city'}
              </div>

              {results.records.map((record) => {
                const isMissing = record.record_type === 'missing_person'
                const source = record.source as { display_name: string } | null

                return (
                  <Card key={record.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <div className={`flex h-12 w-12 items-center justify-center rounded-lg flex-shrink-0 ${
                          isMissing ? 'bg-blue-100' : 'bg-slate-100'
                        }`}>
                          <User className={`h-6 w-6 ${isMissing ? 'text-blue-600' : 'text-slate-500'}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-slate-900 text-lg">
                              {record.person_name ?? 'Unidentified'}
                            </span>
                            <Badge variant={isMissing ? 'default' : 'secondary'}>
                              {isMissing ? 'Missing Person' : 'Unidentified Remains'}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-4 text-sm text-slate-500 mb-3">
                            {record.sex && <span>{record.sex}</span>}
                            {record.age_text && <span>Age {record.age_text}</span>}
                            {record.race && <span>{record.race}</span>}
                            {(record.city || record.state) && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5" />
                                {[record.city, record.state].filter(Boolean).join(', ')}
                              </span>
                            )}
                            {(record.date_missing || record.date_found) && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3.5 w-3.5" />
                                {isMissing ? `Missing ${record.date_missing}` : `Found ${record.date_found}`}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-xs text-slate-400 mb-3">
                            <span>{record.external_id}</span>
                            {source && <span>{source.display_name}</span>}
                            {record.external_url && (
                              <a href={record.external_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-indigo-600">
                                <ExternalLink className="h-3 w-3" />
                                View original
                              </a>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <Button size="sm" asChild>
                              <Link href={`/registry/${record.id}`}>
                                <ChevronRight className="h-4 w-4" />
                                Full Profile
                              </Link>
                            </Button>
                            <DeepResearchButton recordId={record.id} />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* What Threadline does */}
      <div className="border-t border-slate-200 pt-8 mt-8">
        <div className="grid sm:grid-cols-3 gap-6 text-center">
          <div>
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 mb-2">
              <Search className="h-5 w-5 text-slate-600" />
            </div>
            <h3 className="font-semibold text-sm text-slate-900">57,000+ Records</h3>
            <p className="text-xs text-slate-500 mt-1">
              Every missing person and unidentified remains from NamUs and The Doe Network.
            </p>
          </div>
          <div>
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 mb-2">
              <Brain className="h-5 w-5 text-slate-600" />
            </div>
            <h3 className="font-semibold text-sm text-slate-900">AI Deep Research</h3>
            <p className="text-xs text-slate-500 mt-1">
              One click to get an investigative analysis — connections, offender overlaps, next steps.
            </p>
          </div>
          <div>
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 mb-2">
              <Star className="h-5 w-5 text-slate-600" />
            </div>
            <h3 className="font-semibold text-sm text-slate-900">Community</h3>
            <p className="text-xs text-slate-500 mt-1">
              Watch cases, share leads, see who else is investigating. Do something, not just listen.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
