-- =============================================================================
-- 025: Registry & Intelligence Layer
-- Transforms Threadline from case-centric to intelligence-first.
-- Adds: import tracking, registry profiles, intelligence queue, global connections.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. IMPORT TRACKING
-- ---------------------------------------------------------------------------

-- Sources we import from (NamUs, Doe Network, Charley Project, etc.)
CREATE TABLE IF NOT EXISTS import_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,            -- 'namus_missing', 'namus_unidentified', 'doe_network', 'charley_project'
  display_name TEXT NOT NULL,
  base_url TEXT,
  description TEXT,
  last_import_at TIMESTAMPTZ,
  total_records INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Individual imported records — links external IDs to our submissions
CREATE TABLE IF NOT EXISTS import_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES import_sources(id),
  external_id TEXT NOT NULL,             -- NamUs case number, Doe Network ID, etc.
  external_url TEXT,                     -- direct link to original source
  case_id UUID REFERENCES cases(id),    -- system case this was imported into
  submission_id UUID REFERENCES submissions(id),  -- the submission created from this import
  raw_data JSONB NOT NULL,              -- full scraped payload, preserved verbatim
  record_type TEXT NOT NULL CHECK (record_type IN ('missing_person', 'unidentified_remains')),

  -- Extracted summary fields for fast filtering (denormalized from raw_data)
  person_name TEXT,                      -- null for unidentified
  age_text TEXT,                         -- "23" or "25-35" or "unknown"
  sex TEXT,
  race TEXT,
  state TEXT,                            -- US state abbreviation
  city TEXT,
  date_missing DATE,                     -- for missing persons
  date_found DATE,                       -- for unidentified remains
  date_last_contact DATE,

  -- AI processing state
  ai_processed BOOLEAN DEFAULT false,
  ai_processed_at TIMESTAMPTZ,
  ai_extraction JSONB,                   -- structured AI output (entities, claims, signals)

  -- Sync tracking
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  sync_hash TEXT,                        -- hash of raw_data to detect changes
  stale BOOLEAN DEFAULT false,           -- marked true if source data changed

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_id, external_id)
);

CREATE INDEX idx_import_records_source ON import_records(source_id);
CREATE INDEX idx_import_records_type ON import_records(record_type);
CREATE INDEX idx_import_records_state ON import_records(state);
CREATE INDEX idx_import_records_ai ON import_records(ai_processed) WHERE ai_processed = false;
CREATE INDEX idx_import_records_submission ON import_records(submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX idx_import_records_name ON import_records(person_name) WHERE person_name IS NOT NULL;
CREATE INDEX idx_import_records_sex ON import_records(sex);
CREATE INDEX idx_import_records_date_missing ON import_records(date_missing) WHERE date_missing IS NOT NULL;
CREATE INDEX idx_import_records_date_found ON import_records(date_found) WHERE date_found IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER update_import_records_updated_at
  BEFORE UPDATE ON import_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 2. INTELLIGENCE QUEUE
-- The "what needs attention" surface. AI populates this, humans review.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Classification
  queue_type TEXT NOT NULL CHECK (queue_type IN (
    'possible_match',           -- missing person ↔ unidentified remains
    'geographic_cluster',       -- multiple cases in unusual proximity
    'temporal_pattern',         -- time-based pattern across cases
    'offender_overlap',         -- connection to known offender
    'entity_crossmatch',        -- same person/vehicle/phone across cases
    'stalled_case',             -- case with no updates / misclassification
    'behavioral_pattern',       -- MO similarity across cases
    'corridor_cluster',         -- highway/route pattern
    'new_lead',                 -- AI research surfaced actionable lead
    'contradiction'             -- conflicting information across sources
  )),

  -- Priority (0-100, higher = more urgent)
  priority_score INTEGER NOT NULL DEFAULT 50,
  priority_grade TEXT NOT NULL DEFAULT 'medium' CHECK (priority_grade IN ('critical', 'high', 'medium', 'low')),

  -- Content
  title TEXT NOT NULL,
  summary TEXT NOT NULL,                 -- 1-3 sentence human-readable explanation
  ai_reasoning TEXT,                     -- AI's chain of reasoning for surfacing this

  -- References
  details JSONB NOT NULL DEFAULT '{}',   -- flexible payload per queue_type
  related_import_ids UUID[],             -- import_records involved
  related_submission_ids UUID[],
  related_entity_ids UUID[],
  related_case_ids UUID[],

  -- Confidence
  ai_confidence NUMERIC(4,3),            -- 0.000 to 1.000
  signal_count INTEGER DEFAULT 0,        -- how many independent signals support this

  -- Human review
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'actioned', 'dismissed', 'escalated')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  reviewer_note TEXT,

  -- Escalation
  escalated_to TEXT,                     -- 'law_enforcement', 'family_contact', 'research_task'
  escalation_ref_id UUID,               -- ID of created research task, export, etc.

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_iq_status_priority ON intelligence_queue(status, priority_score DESC) WHERE status = 'new';
CREATE INDEX idx_iq_type ON intelligence_queue(queue_type);
CREATE INDEX idx_iq_priority ON intelligence_queue(priority_score DESC);
CREATE INDEX idx_iq_created ON intelligence_queue(created_at DESC);

CREATE TRIGGER update_intelligence_queue_updated_at
  BEFORE UPDATE ON intelligence_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. GLOBAL CONNECTIONS
-- AI-surfaced links between any two records across the entire corpus.
-- Different from link_scores (which are claim-to-claim within a case).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS global_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The two things being connected
  record_a_id UUID NOT NULL REFERENCES import_records(id),
  record_b_id UUID NOT NULL REFERENCES import_records(id),

  -- Connection details
  connection_type TEXT NOT NULL CHECK (connection_type IN (
    'demographic_match',        -- age/sex/race similarity
    'geographic_proximity',     -- locations are close
    'temporal_proximity',       -- dates are close
    'entity_overlap',           -- shared entity (name, vehicle, phone)
    'circumstance_similarity',  -- similar circumstances text
    'corridor_match',           -- both on same highway corridor
    'offender_link',            -- both overlap with same known offender
    'composite'                 -- multi-signal connection
  )),

  -- Scoring
  composite_score INTEGER NOT NULL,      -- 0-100
  grade TEXT NOT NULL CHECK (grade IN ('weak', 'moderate', 'notable', 'strong', 'very_strong')),
  signals JSONB NOT NULL DEFAULT '{}',   -- breakdown: {"demographic": 20, "geographic": 30, ...}
  distance_miles NUMERIC(8,2),
  days_apart INTEGER,

  -- AI assessment
  ai_summary TEXT,                       -- "Both are Hispanic females aged 18-22 who disappeared near I-35 truck stops within 6 months"
  ai_confidence NUMERIC(4,3),

  -- Human review
  reviewer_status TEXT DEFAULT 'unreviewed' CHECK (reviewer_status IN ('unreviewed', 'worth_investigating', 'confirmed', 'dismissed')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  reviewer_note TEXT,

  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(record_a_id, record_b_id)
);

CREATE INDEX idx_gc_score ON global_connections(composite_score DESC);
CREATE INDEX idx_gc_grade ON global_connections(grade);
CREATE INDEX idx_gc_status ON global_connections(reviewer_status) WHERE reviewer_status = 'unreviewed';
CREATE INDEX idx_gc_record_a ON global_connections(record_a_id);
CREATE INDEX idx_gc_record_b ON global_connections(record_b_id);
CREATE INDEX idx_gc_type ON global_connections(connection_type);

-- ---------------------------------------------------------------------------
-- 4. DEEP RESEARCH RESULTS
-- When Threadline AI does a deep dive on a specific case.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deep_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What's being researched
  import_record_id UUID REFERENCES import_records(id),
  submission_id UUID REFERENCES submissions(id),
  case_id UUID REFERENCES cases(id),

  -- Research config
  research_type TEXT NOT NULL DEFAULT 'full' CHECK (research_type IN (
    'full',                     -- comprehensive analysis
    'connections_only',         -- just find related cases
    'offender_check',           -- check against known offenders
    'geographic_analysis',      -- geographic pattern analysis
    'timeline_reconstruction'   -- build timeline from all sources
  )),

  -- Status
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  summary TEXT,                          -- AI-generated executive summary
  findings JSONB,                        -- structured findings
  -- findings shape: {
  --   connections: [{ record_id, score, reason }],
  --   offender_overlaps: [{ offender_id, score, reason }],
  --   geographic_patterns: [{ description, locations: [] }],
  --   timeline: [{ date, event, source }],
  --   next_steps: [{ priority, action, rationale }],
  --   red_flags: [{ description, severity }]
  -- }

  model_used TEXT,                       -- 'claude-opus-4-6', etc.
  tokens_used INTEGER,
  error_message TEXT,

  -- Who requested it
  requested_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dr_import ON deep_research(import_record_id) WHERE import_record_id IS NOT NULL;
CREATE INDEX idx_dr_status ON deep_research(status) WHERE status IN ('queued', 'running');
CREATE INDEX idx_dr_created ON deep_research(created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. SEED IMPORT SOURCES
-- ---------------------------------------------------------------------------

INSERT INTO import_sources (slug, display_name, base_url, description)
VALUES
  ('namus_missing', 'NamUs — Missing Persons', 'https://namus.nij.ojp.gov', 'National Missing and Unidentified Persons System — missing persons registry'),
  ('namus_unidentified', 'NamUs — Unidentified Remains', 'https://namus.nij.ojp.gov', 'National Missing and Unidentified Persons System — unidentified persons registry'),
  ('doe_network', 'The Doe Network', 'http://www.doenetwork.org', 'International Center for Unidentified & Missing Persons — volunteer-run case database'),
  ('charley_project', 'The Charley Project', 'https://charleyproject.org', 'Missing persons database maintained by Meaghan Good')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. RLS POLICIES
-- ---------------------------------------------------------------------------

ALTER TABLE import_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE deep_research ENABLE ROW LEVEL SECURITY;

-- Import sources: readable by all authenticated users
CREATE POLICY "import_sources_select" ON import_sources
  FOR SELECT TO authenticated USING (true);

-- Import records: readable by all authenticated users (this is public data)
CREATE POLICY "import_records_select" ON import_records
  FOR SELECT TO authenticated USING (true);

-- Import records: insert/update by service role only (scrapers run as service role)
CREATE POLICY "import_records_insert" ON import_records
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "import_records_update" ON import_records
  FOR UPDATE TO service_role USING (true);

-- Intelligence queue: readable by all authenticated users
CREATE POLICY "iq_select" ON intelligence_queue
  FOR SELECT TO authenticated USING (true);

-- Intelligence queue: insert by service role or authenticated (AI pipeline + manual flags)
CREATE POLICY "iq_insert" ON intelligence_queue
  FOR INSERT TO authenticated WITH CHECK (true);

-- Intelligence queue: update by authenticated (for review actions)
CREATE POLICY "iq_update" ON intelligence_queue
  FOR UPDATE TO authenticated USING (true);

-- Global connections: readable by all authenticated users
CREATE POLICY "gc_select" ON global_connections
  FOR SELECT TO authenticated USING (true);

-- Global connections: insert by service role (AI pipeline)
CREATE POLICY "gc_insert" ON global_connections
  FOR INSERT TO service_role WITH CHECK (true);

-- Global connections: update by authenticated (for review)
CREATE POLICY "gc_update" ON global_connections
  FOR UPDATE TO authenticated USING (true);

-- Deep research: readable by all authenticated users
CREATE POLICY "dr_select" ON deep_research
  FOR SELECT TO authenticated USING (true);

-- Deep research: insert by authenticated (anyone can request research)
CREATE POLICY "dr_insert" ON deep_research
  FOR INSERT TO authenticated WITH CHECK (true);

-- Deep research: update by service role (AI pipeline writes results)
CREATE POLICY "dr_update" ON deep_research
  FOR UPDATE TO service_role USING (true);
-- Also allow the requester to see status updates
CREATE POLICY "dr_update_auth" ON deep_research
  FOR UPDATE TO authenticated USING (true);
