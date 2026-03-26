-- Migration 020: AI connection level infrastructure
--
-- Adds ai_assessment JSONB to offender_case_overlaps so offender-to-case
-- AI reviews can be stored with the universal 1–5 connection_level rating.
-- Cluster connection_level is stored inside the existing signals JSONB column.

ALTER TABLE offender_case_overlaps
  ADD COLUMN IF NOT EXISTS ai_assessment JSONB;

COMMENT ON COLUMN offender_case_overlaps.ai_assessment IS
  'AI-generated connection assessment. Fields: connection_level (1–5), summary, supporting[], conflicting[], reviewed_at, model.
   1=ignore, 2=slim, 3=some, 4=strong, 5=very_strong (top 5–10% only).
   AI-generated signal only — requires investigator review.';
