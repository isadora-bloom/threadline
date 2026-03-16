-- Threadline Case Intelligence Platform
-- Migration 003: Pattern Intelligence Layer

-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- ALTER EXISTING TABLES
-- ============================================================

-- Add geo columns to entities
ALTER TABLE entities ADD COLUMN IF NOT EXISTS lat NUMERIC(10, 7);
ALTER TABLE entities ADD COLUMN IF NOT EXISTS lng NUMERIC(10, 7);
ALTER TABLE entities ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS geocode_source TEXT;
-- 'submitter_pin' | 'address_lookup' | 'manual' | 'approximate'
ALTER TABLE entities ADD COLUMN IF NOT EXISTS nearest_highway TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS highway_distance_m NUMERIC;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS highway_proximity TEXT;
-- 'on_route'(<500m) | 'near_route'(<3200m) | 'off_route'

-- Weapon/method fields for entities of those types
ALTER TABLE entities ADD COLUMN IF NOT EXISTS weapon_category TEXT;
-- 'firearm'|'bladed'|'blunt'|'ligature'|'chemical'|'vehicle'|'hands'|'unknown'
ALTER TABLE entities ADD COLUMN IF NOT EXISTS weapon_specificity TEXT;
-- 'generic'|'described'|'identified'

-- Add behavioral fields to claims
ALTER TABLE claims ADD COLUMN IF NOT EXISTS behavioral_category TEXT;
-- 'method_of_approach'|'method_of_control'|'method_of_disposal'|
-- 'signature_behavior'|'forensic_awareness'|'staging'|'unknown'
ALTER TABLE claims ADD COLUMN IF NOT EXISTS behavioral_consistency_flag BOOLEAN DEFAULT FALSE;
-- reviewer marks: this behavior appears consistent across multiple claims/cases

-- Update claim_type enum to include new values
ALTER TYPE claim_type ADD VALUE IF NOT EXISTS 'forensic_countermeasure';
ALTER TYPE claim_type ADD VALUE IF NOT EXISTS 'scene_staging';
ALTER TYPE claim_type ADD VALUE IF NOT EXISTS 'disposal_method';

-- ============================================================
-- NEW TABLES
-- ============================================================

-- Pattern flags (all auto-generated flags for reviewer attention)
CREATE TABLE pattern_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL,
  -- 'geographic_recurrence'|'temporal_cluster'|'entity_frequency'|'contradiction'|
  -- 'duplicate_submission'|'cross_case_entity_match'|'highway_corridor_cluster'|
  -- 'time_of_day_cluster'|'day_of_week_cluster'|'decreasing_interval'|
  -- 'calendar_anchor'|'weapon_consistency'|'forensic_sophistication'|
  -- 'victimology_similarity'|'signature_consistency'|'shared_social_node'

  title TEXT NOT NULL,
  description TEXT NOT NULL,

  involved_claim_ids UUID[] DEFAULT '{}',
  involved_entity_ids UUID[] DEFAULT '{}',
  involved_case_ids UUID[] DEFAULT '{}',

  score INTEGER,
  grade TEXT,
  -- 'weak'|'moderate'|'notable'|'strong'|'very_strong'

  signals JSONB DEFAULT '{}',

  reviewer_status TEXT NOT NULL DEFAULT 'unreviewed',
  -- 'unreviewed'|'worth_investigating'|'dismissed'|'confirmed'
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  reviewer_note TEXT,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed_at TIMESTAMPTZ
);

-- Link scores (scored pairs of claims)
CREATE TABLE link_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  claim_a_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  claim_b_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,

  score INTEGER NOT NULL,
  grade TEXT NOT NULL,
  -- 'weak'(0-20)|'moderate'(21-40)|'notable'(41-65)|'strong'(66-85)|'very_strong'(86+)

  signals JSONB NOT NULL DEFAULT '{}',
  -- e.g. {"geo_proximity_10mi": 10, "same_day": 25, "partial_plate": 20, "independent_sources": 15}

  distance_miles NUMERIC(6, 2),

  reviewer_status TEXT DEFAULT 'unreviewed',
  -- 'unreviewed'|'worth_investigating'|'dismissed'|'confirmed'
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  reviewer_note TEXT,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(claim_a_id, claim_b_id)
);

-- Corridor reference points (known significant locations on highways)
CREATE TABLE corridor_reference_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  point_type TEXT NOT NULL,
  -- 'rest_area'|'truck_stop'|'weigh_station'|'known_location'
  highway TEXT,
  lat NUMERIC(10, 7) NOT NULL,
  lng NUMERIC(10, 7) NOT NULL,
  notes TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Victim profiles (structured per-case victim data)
CREATE TABLE victim_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  person_entity_id UUID REFERENCES entities(id),

  -- Demographics (never used to rank importance)
  age_range_min INTEGER,
  age_range_max INTEGER,
  gender TEXT, -- 'male'|'female'|'nonbinary'|'unknown'

  -- Last known information
  last_known_location_entity_id UUID REFERENCES entities(id),
  last_known_date TIMESTAMPTZ,
  last_confirmed_contact_type TEXT, -- 'in_person'|'phone'|'text'|'social_media'|'unknown'
  last_confirmed_contact_notes TEXT,

  -- Routine and lifestyle
  regular_locations TEXT[],
  employment_status TEXT,
  transportation_mode TEXT,

  -- Risk factors (used ONLY for pattern analysis, never to assign blame)
  lifestyle_exposure_level TEXT, -- 'high'|'medium'|'low'|'unknown'
  prior_missing_episodes INTEGER DEFAULT 0,
  transience_level TEXT, -- 'stable'|'semi_transient'|'transient'|'unknown'

  -- Threat context
  known_threats TEXT,
  restraining_orders BOOLEAN DEFAULT false,

  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER victim_profiles_updated_at
  BEFORE UPDATE ON victim_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Person relationships (social network layer)
CREATE TABLE person_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  person_entity_id_a UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  person_entity_id_b UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  relationship_type TEXT NOT NULL,
  -- 'family'|'romantic_partner'|'employer'|'coworker'|
  -- 'neighbor'|'acquaintance'|'service_provider'|'unknown'

  relationship_direction TEXT DEFAULT 'mutual',
  -- 'mutual'|'a_to_b'|'b_to_a'|'unknown'

  source_claim_ids UUID[] DEFAULT '{}',
  confidence confidence_level DEFAULT 'medium',
  notes TEXT,

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Case linkage scores (cross-case composite)
CREATE TABLE case_linkage_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_a_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  case_b_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,

  composite_score INTEGER NOT NULL,
  grade TEXT NOT NULL,

  contributing_layers JSONB NOT NULL DEFAULT '{}',
  -- {
  --   "geographic": 25, "corridor": 0, "victimology": 30,
  --   "temporal": 15, "weapon": 40, "behavioral_signature": 35,
  --   "forensic_method": 20, "social_network": 0
  -- }

  shared_entity_ids UUID[] DEFAULT '{}',
  shared_flag_types TEXT[] DEFAULT '{}',

  reviewer_status TEXT DEFAULT 'unreviewed',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  lead_investigator_note TEXT,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(case_a_id, case_b_id)
);

-- Case pattern settings (configurable per case)
CREATE TABLE case_pattern_settings (
  case_id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,

  -- Geographic thresholds
  proximity_radius_miles INTEGER DEFAULT 15,
  corridor_radius_meters INTEGER DEFAULT 500,

  -- Temporal thresholds
  temporal_window_days INTEGER DEFAULT 90,

  -- Cross-case matching
  cross_case_matching_enabled BOOLEAN DEFAULT false,

  -- Scoring weights (allow lead investigator to tune)
  weight_overrides JSONB DEFAULT '{}',

  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SCORING FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION compute_link_score(
  p_claim_a_id UUID,
  p_claim_b_id UUID,
  p_radius_miles INTEGER DEFAULT 15
)
RETURNS TABLE(score INTEGER, grade TEXT, signals JSONB, distance_miles NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
  v_score INTEGER := 0;
  v_signals JSONB := '{}';
  v_claim_a claims%ROWTYPE;
  v_claim_b claims%ROWTYPE;
  v_sub_a submissions%ROWTYPE;
  v_sub_b submissions%ROWTYPE;
  v_distance_miles NUMERIC := NULL;
  v_time_diff_days NUMERIC;
  v_shared_entities INTEGER;
  v_shared_vehicle_entities INTEGER;
  v_shared_phone_entities INTEGER;
  v_independent_sources BOOLEAN;
BEGIN
  -- Get claims
  SELECT * INTO v_claim_a FROM claims WHERE id = p_claim_a_id;
  SELECT * INTO v_claim_b FROM claims WHERE id = p_claim_b_id;

  -- Get submissions (for source independence check)
  SELECT * INTO v_sub_a FROM submissions WHERE id = v_claim_a.submission_id;
  SELECT * INTO v_sub_b FROM submissions WHERE id = v_claim_b.submission_id;

  -- Source independence bonus
  v_independent_sources := (v_sub_a.id != v_sub_b.id) AND
    (v_sub_a.submitted_by IS NULL OR v_sub_b.submitted_by IS NULL OR
     v_sub_a.submitted_by != v_sub_b.submitted_by);
  IF v_independent_sources THEN
    v_score := v_score + 15;
    v_signals := v_signals || '{"independent_sources": 15}';
  END IF;

  -- Geographic proximity (using location entities linked to each claim)
  WITH claim_a_locations AS (
    SELECT e.lat, e.lng
    FROM claim_entity_links cel
    JOIN entities e ON e.id = cel.entity_id
    WHERE cel.claim_id = p_claim_a_id AND e.entity_type = 'location'
    AND e.lat IS NOT NULL AND e.lng IS NOT NULL
  ),
  claim_b_locations AS (
    SELECT e.lat, e.lng
    FROM claim_entity_links cel
    JOIN entities e ON e.id = cel.entity_id
    WHERE cel.claim_id = p_claim_b_id AND e.entity_type = 'location'
    AND e.lat IS NOT NULL AND e.lng IS NOT NULL
  ),
  distances AS (
    SELECT
      ST_Distance(
        ST_MakePoint(a.lng, a.lat)::geography,
        ST_MakePoint(b.lng, b.lat)::geography
      ) / 1609.34 as dist_miles
    FROM claim_a_locations a
    CROSS JOIN claim_b_locations b
    ORDER BY dist_miles ASC
    LIMIT 1
  )
  SELECT dist_miles INTO v_distance_miles FROM distances;

  IF v_distance_miles IS NOT NULL THEN
    IF v_distance_miles <= 5 THEN
      v_score := v_score + 20;
      v_signals := v_signals || ('{"geo_proximity_5mi": 20, "distance_miles": ' || round(v_distance_miles::numeric, 2) || '}')::jsonb;
    ELSIF v_distance_miles <= 15 THEN
      v_score := v_score + 10;
      v_signals := v_signals || ('{"geo_proximity_15mi": 10, "distance_miles": ' || round(v_distance_miles::numeric, 2) || '}')::jsonb;
    ELSIF v_distance_miles <= p_radius_miles THEN
      v_score := v_score + 5;
      v_signals := v_signals || ('{"geo_proximity_radius": 5, "distance_miles": ' || round(v_distance_miles::numeric, 2) || '}')::jsonb;
    END IF;
  END IF;

  -- Temporal overlap
  IF v_claim_a.event_date IS NOT NULL AND v_claim_b.event_date IS NOT NULL THEN
    v_time_diff_days := ABS(EXTRACT(EPOCH FROM (v_claim_a.event_date - v_claim_b.event_date)) / 86400);
    IF v_time_diff_days <= 1 THEN
      v_score := v_score + 25;
      v_signals := v_signals || '{"time_same_day": 25}';
    ELSIF v_time_diff_days <= 3 THEN
      v_score := v_score + 15;
      v_signals := v_signals || ('{"time_3_days": 15, "days_apart": ' || round(v_time_diff_days::numeric, 1) || '}')::jsonb;
    ELSIF v_time_diff_days <= 14 THEN
      v_score := v_score + 8;
      v_signals := v_signals || ('{"time_2_weeks": 8, "days_apart": ' || round(v_time_diff_days::numeric, 1) || '}')::jsonb;
    ELSIF v_time_diff_days <= 90 THEN
      v_score := v_score + 3;
      v_signals := v_signals || ('{"time_90_days": 3, "days_apart": ' || round(v_time_diff_days::numeric, 1) || '}')::jsonb;
    END IF;
  END IF;

  -- Shared entities
  SELECT COUNT(DISTINCT e.id) INTO v_shared_entities
  FROM claim_entity_links cel_a
  JOIN claim_entity_links cel_b ON cel_a.entity_id = cel_b.entity_id
  JOIN entities e ON e.id = cel_a.entity_id
  WHERE cel_a.claim_id = p_claim_a_id AND cel_b.claim_id = p_claim_b_id;

  -- Vehicle entities specifically
  SELECT COUNT(DISTINCT e.id) INTO v_shared_vehicle_entities
  FROM claim_entity_links cel_a
  JOIN claim_entity_links cel_b ON cel_a.entity_id = cel_b.entity_id
  JOIN entities e ON e.id = cel_a.entity_id
  WHERE cel_a.claim_id = p_claim_a_id
  AND cel_b.claim_id = p_claim_b_id
  AND e.entity_type = 'vehicle';

  -- Phone entities
  SELECT COUNT(DISTINCT e.id) INTO v_shared_phone_entities
  FROM claim_entity_links cel_a
  JOIN claim_entity_links cel_b ON cel_a.entity_id = cel_b.entity_id
  JOIN entities e ON e.id = cel_a.entity_id
  WHERE cel_a.claim_id = p_claim_a_id
  AND cel_b.claim_id = p_claim_b_id
  AND e.entity_type = 'phone';

  IF v_shared_phone_entities > 0 THEN
    v_score := v_score + 45;
    v_signals := v_signals || ('{"shared_phone": 45}')::jsonb;
  END IF;

  IF v_shared_vehicle_entities > 0 THEN
    v_score := v_score + 15;
    v_signals := v_signals || ('{"shared_vehicle_entity": 15}')::jsonb;
  END IF;

  -- Claim type similarity
  IF v_claim_a.claim_type = v_claim_b.claim_type THEN
    v_score := v_score + 10;
    v_signals := v_signals || '{"same_claim_type": 10}';
  END IF;

  -- Content confidence penalty
  IF v_claim_a.content_confidence = 'low' OR v_claim_b.content_confidence = 'low' THEN
    v_score := GREATEST(0, v_score - 10);
    v_signals := v_signals || '{"low_content_confidence_penalty": -10}';
  END IF;

  -- Grade
  RETURN QUERY SELECT
    v_score,
    CASE
      WHEN v_score >= 86 THEN 'very_strong'
      WHEN v_score >= 66 THEN 'strong'
      WHEN v_score >= 41 THEN 'notable'
      WHEN v_score >= 21 THEN 'moderate'
      ELSE 'weak'
    END,
    v_signals,
    v_distance_miles;
END;
$$;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX ON pattern_flags(case_id, reviewer_status);
CREATE INDEX ON pattern_flags(flag_type);
CREATE INDEX ON link_scores(case_id, grade);
CREATE INDEX ON link_scores(reviewer_status);
CREATE INDEX ON link_scores(claim_a_id);
CREATE INDEX ON link_scores(claim_b_id);
CREATE INDEX ON victim_profiles(case_id);
CREATE INDEX ON person_relationships(case_id);
CREATE INDEX ON case_linkage_scores(composite_score DESC);
