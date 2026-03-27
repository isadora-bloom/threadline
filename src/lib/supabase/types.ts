export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      case_invitations: {
        Row: {
          accepted_at: string | null
          case_id: string
          created_at: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["user_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          case_id: string
          created_at?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["user_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          case_id?: string
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["user_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_invitations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_linkage_scores: {
        Row: {
          case_a_id: string
          case_b_id: string
          composite_score: number
          contributing_layers: Json
          generated_at: string
          grade: string
          id: string
          lead_investigator_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_status: string | null
          shared_entity_ids: string[] | null
          shared_flag_types: string[] | null
        }
        Insert: {
          case_a_id: string
          case_b_id: string
          composite_score: number
          contributing_layers?: Json
          generated_at?: string
          grade: string
          id?: string
          lead_investigator_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_status?: string | null
          shared_entity_ids?: string[] | null
          shared_flag_types?: string[] | null
        }
        Update: {
          case_a_id?: string
          case_b_id?: string
          composite_score?: number
          contributing_layers?: Json
          generated_at?: string
          grade?: string
          id?: string
          lead_investigator_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_status?: string | null
          shared_entity_ids?: string[] | null
          shared_flag_types?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "case_linkage_scores_case_a_id_fkey"
            columns: ["case_a_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_linkage_scores_case_b_id_fkey"
            columns: ["case_b_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_pattern_settings: {
        Row: {
          case_id: string
          corridor_radius_meters: number | null
          cross_case_matching_enabled: boolean | null
          proximity_radius_miles: number | null
          temporal_window_days: number | null
          updated_at: string | null
          updated_by: string | null
          weight_overrides: Json | null
        }
        Insert: {
          case_id: string
          corridor_radius_meters?: number | null
          cross_case_matching_enabled?: boolean | null
          proximity_radius_miles?: number | null
          temporal_window_days?: number | null
          updated_at?: string | null
          updated_by?: string | null
          weight_overrides?: Json | null
        }
        Update: {
          case_id?: string
          corridor_radius_meters?: number | null
          cross_case_matching_enabled?: boolean | null
          proximity_radius_miles?: number | null
          temporal_window_days?: number | null
          updated_at?: string | null
          updated_by?: string | null
          weight_overrides?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "case_pattern_settings_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_user_roles: {
        Row: {
          case_id: string
          created_at: string | null
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          case_id: string
          created_at?: string | null
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          case_id?: string
          created_at?: string | null
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_user_roles_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          case_type: Database["public"]["Enums"]["case_type"]
          convicted_offender_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          jurisdiction: string | null
          legal_hold: boolean
          legal_hold_reason: string | null
          legal_hold_set_at: string | null
          legal_hold_set_by: string | null
          notes: string | null
          resolution_notes: string | null
          resolution_type: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["case_status"]
          title: string
          updated_at: string | null
          visibility_level: Database["public"]["Enums"]["visibility_level"]
        }
        Insert: {
          case_type?: Database["public"]["Enums"]["case_type"]
          convicted_offender_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          jurisdiction?: string | null
          legal_hold?: boolean
          legal_hold_reason?: string | null
          legal_hold_set_at?: string | null
          legal_hold_set_by?: string | null
          notes?: string | null
          resolution_notes?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          title: string
          updated_at?: string | null
          visibility_level?: Database["public"]["Enums"]["visibility_level"]
        }
        Update: {
          case_type?: Database["public"]["Enums"]["case_type"]
          convicted_offender_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          jurisdiction?: string | null
          legal_hold?: boolean
          legal_hold_reason?: string | null
          legal_hold_set_at?: string | null
          legal_hold_set_by?: string | null
          notes?: string | null
          resolution_notes?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          title?: string
          updated_at?: string | null
          visibility_level?: Database["public"]["Enums"]["visibility_level"]
        }
        Relationships: [
          {
            foreignKeyName: "cases_convicted_offender_id_fkey"
            columns: ["convicted_offender_id"]
            isOneToOne: false
            referencedRelation: "known_offenders"
            referencedColumns: ["id"]
          },
        ]
      }
      city_geocodes: {
        Row: {
          city: string
          country: string
          created_at: string
          display_name: string | null
          id: string
          lat: number
          lng: number
          source: string
          state: string
        }
        Insert: {
          city: string
          country?: string
          created_at?: string
          display_name?: string | null
          id?: string
          lat: number
          lng: number
          source?: string
          state: string
        }
        Update: {
          city?: string
          country?: string
          created_at?: string
          display_name?: string | null
          id?: string
          lat?: number
          lng?: number
          source?: string
          state?: string
        }
        Relationships: []
      }
      claim_corroborations: {
        Row: {
          case_id: string
          claim_id: string
          contradiction_detail: string | null
          corroborated_by_claim_id: string
          created_at: string | null
          id: string
          is_contradiction: boolean
          match_type: string
          similarity_score: number | null
        }
        Insert: {
          case_id: string
          claim_id: string
          contradiction_detail?: string | null
          corroborated_by_claim_id: string
          created_at?: string | null
          id?: string
          is_contradiction?: boolean
          match_type: string
          similarity_score?: number | null
        }
        Update: {
          case_id?: string
          claim_id?: string
          contradiction_detail?: string | null
          corroborated_by_claim_id?: string
          created_at?: string | null
          id?: string
          is_contradiction?: boolean
          match_type?: string
          similarity_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_corroborations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_corroborations_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_corroborations_corroborated_by_claim_id_fkey"
            columns: ["corroborated_by_claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_entity_links: {
        Row: {
          claim_id: string
          confidence: Database["public"]["Enums"]["confidence_level"] | null
          created_at: string | null
          created_by: string | null
          entity_id: string
          entity_role: Database["public"]["Enums"]["entity_role"]
          id: string
          identifier_source: Database["public"]["Enums"]["identifier_source"]
          notes: string | null
        }
        Insert: {
          claim_id: string
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          created_at?: string | null
          created_by?: string | null
          entity_id: string
          entity_role?: Database["public"]["Enums"]["entity_role"]
          id?: string
          identifier_source?: Database["public"]["Enums"]["identifier_source"]
          notes?: string | null
        }
        Update: {
          claim_id?: string
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          created_at?: string | null
          created_by?: string | null
          entity_id?: string
          entity_role?: Database["public"]["Enums"]["entity_role"]
          id?: string
          identifier_source?: Database["public"]["Enums"]["identifier_source"]
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_entity_links_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_entity_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_tags: {
        Row: {
          case_id: string
          claim_id: string
          created_at: string | null
          created_by: string | null
          id: string
          source: string
          tag: string
          tag_type: string
        }
        Insert: {
          case_id: string
          claim_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          source?: string
          tag: string
          tag_type?: string
        }
        Update: {
          case_id?: string
          claim_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          source?: string
          tag?: string
          tag_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_tags_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_tags_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_templates: {
        Row: {
          case_id: string | null
          claim_type: Database["public"]["Enums"]["claim_type"]
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
          observation_mode:
            | Database["public"]["Enums"]["observation_mode"]
            | null
          suggested_content_confidence:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          suggested_source_confidence:
            | Database["public"]["Enums"]["confidence_level"]
            | null
        }
        Insert: {
          case_id?: string | null
          claim_type: Database["public"]["Enums"]["claim_type"]
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          observation_mode?:
            | Database["public"]["Enums"]["observation_mode"]
            | null
          suggested_content_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          suggested_source_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
        }
        Update: {
          case_id?: string | null
          claim_type?: Database["public"]["Enums"]["claim_type"]
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          observation_mode?:
            | Database["public"]["Enums"]["observation_mode"]
            | null
          suggested_content_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          suggested_source_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_templates_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      claims: {
        Row: {
          behavioral_category: string | null
          behavioral_consistency_flag: boolean | null
          claim_position: number
          claim_type: Database["public"]["Enums"]["claim_type"]
          content_confidence: Database["public"]["Enums"]["confidence_level"]
          contradiction_status: string | null
          created_at: string | null
          created_by: string | null
          event_date: string | null
          event_date_precision:
            | Database["public"]["Enums"]["date_precision"]
            | null
          event_date_range_end: string | null
          extracted_text: string
          id: string
          interpretation_flag: boolean
          notes: string | null
          observation_mode:
            | Database["public"]["Enums"]["observation_mode"]
            | null
          original_submission_id: string
          reviewed_by: string | null
          source_confidence: Database["public"]["Enums"]["confidence_level"]
          submission_id: string
          updated_at: string | null
          verification_status: Database["public"]["Enums"]["review_status"]
        }
        Insert: {
          behavioral_category?: string | null
          behavioral_consistency_flag?: boolean | null
          claim_position?: number
          claim_type?: Database["public"]["Enums"]["claim_type"]
          content_confidence?: Database["public"]["Enums"]["confidence_level"]
          contradiction_status?: string | null
          created_at?: string | null
          created_by?: string | null
          event_date?: string | null
          event_date_precision?:
            | Database["public"]["Enums"]["date_precision"]
            | null
          event_date_range_end?: string | null
          extracted_text: string
          id?: string
          interpretation_flag?: boolean
          notes?: string | null
          observation_mode?:
            | Database["public"]["Enums"]["observation_mode"]
            | null
          original_submission_id: string
          reviewed_by?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          submission_id: string
          updated_at?: string | null
          verification_status?: Database["public"]["Enums"]["review_status"]
        }
        Update: {
          behavioral_category?: string | null
          behavioral_consistency_flag?: boolean | null
          claim_position?: number
          claim_type?: Database["public"]["Enums"]["claim_type"]
          content_confidence?: Database["public"]["Enums"]["confidence_level"]
          contradiction_status?: string | null
          created_at?: string | null
          created_by?: string | null
          event_date?: string | null
          event_date_precision?:
            | Database["public"]["Enums"]["date_precision"]
            | null
          event_date_range_end?: string | null
          extracted_text?: string
          id?: string
          interpretation_flag?: boolean
          notes?: string | null
          observation_mode?:
            | Database["public"]["Enums"]["observation_mode"]
            | null
          original_submission_id?: string
          reviewed_by?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          submission_id?: string
          updated_at?: string | null
          verification_status?: Database["public"]["Enums"]["review_status"]
        }
        Relationships: [
          {
            foreignKeyName: "claims_original_submission_id_fkey"
            columns: ["original_submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      community_notes: {
        Row: {
          content: string
          created_at: string | null
          flagged: boolean | null
          flagged_reason: string | null
          id: string
          import_record_id: string
          is_public: boolean | null
          note_type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          flagged?: boolean | null
          flagged_reason?: string | null
          id?: string
          import_record_id: string
          is_public?: boolean | null
          note_type?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          flagged?: boolean | null
          flagged_reason?: string | null
          id?: string
          import_record_id?: string
          is_public?: boolean | null
          note_type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_notes_import_record_id_fkey"
            columns: ["import_record_id"]
            isOneToOne: false
            referencedRelation: "cases_needing_attention"
            referencedColumns: ["import_record_id"]
          },
          {
            foreignKeyName: "community_notes_import_record_id_fkey"
            columns: ["import_record_id"]
            isOneToOne: false
            referencedRelation: "import_records"
            referencedColumns: ["id"]
          },
        ]
      }
      corridor_reference_points: {
        Row: {
          created_at: string | null
          highway: string | null
          id: string
          lat: number
          lng: number
          name: string
          notes: string | null
          point_type: string
          source: string | null
        }
        Insert: {
          created_at?: string | null
          highway?: string | null
          id?: string
          lat: number
          lng: number
          name: string
          notes?: string | null
          point_type: string
          source?: string | null
        }
        Update: {
          created_at?: string | null
          highway?: string | null
          id?: string
          lat?: number
          lng?: number
          name?: string
          notes?: string | null
          point_type?: string
          source?: string | null
        }
        Relationships: []
      }
      deep_research: {
        Row: {
          case_id: string | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          findings: Json | null
          id: string
          import_record_id: string | null
          model_used: string | null
          requested_by: string | null
          research_type: string
          started_at: string | null
          status: string
          submission_id: string | null
          summary: string | null
          tokens_used: number | null
        }
        Insert: {
          case_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          findings?: Json | null
          id?: string
          import_record_id?: string | null
          model_used?: string | null
          requested_by?: string | null
          research_type?: string
          started_at?: string | null
          status?: string
          submission_id?: string | null
          summary?: string | null
          tokens_used?: number | null
        }
        Update: {
          case_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          findings?: Json | null
          id?: string
          import_record_id?: string | null
          model_used?: string | null
          requested_by?: string | null
          research_type?: string
          started_at?: string | null
          status?: string
          submission_id?: string | null
          summary?: string | null
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deep_research_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deep_research_import_record_id_fkey"
            columns: ["import_record_id"]
            isOneToOne: false
            referencedRelation: "cases_needing_attention"
            referencedColumns: ["import_record_id"]
          },
          {
            foreignKeyName: "deep_research_import_record_id_fkey"
            columns: ["import_record_id"]
            isOneToOne: false
            referencedRelation: "import_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deep_research_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      doe_entity_mentions: {
        Row: {
          case_id: string
          entity_type: string
          entity_value: string
          generated_at: string
          id: string
          match_count: number
          matched_submission_ids: string[] | null
          raw_snippet: string | null
          submission_id: string
        }
        Insert: {
          case_id: string
          entity_type: string
          entity_value: string
          generated_at?: string
          id?: string
          match_count?: number
          matched_submission_ids?: string[] | null
          raw_snippet?: string | null
          submission_id: string
        }
        Update: {
          case_id?: string
          entity_type?: string
          entity_value?: string
          generated_at?: string
          id?: string
          match_count?: number
          matched_submission_ids?: string[] | null
          raw_snippet?: string | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doe_entity_mentions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doe_entity_mentions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      doe_match_candidates: {
        Row: {
          ai_assessment: Json | null
          composite_score: number
          destination_city: string | null
          destination_state: string | null
          destination_text: string | null
          generated_at: string
          grade: string
          id: string
          match_type: string
          missing_age: string | null
          missing_case_id: string
          missing_date: string | null
          missing_doe_id: string | null
          missing_eyes: string | null
          missing_hair: string | null
          missing_jewelry: string | null
          missing_location: string | null
          missing_marks: string | null
          missing_name: string | null
          missing_race: string | null
          missing_sex: string | null
          missing_submission_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          reviewer_status: string
          signals: Json
          unidentified_age: string | null
          unidentified_case_id: string
          unidentified_date: string | null
          unidentified_doe_id: string | null
          unidentified_eyes: string | null
          unidentified_hair: string | null
          unidentified_jewelry: string | null
          unidentified_location: string | null
          unidentified_marks: string | null
          unidentified_race: string | null
          unidentified_sex: string | null
          unidentified_submission_id: string
        }
        Insert: {
          ai_assessment?: Json | null
          composite_score: number
          destination_city?: string | null
          destination_state?: string | null
          destination_text?: string | null
          generated_at?: string
          grade: string
          id?: string
          match_type?: string
          missing_age?: string | null
          missing_case_id: string
          missing_date?: string | null
          missing_doe_id?: string | null
          missing_eyes?: string | null
          missing_hair?: string | null
          missing_jewelry?: string | null
          missing_location?: string | null
          missing_marks?: string | null
          missing_name?: string | null
          missing_race?: string | null
          missing_sex?: string | null
          missing_submission_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string
          signals?: Json
          unidentified_age?: string | null
          unidentified_case_id: string
          unidentified_date?: string | null
          unidentified_doe_id?: string | null
          unidentified_eyes?: string | null
          unidentified_hair?: string | null
          unidentified_jewelry?: string | null
          unidentified_location?: string | null
          unidentified_marks?: string | null
          unidentified_race?: string | null
          unidentified_sex?: string | null
          unidentified_submission_id: string
        }
        Update: {
          ai_assessment?: Json | null
          composite_score?: number
          destination_city?: string | null
          destination_state?: string | null
          destination_text?: string | null
          generated_at?: string
          grade?: string
          id?: string
          match_type?: string
          missing_age?: string | null
          missing_case_id?: string
          missing_date?: string | null
          missing_doe_id?: string | null
          missing_eyes?: string | null
          missing_hair?: string | null
          missing_jewelry?: string | null
          missing_location?: string | null
          missing_marks?: string | null
          missing_name?: string | null
          missing_race?: string | null
          missing_sex?: string | null
          missing_submission_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string
          signals?: Json
          unidentified_age?: string | null
          unidentified_case_id?: string
          unidentified_date?: string | null
          unidentified_doe_id?: string | null
          unidentified_eyes?: string | null
          unidentified_hair?: string | null
          unidentified_jewelry?: string | null
          unidentified_location?: string | null
          unidentified_marks?: string | null
          unidentified_race?: string | null
          unidentified_sex?: string | null
          unidentified_submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doe_match_candidates_missing_case_id_fkey"
            columns: ["missing_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doe_match_candidates_missing_submission_id_fkey"
            columns: ["missing_submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doe_match_candidates_unidentified_case_id_fkey"
            columns: ["unidentified_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doe_match_candidates_unidentified_submission_id_fkey"
            columns: ["unidentified_submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      doe_stall_flags: {
        Row: {
          case_id: string
          classification_used: string | null
          elapsed_days: number | null
          generated_at: string
          id: string
          missing_age: string | null
          missing_date: string | null
          missing_location: string | null
          missing_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          reviewer_status: string
          stall_label: string
          stall_type: string
          submission_id: string
          supporting_signals: string[] | null
        }
        Insert: {
          case_id: string
          classification_used?: string | null
          elapsed_days?: number | null
          generated_at?: string
          id?: string
          missing_age?: string | null
          missing_date?: string | null
          missing_location?: string | null
          missing_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string
          stall_label: string
          stall_type: string
          submission_id: string
          supporting_signals?: string[] | null
        }
        Update: {
          case_id?: string
          classification_used?: string | null
          elapsed_days?: number | null
          generated_at?: string
          id?: string
          missing_age?: string | null
          missing_date?: string | null
          missing_location?: string | null
          missing_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string
          stall_label?: string
          stall_type?: string
          submission_id?: string
          supporting_signals?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "doe_stall_flags_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doe_stall_flags_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      doe_victimology_clusters: {
        Row: {
          age_group: string | null
          ai_generated_at: string | null
          ai_narrative: string | null
          case_count: number
          case_id: string
          cluster_label: string
          cluster_type: string
          corridor: string | null
          generated_at: string
          id: string
          matched_signals: string[] | null
          primary_signal: string | null
          race: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          reviewer_status: string
          sex: string | null
          signal_category: string | null
          signals: Json
          state: string | null
          submission_ids: string[]
          temporal_pattern: string | null
          year_span_end: number | null
          year_span_start: number | null
        }
        Insert: {
          age_group?: string | null
          ai_generated_at?: string | null
          ai_narrative?: string | null
          case_count: number
          case_id: string
          cluster_label: string
          cluster_type: string
          corridor?: string | null
          generated_at?: string
          id?: string
          matched_signals?: string[] | null
          primary_signal?: string | null
          race?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string
          sex?: string | null
          signal_category?: string | null
          signals?: Json
          state?: string | null
          submission_ids?: string[]
          temporal_pattern?: string | null
          year_span_end?: number | null
          year_span_start?: number | null
        }
        Update: {
          age_group?: string | null
          ai_generated_at?: string | null
          ai_narrative?: string | null
          case_count?: number
          case_id?: string
          cluster_label?: string
          cluster_type?: string
          corridor?: string | null
          generated_at?: string
          id?: string
          matched_signals?: string[] | null
          primary_signal?: string | null
          race?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string
          sex?: string | null
          signal_category?: string | null
          signals?: Json
          state?: string | null
          submission_ids?: string[]
          temporal_pattern?: string | null
          year_span_end?: number | null
          year_span_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "doe_victimology_clusters_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          aliases: string[] | null
          case_id: string
          confidence: Database["public"]["Enums"]["confidence_level"] | null
          created_at: string | null
          created_by: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          flagged_for_review: boolean | null
          geocode_source: string | null
          geocoded_at: string | null
          highway_distance_m: number | null
          highway_proximity: string | null
          id: string
          lat: number | null
          lng: number | null
          nearest_highway: string | null
          normalization_status: Database["public"]["Enums"]["normalization_status"]
          normalized_value: string | null
          notes: string | null
          raw_value: string
          review_state: Database["public"]["Enums"]["review_status"] | null
          updated_at: string | null
          weapon_category: string | null
          weapon_specificity: string | null
        }
        Insert: {
          aliases?: string[] | null
          case_id: string
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          created_at?: string | null
          created_by?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"]
          flagged_for_review?: boolean | null
          geocode_source?: string | null
          geocoded_at?: string | null
          highway_distance_m?: number | null
          highway_proximity?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          nearest_highway?: string | null
          normalization_status?: Database["public"]["Enums"]["normalization_status"]
          normalized_value?: string | null
          notes?: string | null
          raw_value: string
          review_state?: Database["public"]["Enums"]["review_status"] | null
          updated_at?: string | null
          weapon_category?: string | null
          weapon_specificity?: string | null
        }
        Update: {
          aliases?: string[] | null
          case_id?: string
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          created_at?: string | null
          created_by?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"]
          flagged_for_review?: boolean | null
          geocode_source?: string | null
          geocoded_at?: string | null
          highway_distance_m?: number | null
          highway_proximity?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          nearest_highway?: string | null
          normalization_status?: Database["public"]["Enums"]["normalization_status"]
          normalized_value?: string | null
          notes?: string | null
          raw_value?: string
          review_state?: Database["public"]["Enums"]["review_status"] | null
          updated_at?: string | null
          weapon_category?: string | null
          weapon_specificity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      event_claim_links: {
        Row: {
          claim_id: string
          event_id: string
        }
        Insert: {
          claim_id: string
          event_id: string
        }
        Update: {
          claim_id?: string
          event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_claim_links_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_claim_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          case_id: string
          created_at: string | null
          created_by: string | null
          date_range_end: string | null
          date_range_start: string | null
          id: string
          location_entity_id: string | null
          notes: string | null
          status: Database["public"]["Enums"]["event_status"] | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          case_id: string
          created_at?: string | null
          created_by?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          id?: string
          location_entity_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["event_status"] | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string | null
          created_by?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          id?: string
          location_entity_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["event_status"] | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      export_records: {
        Row: {
          case_id: string
          created_at: string | null
          export_format: Database["public"]["Enums"]["export_format"]
          exported_by: string
          id: string
          included_claim_ids: string[] | null
          included_entity_ids: string[] | null
          purpose: string | null
          recipient: string | null
          recipient_type: Database["public"]["Enums"]["recipient_type"] | null
          scope: Database["public"]["Enums"]["export_scope"]
          storage_path: string | null
        }
        Insert: {
          case_id: string
          created_at?: string | null
          export_format?: Database["public"]["Enums"]["export_format"]
          exported_by: string
          id?: string
          included_claim_ids?: string[] | null
          included_entity_ids?: string[] | null
          purpose?: string | null
          recipient?: string | null
          recipient_type?: Database["public"]["Enums"]["recipient_type"] | null
          scope?: Database["public"]["Enums"]["export_scope"]
          storage_path?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string | null
          export_format?: Database["public"]["Enums"]["export_format"]
          exported_by?: string
          id?: string
          included_claim_ids?: string[] | null
          included_entity_ids?: string[] | null
          purpose?: string | null
          recipient?: string | null
          recipient_type?: Database["public"]["Enums"]["recipient_type"] | null
          scope?: Database["public"]["Enums"]["export_scope"]
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "export_records_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      global_connections: {
        Row: {
          ai_confidence: number | null
          ai_summary: string | null
          composite_score: number
          connection_type: string
          days_apart: number | null
          distance_miles: number | null
          generated_at: string | null
          grade: string
          id: string
          record_a_id: string
          record_b_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          reviewer_status: string | null
          signals: Json
        }
        Insert: {
          ai_confidence?: number | null
          ai_summary?: string | null
          composite_score: number
          connection_type: string
          days_apart?: number | null
          distance_miles?: number | null
          generated_at?: string | null
          grade: string
          id?: string
          record_a_id: string
          record_b_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string | null
          signals?: Json
        }
        Update: {
          ai_confidence?: number | null
          ai_summary?: string | null
          composite_score?: number
          connection_type?: string
          days_apart?: number | null
          distance_miles?: number | null
          generated_at?: string | null
          grade?: string
          id?: string
          record_a_id?: string
          record_b_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string | null
          signals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "global_connections_record_a_id_fkey"
            columns: ["record_a_id"]
            isOneToOne: false
            referencedRelation: "cases_needing_attention"
            referencedColumns: ["import_record_id"]
          },
          {
            foreignKeyName: "global_connections_record_a_id_fkey"
            columns: ["record_a_id"]
            isOneToOne: false
            referencedRelation: "import_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_connections_record_b_id_fkey"
            columns: ["record_b_id"]
            isOneToOne: false
            referencedRelation: "cases_needing_attention"
            referencedColumns: ["import_record_id"]
          },
          {
            foreignKeyName: "global_connections_record_b_id_fkey"
            columns: ["record_b_id"]
            isOneToOne: false
            referencedRelation: "import_records"
            referencedColumns: ["id"]
          },
        ]
      }
      import_records: {
        Row: {
          age_text: string | null
          ai_extraction: Json | null
          ai_processed: boolean | null
          ai_processed_at: string | null
          case_id: string | null
          city: string | null
          created_at: string | null
          date_found: string | null
          date_last_contact: string | null
          date_missing: string | null
          external_id: string
          external_url: string | null
          id: string
          last_synced_at: string | null
          person_name: string | null
          race: string | null
          raw_data: Json
          record_type: string
          sex: string | null
          source_id: string
          stale: boolean | null
          state: string | null
          submission_id: string | null
          sync_hash: string | null
          updated_at: string | null
        }
        Insert: {
          age_text?: string | null
          ai_extraction?: Json | null
          ai_processed?: boolean | null
          ai_processed_at?: string | null
          case_id?: string | null
          city?: string | null
          created_at?: string | null
          date_found?: string | null
          date_last_contact?: string | null
          date_missing?: string | null
          external_id: string
          external_url?: string | null
          id?: string
          last_synced_at?: string | null
          person_name?: string | null
          race?: string | null
          raw_data: Json
          record_type: string
          sex?: string | null
          source_id: string
          stale?: boolean | null
          state?: string | null
          submission_id?: string | null
          sync_hash?: string | null
          updated_at?: string | null
        }
        Update: {
          age_text?: string | null
          ai_extraction?: Json | null
          ai_processed?: boolean | null
          ai_processed_at?: string | null
          case_id?: string | null
          city?: string | null
          created_at?: string | null
          date_found?: string | null
          date_last_contact?: string | null
          date_missing?: string | null
          external_id?: string
          external_url?: string | null
          id?: string
          last_synced_at?: string | null
          person_name?: string | null
          race?: string | null
          raw_data?: Json
          record_type?: string
          sex?: string | null
          source_id?: string
          stale?: boolean | null
          state?: string | null
          submission_id?: string | null
          sync_hash?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_records_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_records_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "import_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_records_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      import_sources: {
        Row: {
          base_url: string | null
          created_at: string | null
          description: string | null
          display_name: string
          id: string
          is_active: boolean | null
          last_import_at: string | null
          slug: string
          total_records: number | null
        }
        Insert: {
          base_url?: string | null
          created_at?: string | null
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean | null
          last_import_at?: string | null
          slug: string
          total_records?: number | null
        }
        Update: {
          base_url?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean | null
          last_import_at?: string | null
          slug?: string
          total_records?: number | null
        }
        Relationships: []
      }
      intelligence_queue: {
        Row: {
          ai_confidence: number | null
          ai_reasoning: string | null
          created_at: string | null
          details: Json
          escalated_to: string | null
          escalation_ref_id: string | null
          id: string
          priority_grade: string
          priority_score: number
          queue_type: string
          related_case_ids: string[] | null
          related_entity_ids: string[] | null
          related_import_ids: string[] | null
          related_submission_ids: string[] | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          signal_count: number | null
          status: string
          summary: string
          title: string
          updated_at: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_reasoning?: string | null
          created_at?: string | null
          details?: Json
          escalated_to?: string | null
          escalation_ref_id?: string | null
          id?: string
          priority_grade?: string
          priority_score?: number
          queue_type: string
          related_case_ids?: string[] | null
          related_entity_ids?: string[] | null
          related_import_ids?: string[] | null
          related_submission_ids?: string[] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          signal_count?: number | null
          status?: string
          summary: string
          title: string
          updated_at?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_reasoning?: string | null
          created_at?: string | null
          details?: Json
          escalated_to?: string | null
          escalation_ref_id?: string | null
          id?: string
          priority_grade?: string
          priority_score?: number
          queue_type?: string
          related_case_ids?: string[] | null
          related_entity_ids?: string[] | null
          related_import_ids?: string[] | null
          related_submission_ids?: string[] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          signal_count?: number | null
          status?: string
          summary?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      investigative_threads: {
        Row: {
          assigned_to: string | null
          case_id: string
          complicating_factors: string | null
          created_at: string | null
          external_resources: string[]
          generated_by: string | null
          generation_batch_id: string
          generation_model: string | null
          hypothesis: string
          id: string
          recommended_actions: string[]
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          status_reason: string | null
          supporting_claim_ids: string[]
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          case_id: string
          complicating_factors?: string | null
          created_at?: string | null
          external_resources?: string[]
          generated_by?: string | null
          generation_batch_id?: string
          generation_model?: string | null
          hypothesis: string
          id?: string
          recommended_actions?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          status_reason?: string | null
          supporting_claim_ids?: string[]
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          case_id?: string
          complicating_factors?: string | null
          created_at?: string | null
          external_resources?: string[]
          generated_by?: string | null
          generation_batch_id?: string
          generation_model?: string | null
          hypothesis?: string
          id?: string
          recommended_actions?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          status_reason?: string | null
          supporting_claim_ids?: string[]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investigative_threads_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      known_offenders: {
        Row: {
          active_from: number | null
          active_to: number | null
          aliases: string[] | null
          birth_year: number | null
          cause_of_death: string[] | null
          conviction_count: number | null
          created_at: string | null
          disposal_method: string[] | null
          home_cities: string[] | null
          home_states: string[] | null
          id: string
          incarcerated_from: number | null
          incarcerated_to: number | null
          mo_keywords: string[] | null
          name: string
          operation_states: string[] | null
          signature_details: string | null
          source_notes: string | null
          status: string
          suspected_count: number | null
          travel_corridors: string[] | null
          updated_at: string | null
          victim_age_max: number | null
          victim_age_min: number | null
          victim_age_typical: number | null
          victim_cities: string[] | null
          victim_races: string[] | null
          victim_sex: string | null
          victim_states: string[] | null
          wikipedia_slug: string | null
        }
        Insert: {
          active_from?: number | null
          active_to?: number | null
          aliases?: string[] | null
          birth_year?: number | null
          cause_of_death?: string[] | null
          conviction_count?: number | null
          created_at?: string | null
          disposal_method?: string[] | null
          home_cities?: string[] | null
          home_states?: string[] | null
          id?: string
          incarcerated_from?: number | null
          incarcerated_to?: number | null
          mo_keywords?: string[] | null
          name: string
          operation_states?: string[] | null
          signature_details?: string | null
          source_notes?: string | null
          status?: string
          suspected_count?: number | null
          travel_corridors?: string[] | null
          updated_at?: string | null
          victim_age_max?: number | null
          victim_age_min?: number | null
          victim_age_typical?: number | null
          victim_cities?: string[] | null
          victim_races?: string[] | null
          victim_sex?: string | null
          victim_states?: string[] | null
          wikipedia_slug?: string | null
        }
        Update: {
          active_from?: number | null
          active_to?: number | null
          aliases?: string[] | null
          birth_year?: number | null
          cause_of_death?: string[] | null
          conviction_count?: number | null
          created_at?: string | null
          disposal_method?: string[] | null
          home_cities?: string[] | null
          home_states?: string[] | null
          id?: string
          incarcerated_from?: number | null
          incarcerated_to?: number | null
          mo_keywords?: string[] | null
          name?: string
          operation_states?: string[] | null
          signature_details?: string | null
          source_notes?: string | null
          status?: string
          suspected_count?: number | null
          travel_corridors?: string[] | null
          updated_at?: string | null
          victim_age_max?: number | null
          victim_age_min?: number | null
          victim_age_typical?: number | null
          victim_cities?: string[] | null
          victim_races?: string[] | null
          victim_sex?: string | null
          victim_states?: string[] | null
          wikipedia_slug?: string | null
        }
        Relationships: []
      }
      link_scores: {
        Row: {
          case_id: string
          claim_a_id: string
          claim_b_id: string
          distance_miles: number | null
          generated_at: string
          grade: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          reviewer_status: string | null
          score: number
          signals: Json
        }
        Insert: {
          case_id: string
          claim_a_id: string
          claim_b_id: string
          distance_miles?: number | null
          generated_at?: string
          grade: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string | null
          score: number
          signals?: Json
        }
        Update: {
          case_id?: string
          claim_a_id?: string
          claim_b_id?: string
          distance_miles?: number | null
          generated_at?: string
          grade?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string | null
          score?: number
          signals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "link_scores_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_scores_claim_a_id_fkey"
            columns: ["claim_a_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_scores_claim_b_id_fkey"
            columns: ["claim_b_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
        ]
      }
      offender_case_overlaps: {
        Row: {
          ai_assessment: Json | null
          case_id: string
          composite_score: number
          computed_at: string | null
          disposal_score: number | null
          id: string
          matched_disposal: string[] | null
          matched_mo_keywords: string[] | null
          mo_score: number | null
          notes: string | null
          offender_id: string
          predator_geo_score: number | null
          resolution_confirmed: boolean
          resolution_excluded: boolean
          reviewer_status: string
          submission_id: string
          temporal_score: number | null
          victim_age_score: number | null
          victim_geo_score: number | null
          victim_race_score: number | null
          victim_sex_score: number | null
        }
        Insert: {
          ai_assessment?: Json | null
          case_id: string
          composite_score: number
          computed_at?: string | null
          disposal_score?: number | null
          id?: string
          matched_disposal?: string[] | null
          matched_mo_keywords?: string[] | null
          mo_score?: number | null
          notes?: string | null
          offender_id: string
          predator_geo_score?: number | null
          resolution_confirmed?: boolean
          resolution_excluded?: boolean
          reviewer_status?: string
          submission_id: string
          temporal_score?: number | null
          victim_age_score?: number | null
          victim_geo_score?: number | null
          victim_race_score?: number | null
          victim_sex_score?: number | null
        }
        Update: {
          ai_assessment?: Json | null
          case_id?: string
          composite_score?: number
          computed_at?: string | null
          disposal_score?: number | null
          id?: string
          matched_disposal?: string[] | null
          matched_mo_keywords?: string[] | null
          mo_score?: number | null
          notes?: string | null
          offender_id?: string
          predator_geo_score?: number | null
          resolution_confirmed?: boolean
          resolution_excluded?: boolean
          reviewer_status?: string
          submission_id?: string
          temporal_score?: number | null
          victim_age_score?: number | null
          victim_geo_score?: number | null
          victim_race_score?: number | null
          victim_sex_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "offender_case_overlaps_offender_id_fkey"
            columns: ["offender_id"]
            isOneToOne: false
            referencedRelation: "known_offenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offender_case_overlaps_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      pattern_flags: {
        Row: {
          case_id: string
          description: string
          dismissed_at: string | null
          flag_type: string
          generated_at: string
          grade: string | null
          id: string
          involved_case_ids: string[] | null
          involved_claim_ids: string[] | null
          involved_entity_ids: string[] | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          reviewer_status: string
          score: number | null
          signals: Json | null
          title: string
        }
        Insert: {
          case_id: string
          description: string
          dismissed_at?: string | null
          flag_type: string
          generated_at?: string
          grade?: string | null
          id?: string
          involved_case_ids?: string[] | null
          involved_claim_ids?: string[] | null
          involved_entity_ids?: string[] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string
          score?: number | null
          signals?: Json | null
          title: string
        }
        Update: {
          case_id?: string
          description?: string
          dismissed_at?: string | null
          flag_type?: string
          generated_at?: string
          grade?: string | null
          id?: string
          involved_case_ids?: string[] | null
          involved_claim_ids?: string[] | null
          involved_entity_ids?: string[] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          reviewer_status?: string
          score?: number | null
          signals?: Json | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "pattern_flags_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      person_relationships: {
        Row: {
          case_id: string
          confidence: Database["public"]["Enums"]["confidence_level"] | null
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          person_entity_id_a: string
          person_entity_id_b: string
          relationship_direction: string | null
          relationship_type: string
          source_claim_ids: string[] | null
        }
        Insert: {
          case_id: string
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          person_entity_id_a: string
          person_entity_id_b: string
          relationship_direction?: string | null
          relationship_type: string
          source_claim_ids?: string[] | null
        }
        Update: {
          case_id?: string
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          person_entity_id_a?: string
          person_entity_id_b?: string
          relationship_direction?: string | null
          relationship_type?: string
          source_claim_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "person_relationships_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_relationships_person_entity_id_a_fkey"
            columns: ["person_entity_id_a"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_relationships_person_entity_id_b_fkey"
            columns: ["person_entity_id_b"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      research_tasks: {
        Row: {
          case_id: string
          completed_at: string | null
          confidence_summary: string | null
          context: string | null
          created_at: string | null
          created_by: string | null
          error_message: string | null
          findings: Json | null
          human_next_steps: Json | null
          id: string
          question: string
          research_log: Json | null
          sources_consulted: Json | null
          started_at: string | null
          status: string
          trigger_ref_id: string | null
          trigger_ref_type: string | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          case_id: string
          completed_at?: string | null
          confidence_summary?: string | null
          context?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          findings?: Json | null
          human_next_steps?: Json | null
          id?: string
          question: string
          research_log?: Json | null
          sources_consulted?: Json | null
          started_at?: string | null
          status?: string
          trigger_ref_id?: string | null
          trigger_ref_type?: string | null
          trigger_type?: string
          updated_at?: string | null
        }
        Update: {
          case_id?: string
          completed_at?: string | null
          confidence_summary?: string | null
          context?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          findings?: Json | null
          human_next_steps?: Json | null
          id?: string
          question?: string
          research_log?: Json | null
          sources_consulted?: Json | null
          started_at?: string | null
          status?: string
          trigger_ref_id?: string | null
          trigger_ref_type?: string | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      review_actions: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id: string
          case_id: string | null
          diff: Json | null
          id: string
          note: string | null
          target_id: string
          target_type: Database["public"]["Enums"]["audit_target_type"]
          timestamp: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id: string
          case_id?: string | null
          diff?: Json | null
          id?: string
          note?: string | null
          target_id: string
          target_type: Database["public"]["Enums"]["audit_target_type"]
          timestamp?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_id?: string
          case_id?: string | null
          diff?: Json | null
          id?: string
          note?: string | null
          target_id?: string
          target_type?: Database["public"]["Enums"]["audit_target_type"]
          timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_actions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      solvability_scores: {
        Row: {
          ai_next_steps: string[] | null
          ai_summary: string
          computed_at: string | null
          grade: string
          id: string
          import_record_id: string
          model_used: string | null
          score: number
          signals: Json
        }
        Insert: {
          ai_next_steps?: string[] | null
          ai_summary: string
          computed_at?: string | null
          grade: string
          id?: string
          import_record_id: string
          model_used?: string | null
          score: number
          signals?: Json
        }
        Update: {
          ai_next_steps?: string[] | null
          ai_summary?: string
          computed_at?: string | null
          grade?: string
          id?: string
          import_record_id?: string
          model_used?: string | null
          score?: number
          signals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "solvability_scores_import_record_id_fkey"
            columns: ["import_record_id"]
            isOneToOne: true
            referencedRelation: "cases_needing_attention"
            referencedColumns: ["import_record_id"]
          },
          {
            foreignKeyName: "solvability_scores_import_record_id_fkey"
            columns: ["import_record_id"]
            isOneToOne: true
            referencedRelation: "import_records"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_files: {
        Row: {
          created_at: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          id: string
          ocr_text: string | null
          scan_completed_at: string | null
          scan_status: string | null
          storage_path: string
          submission_id: string
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          ocr_text?: string | null
          scan_completed_at?: string | null
          scan_status?: string | null
          storage_path: string
          submission_id: string
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          ocr_text?: string | null
          scan_completed_at?: string | null
          scan_status?: string | null
          storage_path?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_similarity: {
        Row: {
          computed_at: string | null
          id: string
          similarity_score: number
          submission_a_id: string
          submission_b_id: string
        }
        Insert: {
          computed_at?: string | null
          id?: string
          similarity_score: number
          submission_a_id: string
          submission_b_id: string
        }
        Update: {
          computed_at?: string | null
          id?: string
          similarity_score?: number
          submission_a_id?: string
          submission_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_similarity_submission_a_id_fkey"
            columns: ["submission_a_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_similarity_submission_b_id_fkey"
            columns: ["submission_b_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_tokens: {
        Row: {
          case_id: string
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          label: string | null
          token: string
        }
        Insert: {
          case_id: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          label?: string | null
          token?: string
        }
        Update: {
          case_id?: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          label?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_tokens_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          case_id: string
          claimed_by: string | null
          convicted_offender_id: string | null
          created_at: string | null
          discarded_at: string | null
          duplicate_of_submission_id: string | null
          duplicate_similarity: number | null
          entity_count_step6: number | null
          event_date: string | null
          event_date_precision:
            | Database["public"]["Enums"]["date_precision"]
            | null
          event_location: string | null
          event_location_lat: number | null
          event_location_lng: number | null
          firsthand: boolean
          has_date: boolean | null
          has_location_pin: boolean | null
          id: string
          intake_date: string | null
          interpretation_text: string | null
          notes: string | null
          novelty_flags: Json | null
          observation_mode: Database["public"]["Enums"]["observation_mode"]
          occurred_multiple_times: boolean | null
          priority_level: string | null
          priority_score: number | null
          raw_text: string
          resolution_notes: string | null
          resolution_type: string | null
          resolved_at: string | null
          review_completed_at: string | null
          review_started_at: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          source_type: Database["public"]["Enums"]["source_type"]
          submitted_by: string | null
          submitter_consent: Database["public"]["Enums"]["submitter_consent"]
          submitter_contact: string | null
          submitter_name: string | null
          triage_at: string | null
          triage_by: string | null
          triage_discard_reason: string | null
          triage_status: string | null
          updated_at: string | null
          word_count: number | null
        }
        Insert: {
          case_id: string
          claimed_by?: string | null
          convicted_offender_id?: string | null
          created_at?: string | null
          discarded_at?: string | null
          duplicate_of_submission_id?: string | null
          duplicate_similarity?: number | null
          entity_count_step6?: number | null
          event_date?: string | null
          event_date_precision?:
            | Database["public"]["Enums"]["date_precision"]
            | null
          event_location?: string | null
          event_location_lat?: number | null
          event_location_lng?: number | null
          firsthand?: boolean
          has_date?: boolean | null
          has_location_pin?: boolean | null
          id?: string
          intake_date?: string | null
          interpretation_text?: string | null
          notes?: string | null
          novelty_flags?: Json | null
          observation_mode?: Database["public"]["Enums"]["observation_mode"]
          occurred_multiple_times?: boolean | null
          priority_level?: string | null
          priority_score?: number | null
          raw_text: string
          resolution_notes?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          review_completed_at?: string | null
          review_started_at?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          source_type?: Database["public"]["Enums"]["source_type"]
          submitted_by?: string | null
          submitter_consent?: Database["public"]["Enums"]["submitter_consent"]
          submitter_contact?: string | null
          submitter_name?: string | null
          triage_at?: string | null
          triage_by?: string | null
          triage_discard_reason?: string | null
          triage_status?: string | null
          updated_at?: string | null
          word_count?: number | null
        }
        Update: {
          case_id?: string
          claimed_by?: string | null
          convicted_offender_id?: string | null
          created_at?: string | null
          discarded_at?: string | null
          duplicate_of_submission_id?: string | null
          duplicate_similarity?: number | null
          entity_count_step6?: number | null
          event_date?: string | null
          event_date_precision?:
            | Database["public"]["Enums"]["date_precision"]
            | null
          event_location?: string | null
          event_location_lat?: number | null
          event_location_lng?: number | null
          firsthand?: boolean
          has_date?: boolean | null
          has_location_pin?: boolean | null
          id?: string
          intake_date?: string | null
          interpretation_text?: string | null
          notes?: string | null
          novelty_flags?: Json | null
          observation_mode?: Database["public"]["Enums"]["observation_mode"]
          occurred_multiple_times?: boolean | null
          priority_level?: string | null
          priority_score?: number | null
          raw_text?: string
          resolution_notes?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          review_completed_at?: string | null
          review_started_at?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          source_type?: Database["public"]["Enums"]["source_type"]
          submitted_by?: string | null
          submitter_consent?: Database["public"]["Enums"]["submitter_consent"]
          submitter_contact?: string | null
          submitter_name?: string | null
          triage_at?: string | null
          triage_by?: string | null
          triage_discard_reason?: string | null
          triage_status?: string | null
          updated_at?: string | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_convicted_offender_id_fkey"
            columns: ["convicted_offender_id"]
            isOneToOne: false
            referencedRelation: "known_offenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_duplicate_of_submission_id_fkey"
            columns: ["duplicate_of_submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_log: {
        Row: {
          activity_type: string
          created_at: string | null
          id: string
          ref_id: string | null
          user_id: string
        }
        Insert: {
          activity_type: string
          created_at?: string | null
          id?: string
          ref_id?: string | null
          user_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string | null
          id?: string
          ref_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          accepted_tos_at: string | null
          accepted_tos_version: string | null
          created_at: string | null
          full_name: string | null
          id: string
          organization: string | null
          updated_at: string | null
        }
        Insert: {
          accepted_tos_at?: string | null
          accepted_tos_version?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          organization?: string | null
          updated_at?: string | null
        }
        Update: {
          accepted_tos_at?: string | null
          accepted_tos_version?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          organization?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_watchlist: {
        Row: {
          added_at: string | null
          id: string
          import_record_id: string
          notes: string | null
          notify_on_updates: boolean | null
          position: number
          user_id: string
        }
        Insert: {
          added_at?: string | null
          id?: string
          import_record_id: string
          notes?: string | null
          notify_on_updates?: boolean | null
          position?: number
          user_id: string
        }
        Update: {
          added_at?: string | null
          id?: string
          import_record_id?: string
          notes?: string | null
          notify_on_updates?: boolean | null
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_watchlist_import_record_id_fkey"
            columns: ["import_record_id"]
            isOneToOne: false
            referencedRelation: "cases_needing_attention"
            referencedColumns: ["import_record_id"]
          },
          {
            foreignKeyName: "user_watchlist_import_record_id_fkey"
            columns: ["import_record_id"]
            isOneToOne: false
            referencedRelation: "import_records"
            referencedColumns: ["id"]
          },
        ]
      }
      victim_profiles: {
        Row: {
          age_range_max: number | null
          age_range_min: number | null
          case_id: string
          created_at: string | null
          created_by: string | null
          employment_status: string | null
          gender: string | null
          id: string
          known_threats: string | null
          last_confirmed_contact_notes: string | null
          last_confirmed_contact_type: string | null
          last_known_date: string | null
          last_known_location_entity_id: string | null
          lifestyle_exposure_level: string | null
          notes: string | null
          person_entity_id: string | null
          prior_missing_episodes: number | null
          regular_locations: string[] | null
          restraining_orders: boolean | null
          transience_level: string | null
          transportation_mode: string | null
          updated_at: string | null
        }
        Insert: {
          age_range_max?: number | null
          age_range_min?: number | null
          case_id: string
          created_at?: string | null
          created_by?: string | null
          employment_status?: string | null
          gender?: string | null
          id?: string
          known_threats?: string | null
          last_confirmed_contact_notes?: string | null
          last_confirmed_contact_type?: string | null
          last_known_date?: string | null
          last_known_location_entity_id?: string | null
          lifestyle_exposure_level?: string | null
          notes?: string | null
          person_entity_id?: string | null
          prior_missing_episodes?: number | null
          regular_locations?: string[] | null
          restraining_orders?: boolean | null
          transience_level?: string | null
          transportation_mode?: string | null
          updated_at?: string | null
        }
        Update: {
          age_range_max?: number | null
          age_range_min?: number | null
          case_id?: string
          created_at?: string | null
          created_by?: string | null
          employment_status?: string | null
          gender?: string | null
          id?: string
          known_threats?: string | null
          last_confirmed_contact_notes?: string | null
          last_confirmed_contact_type?: string | null
          last_known_date?: string | null
          last_known_location_entity_id?: string | null
          lifestyle_exposure_level?: string | null
          notes?: string | null
          person_entity_id?: string | null
          prior_missing_episodes?: number | null
          regular_locations?: string[] | null
          restraining_orders?: boolean | null
          transience_level?: string | null
          transportation_mode?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "victim_profiles_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "victim_profiles_last_known_location_entity_id_fkey"
            columns: ["last_known_location_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "victim_profiles_person_entity_id_fkey"
            columns: ["person_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      cases_needing_attention: {
        Row: {
          age_text: string | null
          ai_next_steps: string[] | null
          city: string | null
          date_found: string | null
          date_missing: string | null
          external_url: string | null
          import_record_id: string | null
          person_name: string | null
          record_type: string | null
          sex: string | null
          solvability_grade: string | null
          solvability_score: number | null
          solvability_summary: string | null
          source_name: string | null
          state: string | null
          watcher_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_case_role: {
        Args: { p_case_id: string; p_user_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      compute_link_score: {
        Args: {
          p_claim_a_id: string
          p_claim_b_id: string
          p_radius_miles?: number
        }
        Returns: {
          distance_miles: number
          grade: string
          score: number
          signals: Json
        }[]
      }
      compute_submission_priority: {
        Args: { p_submission_id: string }
        Returns: {
          level: string
          score: number
        }[]
      }
      get_user_case_role: {
        Args: { p_case_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      has_case_role: {
        Args: {
          p_case_id: string
          roles: Database["public"]["Enums"]["user_role"][]
        }
        Returns: boolean
      }
      is_reviewer_or_above: { Args: { p_case_id: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      audit_action:
        | "created"
        | "edited"
        | "approved"
        | "disputed"
        | "retracted"
        | "merged"
        | "split"
        | "flagged"
        | "escalated"
        | "exported"
        | "viewed"
        | "hypothesis_generated"
        | "research_started"
        | "research_completed"
      audit_target_type: "submission" | "claim" | "entity" | "event" | "case"
      case_status: "active" | "inactive" | "closed" | "archived"
      case_type:
        | "missing_person"
        | "unidentified_remains"
        | "homicide"
        | "assault"
        | "trafficking"
        | "other"
      claim_type:
        | "sighting"
        | "identifier"
        | "association"
        | "statement"
        | "interpretation"
        | "official"
        | "behavioral"
        | "physical_description"
        | "forensic_countermeasure"
        | "scene_staging"
        | "disposal_method"
      confidence_level: "low" | "medium" | "high"
      date_precision: "exact" | "approximate" | "unknown"
      entity_role:
        | "subject"
        | "vehicle_seen"
        | "associate_mentioned"
        | "location_reference"
        | "identifier_fragment"
        | "witness"
        | "victim"
        | "unknown"
      entity_type:
        | "person"
        | "location"
        | "vehicle"
        | "phone"
        | "username"
        | "organization"
        | "document"
        | "other"
      event_status: "unverified" | "under_review" | "confirmed" | "disputed"
      export_format: "pdf" | "json" | "csv"
      export_scope: "full" | "filtered" | "summary"
      identifier_source:
        | "seen_directly"
        | "heard_stated"
        | "found_in_document"
        | "recalled_from_memory"
        | "inferred"
        | "unknown"
      normalization_status:
        | "raw"
        | "normalized"
        | "merged"
        | "flagged_ambiguous"
      observation_mode:
        | "observed_directly"
        | "heard_directly"
        | "reported_by_another"
        | "inferred_from_document"
        | "system_generated"
      recipient_type:
        | "law_enforcement"
        | "legal"
        | "journalist"
        | "family"
        | "other"
      review_status:
        | "unverified"
        | "under_review"
        | "corroborated"
        | "confirmed"
        | "disputed"
        | "retracted"
      source_type:
        | "named_individual"
        | "anonymous"
        | "organization"
        | "official_record"
        | "media"
        | "system"
      submitter_consent: "anonymous" | "confidential" | "on_record"
      user_role:
        | "contributor"
        | "reviewer"
        | "lead_investigator"
        | "legal"
        | "export_only"
        | "admin"
      visibility_level:
        | "private"
        | "team"
        | "partner_orgs"
        | "law_enforcement"
        | "public"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      audit_action: [
        "created",
        "edited",
        "approved",
        "disputed",
        "retracted",
        "merged",
        "split",
        "flagged",
        "escalated",
        "exported",
        "viewed",
        "hypothesis_generated",
        "research_started",
        "research_completed",
      ],
      audit_target_type: ["submission", "claim", "entity", "event", "case"],
      case_status: ["active", "inactive", "closed", "archived"],
      case_type: [
        "missing_person",
        "unidentified_remains",
        "homicide",
        "assault",
        "trafficking",
        "other",
      ],
      claim_type: [
        "sighting",
        "identifier",
        "association",
        "statement",
        "interpretation",
        "official",
        "behavioral",
        "physical_description",
        "forensic_countermeasure",
        "scene_staging",
        "disposal_method",
      ],
      confidence_level: ["low", "medium", "high"],
      date_precision: ["exact", "approximate", "unknown"],
      entity_role: [
        "subject",
        "vehicle_seen",
        "associate_mentioned",
        "location_reference",
        "identifier_fragment",
        "witness",
        "victim",
        "unknown",
      ],
      entity_type: [
        "person",
        "location",
        "vehicle",
        "phone",
        "username",
        "organization",
        "document",
        "other",
      ],
      event_status: ["unverified", "under_review", "confirmed", "disputed"],
      export_format: ["pdf", "json", "csv"],
      export_scope: ["full", "filtered", "summary"],
      identifier_source: [
        "seen_directly",
        "heard_stated",
        "found_in_document",
        "recalled_from_memory",
        "inferred",
        "unknown",
      ],
      normalization_status: [
        "raw",
        "normalized",
        "merged",
        "flagged_ambiguous",
      ],
      observation_mode: [
        "observed_directly",
        "heard_directly",
        "reported_by_another",
        "inferred_from_document",
        "system_generated",
      ],
      recipient_type: [
        "law_enforcement",
        "legal",
        "journalist",
        "family",
        "other",
      ],
      review_status: [
        "unverified",
        "under_review",
        "corroborated",
        "confirmed",
        "disputed",
        "retracted",
      ],
      source_type: [
        "named_individual",
        "anonymous",
        "organization",
        "official_record",
        "media",
        "system",
      ],
      submitter_consent: ["anonymous", "confidential", "on_record"],
      user_role: [
        "contributor",
        "reviewer",
        "lead_investigator",
        "legal",
        "export_only",
        "admin",
      ],
      visibility_level: [
        "private",
        "team",
        "partner_orgs",
        "law_enforcement",
        "public",
      ],
    },
  },
} as const
