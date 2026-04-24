-- =============================================================================
-- 031: Research Provenance
--
-- Add prompt_hash and model_config to deep_research so runs are reproducible.
-- prompt_hash is a SHA-256 of the system prompt text at run time.
-- model_config captures temperature, max_tokens, and any other params.
-- =============================================================================

ALTER TABLE deep_research
  ADD COLUMN IF NOT EXISTS prompt_hash TEXT,
  ADD COLUMN IF NOT EXISTS model_config JSONB DEFAULT '{}';

COMMENT ON COLUMN deep_research.prompt_hash IS 'SHA-256 of the prompt sent to the model, for reproducibility auditing';
COMMENT ON COLUMN deep_research.model_config IS 'Model parameters used: { model, max_tokens, temperature }';
