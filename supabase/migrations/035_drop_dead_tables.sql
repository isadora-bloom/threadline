-- =============================================================================
-- 035: Drop truly-dead tables
--
-- Each table below has zero writers and zero readers in the application code
-- and in scripts/ — verified by grep across src/ and scripts/. They survived
-- because earlier roadmap work scaffolded them before the intelligence-first
-- pivot, or because their writer was removed without removing the table.
--
-- Decision rationale per table:
--
--   events / event_claim_links
--     Migration 001 comment: "scaffolded for v1, promoted in v1.1". Designed
--     for curated timelines where events are first-class nodes and claims
--     attest to them. The pivot made cross-corpus pattern analysis primary,
--     so curated per-case timelines never got UI. The timeline page at
--     /cases/[caseId]/timeline renders claims/submissions sorted by date
--     directly, bypassing these tables entirely.
--
--   claim_templates
--     Migration 006 comment: "Claim templates (global or per-case)". Designed
--     to pre-fill claim types with suggested confidence levels for repeated
--     investigator workflows. Never reached the UI. YAGNI — can be recreated
--     in one migration if the case system is ever revisited.
--
--   submission_similarity
--     Migration 006: duplicate detection table. Writer killed in Pass 1 of
--     this audit because submissions.duplicate_of_submission_id already
--     carries the useful state. The table is now genuinely orphaned — no
--     writer, no reader.
--
-- user_activity_log is intentionally NOT dropped; it is being revived for
-- "I'm investigating" presence tracking in Pass 3.
--
-- CASCADE removes RLS policies, FK constraints, indexes, and triggers
-- attached to each table. Existing rows (if any) are destroyed.
-- =============================================================================

DROP TABLE IF EXISTS event_claim_links CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS claim_templates CASCADE;
DROP TABLE IF EXISTS submission_similarity CASCADE;

-- event_status enum survives — no tables depend on it now, but it is cheap
-- to keep and a future events-like feature could reuse it. If you want a
-- totally clean schema, uncomment the following after verifying nothing
-- depends on the type:
--
-- DROP TYPE IF EXISTS event_status;
