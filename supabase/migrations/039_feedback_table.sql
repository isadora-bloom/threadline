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
