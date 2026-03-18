-- ── doe_cluster_members ──────────────────────────────────────────────────────
--
-- Junction table linking doe_victimology_clusters to individual submissions.
-- Tracks per-member confidence scores and human review status.
-- Populated by location_runaway_cluster, corridor_cluster, age_bracket_cluster actions.
-- Human investigators confirm or reject each member via the UI.
--
-- Run this in the Supabase SQL editor.

create table if not exists doe_cluster_members (
  id                 uuid         primary key default gen_random_uuid(),
  cluster_id         uuid         not null,
  submission_id      text         not null,   -- submissions.id (UUID stored as text)
  case_id            uuid         not null,

  -- Confidence: 0.0–1.0 (candidates ≥0.75 shown for human review)
  confidence         numeric(4,3) not null default 0.750
                     check (confidence >= 0 and confidence <= 1),
  confidence_reason  text,

  -- Human review outcome
  membership_status  text         not null default 'candidate'
                     check (membership_status in ('candidate', 'confirmed', 'rejected')),

  -- Denormalised member info for display without joining submissions
  member_name        text,
  member_doe_id      text,
  member_location    text,
  member_date        text,
  member_age         text,
  member_sex         text,

  -- Audit
  added_by           uuid,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  notes              text,

  created_at         timestamptz  not null default now(),

  unique (cluster_id, submission_id)
);

create index if not exists idx_dcm_cluster_id    on doe_cluster_members(cluster_id);
create index if not exists idx_dcm_submission_id on doe_cluster_members(submission_id);
create index if not exists idx_dcm_case_id       on doe_cluster_members(case_id);
create index if not exists idx_dcm_status        on doe_cluster_members(membership_status);

alter table doe_cluster_members enable row level security;

create policy "Users can manage cluster members for their cases"
  on doe_cluster_members for all
  using (
    exists (
      select 1 from case_user_roles
      where case_user_roles.case_id = doe_cluster_members.case_id
        and case_user_roles.user_id = auth.uid()
    )
  );
