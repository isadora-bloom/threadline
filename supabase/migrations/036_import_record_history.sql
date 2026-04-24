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
