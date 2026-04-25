-- =============================================================================
-- 040: Personal workspace cases
--
-- A websleuth lands on a registry profile and wants to drop a screenshot or
-- paste text. The existing QuickCapture flow requires a case context, but
-- the registry corpus is administered by system cases (NamUs Import, Doe
-- Network Import, etc.) that ordinary users do not own. They have no
-- destination case to file into.
--
-- This migration adds an is_personal_workspace flag on cases. Each user
-- has at most one such case (enforced by a unique partial index on
-- created_by). The /api/personal-workspace endpoint lazily creates this
-- case the first time the user invokes QuickCapture from outside an
-- existing case context.
--
-- A workspace case is a user's private filing cabinet — distinct from the
-- system cases and from any cases they are an investigator on by invitation.
-- =============================================================================

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS is_personal_workspace BOOLEAN NOT NULL DEFAULT false;

-- A user may have at most one personal workspace. created_by is the natural
-- key here — one workspace per creator.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_one_workspace_per_user
  ON cases(created_by)
  WHERE is_personal_workspace = true;

CREATE INDEX IF NOT EXISTS idx_cases_workspace
  ON cases(is_personal_workspace)
  WHERE is_personal_workspace = true;

COMMENT ON COLUMN cases.is_personal_workspace IS 'True for the auto-created per-user filing-cabinet case used by QuickCapture from registry profiles. Each user has at most one.';
