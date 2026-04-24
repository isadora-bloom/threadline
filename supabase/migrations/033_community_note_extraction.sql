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
