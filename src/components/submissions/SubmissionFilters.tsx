'use client'

import { useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

interface SubmissionFiltersProps {
  caseId: string
  currentFilter: string
  currentSource?: string
  currentFirsthand?: boolean
}

const statusOptions = [
  { value: 'unverified', label: 'Needs review' },
  { value: 'under_review', label: 'Under review' },
  { value: 'corroborated', label: 'Corroborated' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'retracted', label: 'Retracted' },
  { value: 'all', label: 'All submissions' },
]

export function SubmissionFilters({
  caseId,
  currentFilter,
  currentSource,
  currentFirsthand,
}: SubmissionFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()

  const updateFilter = (key: string, value: string | boolean | null) => {
    const params = new URLSearchParams()
    if (key !== 'filter') params.set('filter', currentFilter)
    if (key !== 'source' && currentSource) params.set('source', currentSource)
    if (key !== 'firsthand' && currentFirsthand) params.set('firsthand', 'true')

    if (value !== null && value !== false) {
      params.set(key, String(value))
    }

    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-600 font-medium">Status:</span>
        <div className="flex gap-1 flex-wrap">
          {statusOptions.map((opt) => (
            <Button
              key={opt.value}
              variant={currentFilter === opt.value ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => updateFilter('filter', opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <Select
        value={currentSource ?? 'all'}
        onValueChange={(v) => updateFilter('source', v === 'all' ? null : v)}
      >
        <SelectTrigger className="w-40 h-8 text-xs">
          <SelectValue placeholder="Source type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          <SelectItem value="anonymous">Anonymous</SelectItem>
          <SelectItem value="named_individual">Named individual</SelectItem>
          <SelectItem value="organization">Organization</SelectItem>
          <SelectItem value="official_record">Official record</SelectItem>
          <SelectItem value="media">Media</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Checkbox
          id="firsthand"
          checked={currentFirsthand ?? false}
          onCheckedChange={(checked) => updateFilter('firsthand', checked ? true : null)}
        />
        <Label htmlFor="firsthand" className="text-xs cursor-pointer">
          Firsthand only
        </Label>
      </div>
    </div>
  )
}
