export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      cases: {
        Row: {
          id: string
          title: string
          case_type: Database['public']['Enums']['case_type']
          jurisdiction: string | null
          status: Database['public']['Enums']['case_status']
          visibility_level: Database['public']['Enums']['visibility_level']
          created_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
          // Migration 009 columns
          legal_hold: boolean
          legal_hold_set_at: string | null
          legal_hold_set_by: string | null
          legal_hold_reason: string | null
        }
        Insert: {
          id?: string
          title: string
          case_type?: Database['public']['Enums']['case_type']
          jurisdiction?: string | null
          status?: Database['public']['Enums']['case_status']
          visibility_level?: Database['public']['Enums']['visibility_level']
          created_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          legal_hold?: boolean
          legal_hold_set_at?: string | null
          legal_hold_set_by?: string | null
          legal_hold_reason?: string | null
        }
        Update: {
          id?: string
          title?: string
          case_type?: Database['public']['Enums']['case_type']
          jurisdiction?: string | null
          status?: Database['public']['Enums']['case_status']
          visibility_level?: Database['public']['Enums']['visibility_level']
          created_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          legal_hold?: boolean
          legal_hold_set_at?: string | null
          legal_hold_set_by?: string | null
          legal_hold_reason?: string | null
        }
      }
      case_user_roles: {
        Row: {
          id: string
          case_id: string
          user_id: string
          role: Database['public']['Enums']['user_role']
          invited_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          user_id: string
          role?: Database['public']['Enums']['user_role']
          invited_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          user_id?: string
          role?: Database['public']['Enums']['user_role']
          invited_by?: string | null
          created_at?: string
        }
      }
      submission_tokens: {
        Row: {
          id: string
          case_id: string
          token: string
          label: string | null
          expires_at: string | null
          is_active: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          token?: string
          label?: string | null
          expires_at?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          token?: string
          label?: string | null
          expires_at?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
        }
      }
      submissions: {
        Row: {
          id: string
          case_id: string
          raw_text: string
          source_type: Database['public']['Enums']['source_type']
          submitter_name: string | null
          submitter_contact: string | null
          submitter_consent: Database['public']['Enums']['submitter_consent']
          firsthand: boolean
          observation_mode: Database['public']['Enums']['observation_mode']
          intake_date: string
          submitted_by: string | null
          review_status: Database['public']['Enums']['review_status']
          notes: string | null
          event_date: string | null
          event_date_precision: Database['public']['Enums']['date_precision'] | null
          event_location: string | null
          event_location_lat: number | null
          event_location_lng: number | null
          occurred_multiple_times: boolean | null
          interpretation_text: string | null
          created_at: string
          updated_at: string
          // Migration 006 columns
          priority_score: number
          priority_level: string
          novelty_flags: Json
          triage_status: string
          triage_discard_reason: string | null
          triage_by: string | null
          triage_at: string | null
          claimed_by: string | null
          review_started_at: string | null
          review_completed_at: string | null
          word_count: number
          entity_count_step6: number
          has_location_pin: boolean
          has_date: boolean
          duplicate_similarity: number | null
          duplicate_of_submission_id: string | null
          // Migration 009 columns
          discarded_at: string | null
        }
        Insert: {
          id?: string
          case_id: string
          raw_text: string
          source_type?: Database['public']['Enums']['source_type']
          submitter_name?: string | null
          submitter_contact?: string | null
          submitter_consent?: Database['public']['Enums']['submitter_consent']
          firsthand?: boolean
          observation_mode?: Database['public']['Enums']['observation_mode']
          intake_date?: string
          submitted_by?: string | null
          review_status?: Database['public']['Enums']['review_status']
          notes?: string | null
          event_date?: string | null
          event_date_precision?: Database['public']['Enums']['date_precision'] | null
          event_location?: string | null
          event_location_lat?: number | null
          event_location_lng?: number | null
          occurred_multiple_times?: boolean | null
          interpretation_text?: string | null
          created_at?: string
          updated_at?: string
          priority_score?: number
          priority_level?: string
          novelty_flags?: Json
          triage_status?: string
          triage_discard_reason?: string | null
          triage_by?: string | null
          triage_at?: string | null
          claimed_by?: string | null
          review_started_at?: string | null
          review_completed_at?: string | null
          word_count?: number
          entity_count_step6?: number
          has_location_pin?: boolean
          has_date?: boolean
          duplicate_similarity?: number | null
          duplicate_of_submission_id?: string | null
          discarded_at?: string | null
        }
        Update: {
          id?: string
          case_id?: string
          raw_text?: string
          source_type?: Database['public']['Enums']['source_type']
          submitter_name?: string | null
          submitter_contact?: string | null
          submitter_consent?: Database['public']['Enums']['submitter_consent']
          firsthand?: boolean
          observation_mode?: Database['public']['Enums']['observation_mode']
          intake_date?: string
          submitted_by?: string | null
          review_status?: Database['public']['Enums']['review_status']
          notes?: string | null
          event_date?: string | null
          event_date_precision?: Database['public']['Enums']['date_precision'] | null
          event_location?: string | null
          event_location_lat?: number | null
          event_location_lng?: number | null
          occurred_multiple_times?: boolean | null
          interpretation_text?: string | null
          created_at?: string
          updated_at?: string
          priority_score?: number
          priority_level?: string
          novelty_flags?: Json
          triage_status?: string
          triage_discard_reason?: string | null
          triage_by?: string | null
          triage_at?: string | null
          claimed_by?: string | null
          review_started_at?: string | null
          review_completed_at?: string | null
          word_count?: number
          entity_count_step6?: number
          has_location_pin?: boolean
          has_date?: boolean
          duplicate_similarity?: number | null
          duplicate_of_submission_id?: string | null
          discarded_at?: string | null
        }
      }
      submission_files: {
        Row: {
          id: string
          submission_id: string
          file_name: string
          file_type: string | null
          storage_path: string
          file_size: number | null
          ocr_text: string | null
          created_at: string
          // Migration 009 columns
          scan_status: string
          scan_completed_at: string | null
        }
        Insert: {
          id?: string
          submission_id: string
          file_name: string
          file_type?: string | null
          storage_path: string
          file_size?: number | null
          ocr_text?: string | null
          created_at?: string
          scan_status?: string
          scan_completed_at?: string | null
        }
        Update: {
          id?: string
          submission_id?: string
          file_name?: string
          file_type?: string | null
          storage_path?: string
          file_size?: number | null
          ocr_text?: string | null
          created_at?: string
          scan_status?: string
          scan_completed_at?: string | null
        }
      }
      claims: {
        Row: {
          id: string
          submission_id: string
          original_submission_id: string
          claim_position: number
          extracted_text: string
          claim_type: Database['public']['Enums']['claim_type']
          observation_mode: Database['public']['Enums']['observation_mode'] | null
          interpretation_flag: boolean
          source_confidence: Database['public']['Enums']['confidence_level']
          content_confidence: Database['public']['Enums']['confidence_level']
          event_date: string | null
          event_date_precision: Database['public']['Enums']['date_precision'] | null
          event_date_range_end: string | null
          verification_status: Database['public']['Enums']['review_status']
          contradiction_status: string | null
          created_by: string | null
          reviewed_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          submission_id: string
          original_submission_id: string
          claim_position?: number
          extracted_text: string
          claim_type?: Database['public']['Enums']['claim_type']
          observation_mode?: Database['public']['Enums']['observation_mode'] | null
          interpretation_flag?: boolean
          source_confidence?: Database['public']['Enums']['confidence_level']
          content_confidence?: Database['public']['Enums']['confidence_level']
          event_date?: string | null
          event_date_precision?: Database['public']['Enums']['date_precision'] | null
          event_date_range_end?: string | null
          verification_status?: Database['public']['Enums']['review_status']
          contradiction_status?: string | null
          created_by?: string | null
          reviewed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          submission_id?: string
          original_submission_id?: string
          claim_position?: number
          extracted_text?: string
          claim_type?: Database['public']['Enums']['claim_type']
          observation_mode?: Database['public']['Enums']['observation_mode'] | null
          interpretation_flag?: boolean
          source_confidence?: Database['public']['Enums']['confidence_level']
          content_confidence?: Database['public']['Enums']['confidence_level']
          event_date?: string | null
          event_date_precision?: Database['public']['Enums']['date_precision'] | null
          event_date_range_end?: string | null
          verification_status?: Database['public']['Enums']['review_status']
          contradiction_status?: string | null
          created_by?: string | null
          reviewed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      entities: {
        Row: {
          id: string
          case_id: string
          entity_type: Database['public']['Enums']['entity_type']
          raw_value: string
          normalized_value: string | null
          normalization_status: Database['public']['Enums']['normalization_status']
          aliases: string[]
          confidence: Database['public']['Enums']['confidence_level'] | null
          flagged_for_review: boolean
          review_state: Database['public']['Enums']['review_status'] | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id: string
          entity_type?: Database['public']['Enums']['entity_type']
          raw_value: string
          normalized_value?: string | null
          normalization_status?: Database['public']['Enums']['normalization_status']
          aliases?: string[]
          confidence?: Database['public']['Enums']['confidence_level'] | null
          flagged_for_review?: boolean
          review_state?: Database['public']['Enums']['review_status'] | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          entity_type?: Database['public']['Enums']['entity_type']
          raw_value?: string
          normalized_value?: string | null
          normalization_status?: Database['public']['Enums']['normalization_status']
          aliases?: string[]
          confidence?: Database['public']['Enums']['confidence_level'] | null
          flagged_for_review?: boolean
          review_state?: Database['public']['Enums']['review_status'] | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      claim_entity_links: {
        Row: {
          id: string
          claim_id: string
          entity_id: string
          entity_role: Database['public']['Enums']['entity_role']
          identifier_source: Database['public']['Enums']['identifier_source']
          confidence: Database['public']['Enums']['confidence_level'] | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          claim_id: string
          entity_id: string
          entity_role?: Database['public']['Enums']['entity_role']
          identifier_source?: Database['public']['Enums']['identifier_source']
          confidence?: Database['public']['Enums']['confidence_level'] | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          claim_id?: string
          entity_id?: string
          entity_role?: Database['public']['Enums']['entity_role']
          identifier_source?: Database['public']['Enums']['identifier_source']
          confidence?: Database['public']['Enums']['confidence_level'] | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
      events: {
        Row: {
          id: string
          case_id: string
          title: string | null
          date_range_start: string | null
          date_range_end: string | null
          location_entity_id: string | null
          status: Database['public']['Enums']['event_status'] | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id: string
          title?: string | null
          date_range_start?: string | null
          date_range_end?: string | null
          location_entity_id?: string | null
          status?: Database['public']['Enums']['event_status'] | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          title?: string | null
          date_range_start?: string | null
          date_range_end?: string | null
          location_entity_id?: string | null
          status?: Database['public']['Enums']['event_status'] | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      review_actions: {
        Row: {
          id: string
          actor_id: string
          action: Database['public']['Enums']['audit_action']
          target_type: Database['public']['Enums']['audit_target_type']
          target_id: string
          case_id: string | null
          timestamp: string
          note: string | null
          diff: Json | null
        }
        Insert: {
          id?: string
          actor_id: string
          action: Database['public']['Enums']['audit_action']
          target_type: Database['public']['Enums']['audit_target_type']
          target_id: string
          case_id?: string | null
          timestamp?: string
          note?: string | null
          diff?: Json | null
        }
        Update: {
          id?: string
          actor_id?: string
          action?: Database['public']['Enums']['audit_action']
          target_type?: Database['public']['Enums']['audit_target_type']
          target_id?: string
          case_id?: string | null
          timestamp?: string
          note?: string | null
          diff?: Json | null
        }
      }
      export_records: {
        Row: {
          id: string
          case_id: string
          exported_by: string
          scope: Database['public']['Enums']['export_scope']
          recipient: string | null
          recipient_type: Database['public']['Enums']['recipient_type'] | null
          purpose: string | null
          included_claim_ids: string[] | null
          included_entity_ids: string[] | null
          export_format: Database['public']['Enums']['export_format']
          storage_path: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          exported_by: string
          scope?: Database['public']['Enums']['export_scope']
          recipient?: string | null
          recipient_type?: Database['public']['Enums']['recipient_type'] | null
          purpose?: string | null
          included_claim_ids?: string[] | null
          included_entity_ids?: string[] | null
          export_format?: Database['public']['Enums']['export_format']
          storage_path?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          exported_by?: string
          scope?: Database['public']['Enums']['export_scope']
          recipient?: string | null
          recipient_type?: Database['public']['Enums']['recipient_type'] | null
          purpose?: string | null
          included_claim_ids?: string[] | null
          included_entity_ids?: string[] | null
          export_format?: Database['public']['Enums']['export_format']
          storage_path?: string | null
          created_at?: string
        }
      }
      user_profiles: {
        Row: {
          id: string
          full_name: string | null
          organization: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          organization?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          organization?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      pattern_flags: {
        Row: {
          id: string
          case_id: string
          flag_type: string
          title: string
          description: string
          involved_claim_ids: string[]
          involved_entity_ids: string[]
          involved_case_ids: string[]
          score: number | null
          grade: string | null
          signals: Json
          reviewer_status: string
          reviewed_by: string | null
          reviewed_at: string | null
          reviewer_note: string | null
          generated_at: string
          dismissed_at: string | null
        }
        Insert: {
          id?: string
          case_id: string
          flag_type: string
          title: string
          description: string
          involved_claim_ids?: string[]
          involved_entity_ids?: string[]
          involved_case_ids?: string[]
          score?: number | null
          grade?: string | null
          signals?: Json
          reviewer_status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          reviewer_note?: string | null
          generated_at?: string
          dismissed_at?: string | null
        }
        Update: {
          id?: string
          case_id?: string
          flag_type?: string
          title?: string
          description?: string
          involved_claim_ids?: string[]
          involved_entity_ids?: string[]
          involved_case_ids?: string[]
          score?: number | null
          grade?: string | null
          signals?: Json
          reviewer_status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          reviewer_note?: string | null
          generated_at?: string
          dismissed_at?: string | null
        }
      }
      link_scores: {
        Row: {
          id: string
          case_id: string
          claim_a_id: string
          claim_b_id: string
          score: number
          grade: string
          signals: Json
          distance_miles: number | null
          reviewer_status: string
          reviewed_by: string | null
          reviewed_at: string | null
          reviewer_note: string | null
          generated_at: string
        }
        Insert: {
          id?: string
          case_id: string
          claim_a_id: string
          claim_b_id: string
          score: number
          grade: string
          signals?: Json
          distance_miles?: number | null
          reviewer_status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          reviewer_note?: string | null
          generated_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          claim_a_id?: string
          claim_b_id?: string
          score?: number
          grade?: string
          signals?: Json
          distance_miles?: number | null
          reviewer_status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          reviewer_note?: string | null
          generated_at?: string
        }
      }
      corridor_reference_points: {
        Row: {
          id: string
          name: string
          point_type: string
          highway: string | null
          lat: number
          lng: number
          notes: string | null
          source: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          point_type: string
          highway?: string | null
          lat: number
          lng: number
          notes?: string | null
          source?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          point_type?: string
          highway?: string | null
          lat?: number
          lng?: number
          notes?: string | null
          source?: string | null
          created_at?: string
        }
      }
      victim_profiles: {
        Row: {
          id: string
          case_id: string
          person_entity_id: string | null
          age_range_min: number | null
          age_range_max: number | null
          gender: string | null
          last_known_location_entity_id: string | null
          last_known_date: string | null
          last_confirmed_contact_type: string | null
          last_confirmed_contact_notes: string | null
          regular_locations: string[] | null
          employment_status: string | null
          transportation_mode: string | null
          lifestyle_exposure_level: string | null
          prior_missing_episodes: number
          transience_level: string | null
          known_threats: string | null
          restraining_orders: boolean
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id: string
          person_entity_id?: string | null
          age_range_min?: number | null
          age_range_max?: number | null
          gender?: string | null
          last_known_location_entity_id?: string | null
          last_known_date?: string | null
          last_confirmed_contact_type?: string | null
          last_confirmed_contact_notes?: string | null
          regular_locations?: string[] | null
          employment_status?: string | null
          transportation_mode?: string | null
          lifestyle_exposure_level?: string | null
          prior_missing_episodes?: number
          transience_level?: string | null
          known_threats?: string | null
          restraining_orders?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          person_entity_id?: string | null
          age_range_min?: number | null
          age_range_max?: number | null
          gender?: string | null
          last_known_location_entity_id?: string | null
          last_known_date?: string | null
          last_confirmed_contact_type?: string | null
          last_confirmed_contact_notes?: string | null
          regular_locations?: string[] | null
          employment_status?: string | null
          transportation_mode?: string | null
          lifestyle_exposure_level?: string | null
          prior_missing_episodes?: number
          transience_level?: string | null
          known_threats?: string | null
          restraining_orders?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      person_relationships: {
        Row: {
          id: string
          case_id: string
          person_entity_id_a: string
          person_entity_id_b: string
          relationship_type: string
          relationship_direction: string
          source_claim_ids: string[]
          confidence: Database['public']['Enums']['confidence_level']
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          person_entity_id_a: string
          person_entity_id_b: string
          relationship_type: string
          relationship_direction?: string
          source_claim_ids?: string[]
          confidence?: Database['public']['Enums']['confidence_level']
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          person_entity_id_a?: string
          person_entity_id_b?: string
          relationship_type?: string
          relationship_direction?: string
          source_claim_ids?: string[]
          confidence?: Database['public']['Enums']['confidence_level']
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
      case_linkage_scores: {
        Row: {
          id: string
          case_a_id: string
          case_b_id: string
          composite_score: number
          grade: string
          contributing_layers: Json
          shared_entity_ids: string[]
          shared_flag_types: string[]
          reviewer_status: string
          reviewed_by: string | null
          reviewed_at: string | null
          lead_investigator_note: string | null
          generated_at: string
        }
        Insert: {
          id?: string
          case_a_id: string
          case_b_id: string
          composite_score: number
          grade: string
          contributing_layers?: Json
          shared_entity_ids?: string[]
          shared_flag_types?: string[]
          reviewer_status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          lead_investigator_note?: string | null
          generated_at?: string
        }
        Update: {
          id?: string
          case_a_id?: string
          case_b_id?: string
          composite_score?: number
          grade?: string
          contributing_layers?: Json
          shared_entity_ids?: string[]
          shared_flag_types?: string[]
          reviewer_status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          lead_investigator_note?: string | null
          generated_at?: string
        }
      }
      case_pattern_settings: {
        Row: {
          case_id: string
          proximity_radius_miles: number
          corridor_radius_meters: number
          temporal_window_days: number
          cross_case_matching_enabled: boolean
          weight_overrides: Json
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          proximity_radius_miles?: number
          corridor_radius_meters?: number
          temporal_window_days?: number
          cross_case_matching_enabled?: boolean
          weight_overrides?: Json
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          proximity_radius_miles?: number
          corridor_radius_meters?: number
          temporal_window_days?: number
          cross_case_matching_enabled?: boolean
          weight_overrides?: Json
          updated_by?: string | null
          updated_at?: string
        }
      }
      case_invitations: {
        Row: {
          id: string
          case_id: string
          email: string
          role: Database['public']['Enums']['user_role']
          invited_by: string
          token: string
          accepted_at: string | null
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          email: string
          role: Database['public']['Enums']['user_role']
          invited_by: string
          token?: string
          accepted_at?: string | null
          expires_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          email?: string
          role?: Database['public']['Enums']['user_role']
          invited_by?: string
          token?: string
          accepted_at?: string | null
          expires_at?: string
          created_at?: string
        }
      }
      claim_templates: {
        Row: {
          id: string
          case_id: string | null
          name: string
          claim_type: Database['public']['Enums']['claim_type']
          observation_mode: Database['public']['Enums']['observation_mode'] | null
          suggested_source_confidence: Database['public']['Enums']['confidence_level']
          suggested_content_confidence: Database['public']['Enums']['confidence_level']
          description: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id?: string | null
          name: string
          claim_type: Database['public']['Enums']['claim_type']
          observation_mode?: Database['public']['Enums']['observation_mode'] | null
          suggested_source_confidence?: Database['public']['Enums']['confidence_level']
          suggested_content_confidence?: Database['public']['Enums']['confidence_level']
          description?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string | null
          name?: string
          claim_type?: Database['public']['Enums']['claim_type']
          observation_mode?: Database['public']['Enums']['observation_mode'] | null
          suggested_source_confidence?: Database['public']['Enums']['confidence_level']
          suggested_content_confidence?: Database['public']['Enums']['confidence_level']
          description?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
      submission_similarity: {
        Row: {
          id: string
          submission_a_id: string
          submission_b_id: string
          similarity_score: number
          computed_at: string
        }
        Insert: {
          id?: string
          submission_a_id: string
          submission_b_id: string
          similarity_score: number
          computed_at?: string
        }
        Update: {
          id?: string
          submission_a_id?: string
          submission_b_id?: string
          similarity_score?: number
          computed_at?: string
        }
      }
    }
    Enums: {
      case_type: 'missing_person' | 'unidentified_remains' | 'homicide' | 'assault' | 'trafficking' | 'other'
      case_status: 'active' | 'inactive' | 'closed' | 'archived'
      visibility_level: 'private' | 'team' | 'partner_orgs' | 'law_enforcement' | 'public'
      source_type: 'named_individual' | 'anonymous' | 'organization' | 'official_record' | 'media' | 'system'
      submitter_consent: 'anonymous' | 'confidential' | 'on_record'
      observation_mode: 'observed_directly' | 'heard_directly' | 'reported_by_another' | 'inferred_from_document' | 'system_generated'
      review_status: 'unverified' | 'under_review' | 'corroborated' | 'confirmed' | 'disputed' | 'retracted'
      claim_type: 'sighting' | 'identifier' | 'association' | 'statement' | 'interpretation' | 'official' | 'behavioral' | 'physical_description' | 'forensic_countermeasure' | 'scene_staging' | 'disposal_method'
      confidence_level: 'low' | 'medium' | 'high'
      entity_type: 'person' | 'location' | 'vehicle' | 'phone' | 'username' | 'organization' | 'document' | 'other'
      normalization_status: 'raw' | 'normalized' | 'merged' | 'flagged_ambiguous'
      entity_role: 'subject' | 'vehicle_seen' | 'associate_mentioned' | 'location_reference' | 'identifier_fragment' | 'witness' | 'victim' | 'unknown'
      identifier_source: 'seen_directly' | 'heard_stated' | 'found_in_document' | 'recalled_from_memory' | 'inferred' | 'unknown'
      user_role: 'contributor' | 'reviewer' | 'lead_investigator' | 'legal' | 'export_only' | 'admin'
      audit_action: 'created' | 'edited' | 'approved' | 'disputed' | 'retracted' | 'merged' | 'split' | 'flagged' | 'escalated' | 'exported' | 'viewed'
      audit_target_type: 'submission' | 'claim' | 'entity' | 'event' | 'case'
      export_scope: 'full' | 'filtered' | 'summary'
      recipient_type: 'law_enforcement' | 'legal' | 'journalist' | 'family' | 'other'
      export_format: 'pdf' | 'json' | 'csv'
      event_status: 'unverified' | 'under_review' | 'confirmed' | 'disputed'
      date_precision: 'exact' | 'approximate' | 'unknown'
    }
  }
}

// Helper types
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type InsertTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type UpdateTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]
