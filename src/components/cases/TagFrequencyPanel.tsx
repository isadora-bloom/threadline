'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tag, Search, X, ArrowRight } from 'lucide-react'

const TAG_TYPE_COLORS: Record<string, string> = {
  identifier: 'bg-red-100 text-red-700 border-red-200',
  physical:   'bg-blue-100 text-blue-700 border-blue-200',
  behavioral: 'bg-purple-100 text-purple-700 border-purple-200',
  geographic: 'bg-green-100 text-green-700 border-green-200',
  temporal:   'bg-orange-100 text-orange-700 border-orange-200',
  generic:    'bg-slate-100 text-slate-600 border-slate-200',
}

interface CaseTag {
  tag: string
  tag_type: string
  count: number
}

interface CrossCaseResult {
  id: string
  tag: string
  tag_type: string
  case_id: string
  claims: { id: string; extracted_text: string; claim_type: string; verification_status: string }
  cases: { id: string; title: string; case_type: string; status: string }
}

interface TagFrequencyPanelProps {
  caseId: string
}

export function TagFrequencyPanel({ caseId }: TagFrequencyPanelProps) {
  const [filter, setFilter] = useState('')
  const [crossCaseTag, setCrossCaseTag] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['case-tags', caseId],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/tags`)
      const json = await res.json()
      return json.tags as CaseTag[]
    },
  })

  const { data: crossCaseData, isLoading: crossCaseLoading } = useQuery({
    queryKey: ['cross-case-tags', crossCaseTag],
    queryFn: async () => {
      if (!crossCaseTag) return null
      const res = await fetch(`/api/tags/cross-case?tag=${encodeURIComponent(crossCaseTag)}`)
      const json = await res.json()
      return json.results as CrossCaseResult[]
    },
    enabled: !!crossCaseTag,
  })

  const tags = (data ?? []).filter(t =>
    !filter || t.tag.toLowerCase().includes(filter.toLowerCase())
  )

  const grouped = ['identifier', 'physical', 'behavioral', 'geographic', 'temporal', 'generic'].reduce<Record<string, CaseTag[]>>((acc, type) => {
    const filtered = tags.filter(t => t.tag_type === type)
    if (filtered.length) acc[type] = filtered
    return acc
  }, {})

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-medium text-slate-700">Case Tags</span>
        {data?.length ? (
          <Badge variant="secondary" className="text-xs">{data.length}</Badge>
        ) : null}
      </div>

      {(data?.length ?? 0) > 6 && (
        <Input
          placeholder="Filter tags..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="h-7 text-xs"
        />
      )}

      {Object.entries(grouped).map(([type, typeTags]) => (
        <div key={type}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            {type}
          </p>
          <div className="flex flex-wrap gap-1">
            {typeTags.map(t => (
              <button
                key={t.tag}
                onClick={() => {
                  if (t.tag_type === 'identifier') setCrossCaseTag(t.tag)
                }}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border
                  ${TAG_TYPE_COLORS[t.tag_type] ?? TAG_TYPE_COLORS.generic}
                  ${t.tag_type === 'identifier' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                title={t.tag_type === 'identifier' ? 'Click to search across cases' : undefined}
              >
                {t.tag}
                <span className="font-bold opacity-60">×{t.count}</span>
                {t.tag_type === 'identifier' && <Search className="h-2.5 w-2.5 opacity-60" />}
              </button>
            ))}
          </div>
        </div>
      ))}

      {!tags.length && (
        <p className="text-xs text-slate-400 italic">No tags yet. Tags are generated automatically when claims are extracted.</p>
      )}

      {/* Cross-case search dialog */}
      <Dialog open={!!crossCaseTag} onOpenChange={open => !open && setCrossCaseTag(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Search className="h-4 w-4" />
              Cross-case search: <span className="font-mono text-red-700 bg-red-50 px-1.5 py-0.5 rounded">{crossCaseTag}</span>
            </DialogTitle>
          </DialogHeader>

          {crossCaseLoading ? (
            <div className="py-8 text-center text-sm text-slate-400">Searching across cases...</div>
          ) : (crossCaseData?.length ?? 0) === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">No other cases contain this tag.</div>
          ) : (
            <div className="space-y-3">
              {crossCaseData?.map(r => (
                <div key={r.id} className="rounded-lg border border-slate-200 p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-slate-900">{r.cases.title}</p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">{r.cases.case_type.replace('_', ' ')}</p>
                    </div>
                    <a
                      href={`/cases/${r.cases.id}`}
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      Open <ArrowRight className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="bg-slate-50 rounded p-2">
                    <p className="text-xs text-slate-600">{r.claims.extracted_text}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{r.claims.claim_type} · {r.claims.verification_status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
