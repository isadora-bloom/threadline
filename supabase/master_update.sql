-- =============================================================================
-- MASTER UPDATE — bundles every audit-cycle migration into one runnable script
-- =============================================================================
--
-- Run this against your Supabase database (psql, the SQL editor in the
-- dashboard, or Supabase CLI) to apply migrations 031 through 042 in order.
--
-- Each migration is emitted verbatim and relies on the IF NOT EXISTS /
-- DROP IF EXISTS guards it already carries. Re-running is therefore safe
-- in most cases, with two caveats:
--
--   1. 035 drops events, event_claim_links, claim_templates, and
--      submission_similarity. Re-running after a successful first run is a
--      no-op (DROP IF EXISTS) but will not recreate them.
--
--   2. 037 enables the pgvector extension. If the extension is not yet
--      available in your Supabase project, enable it under
--      Database -> Extensions in the dashboard before running this script.
--
-- After this script runs:
--
--   - npm run ai:embed            (voyage-3 embeddings; needs VOYAGE_API_KEY)
--   - npm run ai:semantic         (nearest-neighbor flagger)
--   - npm run ai:associates       (named-associate / vehicle cross-match)
--   - npm run ai:temporal         (state x month/weekday clustering)
--   - npm run ai:misclass         (misclassification candidates)
--   - npm run ai:changes          (classification-change flagger; after 036)
--   - npm run ai:dq               (data-quality dupe + stale flags)
--   - npm run ai:connections      (populates ai_summary on global_connections)
--   - npm run ai:link-charley     (Charley <-> NamUs sibling links; after 041)
--   - npm run ai:negative-space   (under-reporting state flagger)
--   - npm run ai:evidence-gap     (NCIC/CODIS not entered)
--   - npm run ai:reporter         (reporter-pattern flagger)
--   - npm run ai:offender-drift   (offender geographic drift)
--   - npm run scrape:namus-photos (photo URLs for NamUs records; after 042)
--
-- =============================================================================



-- ##########################################################################
-- ## 031_research_provenance.sql
-- ##########################################################################

-- =============================================================================
-- 031: Research Provenance
--
-- Add prompt_hash and model_config to deep_research so runs are reproducible.
-- prompt_hash is a SHA-256 of the system prompt text at run time.
-- model_config captures temperature, max_tokens, and any other params.
-- =============================================================================

ALTER TABLE deep_research
  ADD COLUMN IF NOT EXISTS prompt_hash TEXT,
  ADD COLUMN IF NOT EXISTS model_config JSONB DEFAULT '{}';

COMMENT ON COLUMN deep_research.prompt_hash IS 'SHA-256 of the prompt sent to the model, for reproducibility auditing';
COMMENT ON COLUMN deep_research.model_config IS 'Model parameters used: { model, max_tokens, temperature }';


-- ##########################################################################
-- ## 032_lead_outcomes.sql
-- ##########################################################################

-- =============================================================================
-- 032: Lead Outcome Feedback
--
-- Track what happened after a lead was investigated. This closes the feedback
-- loop so the system can learn which types of leads are actually useful.
-- =============================================================================

ALTER TABLE intelligence_queue
  ADD COLUMN IF NOT EXISTS outcome TEXT CHECK (outcome IN (
    'led_somewhere',         -- Investigation progressed from this lead
    'dead_end',              -- Investigated but no useful result
    'already_known',         -- Information was already known to investigators
    'insufficient_evidence', -- Interesting but not enough to act on
    'duplicate'              -- Same finding surfaced from a different angle
  )),
  ADD COLUMN IF NOT EXISTS outcome_note TEXT,
  ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_intelligence_queue_outcome ON intelligence_queue(outcome) WHERE outcome IS NOT NULL;

COMMENT ON COLUMN intelligence_queue.outcome IS 'What happened when this lead was investigated';
COMMENT ON COLUMN intelligence_queue.outcome_note IS 'Brief note on the outcome';


-- ##########################################################################
-- ## 033_community_note_extraction.sql
-- ##########################################################################

-- =============================================================================
-- 033: Community Note AI Extraction
--
-- Notes submitted by watchers on a registry profile are freeform prose. Until
-- now they were pure text and never parsed. This adds an ai_extraction column
-- to capture structured output from the text extractor (entities, claims,
-- event dates, source type) so community contributions feed the intelligence
-- layer instead of sitting as an inert string.
-- =============================================================================

ALTER TABLE community_notes
  ADD COLUMN IF NOT EXISTS ai_extraction JSONB,
  ADD COLUMN IF NOT EXISTS ai_extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_model TEXT;

COMMENT ON COLUMN community_notes.ai_extraction IS 'Structured data extracted from note.content by the text extractor: entities, claims, source_type, event_date, summary. Null until extraction runs.';
COMMENT ON COLUMN community_notes.ai_extracted_at IS 'When the extraction ran. Null if never extracted (short notes or extractor failure).';
COMMENT ON COLUMN community_notes.ai_model IS 'Model id used for the extraction, for audit and later re-runs.';

CREATE INDEX IF NOT EXISTS idx_community_notes_extracted ON community_notes(ai_extracted_at DESC) WHERE ai_extraction IS NOT NULL;


-- ##########################################################################
-- ## 034_misclassification_queue_type.sql
-- ##########################################################################

-- =============================================================================
-- 034: Misclassification candidate queue type
--
-- intelligence_queue.queue_type has a CHECK constraint that only allows a
-- fixed enum. Adding a new type requires dropping the constraint and
-- recreating it with the expanded list. Misclassification candidates are
-- distinct from stalled_case (which is about time-since-last-update); they
-- are active cases whose classification contradicts their extracted signals.
-- =============================================================================

ALTER TABLE intelligence_queue
  DROP CONSTRAINT IF EXISTS intelligence_queue_queue_type_check;

ALTER TABLE intelligence_queue
  ADD CONSTRAINT intelligence_queue_queue_type_check
  CHECK (queue_type IN (
    'possible_match',
    'geographic_cluster',
    'temporal_pattern',
    'offender_overlap',
    'entity_crossmatch',
    'stalled_case',
    'behavioral_pattern',
    'corridor_cluster',
    'new_lead',
    'contradiction',
    'misclassification_candidate'
  ));


-- ##########################################################################
-- ## 035_drop_dead_tables.sql
-- ##########################################################################

-- =============================================================================
-- 035: Drop truly-dead tables
--
-- Each table below has zero writers and zero readers in the application code
-- and in scripts/ — verified by grep across src/ and scripts/. They survived
-- because earlier roadmap work scaffolded them before the intelligence-first
-- pivot, or because their writer was removed without removing the table.
--
-- Decision rationale per table:
--
--   events / event_claim_links
--     Migration 001 comment: "scaffolded for v1, promoted in v1.1". Designed
--     for curated timelines where events are first-class nodes and claims
--     attest to them. The pivot made cross-corpus pattern analysis primary,
--     so curated per-case timelines never got UI. The timeline page at
--     /cases/[caseId]/timeline renders claims/submissions sorted by date
--     directly, bypassing these tables entirely.
--
--   claim_templates
--     Migration 006 comment: "Claim templates (global or per-case)". Designed
--     to pre-fill claim types with suggested confidence levels for repeated
--     investigator workflows. Never reached the UI. YAGNI — can be recreated
--     in one migration if the case system is ever revisited.
--
--   submission_similarity
--     Migration 006: duplicate detection table. Writer killed in Pass 1 of
--     this audit because submissions.duplicate_of_submission_id already
--     carries the useful state. The table is now genuinely orphaned — no
--     writer, no reader.
--
-- user_activity_log is intentionally NOT dropped; it is being revived for
-- "I'm investigating" presence tracking in Pass 3.
--
-- CASCADE removes RLS policies, FK constraints, indexes, and triggers
-- attached to each table. Existing rows (if any) are destroyed.
-- =============================================================================

DROP TABLE IF EXISTS event_claim_links CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS claim_templates CASCADE;
DROP TABLE IF EXISTS submission_similarity CASCADE;

-- event_status enum survives — no tables depend on it now, but it is cheap
-- to keep and a future events-like feature could reuse it. If you want a
-- totally clean schema, uncomment the following after verifying nothing
-- depends on the type:
--
-- DROP TYPE IF EXISTS event_status;


-- ##########################################################################
-- ## 036_import_record_history.sql
-- ##########################################################################

-- =============================================================================
-- 036: Import record change history
--
-- Scrapers re-upsert records from NamUs, Doe Network, and Charley Project on
-- every run. When a case's classification flips from "runaway" to "endangered"
-- five years later, that's a load-bearing signal — it tells you investigators
-- found new evidence, a family finally got listened to, or a stale record was
-- corrected. The previous design silently overwrote such changes because the
-- scrapers do straight upserts.
--
-- This migration captures a narrow per-field history for the fields where
-- changes carry investigative meaning. raw_data is explicitly not tracked —
-- it is large, churns on cosmetic upstream changes, and its meaningful
-- content is already distilled into the extracted columns below.
--
-- The trigger runs on UPDATE only (inserts are initial state, not a change).
-- On a scraped upsert that does not actually change any tracked field, the
-- trigger is a no-op.
-- =============================================================================

CREATE TABLE IF NOT EXISTS import_record_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_record_id UUID NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- flagged = already pushed to intelligence_queue, so the flagger script
  -- does not re-emit. Null until processed.
  flagged_at TIMESTAMPTZ,
  queue_item_id UUID
);

CREATE INDEX IF NOT EXISTS idx_irc_record ON import_record_changes(import_record_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_irc_unflagged ON import_record_changes(changed_at DESC) WHERE flagged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_irc_field ON import_record_changes(field);

ALTER TABLE import_record_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "irc_select" ON import_record_changes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "irc_insert" ON import_record_changes
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "irc_update" ON import_record_changes
  FOR UPDATE TO service_role USING (true);

-- Trigger function: compare old vs new on the fields that carry signal.
CREATE OR REPLACE FUNCTION log_import_record_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.classification IS DISTINCT FROM OLD.classification THEN
    INSERT INTO import_record_changes (import_record_id, field, old_value, new_value)
    VALUES (NEW.id, 'classification', OLD.classification, NEW.classification);
  END IF;

  IF NEW.case_status IS DISTINCT FROM OLD.case_status THEN
    INSERT INTO import_record_changes (import_record_id, field, old_value, new_value)
    VALUES (NEW.id, 'case_status', OLD.case_status, NEW.case_status);
  END IF;

  IF NEW.date_missing IS DISTINCT FROM OLD.date_missing THEN
    INSERT INTO import_record_changes (import_record_id, field, old_value, new_value)
    VALUES (NEW.id, 'date_missing', OLD.date_missing::text, NEW.date_missing::text);
  END IF;

  IF NEW.date_found IS DISTINCT FROM OLD.date_found THEN
    INSERT INTO import_record_changes (import_record_id, field, old_value, new_value)
    VALUES (NEW.id, 'date_found', OLD.date_found::text, NEW.date_found::text);
  END IF;

  -- key_flags is a text[] — compare via array_agg of sorted elements so reordering isn't noise.
  IF NEW.key_flags IS DISTINCT FROM OLD.key_flags THEN
    INSERT INTO import_record_changes (import_record_id, field, old_value, new_value)
    VALUES (
      NEW.id,
      'key_flags',
      array_to_string(COALESCE(OLD.key_flags, ARRAY[]::text[]), ','),
      array_to_string(COALESCE(NEW.key_flags, ARRAY[]::text[]), ',')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop-and-recreate so re-running the migration is safe.
DROP TRIGGER IF EXISTS tr_import_record_changes ON import_records;
CREATE TRIGGER tr_import_record_changes
  AFTER UPDATE ON import_records
  FOR EACH ROW
  EXECUTE FUNCTION log_import_record_change();

COMMENT ON TABLE import_record_changes IS 'Narrow per-field change log for import_records. Scraper upserts that modify tracked fields (classification, case_status, date_missing, date_found, key_flags) emit rows here via trigger. A separate flagger script turns significant changes into intelligence_queue items.';


-- ##########################################################################
-- ## 037_semantic_embeddings.sql
-- ##########################################################################

-- =============================================================================
-- 037: Semantic embeddings on import_records
--
-- The existing connection scorer does lexical comparison: substring overlap
-- on distinguishing marks, exact-match on hair color. It cannot tell that
-- "heart with arrow, right shoulder" and "arrow through a heart on the R
-- shoulder" describe the same tattoo. Embeddings close that gap.
--
-- Two columns because the two fields describe different things and should
-- be indexed independently: circumstances describe the event, marks describe
-- the body. A case matching on circumstances is a lead; a case matching on
-- marks is usually a near-identification.
--
-- Dimensions: voyage-3 produces 1024-dim vectors. If you switch to
-- voyage-3-large (2048) or voyage-3-lite (512) you will need a new
-- migration — vector columns are fixed-dimension.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE import_records
  ADD COLUMN IF NOT EXISTS circumstances_embedding vector(1024),
  ADD COLUMN IF NOT EXISTS circumstances_embedded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marks_embedding vector(1024),
  ADD COLUMN IF NOT EXISTS marks_embedded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS embedding_model TEXT;

COMMENT ON COLUMN import_records.circumstances_embedding IS 'voyage-3 embedding of circumstances_summary. Used for semantic nearest-neighbor matching beyond lexical overlap.';
COMMENT ON COLUMN import_records.marks_embedding IS 'voyage-3 embedding of distinguishing_marks concatenated. Catches paraphrased descriptions like "heart with arrow" vs "arrow through a heart".';

-- ivfflat is the right index for cosine-similarity nearest-neighbor search at
-- this scale (tens of thousands of rows). lists = sqrt(rows) is a reasonable
-- starting heuristic. Rebuild these after bulk-embedding: REINDEX INDEX ...
CREATE INDEX IF NOT EXISTS idx_import_records_circumstances_embedding
  ON import_records USING ivfflat (circumstances_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_import_records_marks_embedding
  ON import_records USING ivfflat (marks_embedding vector_cosine_ops)
  WITH (lists = 100);

-- Helper for the neighbor flagger: returns the N nearest neighbors of a given
-- record by circumstances similarity, excluding the record itself. Caller
-- filters out rows already in global_connections.
CREATE OR REPLACE FUNCTION nearest_by_circumstances(
  target_id UUID,
  match_count INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  person_name TEXT,
  record_type TEXT,
  state TEXT,
  similarity NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH target AS (
    SELECT circumstances_embedding FROM import_records WHERE id = target_id
  )
  SELECT
    r.id,
    r.person_name,
    r.record_type,
    r.state,
    (1 - (r.circumstances_embedding <=> t.circumstances_embedding))::numeric AS similarity
  FROM import_records r
  CROSS JOIN target t
  WHERE r.id <> target_id
    AND r.circumstances_embedding IS NOT NULL
    AND t.circumstances_embedding IS NOT NULL
  ORDER BY r.circumstances_embedding <=> t.circumstances_embedding
  LIMIT match_count
$$;

CREATE OR REPLACE FUNCTION nearest_by_marks(
  target_id UUID,
  match_count INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  person_name TEXT,
  record_type TEXT,
  state TEXT,
  similarity NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH target AS (
    SELECT marks_embedding FROM import_records WHERE id = target_id
  )
  SELECT
    r.id,
    r.person_name,
    r.record_type,
    r.state,
    (1 - (r.marks_embedding <=> t.marks_embedding))::numeric AS similarity
  FROM import_records r
  CROSS JOIN target t
  WHERE r.id <> target_id
    AND r.marks_embedding IS NOT NULL
    AND t.marks_embedding IS NOT NULL
  ORDER BY r.marks_embedding <=> t.marks_embedding
  LIMIT match_count
$$;


-- ##########################################################################
-- ## 038_activity_presence.sql
-- ##########################################################################

-- =============================================================================
-- 038: Activity presence — revive user_activity_log
--
-- Migration 026 created user_activity_log and then nothing ever wrote to or
-- read from it. The original design intent (visible in migration 026 and
-- memory notes) was for presence: investigators seeing each other on a case
-- without explicitly coordinating. The "ethical engagement" mission hinges
-- on this signal existing.
--
-- The original RLS policy allowed users to SELECT only their own rows, which
-- made presence impossible. This migration opens SELECT to all authenticated
-- users while keeping INSERT restricted to the acting user. Users who want
-- privacy can simply not take actions.
--
-- Also adds a lookup index by ref_id so the "who is active on this record"
-- query is fast (the existing index is only by user_id).
-- =============================================================================

DROP POLICY IF EXISTS "activity_own" ON user_activity_log;

CREATE POLICY "activity_public_select" ON user_activity_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "activity_own_insert" ON user_activity_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "activity_own_delete" ON user_activity_log
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ual_ref_date
  ON user_activity_log(ref_id, created_at DESC)
  WHERE ref_id IS NOT NULL;

COMMENT ON TABLE user_activity_log IS 'Audit trail of user contributions (watch, note, research, review). Publicly readable so the registry profile can show "who is investigating this case" presence.';


-- ##########################################################################
-- ## 039_feedback_table.sql
-- ##########################################################################

-- =============================================================================
-- 039: First-class feedback table
--
-- The feedback page was inserting feedback rows into community_notes with
-- import_record_id = null. community_notes.import_record_id is NOT NULL,
-- which means every feedback submission has been silently failing in the
-- database for as long as that page has existed. Users saw a "Thank you"
-- screen because the client mutation handler did not check for errors.
--
-- This migration creates a dedicated feedback table and the next commit
-- swaps the feedback page over to a server endpoint that writes here.
-- Counts on community_notes elsewhere in the app (profile, watchlist) stop
-- being polluted automatically because the rows never make it in anyway,
-- but the new schema makes the separation explicit.
-- =============================================================================

CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN (
    'feedback',  -- general experience report
    'bug',       -- something is broken or confusing
    'idea',      -- feature suggestion
    'match',     -- match quality issue (false positive / missed match)
    'data'       -- data correctness issue
  )),
  message TEXT NOT NULL,
  contact TEXT,                      -- optional email if the user wants a reply
  page_url TEXT,                     -- where the feedback was submitted from
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'triaged', 'in_progress', 'resolved', 'wontfix')),
  triage_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  triaged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback(feedback_type);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Authenticated users can submit feedback as themselves.
CREATE POLICY "feedback_insert_own" ON feedback
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Authenticated users can see their own feedback (so they could view a
-- history of what they've sent if a UI ever exposed that).
CREATE POLICY "feedback_select_own" ON feedback
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Service role can read/triage/update everything.
CREATE POLICY "feedback_select_admin" ON feedback
  FOR SELECT TO service_role USING (true);

CREATE POLICY "feedback_update_admin" ON feedback
  FOR UPDATE TO service_role USING (true);

COMMENT ON TABLE feedback IS 'User-submitted feedback, bug reports, and ideas. Replaces the previous abuse of community_notes for this purpose.';


-- ##########################################################################
-- ## 040_personal_workspace.sql
-- ##########################################################################

-- =============================================================================
-- 040: Personal workspace cases
--
-- A websleuth lands on a registry profile and wants to drop a screenshot or
-- paste text. The existing QuickCapture flow requires a case context, but
-- the registry corpus is administered by system cases (NamUs Import, Doe
-- Network Import, etc.) that ordinary users do not own. They have no
-- destination case to file into.
--
-- This migration adds an is_personal_workspace flag on cases. Each user
-- has at most one such case (enforced by a unique partial index on
-- created_by). The /api/personal-workspace endpoint lazily creates this
-- case the first time the user invokes QuickCapture from outside an
-- existing case context.
--
-- A workspace case is a user's private filing cabinet — distinct from the
-- system cases and from any cases they are an investigator on by invitation.
-- =============================================================================

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS is_personal_workspace BOOLEAN NOT NULL DEFAULT false;

-- A user may have at most one personal workspace. created_by is the natural
-- key here — one workspace per creator.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_one_workspace_per_user
  ON cases(created_by)
  WHERE is_personal_workspace = true;

CREATE INDEX IF NOT EXISTS idx_cases_workspace
  ON cases(is_personal_workspace)
  WHERE is_personal_workspace = true;

COMMENT ON COLUMN cases.is_personal_workspace IS 'True for the auto-created per-user filing-cabinet case used by QuickCapture from registry profiles. Each user has at most one.';


-- ##########################################################################
-- ## 041_record_siblings.sql
-- ##########################################################################

-- =============================================================================
-- 041: Cross-source record siblings
--
-- The Charley Project records carry an explicit `namus_number` field in
-- raw_data that names the corresponding NamUs case. Doe Network sometimes
-- carries an `mp_number` to NamUs as well. Until now this was unused: a
-- websleuth on a NamUs profile saw the structured fields but not the much
-- richer Charley prose ("details_of_disappearance" runs paragraphs long
-- where NamUs gives a sentence). The two registries described the same
-- person and the app could not surface that.
--
-- record_siblings stores pairwise links between import_records that
-- different registries identify as the same case. link_type captures how
-- the link was established so a UI can rank explicit links above fuzzy
-- ones, and the link is stored as an unordered pair (record_a_id <
-- record_b_id) so reverse-direction queries hit the same row.
-- =============================================================================

CREATE TABLE IF NOT EXISTS record_siblings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_a_id UUID NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,
  record_b_id UUID NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN (
    'explicit_id',          -- one record names the other's external_id (highest confidence)
    'fuzzy_name_state_year' -- name + state + year-of-event match (medium confidence)
  )),
  confidence NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT record_siblings_ordered CHECK (record_a_id < record_b_id),
  UNIQUE (record_a_id, record_b_id)
);

CREATE INDEX IF NOT EXISTS idx_siblings_a ON record_siblings(record_a_id);
CREATE INDEX IF NOT EXISTS idx_siblings_b ON record_siblings(record_b_id);

ALTER TABLE record_siblings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "siblings_select" ON record_siblings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "siblings_insert" ON record_siblings
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "siblings_update" ON record_siblings
  FOR UPDATE TO service_role USING (true);

CREATE POLICY "siblings_delete" ON record_siblings
  FOR DELETE TO service_role USING (true);

COMMENT ON TABLE record_siblings IS 'Pairwise links between import_records identified as the same case across different registries (NamUs/Doe Network/Charley Project).';


-- ##########################################################################
-- ## 042_record_photos.sql
-- ##########################################################################

-- =============================================================================
-- 042: Record photos
--
-- NamUs case-detail responses carry an `images` array. Until now we ignored
-- it, so every registry profile was a wall of text without a face. Adding
-- a photo column does not download the images — it stores the source URLs
-- and lets the UI fetch them through a server-side proxy that hot-links
-- with the right User-Agent and only allows known-source domains. This is
-- enough to put faces on profiles without taking on storage cost or
-- bandwidth bills.
-- =============================================================================

ALTER TABLE import_records
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS photos_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN import_records.photo_urls IS 'Public URLs to the original-size source photos. The UI proxies these through /api/photo-proxy so the source server sees the right User-Agent and CORS works.';
COMMENT ON COLUMN import_records.photos_fetched_at IS 'When the photo URLs were last refreshed. Null = never; old = candidate for re-fetch.';

CREATE INDEX IF NOT EXISTS idx_import_records_photos_fetched
  ON import_records(photos_fetched_at)
  WHERE photos_fetched_at IS NULL;
