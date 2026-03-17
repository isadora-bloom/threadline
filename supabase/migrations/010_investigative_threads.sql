-- Migration 010: Investigative Threads
-- Adds the investigative_threads table and extends the audit_action enum

-- ── Extend audit_action enum ─────────────────────────────────────────────────
-- Postgres requires ADD VALUE outside a transaction for enum changes
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'hypothesis_generated';

-- ── Investigative threads ────────────────────────────────────────────────────

CREATE TABLE investigative_threads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id               UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  -- Threads from the same generation run share a batch_id
  generation_batch_id   UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Thread content (structured output from Claude)
  hypothesis            TEXT NOT NULL,
  supporting_claim_ids  UUID[] NOT NULL DEFAULT '{}',
  complicating_factors  TEXT,
  recommended_actions   TEXT[] NOT NULL DEFAULT '{}',
  external_resources    TEXT[] NOT NULL DEFAULT '{}',

  -- Lifecycle
  -- unreviewed | active | dismissed | exported_to_handoff
  status                TEXT NOT NULL DEFAULT 'unreviewed',
  status_reason         TEXT,
  assigned_to           UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Provenance
  generated_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at           TIMESTAMPTZ,
  generation_model      TEXT DEFAULT 'claude-opus-4-6',

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX investigative_threads_case_id_idx ON investigative_threads(case_id, created_at DESC);
CREATE INDEX investigative_threads_batch_idx   ON investigative_threads(generation_batch_id);

CREATE TRIGGER investigative_threads_updated_at
  BEFORE UPDATE ON investigative_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE investigative_threads ENABLE ROW LEVEL SECURITY;

-- Read: any case member
CREATE POLICY "threads_select" ON investigative_threads
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = investigative_threads.case_id
        AND user_id = auth.uid()
    )
  );

-- Insert: lead_investigator or admin only
CREATE POLICY "threads_insert" ON investigative_threads
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = investigative_threads.case_id
        AND user_id = auth.uid()
        AND role IN ('lead_investigator', 'admin')
    )
  );

-- Update (accept/dismiss/assign): lead_investigator or admin only
CREATE POLICY "threads_update" ON investigative_threads
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_id = investigative_threads.case_id
        AND user_id = auth.uid()
        AND role IN ('lead_investigator', 'admin')
    )
  );
