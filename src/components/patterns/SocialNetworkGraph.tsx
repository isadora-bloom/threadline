'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Users, Plus, Loader2 } from 'lucide-react'
import type { Entity, PersonRelationship } from '@/lib/types'

interface SocialNetworkGraphProps {
  caseId: string
}

interface GraphNode {
  id: string
  label: string
  claimCount: number
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

interface GraphEdge {
  source: string | GraphNode
  target: string | GraphNode
  relationship_type: string
  confidence: string
  id: string
}

interface SelectedNodeData {
  entity: Entity & { claimCount: number }
  relationships: PersonRelationship[]
}

const RELATIONSHIP_COLORS: Record<string, string> = {
  family: '#8b5cf6',
  romantic_partner: '#ec4899',
  employer: '#3b82f6',
  coworker: '#06b6d4',
  neighbor: '#10b981',
  acquaintance: '#f59e0b',
  service_provider: '#6366f1',
  unknown: '#94a3b8',
}

export function SocialNetworkGraph({ caseId }: SocialNetworkGraphProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const svgRef = useRef<SVGSVGElement>(null)
  const simulationRef = useRef<unknown>(null)
  const [selectedNode, setSelectedNode] = useState<SelectedNodeData | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [confidenceFilter, setConfidenceFilter] = useState<string>('all')
  const [showAddRelationship, setShowAddRelationship] = useState(false)
  const [newRel, setNewRel] = useState({
    entity_a: '',
    entity_b: '',
    relationship_type: 'unknown',
    confidence: 'medium',
    notes: '',
  })

  const { data: personEntities, isLoading: entitiesLoading } = useQuery({
    queryKey: ['person-entities', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entities')
        .select('*')
        .eq('case_id', caseId)
        .eq('entity_type', 'person')

      if (error) throw error

      const entityIds = (data ?? []).map((e) => e.id)
      if (entityIds.length === 0) return []

      const { data: linkData } = await supabase
        .from('claim_entity_links')
        .select('entity_id')
        .in('entity_id', entityIds)

      const claimCounts = new Map<string, number>()
      for (const link of linkData ?? []) {
        claimCounts.set(link.entity_id, (claimCounts.get(link.entity_id) ?? 0) + 1)
      }

      return (data ?? []).map((e) => ({
        ...e,
        claimCount: claimCounts.get(e.id) ?? 0,
      }))
    },
  })

  const { data: relationships } = useQuery({
    queryKey: ['person-relationships', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('person_relationships')
        .select('*')
        .eq('case_id', caseId)

      if (error) throw error
      return data ?? []
    },
  })

  const addRelationshipMutation = useMutation({
    mutationFn: async (rel: typeof newRel) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase.from('person_relationships').insert({
        case_id: caseId,
        person_entity_id_a: rel.entity_a,
        person_entity_id_b: rel.entity_b,
        relationship_type: rel.relationship_type,
        confidence: rel.confidence as 'low' | 'medium' | 'high',
        notes: rel.notes || null,
        created_by: user.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-relationships', caseId] })
      setShowAddRelationship(false)
      setNewRel({ entity_a: '', entity_b: '', relationship_type: 'unknown', confidence: 'medium', notes: '' })
      toast({ title: 'Relationship added' })
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Failed to add relationship', description: err.message })
    },
  })

  const filteredRelationships = (relationships ?? []).filter((r) => {
    if (typeFilter !== 'all' && r.relationship_type !== typeFilter) return false
    if (confidenceFilter !== 'all' && r.confidence !== confidenceFilter) return false
    return true
  })

  const handleNodeClick = useCallback(
    async (entity: Entity & { claimCount: number }) => {
      const entityRelationships = (relationships ?? []).filter(
        (r) => r.person_entity_id_a === entity.id || r.person_entity_id_b === entity.id
      )
      setSelectedNode({ entity, relationships: entityRelationships })
    },
    [relationships]
  )

  // D3 force simulation
  useEffect(() => {
    if (!svgRef.current || !personEntities || !relationships) return

    import('d3').then((d3) => {
      if (!svgRef.current) return

      const svg = d3.select(svgRef.current)
      svg.selectAll('*').remove()

      const width = svgRef.current.clientWidth || 600
      const height = 400

      svg.attr('viewBox', `0 0 ${width} ${height}`)

      const nodes: GraphNode[] = personEntities.map((e) => ({
        id: e.id,
        label: e.normalized_value ?? e.raw_value,
        claimCount: e.claimCount,
      }))

      const edges: GraphEdge[] = filteredRelationships
        .filter((r) => {
          const hasA = nodes.some((n) => n.id === r.person_entity_id_a)
          const hasB = nodes.some((n) => n.id === r.person_entity_id_b)
          return hasA && hasB
        })
        .map((r) => ({
          source: r.person_entity_id_a,
          target: r.person_entity_id_b,
          relationship_type: r.relationship_type,
          confidence: r.confidence,
          id: r.id,
        }))

      if (nodes.length === 0) return

      // Add arrow marker
      svg.append('defs').append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#94a3b8')

      const g = svg.append('g')

      // Zoom behavior
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => {
          g.attr('transform', event.transform)
        })
      svg.call(zoom)

      // Force simulation
      const simulation = d3.forceSimulation<GraphNode>(nodes)
        .force('link', d3.forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.id)
          .distance(120))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(30))

      simulationRef.current = simulation

      // Draw edges
      const link = g.append('g')
        .selectAll('line')
        .data(edges)
        .enter()
        .append('line')
        .attr('stroke', (d) => RELATIONSHIP_COLORS[d.relationship_type] ?? '#94a3b8')
        .attr('stroke-width', (d) => d.confidence === 'high' ? 2.5 : d.confidence === 'medium' ? 1.5 : 0.75)
        .attr('stroke-opacity', 0.7)
        .attr('marker-end', 'url(#arrowhead)')
        .style('cursor', 'pointer')
        .on('click', (_, d) => {
          const rel = filteredRelationships.find((r) => r.id === d.id)
          if (!rel) return
          // Show edge info as a toast
          toast({
            title: `${d.relationship_type.replace('_', ' ')} relationship`,
            description: `Confidence: ${d.confidence}`,
          })
        })

      // Edge labels
      const edgeLabel = g.append('g')
        .selectAll('text')
        .data(edges)
        .enter()
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('font-size', 9)
        .attr('fill', '#94a3b8')
        .text((d) => d.relationship_type.replace('_', ' '))

      // Draw nodes
      const nodeG = g.append('g')
        .selectAll('g')
        .data(nodes)
        .enter()
        .append('g')
        .style('cursor', 'pointer')
        .call(
          d3.drag<SVGGElement, GraphNode>()
            .on('start', (event, d) => {
              if (!event.active) simulation.alphaTarget(0.3).restart()
              d.fx = d.x
              d.fy = d.y
            })
            .on('drag', (event, d) => {
              d.fx = event.x
              d.fy = event.y
            })
            .on('end', (event, d) => {
              if (!event.active) simulation.alphaTarget(0)
              d.fx = null
              d.fy = null
            }) as unknown as (selection: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>) => void
        )
        .on('click', (_, d) => {
          const entity = personEntities.find((e) => e.id === d.id)
          if (entity) handleNodeClick(entity)
        })

      nodeG.append('circle')
        .attr('r', (d) => Math.max(14, Math.min(28, 14 + d.claimCount * 2)))
        .attr('fill', '#6366f1')
        .attr('fill-opacity', 0.15)
        .attr('stroke', '#6366f1')
        .attr('stroke-width', 2)

      nodeG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '-1.5em')
        .attr('font-size', 10)
        .attr('fill', '#334155')
        .attr('font-weight', '500')
        .text((d) => d.label.length > 15 ? d.label.slice(0, 14) + '…' : d.label)

      nodeG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('font-size', 10)
        .attr('fill', '#6366f1')
        .attr('font-weight', '600')
        .text((d) => d.claimCount > 0 ? String(d.claimCount) : '')

      // Tick
      simulation.on('tick', () => {
        link
          .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
          .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
          .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
          .attr('y2', (d) => (d.target as GraphNode).y ?? 0)

        edgeLabel
          .attr('x', (d) => (((d.source as GraphNode).x ?? 0) + ((d.target as GraphNode).x ?? 0)) / 2)
          .attr('y', (d) => (((d.source as GraphNode).y ?? 0) + ((d.target as GraphNode).y ?? 0)) / 2)

        nodeG.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
      })
    })

    return () => {
      if (simulationRef.current) {
        (simulationRef.current as { stop: () => void }).stop()
      }
    }
  }, [personEntities, filteredRelationships, handleNodeClick, toast])

  if (entitiesLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!personEntities || personEntities.length === 0) {
    return (
      <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
        <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="font-medium text-slate-600">No person entities yet</p>
        <p className="text-sm text-slate-400 mt-1">
          Add person entities from submissions to build the social network.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">Relationship type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 text-xs w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="family">Family</SelectItem>
                <SelectItem value="romantic_partner">Romantic partner</SelectItem>
                <SelectItem value="employer">Employer</SelectItem>
                <SelectItem value="coworker">Coworker</SelectItem>
                <SelectItem value="neighbor">Neighbor</SelectItem>
                <SelectItem value="acquaintance">Acquaintance</SelectItem>
                <SelectItem value="service_provider">Service provider</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-500">Confidence</Label>
            <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
              <SelectTrigger className="h-8 text-xs w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAddRelationship(!showAddRelationship)}
        >
          <Plus className="h-4 w-4" />
          Add relationship
        </Button>
      </div>

      {/* Add relationship form */}
      {showAddRelationship && (
        <Card className="border-indigo-200 bg-indigo-50/20">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-medium text-indigo-800">Add relationship</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Person A</Label>
                <Select value={newRel.entity_a} onValueChange={(v) => setNewRel((p) => ({ ...p, entity_a: v }))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select person..." />
                  </SelectTrigger>
                  <SelectContent>
                    {personEntities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.normalized_value ?? e.raw_value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Person B</Label>
                <Select value={newRel.entity_b} onValueChange={(v) => setNewRel((p) => ({ ...p, entity_b: v }))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select person..." />
                  </SelectTrigger>
                  <SelectContent>
                    {personEntities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.normalized_value ?? e.raw_value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Relationship type</Label>
                <Select value={newRel.relationship_type} onValueChange={(v) => setNewRel((p) => ({ ...p, relationship_type: v }))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="family">Family</SelectItem>
                    <SelectItem value="romantic_partner">Romantic partner</SelectItem>
                    <SelectItem value="employer">Employer</SelectItem>
                    <SelectItem value="coworker">Coworker</SelectItem>
                    <SelectItem value="neighbor">Neighbor</SelectItem>
                    <SelectItem value="acquaintance">Acquaintance</SelectItem>
                    <SelectItem value="service_provider">Service provider</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Confidence</Label>
                <Select value={newRel.confidence} onValueChange={(v) => setNewRel((p) => ({ ...p, confidence: v }))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Input
              placeholder="Notes (optional)"
              value={newRel.notes}
              onChange={(e) => setNewRel((p) => ({ ...p, notes: e.target.value }))}
              className="h-8 text-xs"
            />

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => addRelationshipMutation.mutate(newRel)}
                disabled={!newRel.entity_a || !newRel.entity_b || addRelationshipMutation.isPending}
              >
                {addRelationshipMutation.isPending ? 'Saving...' : 'Save relationship'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddRelationship(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(RELATIONSHIP_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block w-3 h-0.5" style={{ backgroundColor: color }} />
            {type.replace('_', ' ')}
          </div>
        ))}
      </div>

      {/* Graph */}
      <div className="flex gap-4">
        <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
          <svg
            ref={svgRef}
            className="w-full"
            style={{ height: '400px' }}
          />
        </div>

        {/* Node detail panel */}
        {selectedNode && (
          <Card className="w-64 flex-shrink-0 border-slate-200">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">
                    {selectedNode.entity.normalized_value ?? selectedNode.entity.raw_value}
                  </p>
                  <p className="text-xs text-slate-500">
                    {selectedNode.entity.claimCount} claim{selectedNode.entity.claimCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-slate-300 hover:text-slate-500 text-lg leading-none"
                >
                  ×
                </button>
              </div>

              {selectedNode.relationships.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                    Relationships
                  </p>
                  {selectedNode.relationships.map((r) => (
                    <div key={r.id} className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: RELATIONSHIP_COLORS[r.relationship_type] ?? '#94a3b8' }}
                      />
                      <span className="text-xs text-slate-600">
                        {r.relationship_type.replace('_', ' ')}
                      </span>
                      <Badge variant="outline" className="text-[10px] ml-auto">
                        {r.confidence}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No relationships recorded.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
