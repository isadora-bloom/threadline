'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Star,
  User,
  MapPin,
  Calendar,
  ChevronRight,
  Eye,
  MessageSquare,
  Plus,
  Trash2,
  Users,
  Flame,
  Brain,
  Search,
} from 'lucide-react'

export default function MyWatchlistPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteType, setNoteType] = useState('observation')

  // Get current user
  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser()
      return data.user
    },
  })

  // Fetch watchlist with record details
  const { data: watchlist, isLoading } = useQuery({
    queryKey: ['my-watchlist'],
    queryFn: async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) return []

      const { data } = await supabase
        .from('user_watchlist')
        .select('*, import_record:import_records(*, source:import_sources(display_name))')
        .eq('user_id', u.id)
        .order('position', { ascending: true })

      return data ?? []
    },
  })

  // Fetch watcher counts for all watched records
  const recordIds = watchlist?.map(w => w.import_record_id) ?? []
  const { data: watcherCounts } = useQuery({
    queryKey: ['watcher-counts', recordIds],
    queryFn: async () => {
      if (recordIds.length === 0) return {}
      const { data } = await supabase
        .from('user_watchlist')
        .select('import_record_id')
        .in('import_record_id', recordIds)

      const counts: Record<string, number> = {}
      for (const w of data ?? []) {
        counts[w.import_record_id] = (counts[w.import_record_id] ?? 0) + 1
      }
      return counts
    },
    enabled: recordIds.length > 0,
  })

  // Fetch community notes for watched records
  const { data: recentNotes } = useQuery({
    queryKey: ['watchlist-notes', recordIds],
    queryFn: async () => {
      if (recordIds.length === 0) return []
      const { data } = await supabase
        .from('community_notes')
        .select('*, user:user_profiles(full_name), import_record:import_records(person_name, external_id)')
        .in('import_record_id', recordIds)
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(20)

      return data ?? []
    },
    enabled: recordIds.length > 0,
  })

  // Fetch solvability for watched records
  const { data: solvabilityMap } = useQuery({
    queryKey: ['watchlist-solvability', recordIds],
    queryFn: async () => {
      if (recordIds.length === 0) return {}
      const { data } = await supabase
        .from('solvability_scores')
        .select('import_record_id, score, grade')
        .in('import_record_id', recordIds)

      const map: Record<string, { score: number; grade: string }> = {}
      for (const s of data ?? []) {
        map[s.import_record_id] = { score: s.score, grade: s.grade }
      }
      return map
    },
    enabled: recordIds.length > 0,
  })

  // Remove from watchlist
  const removeMutation = useMutation({
    mutationFn: async (recordId: string) => {
      await supabase
        .from('user_watchlist')
        .delete()
        .eq('import_record_id', recordId)
        .eq('user_id', user?.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-watchlist'] })
    },
  })

  // Add community note
  const addNoteMutation = useMutation({
    mutationFn: async ({ recordId, content, type }: { recordId: string; content: string; type: string }) => {
      await supabase.from('community_notes').insert({
        user_id: user?.id,
        import_record_id: recordId,
        note_type: type,
        content,
        is_public: true,
      })
    },
    onSuccess: () => {
      setNoteText('')
      setSelectedRecord(null)
      queryClient.invalidateQueries({ queryKey: ['watchlist-notes'] })
    },
  })

  // Activity stats
  const { data: myStats } = useQuery({
    queryKey: ['my-activity-stats'],
    queryFn: async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) return { watching: 0, notes: 0 }

      const [watching, notes] = await Promise.all([
        supabase.from('user_watchlist').select('id', { count: 'exact', head: true }).eq('user_id', u.id),
        supabase.from('community_notes').select('id', { count: 'exact', head: true }).eq('user_id', u.id),
      ])

      return {
        watching: watching.count ?? 0,
        notes: notes.count ?? 0,
      }
    },
  })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
          <h1 className="text-2xl font-bold text-slate-900">My Watchlist</h1>
        </div>
        <p className="text-sm text-slate-500">
          Cases you&apos;re following. Add notes, track updates, connect with others investigating the same cases.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Watching</div>
            <div className="text-2xl font-bold text-amber-700 mt-1">{myStats?.watching ?? 0}</div>
            <div className="text-xs text-slate-400">of 10 max</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Notes Shared</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{myStats?.notes ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-500">Community Activity</div>
            <div className="text-2xl font-bold text-indigo-700 mt-1">{recentNotes?.length ?? 0}</div>
            <div className="text-xs text-slate-400">recent notes on your cases</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Watchlist */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Your Cases</h2>
            <Button variant="outline" size="sm" asChild>
              <Link href="/registry">
                <Search className="h-4 w-4" />
                Find cases
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-24 bg-slate-100 rounded-lg animate-pulse" />)}
            </div>
          ) : !watchlist?.length ? (
            <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
              <Star className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <h3 className="font-semibold text-slate-700 mb-1">No cases on your watchlist</h3>
              <p className="text-sm text-slate-400 max-w-sm mx-auto mb-4">
                Browse the registry and click &quot;Watch&quot; on cases you want to follow.
                You can watch up to 10 cases.
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button asChild>
                  <Link href="/registry">
                    <Search className="h-4 w-4" />
                    Browse Registry
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/needing-attention">
                    <Flame className="h-4 w-4" />
                    Cases That Need You
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {watchlist.map((item) => {
                const record = item.import_record as Record<string, unknown> & {
                  source: { display_name: string } | null
                } | null
                if (!record) return null

                const isMissing = record.record_type === 'missing_person'
                const watchers = watcherCounts?.[item.import_record_id] ?? 0
                const solv = solvabilityMap?.[item.import_record_id]

                return (
                  <Card key={item.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0 ${
                          isMissing ? 'bg-blue-100' : 'bg-slate-100'
                        }`}>
                          <User className={`h-5 w-5 ${isMissing ? 'text-blue-600' : 'text-slate-500'}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Link href={`/registry/${item.import_record_id}`} className="font-semibold text-slate-900 text-sm hover:text-indigo-600">
                              {record.person_name as string ?? 'Unidentified'}
                            </Link>
                            <Badge variant={isMissing ? 'default' : 'secondary'} className="text-xs">
                              {isMissing ? 'Missing' : 'Unidentified'}
                            </Badge>
                            {solv && (
                              <Badge className={`text-xs ${
                                solv.grade === 'high' ? 'bg-green-100 text-green-700' :
                                solv.grade === 'moderate' ? 'bg-amber-100 text-amber-700' :
                                'bg-slate-100 text-slate-500'
                              }`}>
                                Solvability: {solv.score}
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            {record.sex && <span>{record.sex as string}</span>}
                            {record.age_text && <span>Age {record.age_text as string}</span>}
                            {(record.city || record.state) && (
                              <span className="flex items-center gap-0.5">
                                <MapPin className="h-3 w-3" />
                                {[record.city, record.state].filter(Boolean).join(', ')}
                              </span>
                            )}
                            {(record.date_missing || record.date_found) && (
                              <span className="flex items-center gap-0.5">
                                <Calendar className="h-3 w-3" />
                                {isMissing ? record.date_missing as string : record.date_found as string}
                              </span>
                            )}
                            <span className="flex items-center gap-0.5">
                              <Users className="h-3 w-3" />
                              {watchers} watching
                            </span>
                          </div>

                          {/* Add note inline */}
                          {selectedRecord === item.import_record_id ? (
                            <div className="mt-3 space-y-2">
                              <Textarea
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                placeholder="Share an observation, question, or lead..."
                                className="text-sm"
                                rows={2}
                              />
                              <div className="flex items-center gap-2">
                                <Select value={noteType} onValueChange={setNoteType}>
                                  <SelectTrigger className="w-[150px] h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="observation">Observation</SelectItem>
                                    <SelectItem value="question">Question</SelectItem>
                                    <SelectItem value="lead">Lead</SelectItem>
                                    <SelectItem value="research_offer">Research Offer</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="sm"
                                  onClick={() => addNoteMutation.mutate({
                                    recordId: item.import_record_id,
                                    content: noteText,
                                    type: noteType,
                                  })}
                                  disabled={!noteText.trim() || addNoteMutation.isPending}
                                >
                                  Post
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => { setSelectedRecord(null); setNoteText('') }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 mt-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7"
                                onClick={() => setSelectedRecord(item.import_record_id)}
                              >
                                <MessageSquare className="h-3 w-3" />
                                Add note
                              </Button>
                              <Button variant="ghost" size="sm" className="text-xs h-7" asChild>
                                <Link href={`/registry/${item.import_record_id}`}>
                                  <Brain className="h-3 w-3" />
                                  View profile
                                </Link>
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-red-500"
                            onClick={() => removeMutation.mutate(item.import_record_id)}
                            title="Remove from watchlist"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Community feed */}
        <div className="space-y-4">
          <h2 className="font-semibold text-slate-900">Community Activity</h2>
          <p className="text-xs text-slate-500">
            Notes from others investigating your cases.
          </p>

          {!recentNotes?.length ? (
            <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-lg">
              <MessageSquare className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No community notes yet.</p>
              <p className="text-xs text-slate-400 mt-1">Be the first to share an observation.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentNotes.map((note) => {
                const noteUser = note.user as { full_name: string | null } | null
                const noteRecord = note.import_record as { person_name: string | null; external_id: string } | null

                return (
                  <Card key={note.id}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="outline" className="text-xs">{note.note_type}</Badge>
                        <span className="text-xs text-slate-500">
                          {noteUser?.full_name ?? 'Anonymous'}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(note.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">{note.content}</p>
                      <Link
                        href={`/registry/${note.import_record_id}`}
                        className="text-xs text-indigo-600 hover:text-indigo-800 mt-1.5 inline-block"
                      >
                        Re: {noteRecord?.person_name ?? noteRecord?.external_id ?? 'Unknown'}
                      </Link>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
