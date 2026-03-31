-- Performance indexes for doe_match_candidates
-- The table has millions of rows; filtered queries time out without indexes

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_doe_match_case_grade
  ON doe_match_candidates(missing_case_id, grade, composite_score DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_doe_match_grade_score
  ON doe_match_candidates(grade, composite_score DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_doe_match_very_strong
  ON doe_match_candidates(composite_score DESC)
  WHERE grade = 'very_strong';

-- Set default reviewer_status for existing rows (currently null)
UPDATE doe_match_candidates
  SET reviewer_status = 'unreviewed'
  WHERE reviewer_status IS NULL;
