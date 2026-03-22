-- ── Known Offenders ─────────────────────────────────────────────────────────
-- Profiles of convicted serial offenders (2+ victims) for pattern overlap
-- matching against missing persons and unidentified remains.
--
-- Matching philosophy:
--   - Geography has two dimensions: predator home/travel range AND victim dump sites
--   - Age range uses decay scoring, not hard cutoffs (MO evolves over career)
--   - Everything weighted; only hard eliminate is temporal (after incarceration)

CREATE TABLE IF NOT EXISTS known_offenders (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  aliases             text[]      DEFAULT '{}',

  -- Identity
  birth_year          int,                       -- used as hard eliminate floor (active_from must be >= birth_year + 14)

  -- Status
  status              text        NOT NULL DEFAULT 'convicted',
    -- 'convicted' | 'deceased' | 'incarcerated' | 'released' | 'suspected'
  conviction_count    int,                       -- confirmed victim count
  suspected_count     int,                       -- claimed/suspected victims
  active_from         int,                       -- year first known offense
  active_to           int,                       -- year last known offense (null = unknown end)
  incarcerated_from   int,                       -- year removed from circulation
  incarcerated_to     int,                       -- year released (null = still in)

  -- Predator geography (where THEY operated, lived, traveled)
  home_states         text[]      DEFAULT '{}',  -- states of residence during active period
  home_cities         text[]      DEFAULT '{}',  -- specific cities/towns
  travel_corridors    text[]      DEFAULT '{}',  -- interstates, routes (e.g. 'I-70', 'US-40')
  operation_states    text[]      DEFAULT '{}',  -- all states with confirmed activity

  -- Victim geography (where victims were found / went missing)
  victim_states       text[]      DEFAULT '{}',
  victim_cities       text[]      DEFAULT '{}',

  -- Victim profile
  victim_sex          text        DEFAULT 'female',
    -- 'female' | 'male' | 'both'
  victim_races        text[]      DEFAULT '{}',  -- documented victim races
  victim_age_min      int,                       -- youngest known victim
  victim_age_max      int,                       -- oldest known victim
  victim_age_typical  int,                       -- modal / most common victim age

  -- MO and signature
  mo_keywords         text[]      DEFAULT '{}',
    -- e.g. 'hitchhiker', 'sex_worker', 'truck_stop', 'runaway', 'college_campus',
    --      'home_invasion', 'dating', 'foster_care', 'bar', 'highway_abduction'
  disposal_method     text[]      DEFAULT '{}',
    -- e.g. 'roadside', 'wooded', 'water', 'buried', 'left_in_place', 'remote'
  cause_of_death      text[]      DEFAULT '{}',
    -- e.g. 'strangulation', 'stabbing', 'blunt_force', 'shooting', 'undetermined'
  signature_details   text,                      -- free text: specific signature behaviors

  -- Source / credibility
  source_notes        text,
  wikipedia_slug      text,

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Index for geographic matching
CREATE INDEX IF NOT EXISTS idx_offenders_home_states      ON known_offenders USING gin(home_states);
CREATE INDEX IF NOT EXISTS idx_offenders_operation_states ON known_offenders USING gin(operation_states);
CREATE INDEX IF NOT EXISTS idx_offenders_victim_states    ON known_offenders USING gin(victim_states);
CREATE INDEX IF NOT EXISTS idx_offenders_mo               ON known_offenders USING gin(mo_keywords);

-- Offender-to-case overlap results (computed, stored for display)
CREATE TABLE IF NOT EXISTS offender_case_overlaps (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  offender_id           uuid        NOT NULL REFERENCES known_offenders(id) ON DELETE CASCADE,
  submission_id         uuid        NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  case_id               uuid        NOT NULL,

  composite_score       numeric(5,2) NOT NULL,
  temporal_score        numeric(5,2) DEFAULT 0,
  predator_geo_score    numeric(5,2) DEFAULT 0,
  victim_geo_score      numeric(5,2) DEFAULT 0,
  victim_sex_score      numeric(5,2) DEFAULT 0,
  victim_age_score      numeric(5,2) DEFAULT 0,
  victim_race_score     numeric(5,2) DEFAULT 0,
  mo_score              numeric(5,2) DEFAULT 0,
  disposal_score        numeric(5,2) DEFAULT 0,

  matched_mo_keywords   text[]      DEFAULT '{}',
  matched_disposal      text[]      DEFAULT '{}',
  notes                 text,

  computed_at           timestamptz DEFAULT now(),

  UNIQUE (offender_id, submission_id)
);

CREATE INDEX IF NOT EXISTS idx_overlaps_submission   ON offender_case_overlaps(submission_id);
CREATE INDEX IF NOT EXISTS idx_overlaps_offender     ON offender_case_overlaps(offender_id);
CREATE INDEX IF NOT EXISTS idx_overlaps_score        ON offender_case_overlaps(composite_score DESC);

-- RLS
ALTER TABLE known_offenders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE offender_case_overlaps  ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user
CREATE POLICY "authenticated read offenders"
  ON known_offenders FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated read overlaps"
  ON offender_case_overlaps FOR SELECT TO authenticated USING (true);

-- Write: service role only (populated by scripts)
CREATE POLICY "service role write offenders"
  ON known_offenders FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service role write overlaps"
  ON offender_case_overlaps FOR ALL TO service_role USING (true) WITH CHECK (true);
