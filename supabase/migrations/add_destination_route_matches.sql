-- Destination route match candidates
-- Same structure as doe_match_candidates but:
--   missing_location = where they were last seen (origin)
--   destination_text = extracted phrase from circumstances ("heading to Chicago")
--   destination_city, destination_state = parsed destination
--   location signal scored against destination, not last seen
-- All other signals (sex, race, age, hair, eyes, height, weight, marks, jewelry, body_state) identical to cross_match

ALTER TABLE doe_match_candidates
  ADD COLUMN IF NOT EXISTS match_type    TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS destination_text  TEXT,
  ADD COLUMN IF NOT EXISTS destination_city  TEXT,
  ADD COLUMN IF NOT EXISTS destination_state TEXT;

CREATE INDEX IF NOT EXISTS idx_doe_match_candidates_type
  ON doe_match_candidates (missing_case_id, match_type);
