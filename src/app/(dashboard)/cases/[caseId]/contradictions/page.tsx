import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, ArrowRight, Flag, CheckCircle2, XCircle } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClaimRow {
  id: string
  submission_id: string
  extracted_text: string
  claim_type: string
  verification_status: string
  event_date: string | null
}

interface CorroborationRow {
  id: string
  claim_id: string
  corroborated_by_claim_id: string
  contradiction_detail: string | null
  similarity_score: number | null
  claim_a: ClaimRow | null
  claim_b: ClaimRow | null
}

interface FlagRow {
  id: string
  title: string
  description: string
  involved_claim_ids: string[]
  grade: string
  reviewer_status: string
  reviewer_note: string | null
}

const GRADE_COLOR: Record<string, string> = {
  weak:       'bg-slate-100 text-slate-500',
  moderate:   'bg-blue-50 text-blue-600',
  notable:    'bg-amber-50 text-amber-700',
  strong:     'bg-orange-100 text-orange-700',
  very_strong:'bg-red-100 text-red-700',
}

const STATUS_COLOR: Record<string, string> = {
  unverified:   'bg-slate-100 text-slate-500',
  under_review: 'bg-blue-100 text-blue-600',
  confirmed:    'bg-green-100 text-green-700',
  disputed:     'bg-orange-100 text-orange-600',
  retracted:    'bg-red-100 text-red-500',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ContradictionsPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: roleData } = await supabase
    .from('case_user_roles').select('role').eq('case_id', caseId).eq('user_id', user.id).single()
  if (!roleData) notFound()

  const { data: caseData } = await supabase.from('cases').select('title').eq('id', caseId).single()

  // ── Fetch contradiction corroborations ────────────────────────────────────
  const { data: corrRows } = await supabase
    .from('claim_corroborations')
    .select('id,claim_id,corroborated_by_claim_id,contradiction_detail,similarity_score')
    .eq('case_id', caseId)
    .eq('is_contradiction', true)
    .order('created_at', { ascending: false })

  // Fetch claim details for both sides
  const allClaimIds = Array.from(new Set(
    (corrRows ?? []).flatMap(r => [r.claim_id, r.corroborated_by_claim_id])
  ))

  const claimMap = new Map<string, ClaimRow>()
  if (allClaimIds.length > 0) {
    const { data: claimRows } = await supabase
      .from('claims')
      .select('id,submission_id,extracted_text,claim_type,verification_status,event_date')
      .in('id', allClaimIds)
    for (const c of claimRows ?? []) claimMap.set(c.id, c as ClaimRow)
  }

  const contradictions: CorroborationRow[] = (corrRows ?? []).map(r => ({
    ...r,
    claim_a: claimMap.get(r.claim_id) ?? null,
    claim_b: claimMap.get(r.corroborated_by_claim_id) ?? null,
  }))

  // ── Fetch contradiction pattern flags ─────────────────────────────────────
  const { data: flagRows } = await supabase
    .from('pattern_flags')
    .select('id,title,description,involved_claim_ids,grade,reviewer_status,reviewer_note')
    .eq('case_id', caseId)
    .eq('flag_type', 'contradiction')
    .order('score', { ascending: false })

  const flags = (flagRows ?? []) as FlagRow[]

  const total = contradictions.length + flags.length
  const unreviewed = flags.filter(f => f.reviewer_status === 'unreviewed').length

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
          <Link href={`/cases/${caseId}`} className="hover:text-slate-700">{caseData?.title}</Link>
          <span>/</span>
          <span>Contradictions</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Contradictions
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Conflicting claims and contradiction flags that warrant investigator resolution
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unreviewed > 0 && (
              <Badge className="bg-orange-100 text-orange-700 border-orange-200">
                {unreviewed} unreviewed
              </Badge>
            )}
            <Badge variant="outline">{total} total</Badge>
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-lg">
          <CheckCircle2 className="h-12 w-12 text-green-300 mx-auto mb-3" />
          <p className="font-semibold text-slate-700">No contradictions found</p>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            Contradictions appear here when claims conflict with each other or pattern analysis detects inconsistencies.
          </p>
        </div>
      ) : (
        <div className="space-y-8">

          {/* ── Claim-pair contradictions ───────────────────────────────────── */}
          {contradictions.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-400" />
                Conflicting claim pairs ({contradictions.length})
              </h2>
              <div className="space-y-4">
                {contradictions.map((row) => (
                  <div key={row.id} className="bg-white border border-orange-200 rounded-lg overflow-hidden">
                    {row.contradiction_detail && (
                      <div className="px-4 py-2 bg-orange-50 border-b border-orange-100 text-[11px] text-orange-700 flex items-start gap-2">
                        <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                        {row.contradiction_detail}
                      </div>
                    )}
                    <div className="grid grid-cols-2 divide-x divide-slate-100">
                      {([['Claim A', row.claim_a], ['Claim B', row.claim_b]] as [string, ClaimRow | null][]).map(([label, claim]) => (
                        <div key={label} className="p-4">
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{label}</div>
                          {claim ? (
                            <>
                              <p className="text-sm text-slate-800 leading-snug mb-2">{claim.extracted_text}</p>
                              <div className="flex flex-wrap gap-1">
                                <span className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 rounded px-1.5 py-0.5">
                                  {claim.claim_type.replace(/_/g, ' ')}
                                </span>
                                <span className={`text-[10px] rounded px-1.5 py-0.5 ${STATUS_COLOR[claim.verification_status] ?? STATUS_COLOR.unverified}`}>
                                  {claim.verification_status.replace(/_/g, ' ')}
                                </span>
                                {claim.event_date && (
                                  <span className="text-[10px] text-slate-400">
                                    {new Date(claim.event_date).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                              <Link
                                href={`/cases/${caseId}/submissions/${claim.submission_id}`}
                                className="inline-flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700 mt-2"
                              >
                                View submission <ArrowRight className="h-3 w-3" />
                              </Link>
                            </>
                          ) : (
                            <p className="text-sm text-slate-400 italic">Claim not found</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Pattern flags (contradiction type) ─────────────────────────── */}
          {flags.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Flag className="h-4 w-4 text-orange-400" />
                Contradiction flags from pattern analysis ({flags.length})
              </h2>
              <div className="space-y-3">
                {flags.map((flag) => (
                  <div key={flag.id} className={`bg-white border rounded-lg p-4 ${
                    flag.reviewer_status === 'confirmed' ? 'border-orange-300 bg-orange-50/30' :
                    flag.reviewer_status === 'dismissed' ? 'border-slate-200 opacity-60' :
                    'border-orange-200'
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={`text-[10px] ${GRADE_COLOR[flag.grade] ?? GRADE_COLOR.moderate}`}>
                            {flag.grade.replace(/_/g, ' ')}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] text-slate-500">
                            {flag.reviewer_status.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <p className="text-sm font-semibold text-slate-800">{flag.title}</p>
                        <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{flag.description}</p>
                        {flag.reviewer_note && (
                          <p className="text-xs text-indigo-600 mt-1.5 italic">
                            Investigator note: {flag.reviewer_note}
                          </p>
                        )}
                        {flag.involved_claim_ids?.length > 0 && (
                          <p className="text-[10px] text-slate-400 mt-1.5">
                            {flag.involved_claim_ids.length} involved claim{flag.involved_claim_ids.length !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                      <Link
                        href={`/cases/${caseId}/patterns`}
                        className="flex-shrink-0 text-[10px] text-indigo-500 hover:text-indigo-700 flex items-center gap-1"
                      >
                        Review in patterns <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
