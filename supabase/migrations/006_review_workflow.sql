-- Migration 006: Review workflow — priority scoring, triage, invitations, claim templates, similarity

-- Priority scoring on submissions
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS priority_score INTEGER DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS priority_level TEXT DEFAULT 'medium';
-- 'high'(70+) | 'medium'(35-69) | 'low'(0-34)

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS novelty_flags JSONB DEFAULT '[]';
-- Array of: {"type": "new_entity"|"corroboration"|"contradiction", "label": "...", "count": N}

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS triage_status TEXT DEFAULT 'untriaged';
-- 'untriaged' | 'claimed' | 'deferred' | 'discarded'
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS triage_discard_reason TEXT;
-- 'off_topic' | 'duplicate' | 'spam' | 'insufficient_detail'
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS triage_by UUID REFERENCES auth.users(id);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS triage_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES auth.users(id);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS review_started_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS review_completed_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS word_count INTEGER DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS entity_count_step6 INTEGER DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS has_location_pin BOOLEAN DEFAULT false;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS has_date BOOLEAN DEFAULT false;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS duplicate_similarity NUMERIC(5,2);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS duplicate_of_submission_id UUID REFERENCES submissions(id);

-- Invitation system
CREATE TABLE IF NOT EXISTS case_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role user_role NOT NULL,
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Claim templates (global or per-case)
CREATE TABLE IF NOT EXISTS claim_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE, -- NULL = global
  name TEXT NOT NULL,
  claim_type claim_type NOT NULL,
  observation_mode observation_mode,
  suggested_source_confidence confidence_level DEFAULT 'medium',
  suggested_content_confidence confidence_level DEFAULT 'medium',
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Submission similarity pairs (for duplicate detection)
CREATE TABLE IF NOT EXISTS submission_similarity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_a_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  submission_b_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  similarity_score NUMERIC(5,4) NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(submission_a_id, submission_b_id)
);

-- Priority scoring function
CREATE OR REPLACE FUNCTION compute_submission_priority(p_submission_id UUID)
RETURNS TABLE(score INTEGER, level TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_sub submissions%ROWTYPE;
  v_score INTEGER := 0;
BEGIN
  SELECT * INTO v_sub FROM submissions WHERE id = p_submission_id;

  -- Source quality
  IF v_sub.submitter_consent = 'on_record'    THEN v_score := v_score + 20; END IF;
  IF v_sub.submitter_consent = 'confidential' THEN v_score := v_score + 10; END IF;
  IF v_sub.firsthand = true                   THEN v_score := v_score + 25; END IF;

  -- Observation mode
  IF v_sub.observation_mode = 'observed_directly' THEN v_score := v_score + 20; END IF;
  IF v_sub.observation_mode = 'heard_directly'    THEN v_score := v_score + 10; END IF;

  -- Specificity signals
  IF v_sub.entity_count_step6 >= 3  THEN v_score := v_score + 15; END IF;
  IF v_sub.entity_count_step6 >= 5  THEN v_score := v_score + 10; END IF;
  IF v_sub.has_date = true          THEN v_score := v_score + 15; END IF;
  IF v_sub.has_location_pin = true  THEN v_score := v_score + 10; END IF;

  -- Word count bonus (substance)
  IF v_sub.word_count >= 50  THEN v_score := v_score + 5;  END IF;
  IF v_sub.word_count >= 150 THEN v_score := v_score + 5;  END IF;

  -- Interpretation-only penalty
  IF v_sub.interpretation_text IS NOT NULL AND v_sub.word_count < 20 THEN
    v_score := v_score - 20;
  END IF;

  v_score := GREATEST(0, LEAST(v_score, 100));

  RETURN QUERY SELECT
    v_score,
    CASE
      WHEN v_score >= 70 THEN 'high'
      WHEN v_score >= 35 THEN 'medium'
      ELSE 'low'
    END;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_submissions_priority ON submissions(case_id, priority_level, triage_status);
CREATE INDEX IF NOT EXISTS idx_submissions_triage ON submissions(case_id, triage_status);
CREATE INDEX IF NOT EXISTS idx_case_invitations_token ON case_invitations(token);
CREATE INDEX IF NOT EXISTS idx_submission_similarity ON submission_similarity(submission_a_id, similarity_score DESC);
