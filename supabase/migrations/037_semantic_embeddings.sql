-- =============================================================================
-- 037: Semantic embeddings on import_records
--
-- The existing connection scorer does lexical comparison: substring overlap
-- on distinguishing marks, exact-match on hair color. It cannot tell that
-- "heart with arrow, right shoulder" and "arrow through a heart on the R
-- shoulder" describe the same tattoo. Embeddings close that gap.
--
-- Two columns because the two fields describe different things and should
-- be indexed independently: circumstances describe the event, marks describe
-- the body. A case matching on circumstances is a lead; a case matching on
-- marks is usually a near-identification.
--
-- Dimensions: voyage-3 produces 1024-dim vectors. If you switch to
-- voyage-3-large (2048) or voyage-3-lite (512) you will need a new
-- migration — vector columns are fixed-dimension.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE import_records
  ADD COLUMN IF NOT EXISTS circumstances_embedding vector(1024),
  ADD COLUMN IF NOT EXISTS circumstances_embedded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marks_embedding vector(1024),
  ADD COLUMN IF NOT EXISTS marks_embedded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS embedding_model TEXT;

COMMENT ON COLUMN import_records.circumstances_embedding IS 'voyage-3 embedding of circumstances_summary. Used for semantic nearest-neighbor matching beyond lexical overlap.';
COMMENT ON COLUMN import_records.marks_embedding IS 'voyage-3 embedding of distinguishing_marks concatenated. Catches paraphrased descriptions like "heart with arrow" vs "arrow through a heart".';

-- ivfflat is the right index for cosine-similarity nearest-neighbor search at
-- this scale (tens of thousands of rows). lists = sqrt(rows) is a reasonable
-- starting heuristic. Rebuild these after bulk-embedding: REINDEX INDEX ...
CREATE INDEX IF NOT EXISTS idx_import_records_circumstances_embedding
  ON import_records USING ivfflat (circumstances_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_import_records_marks_embedding
  ON import_records USING ivfflat (marks_embedding vector_cosine_ops)
  WITH (lists = 100);

-- Helper for the neighbor flagger: returns the N nearest neighbors of a given
-- record by circumstances similarity, excluding the record itself. Caller
-- filters out rows already in global_connections.
CREATE OR REPLACE FUNCTION nearest_by_circumstances(
  target_id UUID,
  match_count INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  person_name TEXT,
  record_type TEXT,
  state TEXT,
  similarity NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH target AS (
    SELECT circumstances_embedding FROM import_records WHERE id = target_id
  )
  SELECT
    r.id,
    r.person_name,
    r.record_type,
    r.state,
    (1 - (r.circumstances_embedding <=> t.circumstances_embedding))::numeric AS similarity
  FROM import_records r
  CROSS JOIN target t
  WHERE r.id <> target_id
    AND r.circumstances_embedding IS NOT NULL
    AND t.circumstances_embedding IS NOT NULL
  ORDER BY r.circumstances_embedding <=> t.circumstances_embedding
  LIMIT match_count
$$;

CREATE OR REPLACE FUNCTION nearest_by_marks(
  target_id UUID,
  match_count INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  person_name TEXT,
  record_type TEXT,
  state TEXT,
  similarity NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH target AS (
    SELECT marks_embedding FROM import_records WHERE id = target_id
  )
  SELECT
    r.id,
    r.person_name,
    r.record_type,
    r.state,
    (1 - (r.marks_embedding <=> t.marks_embedding))::numeric AS similarity
  FROM import_records r
  CROSS JOIN target t
  WHERE r.id <> target_id
    AND r.marks_embedding IS NOT NULL
    AND t.marks_embedding IS NOT NULL
  ORDER BY r.marks_embedding <=> t.marks_embedding
  LIMIT match_count
$$;
