'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tag,
  Heart,
  AlertTriangle,
  Zap,
  XCircle,
  UserPlus,
  Phone,
  BookOpen,
  Clock,
  Star,
  Check,
} from 'lucide-react'

const TAG_CONFIG: Record<string, { label: string; icon: typeof Heart; color: string }> = {
  interested:      { label: 'Interested',      icon: Heart,          color: 'bg-pink-100 text-pink-700 border-pink-200' },
  priority:        { label: 'Priority',         icon: Star,           color: 'bg-amber-100 text-amber-700 border-amber-200' },
  suspicious:      { label: 'Suspicious',       icon: AlertTriangle,  color: 'bg-red-100 text-red-700 border-red-200' },
  promising_lead:  { label: 'Promising Lead',   icon: Zap,            color: 'bg-green-100 text-green-700 border-green-200' },
  dead_end:        { label: 'Dead End',         icon: XCircle,        color: 'bg-slate-100 text-slate-500 border-slate-200' },
  needs_expert:    { label: 'Needs Expert',     icon: UserPlus,       color: 'bg-purple-100 text-purple-700 border-purple-200' },
  contacted_le:    { label: 'Contacted LE',     icon: Phone,          color: 'bg-blue-100 text-blue-700 border-blue-200' },
  research_done:   { label: 'Research Done',    icon: BookOpen,       color: 'bg-teal-100 text-teal-700 border-teal-200' },
  follow_up:       { label: 'Follow Up',        icon: Clock,          color: 'bg-orange-100 text-orange-700 border-orange-200' },
}

interface TagButtonProps {
  importRecordId?: string
  matchId?: string
  connectionId?: string
  compact?: boolean
}

export function TagButton({ importRecordId, matchId, connectionId, compact }: TagButtonProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const targetKey = importRecordId ?? matchId ?? connectionId ?? ''
  const targetType = importRecordId ? 'record' : matchId ? 'match' : 'connection'

  const { data: myTags } = useQuery({
    queryKey: ['my-tags', targetKey],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      let query = supabase.from('user_tags').select('*').eq('user_id', user.id)
      if (importRecordId) query = query.eq('import_record_id', importRecordId)
      if (matchId) query = query.eq('match_id', matchId)
      if (connectionId) query = query.eq('connection_id', connectionId)

      const { data } = await query
      return data ?? []
    },
    enabled: !!targetKey,
  })

  const { data: tagCounts } = useQuery({
    queryKey: ['tag-counts', targetKey],
    queryFn: async () => {
      let query = supabase.from('user_tags').select('tag')
      if (importRecordId) query = query.eq('import_record_id', importRecordId)
      if (matchId) query = query.eq('match_id', matchId)
      if (connectionId) query = query.eq('connection_id', connectionId)

      const { data } = await query
      const counts: Record<string, number> = {}
      for (const t of data ?? []) {
        counts[t.tag] = (counts[t.tag] ?? 0) + 1
      }
      return counts
    },
    enabled: !!targetKey,
  })

  const toggleTag = useMutation({
    mutationFn: async (tag: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const existing = myTags?.find(t => t.tag === tag)
      if (existing) {
        await supabase.from('user_tags').delete().eq('id', existing.id)
      } else {
        await supabase.from('user_tags').insert({
          user_id: user.id,
          tag,
          import_record_id: importRecordId ?? null,
          match_id: matchId ?? null,
          connection_id: connectionId ?? null,
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-tags', targetKey] })
      queryClient.invalidateQueries({ queryKey: ['tag-counts', targetKey] })
    },
  })

  const myTagSet = new Set(myTags?.map(t => t.tag) ?? [])
  const hasAnyTags = myTagSet.size > 0

  return (
    <div className="flex items-center gap-1.5">
      {/* Show active tags as badges */}
      {!compact && myTags?.map(t => {
        const config = TAG_CONFIG[t.tag]
        if (!config) return null
        const Icon = config.icon
        return (
          <Badge key={t.id} className={`text-xs ${config.color} cursor-pointer`} onClick={() => toggleTag.mutate(t.tag)}>
            <Icon className="h-3 w-3 mr-0.5" />
            {config.label}
            {(tagCounts?.[t.tag] ?? 0) > 1 && <span className="ml-1 opacity-60">{tagCounts?.[t.tag]}</span>}
          </Badge>
        )
      })}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={hasAnyTags ? 'default' : 'outline'}
            size="sm"
            className={compact ? 'h-7 w-7 p-0' : 'h-7'}
          >
            <Tag className="h-3.5 w-3.5" />
            {!compact && (hasAnyTags ? myTagSet.size : 'Tag')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="end">
          <div className="space-y-0.5">
            {Object.entries(TAG_CONFIG).map(([key, config]) => {
              const Icon = config.icon
              const isActive = myTagSet.has(key)
              const count = tagCounts?.[key] ?? 0

              return (
                <button
                  key={key}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors ${
                    isActive ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                  onClick={() => {
                    toggleTag.mutate(key)
                  }}
                >
                  <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                  <span className="flex-1">{config.label}</span>
                  {isActive && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                  {count > 0 && !isActive && <span className="text-xs text-slate-400">{count}</span>}
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
