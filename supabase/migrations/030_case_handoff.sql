-- =============================================================================
-- 030: Case Handoff & Law Enforcement Feedback
--
-- Track: which agency to submit to, submission status, LE response,
-- and share that status across all watchers of a case.
-- =============================================================================

CREATE TABLE IF NOT EXISTS case_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_record_id UUID NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,

  -- Which agency
  agency_name TEXT NOT NULL,          -- "Salt Lake City Police Department"
  agency_type TEXT CHECK (agency_type IN ('local_police', 'sheriff', 'state_police', 'fbi', 'medical_examiner', 'district_attorney', 'other')),
  agency_contact TEXT,                -- Phone, email, or address
  agency_jurisdiction TEXT,           -- "Salt Lake City, Utah"
  tip_line TEXT,                      -- Specific tip line number if different

  -- Submission tracking
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',              -- Being prepared
    'ready',              -- Package built, not yet sent
    'submitted',          -- Sent to agency
    'acknowledged',       -- Agency confirmed receipt
    'under_review',       -- Agency is reviewing
    'action_taken',       -- Agency took action (investigation opened, etc.)
    'declined',           -- Agency declined / no action
    'no_response'         -- No response after reasonable time
  )),

  -- What was submitted
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES auth.users(id),
  submission_method TEXT,             -- "email", "phone", "web_tip", "in_person", "mail"
  reference_number TEXT,              -- Agency's case/reference number if given

  -- LE Response
  le_response TEXT,                   -- What they said
  le_response_at TIMESTAMPTZ,
  le_declined_reason TEXT,            -- "already investigated", "insufficient evidence", "jurisdiction", "other"

  -- Package content
  included_notes TEXT[],              -- IDs of community_notes included
  included_matches TEXT[],            -- IDs of doe_match_candidates included
  ai_research_id UUID REFERENCES deep_research(id), -- Deep research included
  custom_summary TEXT,                -- User-written summary for the package
  package_data JSONB,                 -- Full rendered package content

  -- Audit
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_handoffs_record ON case_handoffs(import_record_id);
CREATE INDEX idx_handoffs_status ON case_handoffs(status);

CREATE TRIGGER update_case_handoffs_updated_at
  BEFORE UPDATE ON case_handoffs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: all watchers of a case can see handoffs, creator can edit
ALTER TABLE case_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "handoffs_read" ON case_handoffs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "handoffs_insert" ON case_handoffs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "handoffs_update" ON case_handoffs
  FOR UPDATE TO authenticated USING (auth.uid() = created_by OR auth.uid() = submitted_by);
