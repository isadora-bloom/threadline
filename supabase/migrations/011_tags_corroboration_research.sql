-- Migration 011: Claim Tags, Corroboration Links, Research Tasks

-- ── Claim Tags ────────────────────────────────────────────────────────────────

CREATE TABLE claim_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id    UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  case_id     UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  tag_type    TEXT NOT NULL DEFAULT 'generic',
  -- 'identifier' | 'physical' | 'behavioral' | 'geographic' | 'temporal' | 'generic'
  source      TEXT NOT NULL DEFAULT 'ai',
  -- 'ai' | 'human'
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(claim_id, tag)
);

CREATE INDEX claim_tags_case_tag_idx ON claim_tags(case_id, tag);
CREATE INDEX claim_tags_tag_type_idx ON claim_tags(tag, tag_type);
CREATE INDEX claim_tags_claim_idx    ON claim_tags(claim_id);

ALTER TABLE claim_tags ENABLE ROW LEVEL SECURITY;

-- Read: any case member
CREATE POLICY "claim_tags_select" ON claim_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM case_user_roles WHERE case_id = claim_tags.case_id AND user_id = auth.uid())
);
-- Insert: any case member
CREATE POLICY "claim_tags_insert" ON claim_tags FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM case_user_roles WHERE case_id = claim_tags.case_id AND user_id = auth.uid())
);
-- Delete: creator or lead/admin
CREATE POLICY "claim_tags_delete" ON claim_tags FOR DELETE USING (
  created_by = auth.uid() OR
  EXISTS (SELECT 1 FROM case_user_roles WHERE case_id = claim_tags.case_id AND user_id = auth.uid() AND role IN ('lead_investigator','admin'))
);

-- ── Claim Corroborations ──────────────────────────────────────────────────────

CREATE TABLE claim_corroborations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id                UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  corroborated_by_claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  case_id                 UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  similarity_score        NUMERIC(4,2),
  match_type              TEXT NOT NULL,
  -- 'entity_match' | 'text_similarity' | 'ai_assessed'
  is_contradiction        BOOLEAN NOT NULL DEFAULT false,
  contradiction_detail    TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE(claim_id, corroborated_by_claim_id)
);

CREATE INDEX corroborations_claim_idx ON claim_corroborations(claim_id);
CREATE INDEX corroborations_case_idx  ON claim_corroborations(case_id, is_contradiction);

ALTER TABLE claim_corroborations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corroborations_select" ON claim_corroborations FOR SELECT USING (
  EXISTS (SELECT 1 FROM case_user_roles WHERE case_id = claim_corroborations.case_id AND user_id = auth.uid())
);
CREATE POLICY "corroborations_insert" ON claim_corroborations FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM case_user_roles WHERE case_id = claim_corroborations.case_id AND user_id = auth.uid())
);

-- ── Research Tasks ────────────────────────────────────────────────────────────

CREATE TABLE research_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

  question          TEXT NOT NULL,
  context           TEXT,

  trigger_type      TEXT NOT NULL DEFAULT 'manual',
  -- 'manual' | 'thread_generator' | 'tag_escalation'
  trigger_ref_id    UUID,
  trigger_ref_type  TEXT,
  -- 'claim' | 'thread' | 'tag'

  status            TEXT NOT NULL DEFAULT 'queued',
  -- 'queued' | 'running' | 'awaiting_review' | 'complete' | 'failed'

  research_log      JSONB DEFAULT '[]',
  -- [{ step, query, finding, confidence, source, dead_end }]

  findings          JSONB,
  -- { confirmed: [], probable: [], unresolvable: [] }

  human_next_steps  JSONB DEFAULT '[]',
  -- [{ priority, action, target, rationale }]

  sources_consulted JSONB DEFAULT '[]',
  -- [{ name, url, type, relevance }]

  confidence_summary TEXT,
  error_message      TEXT,

  created_by    UUID REFERENCES auth.users(id),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX research_tasks_case_idx   ON research_tasks(case_id, status);
CREATE INDEX research_tasks_status_idx ON research_tasks(status);

CREATE TRIGGER research_tasks_updated_at
  BEFORE UPDATE ON research_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE research_tasks ENABLE ROW LEVEL SECURITY;

-- Read: any case member
CREATE POLICY "research_tasks_select" ON research_tasks FOR SELECT USING (
  EXISTS (SELECT 1 FROM case_user_roles WHERE case_id = research_tasks.case_id AND user_id = auth.uid())
);
-- Insert: lead/admin only
CREATE POLICY "research_tasks_insert" ON research_tasks FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM case_user_roles WHERE case_id = research_tasks.case_id AND user_id = auth.uid() AND role IN ('lead_investigator','admin'))
);
-- Update: lead/admin only
CREATE POLICY "research_tasks_update" ON research_tasks FOR UPDATE USING (
  EXISTS (SELECT 1 FROM case_user_roles WHERE case_id = research_tasks.case_id AND user_id = auth.uid() AND role IN ('lead_investigator','admin'))
);

-- Extend audit enum for research events
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'research_started';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'research_completed';
