-- Add AI assessment column to doe_match_candidates
-- Run this in the Supabase SQL editor

alter table doe_match_candidates
  add column if not exists ai_assessment jsonb;

comment on column doe_match_candidates.ai_assessment is
  'AI-generated assessment from Claude Haiku. Fields: verdict (plausible/unlikely/uncertain), confidence, summary, supporting[], conflicting[], reviewed_at, model. Signal only — requires investigator review.';
