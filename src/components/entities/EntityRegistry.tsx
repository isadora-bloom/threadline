'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EntityCard } from './EntityCard'
import { CreateEntityDialog } from './CreateEntityDialog'
import { Search, Plus, Users } from 'lucide-react'
import { labelForEntityType } from '@/lib/utils'
import type { EntityType, EntityWithClaimCount } from '@/lib/types'

const ENTITY_TYPES: EntityType[] = ['person', 'location', 'vehicle', 'phone', 'username', 'organization', 'document', 'other']

interface EntityRegistryProps {
  caseId: string
}

export function EntityRegistry({ caseId }: EntityRegistryProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<EntityType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const { data: entities, isLoading } = useQuery({
    queryKey: ['entities', caseId, activeTab, search],
    queryFn: async () => {
      let query = supabase
        .from('entities')
        .select('*')
        .eq('case_id', caseId)
        .order('updated_at', { ascending: false })

      if (activeTab !== 'all') {
        query = query.eq('entity_type', activeTab)
      }

      if (search) {
        query = query.or(`raw_value.ilike.%${search}%,normalized_value.ilike.%${search}%`)
      }

      const { data, error } = await query
      if (error) throw error

      // Fetch claim counts
      const enriched: EntityWithClaimCount[] = await Promise.all(
        (data ?? []).map(async (e) => {
          const { count } = await supabase
            .from('claim_entity_links')
            .select('id', { count: 'exact', head: true })
            .eq('entity_id', e.id)

          return { ...e, claim_count: count ?? 0 }
        })
      )

      return enriched
    },
  })

  const { data: typeCounts } = useQuery({
    queryKey: ['entity-type-counts', caseId],
    queryFn: async () => {
      const counts: Record<string, number> = {}
      for (const type of ENTITY_TYPES) {
        const { count } = await supabase
          .from('entities')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .eq('entity_type', type)
        counts[type] = count ?? 0
      }
      return counts
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <Search className="h-4 w-4 text-slate-400 absolute ml-2.5 pointer-events-none" />
          <Input
            placeholder="Search entities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          Add entity
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EntityType | 'all')}>
        <TabsList className="flex-wrap h-auto gap-1 bg-slate-100 p-1">
          <TabsTrigger value="all" className="text-xs">
            All ({entities?.length ?? 0})
          </TabsTrigger>
          {ENTITY_TYPES.map((type) => {
            const count = typeCounts?.[type] ?? 0
            if (count === 0 && activeTab !== type) return null
            return (
              <TabsTrigger key={type} value={type} className="text-xs">
                {labelForEntityType(type)} ({count})
              </TabsTrigger>
            )
          })}
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-slate-100 rounded-md animate-pulse" />
              ))}
            </div>
          ) : !entities || entities.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
              <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="font-medium text-slate-600">No entities found</p>
              <p className="text-sm text-slate-400 mt-1">
                Entities are created during claim review or from intake forms.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {entities.map((entity) => (
                <EntityCard
                  key={entity.id}
                  entity={entity}
                  caseId={caseId}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {showCreate && (
        <CreateEntityDialog
          caseId={caseId}
          onClose={() => {
            setShowCreate(false)
            queryClient.invalidateQueries({ queryKey: ['entities', caseId] })
            queryClient.invalidateQueries({ queryKey: ['entity-type-counts', caseId] })
          }}
        />
      )}
    </div>
  )
}
