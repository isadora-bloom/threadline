'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, X } from 'lucide-react'
import { useCallback, useState } from 'react'

interface ClaimFiltersProps {
  currentFilters: {
    claim_type?: string
    status?: string
    interpretation?: string
    search?: string
    source_confidence?: string
    content_confidence?: string
  }
}

export function ClaimFilters({ currentFilters }: ClaimFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchText, setSearchText] = useState(currentFilters.search ?? '')

  const updateParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === null || value === '' || value === 'all') {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [router, pathname, searchParams])

  const hasActiveFilters = Object.values(currentFilters).some(Boolean)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Search claim text..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') updateParam('search', searchText || null)
            }}
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => updateParam('search', searchText || null)}
        >
          Search
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={currentFilters.claim_type ?? 'all'}
          onValueChange={(v) => updateParam('claim_type', v)}
        >
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder="Claim type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="statement">Statement</SelectItem>
            <SelectItem value="sighting">Sighting</SelectItem>
            <SelectItem value="identifier">Identifier</SelectItem>
            <SelectItem value="association">Association</SelectItem>
            <SelectItem value="interpretation">Interpretation</SelectItem>
            <SelectItem value="official">Official</SelectItem>
            <SelectItem value="behavioral">Behavioral</SelectItem>
            <SelectItem value="physical_description">Physical description</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={currentFilters.status ?? 'all'}
          onValueChange={(v) => updateParam('status', v)}
        >
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="unverified">Unverified</SelectItem>
            <SelectItem value="under_review">Under review</SelectItem>
            <SelectItem value="corroborated">Corroborated</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="disputed">Disputed</SelectItem>
            <SelectItem value="retracted">Retracted</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={currentFilters.interpretation ?? 'all'}
          onValueChange={(v) => updateParam('interpretation', v)}
        >
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder="Interpretation" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All claims</SelectItem>
            <SelectItem value="false">Facts only</SelectItem>
            <SelectItem value="true">Interpretations only</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={currentFilters.source_confidence ?? 'all'}
          onValueChange={(v) => updateParam('source_confidence', v)}
        >
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder="Source reliability" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any source reliability</SelectItem>
            <SelectItem value="low">Source: Low</SelectItem>
            <SelectItem value="medium">Source: Medium</SelectItem>
            <SelectItem value="high">Source: High</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-slate-500"
            onClick={() => router.push(pathname)}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}
