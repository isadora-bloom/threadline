-- ── Per-submission resolution tracking ───────────────────────────────────────
-- Missing persons cases imported from Doe Network are stored as individual
-- submissions within bulk cases. Resolution data (perpetrator convicted, found
-- alive, etc.) is recorded at the submission level, not the parent case level.

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS resolution_type TEXT
    CHECK (resolution_type IN (
      'found_alive',
      'remains_identified',
      'perpetrator_convicted',
      'perpetrator_identified',
      'closed_unresolved',
      'duplicate_case'
    )),
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
  ADD COLUMN IF NOT EXISTS convicted_offender_id UUID
    REFERENCES known_offenders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Index for fast filtering in match script (skip resolved submissions)
CREATE INDEX IF NOT EXISTS idx_submissions_resolution
  ON submissions(resolution_type)
  WHERE resolution_type IS NOT NULL;

-- Index for confirmed-match lookup
CREATE INDEX IF NOT EXISTS idx_submissions_convicted_offender
  ON submissions(convicted_offender_id)
  WHERE convicted_offender_id IS NOT NULL;
