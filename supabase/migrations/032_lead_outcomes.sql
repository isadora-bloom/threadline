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
