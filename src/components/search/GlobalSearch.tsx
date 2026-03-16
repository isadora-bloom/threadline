'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Search, X, FileText, Users, Inbox } from 'lucide-react'

interface SearchResult {
  type: 'claim' | 'entity' | 'submission'
  id: string
  text: string
  submatch: string
  href: string
}

interface GlobalSearchProps {
  caseId: string
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <strong className="font-semibold text-slate-900">{text.slice(idx, idx + query.length)}</strong>
      {text.slice(idx + query.length)}
    </>
  )
}

const TYPE_ICON = {
  claim: <FileText className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />,
  entity: <Users className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />,
  submission: <Inbox className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />,
}

const TYPE_LABEL = {
  claim: 'Claim',
  entity: 'Entity',
  submission: 'Submission',
}

export function GlobalSearch({ caseId }: GlobalSearchProps) {
  const supabase = createClient()
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ claims: SearchResult[]; entities: SearchResult[]; submissions: SearchResult[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const allResults = results
    ? [...results.claims, ...results.entities, ...results.submissions]
    : []

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 3) {
      setResults(null)
      setLoading(false)
      return
    }

    setLoading(true)

    const like = `%${q}%`

    const [claimsRes, entitiesRes, submissionsRes] = await Promise.all([
      supabase
        .from('claims')
        .select('id, extracted_text, submission_id')
        .ilike('extracted_text', like)
        .limit(5),
      supabase
        .from('entities')
        .select('id, raw_value, normalized_value, entity_type')
        .eq('case_id', caseId)
        .or(`raw_value.ilike.${like},normalized_value.ilike.${like}`)
        .limit(5),
      supabase
        .from('submissions')
        .select('id, raw_text')
        .eq('case_id', caseId)
        .ilike('raw_text', like)
        .limit(5),
    ])

    // Filter claims to this case — need to join through submissions
    const submissionIds = (submissionsRes.data ?? []).map(s => s.id)
    const caseClaimIds = new Set<string>()
    if (submissionIds.length > 0) {
      const { data: caseClaimsCheck } = await supabase
        .from('claims')
        .select('id')
        .in('submission_id', submissionIds)
      ;(caseClaimsCheck ?? []).forEach(c => caseClaimIds.add(c.id))
    }

    const claims: SearchResult[] = (claimsRes.data ?? []).map(c => ({
      type: 'claim',
      id: c.id,
      text: c.extracted_text,
      submatch: c.extracted_text.substring(
        Math.max(0, c.extracted_text.toLowerCase().indexOf(q.toLowerCase()) - 20),
        Math.min(c.extracted_text.length, c.extracted_text.toLowerCase().indexOf(q.toLowerCase()) + q.length + 60)
      ),
      href: `/cases/${caseId}/submissions/${c.submission_id}`,
    }))

    const entities: SearchResult[] = (entitiesRes.data ?? []).map(e => ({
      type: 'entity',
      id: e.id,
      text: e.normalized_value ?? e.raw_value,
      submatch: `${e.entity_type}: ${e.normalized_value ?? e.raw_value}`,
      href: `/cases/${caseId}/entities/${e.id}`,
    }))

    const subs: SearchResult[] = (submissionsRes.data ?? []).map(s => {
      const idx = s.raw_text.toLowerCase().indexOf(q.toLowerCase())
      const snippet = s.raw_text.substring(
        Math.max(0, idx - 20),
        Math.min(s.raw_text.length, idx + q.length + 60)
      )
      return {
        type: 'submission',
        id: s.id,
        text: snippet,
        submatch: snippet,
        href: `/cases/${caseId}/submissions/${s.id}`,
      }
    })

    setResults({ claims, entities, submissions: subs })
    setLoading(false)
    setActiveIdx(-1)
  }, [supabase, caseId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doSearch(query)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, doSearch])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, allResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      const result = allResults[activeIdx]
      if (result) {
        router.push(result.href)
        setOpen(false)
        setQuery('')
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  const hasResults = results && (results.claims.length > 0 || results.entities.length > 0 || results.submissions.length > 0)
  const noResults = results && !hasResults && query.length >= 3 && !loading

  return (
    <div className="relative px-3 py-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search claims, entities, submissions…"
          className="w-full h-8 pl-8 pr-7 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 placeholder:text-slate-400"
        />
        {query && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            onClick={() => {
              setQuery('')
              setResults(null)
              setOpen(false)
              inputRef.current?.focus()
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && query.length >= 3 && (
        <div className="absolute left-3 right-3 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden max-h-96 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
          )}

          {noResults && (
            <div className="px-3 py-4 text-xs text-slate-400 text-center">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {hasResults && (
            <>
              {/* Claims */}
              {results.claims.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-400 font-semibold bg-slate-50 border-b border-slate-100">
                    Claims
                  </div>
                  {results.claims.map((r, i) => {
                    const globalIdx = i
                    return (
                      <button
                        key={r.id}
                        className={`w-full flex items-start gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 ${activeIdx === globalIdx ? 'bg-indigo-50' : ''}`}
                        onClick={() => { router.push(r.href); setOpen(false); setQuery('') }}
                      >
                        {TYPE_ICON[r.type]}
                        <span className="flex-1 text-slate-600 leading-relaxed">
                          &ldquo;{highlightMatch(r.submatch, query)}&rdquo;
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Entities */}
              {results.entities.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-400 font-semibold bg-slate-50 border-b border-slate-100">
                    Entities
                  </div>
                  {results.entities.map((r, i) => {
                    const globalIdx = results.claims.length + i
                    return (
                      <button
                        key={r.id}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 ${activeIdx === globalIdx ? 'bg-indigo-50' : ''}`}
                        onClick={() => { router.push(r.href); setOpen(false); setQuery('') }}
                      >
                        {TYPE_ICON[r.type]}
                        <span className="flex-1 text-slate-600">
                          {highlightMatch(r.submatch, query)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Submissions */}
              {results.submissions.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-400 font-semibold bg-slate-50 border-b border-slate-100">
                    Submissions
                  </div>
                  {results.submissions.map((r, i) => {
                    const globalIdx = results.claims.length + results.entities.length + i
                    return (
                      <button
                        key={r.id}
                        className={`w-full flex items-start gap-2 px-3 py-2.5 text-left text-xs hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 ${activeIdx === globalIdx ? 'bg-indigo-50' : ''}`}
                        onClick={() => { router.push(r.href); setOpen(false); setQuery('') }}
                      >
                        {TYPE_ICON[r.type]}
                        <span className="flex-1 text-slate-600 font-mono leading-relaxed">
                          &hellip;{highlightMatch(r.submatch, query)}&hellip;
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
