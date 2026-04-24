-- =============================================================================
-- 038: Activity presence — revive user_activity_log
--
-- Migration 026 created user_activity_log and then nothing ever wrote to or
-- read from it. The original design intent (visible in migration 026 and
-- memory notes) was for presence: investigators seeing each other on a case
-- without explicitly coordinating. The "ethical engagement" mission hinges
-- on this signal existing.
--
-- The original RLS policy allowed users to SELECT only their own rows, which
-- made presence impossible. This migration opens SELECT to all authenticated
-- users while keeping INSERT restricted to the acting user. Users who want
-- privacy can simply not take actions.
--
-- Also adds a lookup index by ref_id so the "who is active on this record"
-- query is fast (the existing index is only by user_id).
-- =============================================================================

DROP POLICY IF EXISTS "activity_own" ON user_activity_log;

CREATE POLICY "activity_public_select" ON user_activity_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "activity_own_insert" ON user_activity_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "activity_own_delete" ON user_activity_log
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ual_ref_date
  ON user_activity_log(ref_id, created_at DESC)
  WHERE ref_id IS NOT NULL;

COMMENT ON TABLE user_activity_log IS 'Audit trail of user contributions (watch, note, research, review). Publicly readable so the registry profile can show "who is investigating this case" presence.';
