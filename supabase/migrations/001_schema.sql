-- Threadline Case Intelligence Platform
-- Migration 001: Schema

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE case_type AS ENUM ('missing_person', 'unidentified_remains', 'homicide', 'assault', 'trafficking', 'other');
CREATE TYPE case_status AS ENUM ('active', 'inactive', 'closed', 'archived');
CREATE TYPE visibility_level AS ENUM ('private', 'team', 'partner_orgs', 'law_enforcement', 'public');
CREATE TYPE source_type AS ENUM ('named_individual', 'anonymous', 'organization', 'official_record', 'media', 'system');
CREATE TYPE submitter_consent AS ENUM ('anonymous', 'confidential', 'on_record');
CREATE TYPE observation_mode AS ENUM ('observed_directly', 'heard_directly', 'reported_by_another', 'inferred_from_document', 'system_generated');
CREATE TYPE review_status AS ENUM ('unverified', 'under_review', 'corroborated', 'confirmed', 'disputed', 'retracted');
CREATE TYPE claim_type AS ENUM ('sighting', 'identifier', 'association', 'statement', 'interpretation', 'official', 'behavioral', 'physical_description');
CREATE TYPE confidence_level AS ENUM ('low', 'medium', 'high');
CREATE TYPE entity_type AS ENUM ('person', 'location', 'vehicle', 'phone', 'username', 'organization', 'document', 'other');
CREATE TYPE normalization_status AS ENUM ('raw', 'normalized', 'merged', 'flagged_ambiguous');
CREATE TYPE entity_role AS ENUM ('subject', 'vehicle_seen', 'associate_mentioned', 'location_reference', 'identifier_fragment', 'witness', 'victim', 'unknown');
CREATE TYPE identifier_source AS ENUM ('seen_directly', 'heard_stated', 'found_in_document', 'recalled_from_memory', 'inferred', 'unknown');
CREATE TYPE user_role AS ENUM ('contributor', 'reviewer', 'lead_investigator', 'legal', 'export_only', 'admin');
CREATE TYPE audit_action AS ENUM ('created', 'edited', 'approved', 'disputed', 'retracted', 'merged', 'split', 'flagged', 'escalated', 'exported', 'viewed');
CREATE TYPE audit_target_type AS ENUM ('submission', 'claim', 'entity', 'event', 'case');
CREATE TYPE export_scope AS ENUM ('full', 'filtered', 'summary');
CREATE TYPE recipient_type AS ENUM ('law_enforcement', 'legal', 'journalist', 'family', 'other');
CREATE TYPE export_format AS ENUM ('pdf', 'json', 'csv');
CREATE TYPE event_status AS ENUM ('unverified', 'under_review', 'confirmed', 'disputed');
CREATE TYPE date_precision AS ENUM ('exact', 'approximate', 'unknown');

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLES
-- ============================================================

-- User profiles
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  organization TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Cases
CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  case_type case_type NOT NULL DEFAULT 'other',
  jurisdiction TEXT,
  status case_status NOT NULL DEFAULT 'active',
  visibility_level visibility_level NOT NULL DEFAULT 'team',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER cases_updated_at
  BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Case user roles
CREATE TABLE case_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'reviewer',
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(case_id, user_id)
);

-- Submission tokens (public intake form URLs)
CREATE TABLE submission_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  label TEXT,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Submissions
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  source_type source_type NOT NULL DEFAULT 'anonymous',
  submitter_name TEXT,
  submitter_contact TEXT,
  submitter_consent submitter_consent NOT NULL DEFAULT 'anonymous',
  firsthand BOOLEAN NOT NULL DEFAULT false,
  observation_mode observation_mode NOT NULL DEFAULT 'observed_directly',
  intake_date TIMESTAMPTZ DEFAULT now(),
  submitted_by UUID REFERENCES auth.users(id),
  review_status review_status NOT NULL DEFAULT 'unverified',
  notes TEXT,
  event_date TIMESTAMPTZ,
  event_date_precision date_precision DEFAULT 'unknown',
  event_location TEXT,
  event_location_lat NUMERIC,
  event_location_lng NUMERIC,
  occurred_multiple_times BOOLEAN,
  interpretation_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER submissions_updated_at
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Submission files
CREATE TABLE submission_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT,
  storage_path TEXT NOT NULL,
  file_size INTEGER,
  ocr_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Claims
CREATE TABLE claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  original_submission_id UUID NOT NULL REFERENCES submissions(id),
  claim_position INTEGER NOT NULL DEFAULT 0,
  extracted_text TEXT NOT NULL,
  claim_type claim_type NOT NULL DEFAULT 'statement',
  observation_mode observation_mode,
  interpretation_flag BOOLEAN NOT NULL DEFAULT false,
  source_confidence confidence_level NOT NULL DEFAULT 'medium',
  content_confidence confidence_level NOT NULL DEFAULT 'medium',
  event_date TIMESTAMPTZ,
  event_date_precision date_precision DEFAULT 'unknown',
  event_date_range_end TIMESTAMPTZ,
  verification_status review_status NOT NULL DEFAULT 'unverified',
  contradiction_status TEXT,
  created_by UUID REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER claims_updated_at
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Entities
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  entity_type entity_type NOT NULL DEFAULT 'other',
  raw_value TEXT NOT NULL,
  normalized_value TEXT,
  normalization_status normalization_status NOT NULL DEFAULT 'raw',
  aliases TEXT[] DEFAULT '{}',
  confidence confidence_level DEFAULT 'medium',
  flagged_for_review BOOLEAN DEFAULT false,
  review_state review_status DEFAULT 'unverified',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER entities_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Claim entity links
CREATE TABLE claim_entity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  entity_role entity_role NOT NULL DEFAULT 'unknown',
  identifier_source identifier_source NOT NULL DEFAULT 'unknown',
  confidence confidence_level DEFAULT 'medium',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(claim_id, entity_id)
);

-- Events (scaffolded for v1, promoted in v1.1)
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  title TEXT,
  date_range_start TIMESTAMPTZ,
  date_range_end TIMESTAMPTZ,
  location_entity_id UUID REFERENCES entities(id),
  status event_status DEFAULT 'unverified',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Event claim links
CREATE TABLE event_claim_links (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, claim_id)
);

-- Review actions (IMMUTABLE audit trail)
CREATE TABLE review_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  action audit_action NOT NULL,
  target_type audit_target_type NOT NULL,
  target_id UUID NOT NULL,
  case_id UUID REFERENCES cases(id),
  timestamp TIMESTAMPTZ DEFAULT now(),
  note TEXT,
  diff JSONB
);

-- Export records
CREATE TABLE export_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  exported_by UUID NOT NULL REFERENCES auth.users(id),
  scope export_scope NOT NULL DEFAULT 'filtered',
  recipient TEXT,
  recipient_type recipient_type,
  purpose TEXT,
  included_claim_ids UUID[],
  included_entity_ids UUID[],
  export_format export_format NOT NULL DEFAULT 'pdf',
  storage_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX ON submissions(case_id, review_status);
CREATE INDEX ON claims(submission_id);
CREATE INDEX ON claims(verification_status);
CREATE INDEX ON entities(case_id, entity_type);
CREATE INDEX ON claim_entity_links(entity_id);
CREATE INDEX ON review_actions(case_id, timestamp DESC);
CREATE INDEX ON review_actions(target_id, target_type);
CREATE INDEX ON submission_tokens(token);
CREATE INDEX ON case_user_roles(user_id);
