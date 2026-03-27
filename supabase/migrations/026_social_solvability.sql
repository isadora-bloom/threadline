-- =============================================================================
-- 026: Social Layer & Solvability Scores
-- Watchlists, community connections, and AI solvability assessment.
-- Makes Threadline engaging without being exploitative.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. USER WATCHLISTS ("My Cases")
-- Users can follow up to 10 cases they care about.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_record_id UUID NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,   -- 0-9, for ordering their top 10
  notes TEXT,                            -- personal notes on why they're watching
  notify_on_updates BOOLEAN DEFAULT true,-- get notified when AI finds something new
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, import_record_id)
);

CREATE INDEX idx_watchlist_user ON user_watchlist(user_id, position);
CREATE INDEX idx_watchlist_record ON user_watchlist(import_record_id);

-- Count how many people are watching each record (for "X people are investigating this")
CREATE INDEX idx_watchlist_popular ON user_watchlist(import_record_id, added_at DESC);

-- ---------------------------------------------------------------------------
-- 2. SOLVABILITY SCORES
-- AI assessment of how likely a case is to benefit from fresh eyes.
-- This is what drives "Cases That Need You" — the ethical engagement hook.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS solvability_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_record_id UUID NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,

  -- Overall score (0-100)
  score INTEGER NOT NULL,
  grade TEXT NOT NULL CHECK (grade IN ('high', 'moderate', 'low', 'uncertain')),

  -- Signal breakdown
  signals JSONB NOT NULL DEFAULT '{}',
  -- signals shape: {
  --   "has_named_poi": true/false,             -- person of interest exists
  --   "has_vehicle_description": true/false,
  --   "has_specific_location": true/false,
  --   "has_witness_accounts": true/false,
  --   "recent_activity": true/false,            -- updates in last 2 years
  --   "multiple_sources": true/false,           -- data from >1 database
  --   "dna_available": true/false,
  --   "unmatched_connections": 3,               -- connections found but not reviewed
  --   "offender_overlaps": 1,                   -- known offender matches
  --   "geographic_cluster_member": true/false,
  --   "stall_flag": true/false,                 -- classified as runaway/voluntary
  --   "media_coverage_gap": true/false,         -- no media attention found
  --   "years_cold": 15,                         -- how long since last activity
  --   "watcher_count": 0                        -- nobody is looking at this yet
  -- }

  -- AI reasoning
  ai_summary TEXT NOT NULL,              -- "This case has specific vehicle descriptions and witness accounts but has been classified as voluntary departure for 8 years with no follow-up."
  ai_next_steps TEXT[],                  -- ["Check if vehicle was ever recovered", "Cross-reference with I-35 corridor cases"]

  -- Metadata
  model_used TEXT,
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(import_record_id)
);

CREATE INDEX idx_solvability_score ON solvability_scores(score DESC);
CREATE INDEX idx_solvability_grade ON solvability_scores(grade) WHERE grade = 'high';

-- ---------------------------------------------------------------------------
-- 3. COMMUNITY CONNECTIONS
-- Connect people investigating the same cases. Not chat — just awareness.
-- "3 other people are investigating this case"
-- Optional: share a note about what angle you're looking at.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS community_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_record_id UUID NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,

  note_type TEXT NOT NULL DEFAULT 'observation' CHECK (note_type IN (
    'observation',           -- "I noticed the vehicle description matches a case in Ohio"
    'question',              -- "Has anyone checked if the phone number is still active?"
    'lead',                  -- "I found a newspaper article from 2003 that mentions this person"
    'research_offer'         -- "I have access to newspaper archives and can search"
  )),

  content TEXT NOT NULL,
  is_public BOOLEAN DEFAULT true,        -- visible to other watchers of this case

  -- Moderation
  flagged BOOLEAN DEFAULT false,
  flagged_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_community_notes_record ON community_notes(import_record_id, created_at DESC);
CREATE INDEX idx_community_notes_user ON community_notes(user_id);

CREATE TRIGGER update_community_notes_updated_at
  BEFORE UPDATE ON community_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 4. USER ACTIVITY & STREAKS (gentle engagement, not gamification)
-- Track contributions so people feel their effort matters.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'watched_case',
    'reviewed_connection',
    'added_note',
    'requested_research',
    'confirmed_match',
    'dismissed_false_positive',
    'shared_lead'
  )),
  ref_id UUID,                           -- ID of the thing acted on
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ual_user_date ON user_activity_log(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. "CASES THAT NEED YOU"
-- View combining solvability scores with low watcher counts.
-- High solvability + few watchers = case that deserves attention.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW cases_needing_attention AS
SELECT
  ir.id AS import_record_id,
  ir.person_name,
  ir.record_type,
  ir.sex,
  ir.age_text,
  ir.state,
  ir.city,
  ir.date_missing,
  ir.date_found,
  ir.external_url,
  is_source.display_name AS source_name,
  ss.score AS solvability_score,
  ss.grade AS solvability_grade,
  ss.ai_summary AS solvability_summary,
  ss.ai_next_steps,
  COALESCE(wc.watcher_count, 0) AS watcher_count
FROM import_records ir
JOIN import_sources is_source ON ir.source_id = is_source.id
LEFT JOIN solvability_scores ss ON ss.import_record_id = ir.id
LEFT JOIN (
  SELECT import_record_id, COUNT(*) AS watcher_count
  FROM user_watchlist
  GROUP BY import_record_id
) wc ON wc.import_record_id = ir.id
WHERE ss.grade IN ('high', 'moderate')
ORDER BY
  -- Prioritize: high solvability + few watchers
  CASE ss.grade WHEN 'high' THEN 0 ELSE 1 END,
  COALESCE(wc.watcher_count, 0) ASC,
  ss.score DESC;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE user_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE solvability_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_log ENABLE ROW LEVEL SECURITY;

-- Watchlist: users see their own, anyone can see counts
CREATE POLICY "watchlist_own" ON user_watchlist
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- Solvability: readable by everyone
CREATE POLICY "solvability_select" ON solvability_scores
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "solvability_write" ON solvability_scores
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "solvability_update" ON solvability_scores
  FOR UPDATE TO service_role USING (true);

-- Community notes: public notes visible to all, own notes editable
CREATE POLICY "notes_select" ON community_notes
  FOR SELECT TO authenticated USING (is_public = true OR auth.uid() = user_id);
CREATE POLICY "notes_insert" ON community_notes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notes_update" ON community_notes
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notes_delete" ON community_notes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Activity log: users see their own
CREATE POLICY "activity_own" ON user_activity_log
  FOR ALL TO authenticated USING (auth.uid() = user_id);
