-- ── Case Resolution ──────────────────────────────────────────────────────────
-- Tracks how a case was ultimately resolved.
-- Separate from `status` (active/closed/etc) — status tracks workflow state,
-- resolution tracks the factual outcome when a case reaches conclusion.

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS resolution_type TEXT
    CHECK (resolution_type IN (
      'found_alive',           -- missing person located alive
      'remains_identified',    -- unidentified remains identified
      'perpetrator_convicted', -- offender identified and convicted
      'perpetrator_identified',-- offender identified, case pending or no conviction
      'closed_unresolved',     -- case closed without resolution (cold case)
      'duplicate_case'         -- duplicate entry, see notes
    )),
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Index so the cross-reference panel can quickly check resolution
CREATE INDEX IF NOT EXISTS idx_cases_resolution_type ON cases(resolution_type)
  WHERE resolution_type IS NOT NULL;
