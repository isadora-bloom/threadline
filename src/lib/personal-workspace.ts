/**
 * Resolve or create the personal-workspace case for the given user.
 *
 * Each user has at most one is_personal_workspace=true case (enforced by a
 * unique partial index in migration 040). On first call we lazy-create it and
 * grant the user lead_investigator. Subsequent calls return the existing id.
 *
 * The function is safe to call from server components, server actions, and
 * route handlers. It uses the caller's supabase client so RLS still applies.
 *
 * The supabase parameter is intentionally typed loosely. Callers pass either
 * a server client or service-role client, both of which have different
 * generic Database parameters; tightening the type would require duplicating
 * this helper or pulling in the Database type with all its surface area.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensurePersonalWorkspace(
  supabase: any,
  userId: string,
  userEmail?: string | null,
): Promise<string | null> {
  type WorkspaceRow = { id: string }

  const existing = await supabase
    .from('cases')
    .select('id')
    .eq('created_by', userId)
    .eq('is_personal_workspace', true)
    .limit(1)
    .maybeSingle() as unknown as { data: WorkspaceRow | null }

  if (existing.data?.id) return existing.data.id

  const title = userEmail
    ? `${userEmail.split('@')[0]}'s workspace`
    : 'My workspace'

  const insertRes = await supabase
    .from('cases')
    .insert({
      title,
      case_type: 'other',
      status: 'active',
      created_by: userId,
      is_personal_workspace: true,
      notes: 'Auto-created personal workspace. Anything you Quick Capture from a registry profile lands here.',
    } as never)
    .select('id')
    .single() as unknown as { data: WorkspaceRow | null; error: { message: string } | null }

  if (insertRes.error || !insertRes.data?.id) {
    // Likely a race — re-read.
    const retry = await supabase
      .from('cases')
      .select('id')
      .eq('created_by', userId)
      .eq('is_personal_workspace', true)
      .limit(1)
      .maybeSingle() as unknown as { data: WorkspaceRow | null }
    if (retry.data?.id) return retry.data.id
    console.error('ensurePersonalWorkspace insert failed:', insertRes.error?.message)
    return null
  }

  // Grant lead_investigator role. Non-fatal on failure — case still exists.
  const { error: roleErr } = await supabase
    .from('case_user_roles')
    .insert({
      case_id: insertRes.data.id,
      user_id: userId,
      role: 'lead_investigator',
    } as never)
  if (roleErr) console.error('ensurePersonalWorkspace role insert failed:', roleErr.message)

  return insertRes.data.id
}
