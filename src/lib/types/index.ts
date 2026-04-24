import type { Tables, Enums } from '@/lib/supabase/types'

// Re-export base types
export type Case = Tables<'cases'>
export type CaseUserRole = Tables<'case_user_roles'>
export type SubmissionToken = Tables<'submission_tokens'>
export type Submission = Tables<'submissions'>
export type SubmissionFile = Tables<'submission_files'>
export type Claim = Tables<'claims'>
export type Entity = Tables<'entities'>
export type ClaimEntityLink = Tables<'claim_entity_links'>
export type ReviewAction = Tables<'review_actions'>
export type ExportRecord = Tables<'export_records'>
export type UserProfile = Tables<'user_profiles'>
export type PatternFlag = Tables<'pattern_flags'>
export type LinkScore = Tables<'link_scores'>
export type CorridorReferencePoint = Tables<'corridor_reference_points'>
export type VictimProfile = Tables<'victim_profiles'>
export type PersonRelationship = Tables<'person_relationships'>
export type CaseLinkageScore = Tables<'case_linkage_scores'>
export type CasePatternSettings = Tables<'case_pattern_settings'>
export type CaseInvitation = Tables<'case_invitations'>

// Enum types
export type CaseType = Enums<'case_type'>
export type CaseStatus = Enums<'case_status'>
export type VisibilityLevel = Enums<'visibility_level'>
export type SourceType = Enums<'source_type'>
export type SubmitterConsent = Enums<'submitter_consent'>
export type ObservationMode = Enums<'observation_mode'>
export type ReviewStatus = Enums<'review_status'>
export type ClaimType = Enums<'claim_type'>
export type ConfidenceLevel = Enums<'confidence_level'>
export type EntityType = Enums<'entity_type'>
export type NormalizationStatus = Enums<'normalization_status'>
export type EntityRole = Enums<'entity_role'>
export type IdentifierSource = Enums<'identifier_source'>
export type UserRole = Enums<'user_role'>
export type AuditAction = Enums<'audit_action'>
export type AuditTargetType = Enums<'audit_target_type'>
export type ExportScope = Enums<'export_scope'>
export type RecipientType = Enums<'recipient_type'>
export type ExportFormat = Enums<'export_format'>
export type DatePrecision = Enums<'date_precision'>

// ============================================================
// COMPOSITE TYPES
// ============================================================

export type CaseWithCounts = Case & {
  submission_count: number
  claim_count: number
  entity_count: number
  unreviewed_count: number
  user_role?: UserRole
}

export type SubmissionWithEntities = Submission & {
  entities?: Entity[]
  files?: SubmissionFile[]
  claim_count?: number
}

export type ClaimWithLinks = Claim & {
  entities?: (ClaimEntityLink & { entity: Entity })[]
  submission?: Pick<Submission, 'id' | 'source_type' | 'submitter_consent' | 'intake_date'>
}

export type EntityWithClaimCount = Entity & {
  claim_count: number
  linked_claims?: (ClaimEntityLink & { claim: Pick<Claim, 'id' | 'extracted_text' | 'claim_type' | 'verification_status'> })[]
}

export type ReviewActionWithActor = ReviewAction & {
  actor?: UserProfile
}

// ============================================================
// FORM DATA TYPES
// ============================================================

export interface IntakeFormData {
  // Step 1
  observation_mode: ObservationMode

  // Step 2
  event_date_known: 'exact' | 'approximate' | 'unknown'
  event_date?: string
  event_time?: string
  event_time_of_day?: string
  occurred_multiple_times: boolean

  // Step 3
  location_type: 'specific_address' | 'named_place' | 'intersection' | 'general_area' | 'unknown'
  event_location?: string
  location_imprecise?: boolean

  // Step 4
  raw_text: string

  // Step 5
  firsthand: 'yes' | 'partly' | 'no'
  secondhand_source?: string

  // Step 6
  step6_entities: Step6Entity[]

  // Step 7
  files: File[]
  paste_links: string[]

  // Step 8
  interpretation_text?: string

  // Step 9
  submitter_consent: SubmitterConsent
  submitter_name?: string
  submitter_contact?: string
}

export interface Step6Entity {
  id: string
  entity_type: EntityType
  value: string
  identifier_source: IdentifierSource
  confidence: ConfidenceLevel
}

export interface CreateCaseFormData {
  title: string
  case_type: CaseType
  jurisdiction?: string
  status: CaseStatus
  notes?: string
}

export interface CreateClaimFormData {
  extracted_text: string
  claim_type: ClaimType
  interpretation_flag: boolean
  source_confidence: ConfidenceLevel
  content_confidence: ConfidenceLevel
  event_date?: string
  event_date_precision?: DatePrecision
  notes?: string
}

export interface LinkEntityFormData {
  entity_id?: string
  // OR create new:
  new_entity_type?: EntityType
  new_entity_raw_value?: string
  // Link metadata
  entity_role: EntityRole
  identifier_source: IdentifierSource
  confidence: ConfidenceLevel
  notes?: string
}

export interface HandoffBuilderData {
  step: number
  recipient_type: RecipientType
  recipient_name: string
  purpose: string
  selected_claim_ids: string[]
  selected_entity_ids: string[]
  case_summary: string
  methodology_note: string
  confidence_statement: string
}

// ============================================================
// PATTERN INTELLIGENCE TYPES
// ============================================================

export type PatternGrade = 'weak' | 'moderate' | 'notable' | 'strong' | 'very_strong'
export type PatternReviewerStatus = 'unreviewed' | 'worth_investigating' | 'dismissed' | 'confirmed'

export type FlagType =
  | 'geographic_recurrence'
  | 'temporal_cluster'
  | 'entity_frequency'
  | 'contradiction'
  | 'duplicate_submission'
  | 'cross_case_entity_match'
  | 'highway_corridor_cluster'
  | 'time_of_day_cluster'
  | 'day_of_week_cluster'
  | 'decreasing_interval'
  | 'calendar_anchor'
  | 'weapon_consistency'
  | 'forensic_sophistication'
  | 'victimology_similarity'
  | 'signature_consistency'
  | 'shared_social_node'

export const FLAG_LABELS: Record<string, string> = {
  geographic_recurrence: 'Possible geographic recurrence',
  temporal_cluster: 'Possible temporal cluster',
  entity_frequency: 'Frequently appearing entity',
  contradiction: 'Possible contradiction',
  duplicate_submission: 'Possible duplicate submission',
  cross_case_entity_match: 'Cross-case entity — surfaced for review',
  highway_corridor_cluster: 'Possible corridor pattern',
  time_of_day_cluster: 'Possible time-of-day pattern',
  day_of_week_cluster: 'Possible day-of-week pattern',
  decreasing_interval: 'Possible narrowing interval',
  calendar_anchor: 'Possible calendar anchor pattern',
  weapon_consistency: 'Possible weapon consistency',
  forensic_sophistication: 'Possible forensic awareness pattern',
  victimology_similarity: 'Possible victimology similarity',
  signature_consistency: 'Possible signature behavior — surfaced for review',
  shared_social_node: 'Shared social connection — surfaced for review',
}

export type PatternFlagWithClaims = PatternFlag & {
  involved_claims?: Pick<Claim, 'id' | 'extracted_text' | 'event_date' | 'claim_type'>[]
  reviewer?: UserProfile | null
}

export type LinkScoreWithClaims = LinkScore & {
  claim_a?: Pick<Claim, 'id' | 'extracted_text' | 'event_date' | 'claim_type' | 'content_confidence'>
  claim_b?: Pick<Claim, 'id' | 'extracted_text' | 'event_date' | 'claim_type' | 'content_confidence'>
  reviewer?: UserProfile | null
}

export type LinkSignals = {
  independent_sources?: number
  geo_proximity_5mi?: number
  geo_proximity_15mi?: number
  geo_proximity_radius?: number
  distance_miles?: number
  time_same_day?: number
  time_3_days?: number
  time_2_weeks?: number
  time_90_days?: number
  days_apart?: number
  shared_phone?: number
  shared_vehicle_entity?: number
  same_claim_type?: number
  low_content_confidence_penalty?: number
  [key: string]: number | undefined
}

export type ContributingLayers = {
  geographic?: number
  corridor?: number
  victimology?: number
  temporal?: number
  weapon?: number
  behavioral_signature?: number
  forensic_method?: number
  social_network?: number
}

export type CaseLinkageScoreWithCases = CaseLinkageScore & {
  case_a?: Pick<Case, 'id' | 'title' | 'case_type'>
  case_b?: Pick<Case, 'id' | 'title' | 'case_type'>
}

export type PersonRelationshipWithEntities = PersonRelationship & {
  entity_a?: Pick<Entity, 'id' | 'raw_value' | 'normalized_value' | 'entity_type'>
  entity_b?: Pick<Entity, 'id' | 'raw_value' | 'normalized_value' | 'entity_type'>
}

export type EntityWithGeo = Entity & {
  lat?: number | null
  lng?: number | null
  geocoded_at?: string | null
  geocode_source?: string | null
  nearest_highway?: string | null
  highway_distance_m?: number | null
  highway_proximity?: string | null
  weapon_category?: string | null
  weapon_specificity?: string | null
}

export type PatternAnalysisSummary = {
  unreviewed_flags: number
  notable_plus_links: number
  confirmed_patterns: number
  cross_case_signals: number
  last_analyzed_at: string | null
}

export interface BehavioralClaimFields {
  behavioral_category: string | null
  behavioral_consistency_flag: boolean
}

// ============================================================
// REVIEW WORKFLOW TYPES
// ============================================================

export type TriageStatus = 'untriaged' | 'claimed' | 'deferred' | 'discarded'
export type TriageDiscardReason = 'off_topic' | 'duplicate' | 'spam' | 'insufficient_detail'
export type PriorityLevel = 'high' | 'medium' | 'low'

export interface NoveltyFlag {
  type: 'new_entity' | 'corroboration' | 'contradiction' | 'duplicate'
  label: string
  count?: number
  similarity?: number
}

export type SubmissionWithTriageData = Submission & {
  novelty_flags: NoveltyFlag[]
  triage_status: TriageStatus
  priority_level: PriorityLevel
  priority_score: number
  word_count: number
  entity_count_step6: number
  has_date: boolean
  has_location_pin: boolean
  duplicate_similarity: number | null
  duplicate_of_submission_id: string | null
}

export type EnrichedSubmission = SubmissionWithTriageData & {
  file_count?: number
  claim_count?: number
}

export interface InvitationWithCase extends CaseInvitation {
  case?: Pick<Case, 'id' | 'title'>
}

export interface QueueStats {
  untriaged: number
  in_review: number
  reviewed_today: number
}
