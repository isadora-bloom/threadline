-- ── Resolution ↔ Offender Link ───────────────────────────────────────────────
-- When a case is resolved with a known offender (perpetrator_convicted /
-- perpetrator_identified), link to the known_offenders record so the match
-- script can flag that overlap as confirmed rather than speculative.
--
-- resolution_excluded: overlap skipped because case is resolved in a way that
--   makes further offender matching meaningless (found_alive, duplicate_case).

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS convicted_offender_id UUID
    REFERENCES known_offenders(id) ON DELETE SET NULL;

ALTER TABLE offender_case_overlaps
  ADD COLUMN IF NOT EXISTS resolution_confirmed  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolution_excluded   BOOLEAN NOT NULL DEFAULT false;

-- Index so UI can quickly pull confirmed overlaps
CREATE INDEX IF NOT EXISTS idx_overlaps_confirmed
  ON offender_case_overlaps(resolution_confirmed)
  WHERE resolution_confirmed = true;
