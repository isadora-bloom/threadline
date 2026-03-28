'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  User,
  Plus,
  X,
  Search,
  MapPin,
  Dna,
  Palette,
  Newspaper,
  Scale,
  BarChart3,
  Globe2,
  Stethoscope,
  Languages,
  Shield,
  Heart,
  Map,
} from 'lucide-react'

const SKILL_CONFIG: Record<string, { label: string; description: string; icon: typeof Search; color: string }> = {
  osint:            { label: 'OSINT Research',     description: 'Social media, public records, digital footprints', icon: Search,      color: 'bg-blue-100 text-blue-700' },
  genealogy:        { label: 'Genealogy',          description: 'Family trees, DNA matching, ancestry databases',   icon: Dna,         color: 'bg-purple-100 text-purple-700' },
  forensic_art:     { label: 'Forensic Art',       description: 'Facial reconstruction, age progression',          icon: Palette,     color: 'bg-pink-100 text-pink-700' },
  journalism:       { label: 'Journalism',         description: 'Media outreach, FOIA requests, news archives',    icon: Newspaper,   color: 'bg-amber-100 text-amber-700' },
  legal:            { label: 'Legal Research',      description: 'Court records, case law, public filings',         icon: Scale,       color: 'bg-slate-100 text-slate-700' },
  data_analysis:    { label: 'Data Analysis',       description: 'Pattern analysis, statistics, visualization',     icon: BarChart3,   color: 'bg-green-100 text-green-700' },
  geospatial:       { label: 'Geospatial',          description: 'GIS, mapping, terrain, satellite imagery',        icon: Globe2,      color: 'bg-teal-100 text-teal-700' },
  medical_forensic: { label: 'Medical / Forensic',  description: 'Medical knowledge, forensic science',             icon: Stethoscope, color: 'bg-red-100 text-red-700' },
  languages:        { label: 'Languages',           description: 'Translation, non-English source research',        icon: Languages,   color: 'bg-indigo-100 text-indigo-700' },
  law_enforcement:  { label: 'Law Enforcement',     description: 'Current or former LE experience',                 icon: Shield,      color: 'bg-sky-100 text-sky-700' },
  victim_advocacy:  { label: 'Victim Advocacy',     description: 'Family support, grief counseling, advocacy',      icon: Heart,       color: 'bg-rose-100 text-rose-700' },
  local_knowledge:  { label: 'Local Knowledge',     description: 'Deep knowledge of a specific region',             icon: Map,         color: 'bg-orange-100 text-orange-700' },
}

export default function ProfilePage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [addingSkill, setAddingSkill] = useState(false)
  const [newSkill, setNewSkill] = useState('')
  const [newProficiency, setNewProficiency] = useState('intermediate')
  const [newNotes, setNewNotes] = useState('')
  const [newRegion, setNewRegion] = useState('')

  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser()
      return data.user
    },
  })

  const { data: profile } = useQuery({
    queryKey: ['user-profile'],
    queryFn: async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) return null
      const { data } = await supabase.from('user_profiles').select('*').eq('id', u.id).single()
      return data
    },
  })

  const { data: skills } = useQuery({
    queryKey: ['my-skills'],
    queryFn: async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) return []
      const { data } = await supabase.from('user_skills').select('*').eq('user_id', u.id)
      return data ?? []
    },
  })

  const { data: activityStats } = useQuery({
    queryKey: ['my-activity'],
    queryFn: async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) return { watching: 0, notes: 0, research: 0 }
      const [watching, notes, research] = await Promise.all([
        supabase.from('user_watchlist').select('id', { count: 'exact', head: true }).eq('user_id', u.id),
        supabase.from('community_notes').select('id', { count: 'exact', head: true }).eq('user_id', u.id),
        supabase.from('deep_research').select('id', { count: 'exact', head: true }).eq('requested_by', u.id),
      ])
      return { watching: watching.count ?? 0, notes: notes.count ?? 0, research: research.count ?? 0 }
    },
  })

  const addSkillMutation = useMutation({
    mutationFn: async () => {
      if (!newSkill || !user) return
      await supabase.from('user_skills').insert({
        user_id: user.id,
        skill: newSkill,
        proficiency: newProficiency,
        notes: newNotes || null,
        region: newRegion || null,
      })
    },
    onSuccess: () => {
      setAddingSkill(false)
      setNewSkill('')
      setNewNotes('')
      setNewRegion('')
      queryClient.invalidateQueries({ queryKey: ['my-skills'] })
    },
  })

  const removeSkillMutation = useMutation({
    mutationFn: async (skillId: string) => {
      await supabase.from('user_skills').delete().eq('id', skillId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-skills'] })
    },
  })

  const existingSkillTypes = new Set(skills?.map(s => s.skill) ?? [])

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <User className="h-5 w-5 text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900">Your Profile</h1>
        </div>
        <p className="text-sm text-slate-500">
          Tell Threadline what you&apos;re good at. We&apos;ll match you with cases that need your specific skills.
        </p>
      </div>

      {/* Activity */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{activityStats?.watching ?? 0}</div>
            <div className="text-xs text-slate-500">Cases watched</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{activityStats?.notes ?? 0}</div>
            <div className="text-xs text-slate-500">Notes shared</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{activityStats?.research ?? 0}</div>
            <div className="text-xs text-slate-500">Research runs</div>
          </CardContent>
        </Card>
      </div>

      {/* Skills */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Your Skills</CardTitle>
            {!addingSkill && (
              <Button size="sm" variant="outline" onClick={() => setAddingSkill(true)}>
                <Plus className="h-4 w-4" />
                Add skill
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Cases that need your expertise will appear on your &quot;Needs You&quot; page.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Existing skills */}
          {skills?.map((skill) => {
            const config = SKILL_CONFIG[skill.skill]
            if (!config) return null
            const Icon = config.icon

            return (
              <div key={skill.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${config.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-slate-900">{config.label}</span>
                    <Badge variant="outline" className="text-xs">{skill.proficiency}</Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{config.description}</p>
                  {skill.notes && <p className="text-xs text-slate-600 mt-1 italic">{skill.notes}</p>}
                  {skill.region && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500 mt-1">
                      <MapPin className="h-3 w-3" />
                      {skill.region}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-400 hover:text-red-500"
                  onClick={() => removeSkillMutation.mutate(skill.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )
          })}

          {(!skills || skills.length === 0) && !addingSkill && (
            <div className="text-center py-8 text-sm text-slate-400">
              No skills added yet. Add your first skill to get matched with cases.
            </div>
          )}

          {/* Add skill form */}
          {addingSkill && (
            <div className="p-4 border border-indigo-200 bg-indigo-50 rounded-lg space-y-3">
              <Select value={newSkill} onValueChange={setNewSkill}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a skill..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SKILL_CONFIG)
                    .filter(([key]) => !existingSkillTypes.has(key))
                    .map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        {config.label} — {config.description}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>

              <Select value={newProficiency} onValueChange={setNewProficiency}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner — learning</SelectItem>
                  <SelectItem value="intermediate">Intermediate — capable</SelectItem>
                  <SelectItem value="expert">Expert — years of experience</SelectItem>
                  <SelectItem value="professional">Professional — this is my job</SelectItem>
                </SelectContent>
              </Select>

              <Textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Optional: tools you have access to, specific experience, etc."
                rows={2}
                className="text-sm"
              />

              {newSkill === 'local_knowledge' && (
                <Input
                  value={newRegion}
                  onChange={(e) => setNewRegion(e.target.value)}
                  placeholder="Region (e.g. Virginia, Pacific Northwest, I-95 corridor)"
                />
              )}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => addSkillMutation.mutate()}
                  disabled={!newSkill || addSkillMutation.isPending}
                >
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingSkill(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* How matching works */}
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">How skill matching works</h3>
          <div className="text-xs text-slate-600 space-y-1.5">
            <p>When you add skills, Threadline personalizes your experience:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><span className="font-medium">Genealogy</span> — You&apos;ll see cases where DNA is available but no family tree work has been done</li>
              <li><span className="font-medium">OSINT</span> — Cases where social media accounts went silent or digital trails exist</li>
              <li><span className="font-medium">Journalism</span> — Cases with no media coverage that could benefit from attention</li>
              <li><span className="font-medium">Local knowledge</span> — Cases in your region where terrain, community, or local context matters</li>
              <li><span className="font-medium">Forensic art</span> — Unidentified remains with no facial reconstruction</li>
              <li><span className="font-medium">Legal</span> — Cases where court records, property records, or legal filings might reveal connections</li>
            </ul>
            <p className="mt-2 text-slate-500">
              This isn&apos;t about credentials. A retired librarian who knows how to search newspaper archives
              is exactly as valuable as a forensic scientist. Different cases need different people.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
