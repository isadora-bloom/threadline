'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuditLog } from '@/hooks/useAuditLog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/ui/use-toast'
import {
  getPublicSubmitUrl,
  labelForUserRole,
  formatDate,
} from '@/lib/utils'
import { CopyButton } from '@/components/shared/CopyButton'
import { Plus, Link2, AlertTriangle, UserMinus, Mail, Trash2, Lock, LockOpen } from 'lucide-react'
import type { Case, UserRole, CaseInvitation } from '@/lib/types'

interface TeamMember {
  id: string
  user_id: string
  role: UserRole
  created_at: string
  profile: { full_name?: string; organization?: string } | null
}

interface Token {
  id: string
  token: string
  label: string | null
  expires_at: string | null
  is_active: boolean
  created_at: string
}

interface CaseWithLegalHold extends Case {
  legal_hold?: boolean
  legal_hold_set_at?: string | null
  legal_hold_set_by?: string | null
  legal_hold_reason?: string | null
}

interface CaseSettingsProps {
  caseData: CaseWithLegalHold
  teamMembers: TeamMember[]
  tokens: Token[]
  userRole: UserRole
  currentUserId: string
  caseId: string
}

export function CaseSettings({
  caseData,
  teamMembers,
  tokens,
  userRole,
  currentUserId,
  caseId,
}: CaseSettingsProps) {
  const supabase = createClient()
  const router = useRouter()
  const { logAction } = useAuditLog()
  const { toast } = useToast()

  const canManage = ['lead_investigator', 'admin'].includes(userRole)

  // General settings form state
  const [title, setTitle] = useState(caseData.title)
  const [jurisdiction, setJurisdiction] = useState(caseData.jurisdiction ?? '')
  const [status, setStatus] = useState(caseData.status)
  const [caseType, setCaseType] = useState(caseData.case_type)
  const [notes, setNotes] = useState(caseData.notes ?? '')

  // Legal hold
  const [legalHold, setLegalHold] = useState(caseData.legal_hold ?? false)
  const [legalHoldReason, setLegalHoldReason] = useState(caseData.legal_hold_reason ?? '')
  const [legalHoldPending, setLegalHoldPending] = useState(false)

  // Team
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('reviewer')
  const [inviting, setInviting] = useState(false)

  // Fetch pending invitations
  const { data: invitations, refetch: refetchInvitations } = useQuery({
    queryKey: ['case-invitations', caseId],
    queryFn: async (): Promise<CaseInvitation[]> => {
      const res = await fetch(`/api/invitations?caseId=${caseId}`)
      if (!res.ok) return []
      const data = await res.json()
      return data.invitations ?? []
    },
    enabled: canManage,
  })

  // Token label
  const [newTokenLabel, setNewTokenLabel] = useState('')

  const saveGeneralMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('cases')
        .update({ title, jurisdiction: jurisdiction || null, status, case_type: caseType, notes: notes || null })
        .eq('id', caseId)
      if (error) throw error

      await logAction({ action: 'edited', target_type: 'case', target_id: caseId, case_id: caseId })
    },
    onSuccess: () => {
      toast({ title: 'Case updated' })
      router.refresh()
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Error', description: e.message }),
  })

  const generateTokenMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase.from('submission_tokens').insert({
        case_id: caseId,
        label: newTokenLabel || null,
        created_by: user.id,
        is_active: true,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Submission link generated' })
      setNewTokenLabel('')
      router.refresh()
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Error', description: e.message }),
  })

  const deactivateTokenMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      const { error } = await supabase
        .from('submission_tokens')
        .update({ is_active: false })
        .eq('id', tokenId)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Link deactivated' })
      router.refresh()
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('case_user_roles')
        .delete()
        .eq('case_id', caseId)
        .eq('user_id', userId)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Member removed' })
      router.refresh()
    },
  })

  return (
    <Tabs defaultValue="general">
      <TabsList className="mb-6">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="links" id="submission-links">Submission links</TabsTrigger>
        {canManage && <TabsTrigger value="danger">Danger zone</TabsTrigger>}
      </TabsList>

      {/* General */}
      <TabsContent value="general">
        <Card>
          <CardHeader><CardTitle className="text-base">Case details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canManage} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Case type</Label>
                <Select value={caseType} onValueChange={(v) => setCaseType(v as typeof caseType)} disabled={!canManage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="missing_person">Missing Person</SelectItem>
                    <SelectItem value="unidentified_remains">Unidentified Remains</SelectItem>
                    <SelectItem value="homicide">Homicide</SelectItem>
                    <SelectItem value="assault">Assault</SelectItem>
                    <SelectItem value="trafficking">Trafficking</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as typeof status)} disabled={!canManage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Jurisdiction</Label>
              <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} disabled={!canManage} />
            </div>
            <div className="space-y-1.5">
              <Label>Internal notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canManage} className="min-h-[80px]" />
            </div>
            {canManage && (
              <Button onClick={() => saveGeneralMutation.mutate()} disabled={saveGeneralMutation.isPending}>
                {saveGeneralMutation.isPending ? 'Saving...' : 'Save changes'}
              </Button>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Team */}
      <TabsContent value="team">
        <Card>
          <CardHeader><CardTitle className="text-base">Team members ({teamMembers.length})</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {teamMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-md">
                  <div>
                    <p className="text-sm font-medium">{member.profile?.full_name ?? 'Unknown user'}</p>
                    {member.profile?.organization && (
                      <p className="text-xs text-slate-500">{member.profile.organization}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">Added {formatDate(member.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="muted">{labelForUserRole(member.role)}</Badge>
                    {canManage && member.user_id !== currentUserId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-300 hover:text-red-400"
                        onClick={() => removeMemberMutation.mutate(member.user_id)}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {canManage && (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-700">Invite someone</p>
                  <p className="text-xs text-slate-500">
                    An invitation link will be emailed to them. They can be new to Threadline.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="user@organization.org"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="flex-1"
                      type="email"
                    />
                    <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as UserRole)}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="reviewer">Reviewer</SelectItem>
                        <SelectItem value="lead_investigator">Lead Investigator</SelectItem>
                        <SelectItem value="legal">Legal</SelectItem>
                        <SelectItem value="export_only">Export Only</SelectItem>
                        <SelectItem value="contributor">Contributor</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={inviting || !inviteEmail}
                      onClick={async () => {
                        if (!inviteEmail.trim()) return
                        setInviting(true)
                        try {
                          const res = await fetch('/api/invitations', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ caseId, email: inviteEmail.trim(), role: inviteRole }),
                          })
                          const data = await res.json()
                          if (!res.ok) {
                            toast({ variant: 'destructive', title: 'Failed to invite', description: data.error })
                          } else {
                            toast({ title: 'Invitation sent', description: `An invitation has been sent to ${inviteEmail}.` })
                            setInviteEmail('')
                            refetchInvitations()
                          }
                        } catch {
                          toast({ variant: 'destructive', title: 'Network error' })
                        } finally {
                          setInviting(false)
                        }
                      }}
                    >
                      <Mail className="h-4 w-4" />
                      {inviting ? 'Sending…' : 'Send invite'}
                    </Button>
                  </div>
                </div>

                {/* Pending invitations */}
                {invitations && invitations.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm font-medium text-slate-700 mb-2">Pending invitations</p>
                      <div className="space-y-2">
                        {invitations.filter(inv => !inv.accepted_at).map((inv) => (
                          <div
                            key={inv.id}
                            className={`flex items-center justify-between p-2.5 border rounded-md text-sm ${
                              new Date(inv.expires_at) < new Date()
                                ? 'border-slate-100 opacity-60'
                                : 'border-slate-200'
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-800">{inv.email}</span>
                                <Badge variant="muted" className="text-[10px]">{labelForUserRole(inv.role)}</Badge>
                                {new Date(inv.expires_at) < new Date() && (
                                  <Badge variant="muted" className="text-[10px] text-slate-400">Expired</Badge>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 mt-0.5">
                                Sent {formatDate(inv.created_at)} · Expires {formatDate(inv.expires_at)}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-300 hover:text-red-400"
                              onClick={async () => {
                                const res = await fetch(`/api/invitations?id=${inv.id}`, { method: 'DELETE' })
                                if (res.ok) {
                                  toast({ title: 'Invitation revoked' })
                                  refetchInvitations()
                                }
                              }}
                              title="Revoke invitation"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Submission links */}
      <TabsContent value="links">
        <Card>
          <CardHeader><CardTitle className="text-base">Submission links</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              Share these links publicly to allow anonymous or confidential submissions to this case.
            </p>

            <div className="space-y-3">
              {tokens.map((token) => (
                <div key={token.id} className={`p-3 border rounded-md ${token.is_active ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Link2 className="h-4 w-4 text-slate-400" />
                      <span className="text-sm font-medium">{token.label ?? 'Submission form'}</span>
                      <Badge variant={token.is_active ? 'success' as never : 'muted' as never}>
                        {token.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    {canManage && token.is_active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-slate-500 hover:text-red-500"
                        onClick={() => deactivateTokenMutation.mutate(token.id)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 bg-slate-50 rounded p-2 border border-slate-100">
                    <code className="text-xs text-slate-600 flex-1 truncate">
                      {getPublicSubmitUrl(token.token)}
                    </code>
                    <CopyButton text={getPublicSubmitUrl(token.token)} />
                  </div>
                  {token.expires_at && (
                    <p className="text-xs text-slate-400 mt-1">
                      Expires {formatDate(token.expires_at)}
                    </p>
                  )}
                </div>
              ))}

              {tokens.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">No links yet.</p>
              )}
            </div>

            {canManage && (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-sm font-medium">Generate new link</p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Link label (optional, e.g. 'Community form')"
                      value={newTokenLabel}
                      onChange={(e) => setNewTokenLabel(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      onClick={() => generateTokenMutation.mutate()}
                      disabled={generateTokenMutation.isPending}
                    >
                      <Plus className="h-4 w-4" />
                      Generate
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Danger zone */}
      {canManage && (
        <TabsContent value="danger">
          <div className="space-y-4">
            {/* Legal hold section */}
            <Card className={legalHold ? 'border-red-400' : 'border-slate-200'}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  {legalHold ? (
                    <Lock className="h-4 w-4 text-red-600" />
                  ) : (
                    <LockOpen className="h-4 w-4 text-slate-400" />
                  )}
                  Legal hold
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {legalHold && (
                  <Alert className="border-red-300 bg-red-50">
                    <AlertDescription className="text-red-800 font-medium">
                      Legal hold is ACTIVE — this case cannot be archived or closed until hold is removed.
                      {caseData.legal_hold_set_at && (
                        <span className="block text-xs font-normal mt-1 text-red-700">
                          Set {formatDate(caseData.legal_hold_set_at)}
                          {caseData.legal_hold_reason && ` · ${caseData.legal_hold_reason}`}
                        </span>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      Legal hold is {legalHold ? 'ACTIVE' : 'OFF'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      When on: prevents archiving or closing this case.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={legalHold}
                    onClick={() => setLegalHold(v => !v)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      legalHold ? 'bg-red-600' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        legalHold ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {legalHold && (
                  <div className="space-y-1.5">
                    <Label>Reason <span className="text-red-500">*</span></Label>
                    <textarea
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Required: describe why legal hold is being applied..."
                      value={legalHoldReason}
                      onChange={(e) => setLegalHoldReason(e.target.value)}
                    />
                  </div>
                )}

                <Button
                  size="sm"
                  variant={legalHold ? 'destructive' : 'outline'}
                  disabled={legalHoldPending || (legalHold && !legalHoldReason.trim())}
                  onClick={async () => {
                    setLegalHoldPending(true)
                    try {
                      const res = await fetch('/api/cases/legal-hold', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          caseId,
                          enabled: legalHold,
                          reason: legalHoldReason.trim() || undefined,
                        }),
                      })
                      const data = await res.json()
                      if (!res.ok) {
                        toast({ variant: 'destructive', title: 'Error', description: data.error })
                        // Revert toggle on failure
                        setLegalHold(v => !v)
                      } else {
                        toast({
                          title: legalHold ? 'Legal hold enabled' : 'Legal hold removed',
                        })
                        router.refresh()
                      }
                    } catch {
                      toast({ variant: 'destructive', title: 'Network error' })
                      setLegalHold(v => !v)
                    } finally {
                      setLegalHoldPending(false)
                    }
                  }}
                >
                  {legalHoldPending
                    ? 'Saving…'
                    : legalHold
                    ? 'Enable legal hold'
                    : 'Remove legal hold'}
                </Button>
              </CardContent>
            </Card>

            {/* Close / Archive */}
            <Card className="border-red-200">
              <CardHeader>
                <CardTitle className="text-base text-red-700 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Danger zone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert variant="destructive">
                  <AlertDescription>
                    These actions are significant. Closing or archiving a case will affect all team members.
                  </AlertDescription>
                </Alert>

                {legalHold && (
                  <Alert className="border-red-300 bg-red-50">
                    <AlertDescription className="text-red-800 text-xs">
                      Legal hold is active. Remove it before closing or archiving this case.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 border border-amber-200 rounded-md bg-amber-50">
                    <div>
                      <p className="text-sm font-medium">Close this case</p>
                      <p className="text-xs text-slate-500">Mark the case as closed. Submissions and data are preserved.</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-amber-300 text-amber-700"
                      disabled={legalHold}
                      title={legalHold ? 'Remove legal hold before closing this case' : undefined}
                      onClick={async () => {
                        await supabase.from('cases').update({ status: 'closed' }).eq('id', caseId)
                        toast({ title: 'Case closed' })
                        router.refresh()
                      }}
                    >
                      Close case
                    </Button>
                  </div>

                  <div className="flex items-center justify-between p-3 border border-red-200 rounded-md bg-red-50">
                    <div>
                      <p className="text-sm font-medium">Archive this case</p>
                      <p className="text-xs text-slate-500">Archive removes it from the active list. Data is preserved.</p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={legalHold}
                      title={legalHold ? 'Remove legal hold before archiving this case' : undefined}
                      onClick={async () => {
                        await supabase.from('cases').update({ status: 'archived' }).eq('id', caseId)
                        toast({ title: 'Case archived' })
                        router.push('/cases')
                      }}
                    >
                      Archive case
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      )}
    </Tabs>
  )
}
