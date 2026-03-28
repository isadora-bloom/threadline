-- =============================================================================
-- 028: Case Status & Personal Tags
--
-- 1. Case status on import_records — resolved, classification, key circumstances
-- 2. Personal tags on any record or match — "interested", "suspicious", "priority"
-- =============================================================================

-- Case status fields on import_records
ALTER TABLE import_records ADD COLUMN IF NOT EXISTS case_status TEXT DEFAULT 'open'
  CHECK (case_status IN (
    'open',                -- Active missing / unidentified
    'resolved_alive',      -- Found alive
    'resolved_deceased',   -- Found deceased / remains identified
    'resolved_arrested',   -- Arrest made
    'resolved_other',      -- Resolved other way
    'closed',              -- Closed by agency, no resolution
    'cold'                 -- No activity in years
  ));

ALTER TABLE import_records ADD COLUMN IF NOT EXISTS classification TEXT;
-- e.g. "Endangered Missing", "Involuntary", "Lost, Injured, Missing",
-- "Family Abduction", "Non-Family Abduction", "Runaway", "Voluntary",
-- "Stranger Abduction", "Unknown", "Catastrophe Victim"

ALTER TABLE import_records ADD COLUMN IF NOT EXISTS circumstances_summary TEXT;
-- Short 1-2 line summary for display under the name

ALTER TABLE import_records ADD COLUMN IF NOT EXISTS key_flags TEXT[] DEFAULT '{}';
-- Quick-scan flags: 'family_abduction', 'international', 'child', 'endangered',
-- 'foul_play_suspected', 'sex_offender_involvement', 'tribal_jurisdiction',
-- 'no_media_coverage', 'dna_available', 'dental_available'

CREATE INDEX idx_import_records_status ON import_records(case_status) WHERE case_status != 'open';
CREATE INDEX idx_import_records_classification ON import_records(classification) WHERE classification IS NOT NULL;
CREATE INDEX idx_import_records_flags ON import_records USING GIN(key_flags) WHERE key_flags != '{}';

-- ---------------------------------------------------------------------------
-- Personal tags — users can tag any record or match for their own tracking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What's being tagged (one of these will be set)
  import_record_id UUID REFERENCES import_records(id) ON DELETE CASCADE,
  match_id UUID REFERENCES doe_match_candidates(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES global_connections(id) ON DELETE CASCADE,

  tag TEXT NOT NULL CHECK (tag IN (
    'interested',          -- "I want to look at this more"
    'priority',            -- "This one matters"
    'suspicious',          -- "Something feels off"
    'promising_lead',      -- "This could go somewhere"
    'dead_end',            -- "Checked, nothing here"
    'needs_expert',        -- "Someone with specific skills should look"
    'contacted_le',        -- "Reached out to law enforcement"
    'research_done',       -- "I've done research on this"
    'follow_up'            -- "Come back to this"
  )),

  notes TEXT,              -- Why they tagged it
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, import_record_id, tag),
  UNIQUE(user_id, match_id, tag),
  UNIQUE(user_id, connection_id, tag)
);

CREATE INDEX idx_user_tags_user ON user_tags(user_id);
CREATE INDEX idx_user_tags_record ON user_tags(import_record_id) WHERE import_record_id IS NOT NULL;
CREATE INDEX idx_user_tags_match ON user_tags(match_id) WHERE match_id IS NOT NULL;

-- RLS
ALTER TABLE user_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_own" ON user_tags
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- Others can see tags for community awareness (how many people tagged something)
CREATE POLICY "tags_read" ON user_tags
  FOR SELECT TO authenticated USING (true);
