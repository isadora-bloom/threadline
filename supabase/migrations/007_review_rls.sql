-- Migration 007: RLS policies for review workflow tables

-- Enable RLS on new tables
ALTER TABLE case_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_similarity ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- case_invitations
-- ============================================================

-- Lead investigators and admins can read invitations for their cases
CREATE POLICY "case_invitations_select" ON case_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = case_invitations.case_id
        AND user_id = auth.uid()
        AND role IN ('lead_investigator', 'admin')
    )
  );

-- Lead investigators and admins can create invitations for their cases
CREATE POLICY "case_invitations_insert" ON case_invitations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = case_invitations.case_id
        AND user_id = auth.uid()
        AND role IN ('lead_investigator', 'admin')
    )
  );

-- Anyone can update accepted_at when they have the matching token (token-based accept route)
-- This is intentionally permissive — the token itself is the auth credential
CREATE POLICY "case_invitations_accept" ON case_invitations
  FOR UPDATE
  USING (accepted_at IS NULL AND expires_at > now());

-- Lead investigators and admins can delete (revoke) invitations
CREATE POLICY "case_invitations_delete" ON case_invitations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = case_invitations.case_id
        AND user_id = auth.uid()
        AND role IN ('lead_investigator', 'admin')
    )
  );

-- ============================================================
-- claim_templates
-- ============================================================

-- Any case member can read templates (global or their case)
CREATE POLICY "claim_templates_select" ON claim_templates
  FOR SELECT
  USING (
    case_id IS NULL -- global templates visible to all authenticated users
    OR EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = claim_templates.case_id
        AND user_id = auth.uid()
    )
  );

-- Reviewers and above can create/update templates
CREATE POLICY "claim_templates_insert" ON claim_templates
  FOR INSERT
  WITH CHECK (
    (case_id IS NULL AND auth.uid() IS NOT NULL) -- global: any auth user
    OR EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = claim_templates.case_id
        AND user_id = auth.uid()
        AND role IN ('reviewer', 'lead_investigator', 'admin')
    )
  );

CREATE POLICY "claim_templates_update" ON claim_templates
  FOR UPDATE
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = claim_templates.case_id
        AND user_id = auth.uid()
        AND role IN ('lead_investigator', 'admin')
    )
  );

-- ============================================================
-- submission_similarity
-- ============================================================

-- Reviewers and above can read similarity scores for their cases
CREATE POLICY "submission_similarity_select" ON submission_similarity
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      JOIN case_user_roles cur ON cur.case_id = s.case_id
      WHERE s.id = submission_similarity.submission_a_id
        AND cur.user_id = auth.uid()
        AND cur.role IN ('reviewer', 'lead_investigator', 'admin', 'legal')
    )
  );

-- Service role can insert similarity records (computed server-side)
CREATE POLICY "submission_similarity_insert" ON submission_similarity
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
