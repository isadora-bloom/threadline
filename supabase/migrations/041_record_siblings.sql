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
