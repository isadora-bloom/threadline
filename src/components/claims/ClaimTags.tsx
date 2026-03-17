'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Tag, Plus, X, Search } from 'lucide-react'

const TAG_TYPE_COLORS: Record<string, string> = {
  identifier: 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200',
  physical:   'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200',
  behavioral: 'bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200',
  geographic: 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200',
  temporal:   'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200',
  generic:    'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',
}

const TAG_TYPE_LABELS: Record<string, string> = {
  identifier: 'ID',
  physical:   'Physical',
  behavioral: 'Behavioral',
  geographic: 'Geographic',
  temporal:   'Temporal',
  generic:    'General',
}

interface ClaimTag {
  id: string
  tag: string
  tag_type: string
  source: string
}

interface ClaimTagsProps {
  claimId: string
  caseId: string
  canEdit?: boolean
  onCrossCaseSearch?: (tag: string) => void
}

export function ClaimTags({ claimId, caseId, canEdit = false, onCrossCaseSearch }: ClaimTagsProps) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [newTagType, setNewTagType] = useState('generic')

  const { data } = useQuery({
    queryKey: ['claim-tags', claimId],
    queryFn: async () => {
      const res = await fetch(`/api/claims/${claimId}/tags`)
      const json = await res.json()
      return json.tags as ClaimTag[]
    },
  })

  const addMutation = useMutation({
    mutationFn: async ({ tag, tag_type }: { tag: string; tag_type: string }) => {
      const res = await fetch(`/api/claims/${claimId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, tag_type }),
      })
      if (!res.ok) throw new Error('Failed to add tag')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claim-tags', claimId] })
      queryClient.invalidateQueries({ queryKey: ['case-tags', caseId] })
      setNewTag('')
      setAddOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (tag: string) => {
      await fetch(`/api/claims/${claimId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claim-tags', claimId] })
      queryClient.invalidateQueries({ queryKey: ['case-tags', caseId] })
    },
  })

  const tags = data ?? []

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
      <TooltipProvider>
        {tags.map(t => (
          <Tooltip key={t.id}>
            <TooltipTrigger asChild>
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border cursor-default
                  ${TAG_TYPE_COLORS[t.tag_type] ?? TAG_TYPE_COLORS.generic}`}
              >
                <Tag className="h-2.5 w-2.5 flex-shrink-0" />
                {t.tag}
                {t.tag_type === 'identifier' && onCrossCaseSearch && (
                  <button
                    className="ml-0.5 hover:opacity-70"
                    onClick={() => onCrossCaseSearch(t.tag)}
                    title="Search across cases"
                  >
                    <Search className="h-2.5 w-2.5" />
                  </button>
                )}
                {canEdit && (
                  <button
                    className="ml-0.5 hover:opacity-70"
                    onClick={() => deleteMutation.mutate(t.tag)}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {TAG_TYPE_LABELS[t.tag_type] ?? 'Tag'} · Added by {t.source}
            </TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>

      {canEdit && (
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-slate-400 border border-dashed border-slate-300 hover:border-slate-400 hover:text-slate-600">
              <Plus className="h-2.5 w-2.5" />
              tag
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <div className="space-y-2">
              <Input
                placeholder="tag name"
                value={newTag}
                onChange={e => setNewTag(e.target.value.toLowerCase())}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newTag.trim()) {
                    addMutation.mutate({ tag: newTag.trim(), tag_type: newTagType })
                  }
                }}
                className="h-7 text-xs"
              />
              <Select value={newTagType} onValueChange={setNewTagType}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TAG_TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="w-full h-7 text-xs"
                disabled={!newTag.trim() || addMutation.isPending}
                onClick={() => addMutation.mutate({ tag: newTag.trim(), tag_type: newTagType })}
              >
                Add tag
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
