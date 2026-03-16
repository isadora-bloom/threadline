-- Track ToS acceptance in user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS accepted_tos_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_tos_version TEXT; -- for future version tracking

-- Current ToS version identifier
-- Bump this string when the ToS materially changes to require re-acceptance
COMMENT ON COLUMN user_profiles.accepted_tos_version IS
  'Version string of the ToS accepted. Current: "2026-03". Bump to force re-acceptance.';
