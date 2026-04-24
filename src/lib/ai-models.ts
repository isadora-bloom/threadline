/**
 * Centralized AI model configuration.
 *
 * Before this existed, model IDs were hardcoded across 12+ files with three
 * different values, including `claude-opus-4-6` which is not a valid Claude
 * model identifier (there is no Opus 4.6 — valid Opus is `claude-opus-4-7`,
 * valid Sonnet is `claude-sonnet-4-6`). Those calls failed silently at the
 * API and dead-ended whatever flow invoked them.
 *
 * Models are grouped by purpose so we can swap speed/cost/quality per flow
 * without touching call sites. Each constant is env-overridable so upgrading
 * the API key (to add Sonnet/Opus access) is a one-env-var change rather
 * than a multi-file rewrite.
 *
 * Defaults point at Haiku because that is the only model the production API
 * key is confirmed to have access to today. Upgrade defaults once a wider
 * key is provisioned.
 */

/** Deep text / image extraction — runs once per new submission or screenshot. */
export const EXTRACTION_MODEL =
  process.env.THREADLINE_EXTRACTION_MODEL ?? 'claude-haiku-4-5-20251001'

/** Multi-layer case research, thread generation, corroboration reasoning. */
export const RESEARCH_MODEL =
  process.env.THREADLINE_RESEARCH_MODEL ?? 'claude-haiku-4-5-20251001'

/** Batch solvability and entity scoring across the registry. */
export const SCORING_MODEL =
  process.env.THREADLINE_SCORING_MODEL ?? 'claude-haiku-4-5-20251001'

/** Small per-row judgments: match review, offender assessment, drafting. */
export const REVIEW_MODEL =
  process.env.THREADLINE_REVIEW_MODEL ?? 'claude-haiku-4-5-20251001'
