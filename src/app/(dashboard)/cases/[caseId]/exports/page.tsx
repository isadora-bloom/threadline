import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { HandoffBuilder } from '@/components/exports/HandoffBuilder'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import { Download, Package } from 'lucide-react'

export default async function ExportsPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()

  if (!roleData) notFound()

  const canExport = ['lead_investigator', 'export_only', 'admin'].includes(roleData.role)

  // Fetch existing exports
  const { data: exports } = await supabase
    .from('export_records')
    .select('*, exporter:user_profiles(full_name)')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })

  const { data: caseData } = await supabase
    .from('cases')
    .select('title')
    .eq('id', caseId)
    .single()

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Exports</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Generate handoff packages for law enforcement, legal, or other recipients.
        </p>
      </div>

      {/* Previous exports */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Previous exports</CardTitle>
        </CardHeader>
        <CardContent>
          {!exports || exports.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No exports yet.</p>
          ) : (
            <div className="space-y-2">
              {exports.map((exp) => {
                const exporter = exp.exporter as { full_name?: string } | null
                return (
                  <div key={exp.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-md">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="muted" className="text-xs capitalize">
                          {exp.recipient_type?.replace('_', ' ') ?? 'Unknown type'}
                        </Badge>
                        <Badge variant="outline" className="text-xs uppercase">
                          {exp.export_format}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium text-slate-700">
                        {exp.recipient ?? 'Unknown recipient'}
                      </p>
                      {exp.purpose && (
                        <p className="text-xs text-slate-500 truncate">{exp.purpose}</p>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5">
                        Exported by {exporter?.full_name ?? 'Unknown'} · {formatDate(exp.created_at, true)}
                        {exp.included_claim_ids && ` · ${exp.included_claim_ids.length} claims`}
                      </p>
                    </div>
                    {exp.storage_path && (
                      <Badge variant="success">
                        <Download className="h-3 w-3 mr-1" />
                        Available
                      </Badge>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Build new export */}
      {canExport ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-indigo-600" />
              <CardTitle className="text-base">Build handoff package</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <HandoffBuilder
              caseId={caseId}
              caseTitle={caseData?.title ?? 'Untitled case'}
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-200">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-slate-500">
              You need lead investigator or admin access to generate exports.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
