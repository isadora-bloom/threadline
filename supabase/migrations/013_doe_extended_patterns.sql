-- ─── DELETE policies for existing Doe tables (needed for re-run operations) ──

CREATE POLICY "lead or admin can delete doe_victimology_clusters"
  ON doe_victimology_clusters FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_user_roles.case_id = doe_victimology_clusters.case_id
        AND case_user_roles.user_id = auth.uid()
        AND case_user_roles.role IN ('lead_investigator','admin')
    )
  );

CREATE POLICY "lead or admin can delete doe_match_candidates"
  ON doe_match_candidates FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_user_roles.case_id = doe_match_candidates.missing_case_id
        AND case_user_roles.user_id = auth.uid()
        AND case_user_roles.role IN ('lead_investigator','admin')
    )
  );

-- ─── Entity mentions ──────────────────────────────────────────────────────────
-- Person names, vehicles, and locations extracted from case circumstances text.
-- match_count > 0 means the same entity appears in multiple separate submissions.

CREATE TABLE doe_entity_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,

  -- 'person_name'     — a person mentioned in "last seen with / met / left with" context
  -- 'vehicle'         — vehicle description extracted from circumstances
  -- 'location'        — specific named location (business, address)
  -- 'possible_duplicate' — two missing person records with nearly-identical names (phonetic match)
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person_name', 'vehicle', 'location', 'possible_duplicate')),

  entity_value TEXT NOT NULL,    -- normalized entity text
  raw_snippet  TEXT,             -- original text it was extracted from

  -- Cross-case match info (populated by extract_entities / name_dedup actions)
  matched_submission_ids UUID[] DEFAULT '{}',
  match_count INTEGER NOT NULL DEFAULT 0,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON doe_entity_mentions(case_id);
CREATE INDEX ON doe_entity_mentions(entity_type);
CREATE INDEX ON doe_entity_mentions(entity_value);
CREATE INDEX ON doe_entity_mentions(match_count DESC);
CREATE INDEX ON doe_entity_mentions(submission_id);

-- ─── Stall flags ──────────────────────────────────────────────────────────────
-- Missing persons with investigative stall patterns:
--   voluntary/runaway classification that was never revisited after years elapsed

CREATE TABLE doe_stall_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,

  stall_type TEXT NOT NULL CHECK (stall_type IN (
    'voluntary_misclassification',  -- classified "voluntary", years elapsed, still open
    'runaway_no_followup',          -- classified "runaway", years elapsed, still open
    'quick_closure_young'           -- minor classified runaway/voluntary, still open
  )),
  stall_label TEXT NOT NULL,
  elapsed_days INTEGER,
  classification_used TEXT,
  supporting_signals TEXT[] DEFAULT '{}',

  -- Denormalized display fields
  missing_name     TEXT,
  missing_age      TEXT,
  missing_date     TEXT,
  missing_location TEXT,

  -- Reviewer workflow
  reviewer_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (reviewer_status IN ('unreviewed','worth_investigating','confirmed','dismissed')),
  reviewed_by   UUID REFERENCES auth.users(id),
  reviewed_at   TIMESTAMPTZ,
  reviewer_note TEXT,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(submission_id, stall_type)
);

CREATE INDEX ON doe_stall_flags(case_id);
CREATE INDEX ON doe_stall_flags(stall_type);
CREATE INDEX ON doe_stall_flags(reviewer_status);
CREATE INDEX ON doe_stall_flags(elapsed_days DESC);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE doe_entity_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE doe_stall_flags     ENABLE ROW LEVEL SECURITY;

-- Entity mentions
CREATE POLICY "case members can read doe_entity_mentions"
  ON doe_entity_mentions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_user_roles.case_id = doe_entity_mentions.case_id
        AND case_user_roles.user_id = auth.uid()
    )
  );

CREATE POLICY "lead or admin can insert doe_entity_mentions"
  ON doe_entity_mentions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_user_roles.case_id = doe_entity_mentions.case_id
        AND case_user_roles.user_id = auth.uid()
        AND case_user_roles.role IN ('lead_investigator','admin')
    )
  );

CREATE POLICY "lead or admin can delete doe_entity_mentions"
  ON doe_entity_mentions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_user_roles.case_id = doe_entity_mentions.case_id
        AND case_user_roles.user_id = auth.uid()
        AND case_user_roles.role IN ('lead_investigator','admin')
    )
  );

-- Stall flags
CREATE POLICY "case members can read doe_stall_flags"
  ON doe_stall_flags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_user_roles.case_id = doe_stall_flags.case_id
        AND case_user_roles.user_id = auth.uid()
    )
  );

CREATE POLICY "lead or admin can insert doe_stall_flags"
  ON doe_stall_flags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_user_roles.case_id = doe_stall_flags.case_id
        AND case_user_roles.user_id = auth.uid()
        AND case_user_roles.role IN ('lead_investigator','admin')
    )
  );

CREATE POLICY "lead or admin can update doe_stall_flags"
  ON doe_stall_flags FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_user_roles.case_id = doe_stall_flags.case_id
        AND case_user_roles.user_id = auth.uid()
        AND case_user_roles.role IN ('lead_investigator','admin')
    )
  );

CREATE POLICY "lead or admin can delete doe_stall_flags"
  ON doe_stall_flags FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM case_user_roles
      WHERE case_user_roles.case_id = doe_stall_flags.case_id
        AND case_user_roles.user_id = auth.uid()
        AND case_user_roles.role IN ('lead_investigator','admin')
    )
  );
