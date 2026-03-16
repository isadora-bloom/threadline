-- Threadline Case Intelligence Platform
-- Migration 002: Row Level Security

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_case_role(p_case_id UUID)
RETURNS user_role AS $$
  SELECT role FROM case_user_roles
  WHERE case_id = p_case_id AND user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_case_role(p_case_id UUID, VARIADIC roles user_role[])
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM case_user_roles
    WHERE case_id = p_case_id
    AND user_id = auth.uid()
    AND role = ANY(roles)
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_reviewer_or_above(p_case_id UUID)
RETURNS BOOLEAN AS $$
  SELECT has_case_role(
    p_case_id,
    'reviewer', 'lead_investigator', 'legal', 'export_only', 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- ENABLE RLS
-- ============================================================

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_claim_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CASES POLICIES
-- ============================================================

CREATE POLICY "cases_select" ON cases
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = cases.id AND user_id = auth.uid()
    )
  );

CREATE POLICY "cases_insert" ON cases
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "cases_update" ON cases
  FOR UPDATE USING (
    has_case_role(id, 'lead_investigator', 'admin')
  );

CREATE POLICY "cases_delete" ON cases
  FOR DELETE USING (
    has_case_role(id, 'admin')
  );

-- ============================================================
-- CASE_USER_ROLES POLICIES
-- ============================================================

CREATE POLICY "case_user_roles_select" ON case_user_roles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM case_user_roles cur
      WHERE cur.case_id = case_user_roles.case_id AND cur.user_id = auth.uid()
    )
  );

CREATE POLICY "case_user_roles_insert" ON case_user_roles
  FOR INSERT WITH CHECK (
    has_case_role(case_id, 'lead_investigator', 'admin')
    OR (
      -- Allow initial role assignment when creating a case (creator adds themselves)
      NOT EXISTS (SELECT 1 FROM case_user_roles WHERE case_id = case_user_roles.case_id)
    )
  );

CREATE POLICY "case_user_roles_update" ON case_user_roles
  FOR UPDATE USING (
    has_case_role(case_id, 'lead_investigator', 'admin')
  );

CREATE POLICY "case_user_roles_delete" ON case_user_roles
  FOR DELETE USING (
    has_case_role(case_id, 'lead_investigator', 'admin')
  );

-- ============================================================
-- SUBMISSION TOKENS POLICIES
-- ============================================================

CREATE POLICY "submission_tokens_select" ON submission_tokens
  FOR SELECT USING (
    has_case_role(case_id, 'lead_investigator', 'admin')
  );

CREATE POLICY "submission_tokens_insert" ON submission_tokens
  FOR INSERT WITH CHECK (
    has_case_role(case_id, 'lead_investigator', 'admin')
  );

CREATE POLICY "submission_tokens_update" ON submission_tokens
  FOR UPDATE USING (
    has_case_role(case_id, 'lead_investigator', 'admin')
  );

-- ============================================================
-- SUBMISSIONS POLICIES
-- ============================================================

CREATE POLICY "submissions_select" ON submissions
  FOR SELECT USING (
    has_case_role(case_id, 'reviewer', 'lead_investigator', 'legal', 'export_only', 'admin')
  );

-- Service role bypasses RLS for public form submissions
-- Authenticated users can also insert (staff intake)
CREATE POLICY "submissions_insert" ON submissions
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    OR auth.role() = 'service_role'
  );

CREATE POLICY "submissions_update" ON submissions
  FOR UPDATE USING (
    has_case_role(case_id, 'reviewer', 'lead_investigator', 'legal', 'admin')
  );

-- ============================================================
-- SUBMISSION FILES POLICIES
-- ============================================================

CREATE POLICY "submission_files_select" ON submission_files
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = submission_files.submission_id
      AND has_case_role(s.case_id, 'reviewer', 'lead_investigator', 'legal', 'export_only', 'admin')
    )
  );

CREATE POLICY "submission_files_insert" ON submission_files
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL OR auth.role() = 'service_role'
  );

-- ============================================================
-- CLAIMS POLICIES
-- ============================================================

CREATE POLICY "claims_select" ON claims
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = claims.submission_id
      AND has_case_role(s.case_id, 'reviewer', 'lead_investigator', 'legal', 'export_only', 'admin')
    )
  );

CREATE POLICY "claims_insert" ON claims
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = claims.submission_id
      AND has_case_role(s.case_id, 'reviewer', 'lead_investigator', 'admin')
    )
  );

CREATE POLICY "claims_update" ON claims
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = claims.submission_id
      AND has_case_role(s.case_id, 'reviewer', 'lead_investigator', 'admin')
    )
  );

-- ============================================================
-- ENTITIES POLICIES
-- ============================================================

CREATE POLICY "entities_select" ON entities
  FOR SELECT USING (
    has_case_role(case_id, 'reviewer', 'lead_investigator', 'legal', 'export_only', 'admin')
  );

CREATE POLICY "entities_insert" ON entities
  FOR INSERT WITH CHECK (
    has_case_role(case_id, 'reviewer', 'lead_investigator', 'admin')
    OR auth.role() = 'service_role'
  );

CREATE POLICY "entities_update" ON entities
  FOR UPDATE USING (
    has_case_role(case_id, 'reviewer', 'lead_investigator', 'admin')
  );

-- ============================================================
-- CLAIM ENTITY LINKS POLICIES
-- ============================================================

CREATE POLICY "claim_entity_links_select" ON claim_entity_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM claims c
      JOIN submissions s ON s.id = c.submission_id
      WHERE c.id = claim_entity_links.claim_id
      AND has_case_role(s.case_id, 'reviewer', 'lead_investigator', 'legal', 'export_only', 'admin')
    )
  );

CREATE POLICY "claim_entity_links_insert" ON claim_entity_links
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM claims c
      JOIN submissions s ON s.id = c.submission_id
      WHERE c.id = claim_entity_links.claim_id
      AND has_case_role(s.case_id, 'reviewer', 'lead_investigator', 'admin')
    )
  );

CREATE POLICY "claim_entity_links_update" ON claim_entity_links
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM claims c
      JOIN submissions s ON s.id = c.submission_id
      WHERE c.id = claim_entity_links.claim_id
      AND has_case_role(s.case_id, 'reviewer', 'lead_investigator', 'admin')
    )
  );

-- ============================================================
-- EVENTS POLICIES
-- ============================================================

CREATE POLICY "events_select" ON events
  FOR SELECT USING (
    has_case_role(case_id, 'reviewer', 'lead_investigator', 'legal', 'export_only', 'admin')
  );

CREATE POLICY "events_insert" ON events
  FOR INSERT WITH CHECK (
    has_case_role(case_id, 'reviewer', 'lead_investigator', 'admin')
  );

CREATE POLICY "events_update" ON events
  FOR UPDATE USING (
    has_case_role(case_id, 'reviewer', 'lead_investigator', 'admin')
  );

-- ============================================================
-- EVENT CLAIM LINKS POLICIES
-- ============================================================

CREATE POLICY "event_claim_links_select" ON event_claim_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_claim_links.event_id
      AND has_case_role(e.case_id, 'reviewer', 'lead_investigator', 'legal', 'export_only', 'admin')
    )
  );

-- ============================================================
-- REVIEW ACTIONS POLICIES (IMMUTABLE)
-- ============================================================

CREATE POLICY "review_actions_select" ON review_actions
  FOR SELECT USING (
    has_case_role(case_id, 'lead_investigator', 'legal', 'admin')
  );

CREATE POLICY "review_actions_insert" ON review_actions
  FOR INSERT WITH CHECK (
    auth.uid() = actor_id
    AND (
      case_id IS NULL
      OR EXISTS (
        SELECT 1 FROM case_user_roles
        WHERE case_id = review_actions.case_id AND user_id = auth.uid()
      )
    )
  );

-- NO UPDATE or DELETE policies — audit log is immutable

-- ============================================================
-- EXPORT RECORDS POLICIES
-- ============================================================

CREATE POLICY "export_records_select" ON export_records
  FOR SELECT USING (
    has_case_role(case_id, 'lead_investigator', 'export_only', 'admin')
  );

CREATE POLICY "export_records_insert" ON export_records
  FOR INSERT WITH CHECK (
    has_case_role(case_id, 'lead_investigator', 'admin')
  );

-- ============================================================
-- USER PROFILES POLICIES
-- ============================================================

CREATE POLICY "user_profiles_select" ON user_profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "user_profiles_insert" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "user_profiles_update" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- ============================================================
-- AUTO-CREATE USER PROFILE ON SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
