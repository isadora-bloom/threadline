-- Threadline Case Intelligence Platform
-- Migration 004: Pattern Intelligence RLS

-- ============================================================
-- ENABLE RLS
-- ============================================================

ALTER TABLE pattern_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE corridor_reference_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE victim_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_linkage_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_pattern_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PATTERN FLAGS POLICIES
-- Reviewer+ can select and insert; reviewer+ can update reviewer_status
-- ============================================================

CREATE POLICY "pattern_flags_select" ON pattern_flags
  FOR SELECT USING (
    is_reviewer_or_above(case_id)
  );

CREATE POLICY "pattern_flags_insert" ON pattern_flags
  FOR INSERT WITH CHECK (
    is_reviewer_or_above(case_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "pattern_flags_update" ON pattern_flags
  FOR UPDATE USING (
    is_reviewer_or_above(case_id)
  );

-- ============================================================
-- LINK SCORES POLICIES
-- Reviewer+ can select; reviewer+ or system can insert; reviewer+ can update status
-- ============================================================

CREATE POLICY "link_scores_select" ON link_scores
  FOR SELECT USING (
    is_reviewer_or_above(case_id)
  );

CREATE POLICY "link_scores_insert" ON link_scores
  FOR INSERT WITH CHECK (
    is_reviewer_or_above(case_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "link_scores_update" ON link_scores
  FOR UPDATE USING (
    is_reviewer_or_above(case_id)
  );

-- ============================================================
-- CORRIDOR REFERENCE POINTS POLICIES
-- Any authenticated user can select; only admin can insert/update
-- ============================================================

CREATE POLICY "corridor_reference_points_select" ON corridor_reference_points
  FOR SELECT USING (
    auth.uid() IS NOT NULL
  );

CREATE POLICY "corridor_reference_points_insert" ON corridor_reference_points
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "corridor_reference_points_update" ON corridor_reference_points
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================================
-- VICTIM PROFILES POLICIES
-- Reviewer+ can select, insert, and update
-- ============================================================

CREATE POLICY "victim_profiles_select" ON victim_profiles
  FOR SELECT USING (
    is_reviewer_or_above(case_id)
  );

CREATE POLICY "victim_profiles_insert" ON victim_profiles
  FOR INSERT WITH CHECK (
    is_reviewer_or_above(case_id)
  );

CREATE POLICY "victim_profiles_update" ON victim_profiles
  FOR UPDATE USING (
    is_reviewer_or_above(case_id)
  );

-- ============================================================
-- PERSON RELATIONSHIPS POLICIES
-- Reviewer+ can select, insert, and update
-- ============================================================

CREATE POLICY "person_relationships_select" ON person_relationships
  FOR SELECT USING (
    is_reviewer_or_above(case_id)
  );

CREATE POLICY "person_relationships_insert" ON person_relationships
  FOR INSERT WITH CHECK (
    is_reviewer_or_above(case_id)
  );

CREATE POLICY "person_relationships_update" ON person_relationships
  FOR UPDATE USING (
    is_reviewer_or_above(case_id)
  );

-- ============================================================
-- CASE LINKAGE SCORES POLICIES
-- Lead investigator or admin can select; system can insert
-- ============================================================

CREATE POLICY "case_linkage_scores_select" ON case_linkage_scores
  FOR SELECT USING (
    has_case_role(case_a_id, 'lead_investigator', 'admin')
    OR has_case_role(case_b_id, 'lead_investigator', 'admin')
  );

CREATE POLICY "case_linkage_scores_insert" ON case_linkage_scores
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR has_case_role(case_a_id, 'lead_investigator', 'admin')
  );

CREATE POLICY "case_linkage_scores_update" ON case_linkage_scores
  FOR UPDATE USING (
    has_case_role(case_a_id, 'lead_investigator', 'admin')
    OR has_case_role(case_b_id, 'lead_investigator', 'admin')
  );

-- ============================================================
-- CASE PATTERN SETTINGS POLICIES
-- Any case member can select; lead investigator or admin can insert/update
-- ============================================================

CREATE POLICY "case_pattern_settings_select" ON case_pattern_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = case_pattern_settings.case_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "case_pattern_settings_insert" ON case_pattern_settings
  FOR INSERT WITH CHECK (
    has_case_role(case_id, 'lead_investigator', 'admin')
  );

CREATE POLICY "case_pattern_settings_update" ON case_pattern_settings
  FOR UPDATE USING (
    has_case_role(case_id, 'lead_investigator', 'admin')
  );
