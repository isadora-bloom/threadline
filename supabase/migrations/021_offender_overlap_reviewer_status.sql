-- Migration 021: Reviewer status for offender_case_overlaps
--
-- Adds reviewer_status so investigators can mark overlapping cases as
-- worth investigating / confirmed / dismissed — same workflow as clusters and DOE matches.

ALTER TABLE offender_case_overlaps
  ADD COLUMN IF NOT EXISTS reviewer_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (reviewer_status IN ('unreviewed', 'worth_investigating', 'confirmed', 'dismissed'));

COMMENT ON COLUMN offender_case_overlaps.reviewer_status IS
  'Investigator review status. unreviewed (default) | worth_investigating | confirmed | dismissed.
   Distinct from resolution_confirmed (conviction on record).';
