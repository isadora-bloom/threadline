-- Soft delete: discarded submissions are never hard-deleted
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS discarded_at TIMESTAMPTZ;

-- Legal hold on cases
ALTER TABLE cases ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS legal_hold_set_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS legal_hold_set_by UUID REFERENCES auth.users(id);
ALTER TABLE cases ADD COLUMN IF NOT EXISTS legal_hold_reason TEXT;

-- Update the SELECT policies so discarded submissions are still accessible
-- (they appear in the UI with a discarded indicator, just filtered by default)
-- No schema change needed — filter is applied at query level in the app.

-- Add index for soft-delete queries
CREATE INDEX IF NOT EXISTS idx_submissions_discarded ON submissions(case_id, discarded_at) WHERE discarded_at IS NULL;

-- Add scan_status to submission_files for virus scan integration
ALTER TABLE submission_files ADD COLUMN IF NOT EXISTS scan_status TEXT DEFAULT 'pending';
-- 'pending' | 'clean' | 'flagged' | 'skipped'
ALTER TABLE submission_files ADD COLUMN IF NOT EXISTS scan_completed_at TIMESTAMPTZ;
