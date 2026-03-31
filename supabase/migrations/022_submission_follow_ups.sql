-- Migration 022: Per-submission follow-up task queue
--
-- Lightweight action items that investigators attach to submissions or claims.
-- Distinct from ResearchTasks (which run AI workflows) — these are simple
-- to-dos like "call this witness back" or "verify against police report".

CREATE TABLE submission_follow_ups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
  claim_id      UUID REFERENCES claims(id) ON DELETE SET NULL,
  text          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'done')),
  due_date      DATE,
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  completed_by  UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX ON submission_follow_ups(case_id, status);
CREATE INDEX ON submission_follow_ups(submission_id);
CREATE INDEX ON submission_follow_ups(claim_id);

ALTER TABLE submission_follow_ups ENABLE ROW LEVEL SECURITY;

-- Any case member can read all follow-ups for the case
CREATE POLICY "followups_select" ON submission_follow_ups FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM case_user_roles
    WHERE case_id = submission_follow_ups.case_id
      AND user_id = auth.uid()
  )
);

-- Any case member can create follow-ups (must own the record)
CREATE POLICY "followups_insert" ON submission_follow_ups FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM case_user_roles
    WHERE case_id = submission_follow_ups.case_id
      AND user_id = auth.uid()
  )
  AND created_by = auth.uid()
);

-- Any case member can update (mark done/reopen) any follow-up
CREATE POLICY "followups_update" ON submission_follow_ups FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM case_user_roles
    WHERE case_id = submission_follow_ups.case_id
      AND user_id = auth.uid()
  )
);

-- Creators and lead/admin can delete
CREATE POLICY "followups_delete" ON submission_follow_ups FOR DELETE USING (
  created_by = auth.uid() OR
  EXISTS (
    SELECT 1 FROM case_user_roles
    WHERE case_id = submission_follow_ups.case_id
      AND user_id = auth.uid()
      AND role IN ('lead_investigator', 'admin')
  )
);
