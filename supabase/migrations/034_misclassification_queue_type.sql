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
