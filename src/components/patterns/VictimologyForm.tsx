'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { Shield, Info } from 'lucide-react'
import type { VictimProfile } from '@/lib/types'

interface VictimologyFormProps {
  caseId: string
}

const EMPTY_FORM = {
  person_entity_id: '',
  age_range_min: '',
  age_range_max: '',
  gender: 'unknown',
  last_known_date: '',
  last_confirmed_contact_type: 'unknown',
  last_confirmed_contact_notes: '',
  employment_status: '',
  transportation_mode: '',
  lifestyle_exposure_level: 'unknown',
  prior_missing_episodes: '0',
  transience_level: 'unknown',
  known_threats: '',
  restraining_orders: false,
  notes: '',
}

export function VictimologyForm({ caseId }: VictimologyFormProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showNewForm, setShowNewForm] = useState(false)

  const { data: profiles, isLoading } = useQuery({
    queryKey: ['victim-profiles', caseId],
    queryFn: async (): Promise<VictimProfile[]> => {
      const { data, error } = await supabase
        .from('victim_profiles')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data ?? []
    },
  })

  const { data: personEntities } = useQuery({
    queryKey: ['person-entities-simple', caseId],
    queryFn: async () => {
      const { data } = await supabase
        .from('entities')
        .select('id, raw_value, normalized_value')
        .eq('case_id', caseId)
        .eq('entity_type', 'person')

      return data ?? []
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (f: typeof EMPTY_FORM) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const payload = {
        case_id: caseId,
        person_entity_id: f.person_entity_id || null,
        age_range_min: f.age_range_min ? parseInt(f.age_range_min) : null,
        age_range_max: f.age_range_max ? parseInt(f.age_range_max) : null,
        gender: f.gender || null,
        last_known_date: f.last_known_date || null,
        last_confirmed_contact_type: f.last_confirmed_contact_type || null,
        last_confirmed_contact_notes: f.last_confirmed_contact_notes || null,
        employment_status: f.employment_status || null,
        transportation_mode: f.transportation_mode || null,
        lifestyle_exposure_level: f.lifestyle_exposure_level || null,
        prior_missing_episodes: parseInt(f.prior_missing_episodes) || 0,
        transience_level: f.transience_level || null,
        known_threats: f.known_threats || null,
        restraining_orders: f.restraining_orders,
        notes: f.notes || null,
        created_by: user.id,
      }

      if (editing) {
        const { error } = await supabase
          .from('victim_profiles')
          .update(payload)
          .eq('id', editing)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('victim_profiles')
          .insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['victim-profiles', caseId] })
      setShowNewForm(false)
      setEditing(null)
      setForm(EMPTY_FORM)
      toast({ title: editing ? 'Profile updated' : 'Profile created' })
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Failed to save', description: err.message })
    },
  })

  function startEdit(profile: VictimProfile) {
    setEditing(profile.id)
    setForm({
      person_entity_id: profile.person_entity_id ?? '',
      age_range_min: profile.age_range_min?.toString() ?? '',
      age_range_max: profile.age_range_max?.toString() ?? '',
      gender: profile.gender ?? 'unknown',
      last_known_date: profile.last_known_date
        ? new Date(profile.last_known_date).toISOString().split('T')[0]
        : '',
      last_confirmed_contact_type: profile.last_confirmed_contact_type ?? 'unknown',
      last_confirmed_contact_notes: profile.last_confirmed_contact_notes ?? '',
      employment_status: profile.employment_status ?? '',
      transportation_mode: profile.transportation_mode ?? '',
      lifestyle_exposure_level: profile.lifestyle_exposure_level ?? 'unknown',
      prior_missing_episodes: profile.prior_missing_episodes?.toString() ?? '0',
      transience_level: profile.transience_level ?? 'unknown',
      known_threats: profile.known_threats ?? '',
      restraining_orders: profile.restraining_orders ?? false,
      notes: profile.notes ?? '',
    })
    setShowNewForm(true)
  }

  const ProfileCard = ({ profile }: { profile: VictimProfile }) => {
    const linkedEntity = personEntities?.find((e) => e.id === profile.person_entity_id)
    return (
      <Card className="border-slate-200">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium text-slate-800 text-sm">
                {linkedEntity ? (linkedEntity.normalized_value ?? linkedEntity.raw_value) : 'Unnamed profile'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {profile.gender && profile.gender !== 'unknown' && (
                  <Badge variant="outline" className="text-xs capitalize">{profile.gender}</Badge>
                )}
                {(profile.age_range_min || profile.age_range_max) && (
                  <Badge variant="outline" className="text-xs">
                    Age {profile.age_range_min ?? '?'}–{profile.age_range_max ?? '?'}
                  </Badge>
                )}
                {profile.lifestyle_exposure_level && profile.lifestyle_exposure_level !== 'unknown' && (
                  <Badge variant="outline" className="text-xs capitalize">
                    Exposure: {profile.lifestyle_exposure_level}
                  </Badge>
                )}
              </div>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startEdit(profile)}>
              Edit
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {/* Ethics notice */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-lg p-4">
        <Shield className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-blue-800">
            This information is used only for pattern analysis
          </p>
          <p className="text-xs text-blue-700 leading-relaxed">
            Victim profile data is never used to assign blame, evaluate the victim&apos;s worthiness,
            or rank the importance of this case. All fields exist solely to assist investigators
            in identifying potential patterns across cases.
          </p>
        </div>
      </div>

      {/* Existing profiles */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-20 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : (profiles ?? []).length > 0 ? (
        <div className="space-y-3">
          {profiles!.map((p) => (
            <ProfileCard key={p.id} profile={p} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400 text-center py-4">No victim profiles yet.</p>
      )}

      {/* Toggle form */}
      {!showNewForm && (
        <Button variant="outline" size="sm" onClick={() => setShowNewForm(true)}>
          <Info className="h-4 w-4" />
          Add victim profile
        </Button>
      )}

      {/* Form */}
      {showNewForm && (
        <Card className="border-indigo-200 bg-indigo-50/20">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm text-indigo-800">
              {editing ? 'Edit victim profile' : 'New victim profile'}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {/* Linked person entity */}
            <div className="space-y-1.5">
              <Label className="text-xs">Linked person entity (optional)</Label>
              <Select
                value={form.person_entity_id}
                onValueChange={(v) => setForm((p) => ({ ...p, person_entity_id: v }))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select person entity..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {personEntities?.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.normalized_value ?? e.raw_value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Demographics */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
                Demographics — never used to rank case importance
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Gender</Label>
                  <Select value={form.gender} onValueChange={(v) => setForm((p) => ({ ...p, gender: v }))}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Unknown</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="nonbinary">Nonbinary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Age min</Label>
                  <Input
                    type="number"
                    value={form.age_range_min}
                    onChange={(e) => setForm((p) => ({ ...p, age_range_min: e.target.value }))}
                    className="h-8 text-xs"
                    placeholder="e.g. 25"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Age max</Label>
                  <Input
                    type="number"
                    value={form.age_range_max}
                    onChange={(e) => setForm((p) => ({ ...p, age_range_max: e.target.value }))}
                    className="h-8 text-xs"
                    placeholder="e.g. 35"
                  />
                </div>
              </div>
            </div>

            {/* Last known */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
                Last known information
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Last known date</Label>
                  <Input
                    type="date"
                    value={form.last_known_date}
                    onChange={(e) => setForm((p) => ({ ...p, last_known_date: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Last confirmed contact type</Label>
                  <Select
                    value={form.last_confirmed_contact_type}
                    onValueChange={(v) => setForm((p) => ({ ...p, last_confirmed_contact_type: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Unknown</SelectItem>
                      <SelectItem value="in_person">In person</SelectItem>
                      <SelectItem value="phone">Phone</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="social_media">Social media</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5 mt-3">
                <Label className="text-xs">Last contact notes</Label>
                <Input
                  value={form.last_confirmed_contact_notes}
                  onChange={(e) => setForm((p) => ({ ...p, last_confirmed_contact_notes: e.target.value }))}
                  className="h-8 text-xs"
                  placeholder="Context about last contact..."
                />
              </div>
            </div>

            {/* Routine */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
                Routine
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Employment status</Label>
                  <Input
                    value={form.employment_status}
                    onChange={(e) => setForm((p) => ({ ...p, employment_status: e.target.value }))}
                    className="h-8 text-xs"
                    placeholder="e.g. employed, unemployed..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Transportation mode</Label>
                  <Input
                    value={form.transportation_mode}
                    onChange={(e) => setForm((p) => ({ ...p, transportation_mode: e.target.value }))}
                    className="h-8 text-xs"
                    placeholder="e.g. own vehicle, hitchhiking..."
                  />
                </div>
              </div>
            </div>

            {/* Risk factors */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">
                Pattern analysis factors — not judgments
              </p>
              <p className="text-xs text-slate-400 mb-2">
                These fields assist pattern matching only. They are never used to evaluate
                the victim&apos;s worthiness or blame them for what occurred.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1">
                    <Label className="text-xs">Routine exposure level</Label>
                    <span className="text-[10px] text-slate-400">(?)</span>
                  </div>
                  <Select
                    value={form.lifestyle_exposure_level}
                    onValueChange={(v) => setForm((p) => ({ ...p, lifestyle_exposure_level: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Unknown</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High — frequent contact with strangers in routine</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-slate-400">
                    High = frequent contact with strangers in routine — not a judgment of behavior
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Transience level</Label>
                  <Select
                    value={form.transience_level}
                    onValueChange={(v) => setForm((p) => ({ ...p, transience_level: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Unknown</SelectItem>
                      <SelectItem value="stable">Stable — fixed address</SelectItem>
                      <SelectItem value="semi_transient">Semi-transient</SelectItem>
                      <SelectItem value="transient">Transient</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5 mt-3">
                <Label className="text-xs">Prior missing episodes</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.prior_missing_episodes}
                  onChange={(e) => setForm((p) => ({ ...p, prior_missing_episodes: e.target.value }))}
                  className="h-8 text-xs w-24"
                />
              </div>
            </div>

            {/* Threat context */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
                Threat context
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Known threats</Label>
                  <Input
                    value={form.known_threats}
                    onChange={(e) => setForm((p) => ({ ...p, known_threats: e.target.value }))}
                    className="h-8 text-xs"
                    placeholder="Known threats or persons of concern..."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="restraining_orders"
                    checked={form.restraining_orders}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, restraining_orders: !!v }))}
                  />
                  <Label htmlFor="restraining_orders" className="text-xs cursor-pointer">
                    Active restraining orders
                  </Label>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="text-xs min-h-[60px]"
                placeholder="Additional context..."
              />
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving...' : editing ? 'Update profile' : 'Save profile'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowNewForm(false)
                  setEditing(null)
                  setForm(EMPTY_FORM)
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
