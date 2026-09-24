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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      analyte_synonyms: {
        Row: {
          canonical_analyte_id: string
          created_at: string | null
          id: string
          source_type: string
          synonym_text: string
        }
        Insert: {
          canonical_analyte_id: string
          created_at?: string | null
          id?: string
          source_type?: string
          synonym_text: string
        }
        Update: {
          canonical_analyte_id?: string
          created_at?: string | null
          id?: string
          source_type?: string
          synonym_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyte_synonyms_canonical_analyte_id_fkey"
            columns: ["canonical_analyte_id"]
            isOneToOne: false
            referencedRelation: "canonical_analytes"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      biomarker_catalog: {
        Row: {
          category: string
          created_at: string
          id: string
          is_cycle_dependent: boolean
          is_fasting_sensitive: boolean
          name: string
          sex_applicability: string
          slug: string
          subcategory: string
          unit: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          is_cycle_dependent?: boolean
          is_fasting_sensitive?: boolean
          name: string
          sex_applicability?: string
          slug: string
          subcategory?: string
          unit?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_cycle_dependent?: boolean
          is_fasting_sensitive?: boolean
          name?: string
          sex_applicability?: string
          slug?: string
          subcategory?: string
          unit?: string
        }
        Relationships: []
      }
      biomarker_definitions: {
        Row: {
          category: string
          clinical_max: number | null
          clinical_min: number | null
          cycle_dependent: boolean
          description: string
          display_name: string
          id: string
          name: string
          optimal_max: number | null
          optimal_min: number | null
          score_weight: number
          sex_specific: boolean
          short_name: string
          sort_order: number
          unit: string
          what_it_measures: string
        }
        Insert: {
          category: string
          clinical_max?: number | null
          clinical_min?: number | null
          cycle_dependent?: boolean
          description?: string
          display_name: string
          id?: string
          name: string
          optimal_max?: number | null
          optimal_min?: number | null
          score_weight?: number
          sex_specific?: boolean
          short_name?: string
          sort_order?: number
          unit: string
          what_it_measures?: string
        }
        Update: {
          category?: string
          clinical_max?: number | null
          clinical_min?: number | null
          cycle_dependent?: boolean
          description?: string
          display_name?: string
          id?: string
          name?: string
          optimal_max?: number | null
          optimal_min?: number | null
          score_weight?: number
          sex_specific?: boolean
          short_name?: string
          sort_order?: number
          unit?: string
          what_it_measures?: string
        }
        Relationships: []
      }
      biomarker_panels: {
        Row: {
          biomarker_names: string[]
          description: string
          display_name: string
          id: string
          name: string
        }
        Insert: {
          biomarker_names?: string[]
          description?: string
          display_name: string
          id?: string
          name: string
        }
        Update: {
          biomarker_names?: string[]
          description?: string
          display_name?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      biomarker_phase_ranges: {
        Row: {
          biomarker_name: string
          clinical_max: number | null
          clinical_min: number | null
          id: string
          notes: string | null
          optimal_max: number | null
          optimal_min: number | null
          phase: string
        }
        Insert: {
          biomarker_name: string
          clinical_max?: number | null
          clinical_min?: number | null
          id?: string
          notes?: string | null
          optimal_max?: number | null
          optimal_min?: number | null
          phase: string
        }
        Update: {
          biomarker_name?: string
          clinical_max?: number | null
          clinical_min?: number | null
          id?: string
          notes?: string | null
          optimal_max?: number | null
          optimal_min?: number | null
          phase?: string
        }
        Relationships: []
      }
      biomarker_reference_ranges: {
        Row: {
          biomarker_name: string
          clinical_max: number | null
          clinical_min: number | null
          id: string
          notes: string | null
          optimal_max: number | null
          optimal_min: number | null
          phase: string
        }
        Insert: {
          biomarker_name: string
          clinical_max?: number | null
          clinical_min?: number | null
          id?: string
          notes?: string | null
          optimal_max?: number | null
          optimal_min?: number | null
          phase: string
        }
        Update: {
          biomarker_name?: string
          clinical_max?: number | null
          clinical_min?: number | null
          id?: string
          notes?: string | null
          optimal_max?: number | null
          optimal_min?: number | null
          phase?: string
        }
        Relationships: [
          {
            foreignKeyName: "biomarker_reference_ranges_biomarker_name_fkey"
            columns: ["biomarker_name"]
            isOneToOne: false
            referencedRelation: "biomarker_definitions"
            referencedColumns: ["name"]
          },
        ]
      }
      biomarkers: {
        Row: {
          flagged: string
          id: string
          lab_report_id: string
          name: string
          raw_value_text: string | null
          reference_max: number | null
          reference_min: number | null
          unit: string
          value: number
        }
        Insert: {
          flagged?: string
          id?: string
          lab_report_id: string
          name: string
          raw_value_text?: string | null
          reference_max?: number | null
          reference_min?: number | null
          unit: string
          value: number
        }
        Update: {
          flagged?: string
          id?: string
          lab_report_id?: string
          name?: string
          raw_value_text?: string | null
          reference_max?: number | null
          reference_min?: number | null
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "biomarkers_lab_report_id_fkey"
            columns: ["lab_report_id"]
            isOneToOne: false
            referencedRelation: "lab_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      canonical_analytes: {
        Row: {
          affects_recommendations: boolean
          affects_scoring: boolean
          category: string
          created_at: string | null
          display_name: string
          id: string
          is_core: boolean
          is_ratio: boolean
          slug: string
          subcategory: string | null
          unit: string | null
        }
        Insert: {
          affects_recommendations?: boolean
          affects_scoring?: boolean
          category: string
          created_at?: string | null
          display_name: string
          id?: string
          is_core?: boolean
          is_ratio?: boolean
          slug: string
          subcategory?: string | null
          unit?: string | null
        }
        Update: {
          affects_recommendations?: boolean
          affects_scoring?: boolean
          category?: string
          created_at?: string | null
          display_name?: string
          id?: string
          is_core?: boolean
          is_ratio?: boolean
          slug?: string
          subcategory?: string | null
          unit?: string | null
        }
        Relationships: []
      }
      cycle_events: {
        Row: {
          created_at: string
          event_date: string
          event_type: string
          id: string
          metadata: Json | null
          notes: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_date: string
          event_type: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_date?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          user_id?: string
        }
        Relationships: []
      }
      derived_metric_definitions: {
        Row: {
          display_name: string
          formula_note: string | null
          id: string
          inputs_required: string[]
          name: string
          optimal_max: number | null
          optimal_min: number | null
          unit: string
        }
        Insert: {
          display_name: string
          formula_note?: string | null
          id?: string
          inputs_required?: string[]
          name: string
          optimal_max?: number | null
          optimal_min?: number | null
          unit?: string
        }
        Update: {
          display_name?: string
          formula_note?: string | null
          id?: string
          inputs_required?: string[]
          name?: string
          optimal_max?: number | null
          optimal_min?: number | null
          unit?: string
        }
        Relationships: []
      }
      derived_metric_defs: {
        Row: {
          description: string
          display_name: string
          formula: string
          id: string
          name: string
          optimal_max: number | null
          optimal_min: number | null
          required_biomarkers: string[]
          unit: string
        }
        Insert: {
          description?: string
          display_name: string
          formula: string
          id?: string
          name: string
          optimal_max?: number | null
          optimal_min?: number | null
          required_biomarkers?: string[]
          unit?: string
        }
        Update: {
          description?: string
          display_name?: string
          formula?: string
          id?: string
          name?: string
          optimal_max?: number | null
          optimal_min?: number | null
          required_biomarkers?: string[]
          unit?: string
        }
        Relationships: []
      }
      derived_metric_results: {
        Row: {
          created_at: string
          id: string
          interpretation: string
          lab_report_id: string
          metric_name: string
          status: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          interpretation?: string
          lab_report_id: string
          metric_name: string
          status?: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          interpretation?: string
          lab_report_id?: string
          metric_name?: string
          status?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "derived_metric_results_lab_report_id_fkey"
            columns: ["lab_report_id"]
            isOneToOne: false
            referencedRelation: "lab_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derived_metric_results_metric_name_fkey"
            columns: ["metric_name"]
            isOneToOne: false
            referencedRelation: "derived_metric_definitions"
            referencedColumns: ["name"]
          },
        ]
      }
      health_scores: {
        Row: {
          cardiovascular_score: number
          created_at: string
          hormone_score: number
          id: string
          inflammation_score: number
          kidney_score: number
          lab_report_id: string
          liver_score: number
          metabolic_score: number
          nutrient_score: number
          overall_score: number
          score_breakdown: Json
          thyroid_score: number
        }
        Insert: {
          cardiovascular_score?: number
          created_at?: string
          hormone_score?: number
          id?: string
          inflammation_score?: number
          kidney_score?: number
          lab_report_id: string
          liver_score?: number
          metabolic_score?: number
          nutrient_score?: number
          overall_score?: number
          score_breakdown?: Json
          thyroid_score?: number
        }
        Update: {
          cardiovascular_score?: number
          created_at?: string
          hormone_score?: number
          id?: string
          inflammation_score?: number
          kidney_score?: number
          lab_report_id?: string
          liver_score?: number
          metabolic_score?: number
          nutrient_score?: number
          overall_score?: number
          score_breakdown?: Json
          thyroid_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "health_scores_lab_report_id_fkey"
            columns: ["lab_report_id"]
            isOneToOne: true
            referencedRelation: "lab_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_rule_defs: {
        Row: {
          category: string
          description_template: string
          display_name: string
          id: string
          recommendation: string
          required_biomarkers: string[]
          rule_id: string
          severity: string
        }
        Insert: {
          category: string
          description_template?: string
          display_name: string
          id?: string
          recommendation?: string
          required_biomarkers?: string[]
          rule_id: string
          severity: string
        }
        Update: {
          category?: string
          description_template?: string
          display_name?: string
          id?: string
          recommendation?: string
          required_biomarkers?: string[]
          rule_id?: string
          severity?: string
        }
        Relationships: []
      }
      insight_rule_results: {
        Row: {
          biomarkers_involved: string[]
          created_at: string
          description: string
          id: string
          lab_report_id: string
          rule_id: string
          severity: string
          title: string
        }
        Insert: {
          biomarkers_involved?: string[]
          created_at?: string
          description: string
          id?: string
          lab_report_id: string
          rule_id: string
          severity: string
          title: string
        }
        Update: {
          biomarkers_involved?: string[]
          created_at?: string
          description?: string
          id?: string
          lab_report_id?: string
          rule_id?: string
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_rule_results_lab_report_id_fkey"
            columns: ["lab_report_id"]
            isOneToOne: false
            referencedRelation: "lab_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_rule_results_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "insight_rules"
            referencedColumns: ["rule_id"]
          },
        ]
      }
      insight_rules: {
        Row: {
          active: boolean
          biomarkers_involved: string[]
          category: string
          description_template: string
          id: string
          rule_id: string
          severity: string
          title: string
        }
        Insert: {
          active?: boolean
          biomarkers_involved?: string[]
          category: string
          description_template: string
          id?: string
          rule_id: string
          severity: string
          title: string
        }
        Update: {
          active?: boolean
          biomarkers_involved?: string[]
          category?: string
          description_template?: string
          id?: string
          rule_id?: string
          severity?: string
          title?: string
        }
        Relationships: []
      }
      interpretations: {
        Row: {
          disclaimer_version: string
          generated_at: string
          id: string
          interpretation_source: string | null
          json_output: Json
          lab_report_id: string
        }
        Insert: {
          disclaimer_version?: string
          generated_at?: string
          id?: string
          interpretation_source?: string | null
          json_output: Json
          lab_report_id: string
        }
        Update: {
          disclaimer_version?: string
          generated_at?: string
          id?: string
          interpretation_source?: string | null
          json_output?: Json
          lab_report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interpretations_lab_report_id_fkey"
            columns: ["lab_report_id"]
            isOneToOne: true
            referencedRelation: "lab_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      interventions: {
        Row: {
          category: string
          created_at: string
          end_date: string | null
          id: string
          notes: string | null
          start_date: string
          title: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          start_date: string
          title: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          start_date?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      lab_panels: {
        Row: {
          biomarkers: string[]
          description: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          biomarkers?: string[]
          description?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          biomarkers?: string[]
          description?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      interpretation_generation_costs: {
        Row: {
          id: string
          user_id: string
          report_id: string | null
          interpretation_tier: string
          plan_at_request: string
          claim_consumed: boolean
          model: string
          prompt_tokens: number | null
          completion_tokens: number | null
          total_tokens: number | null
          deep: boolean
          duration_ms: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          report_id?: string | null
          interpretation_tier: string
          plan_at_request: string
          claim_consumed: boolean
          model: string
          prompt_tokens?: number | null
          completion_tokens?: number | null
          total_tokens?: number | null
          deep: boolean
          duration_ms: number
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          report_id?: string | null
          interpretation_tier?: string
          plan_at_request?: string
          claim_consumed?: boolean
          model?: string
          prompt_tokens?: number | null
          completion_tokens?: number | null
          total_tokens?: number | null
          deep?: boolean
          duration_ms?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interpretation_generation_costs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interpretation_generation_costs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "lab_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_reports: {
        Row: {
          average_cycle_length: number | null
          context: Json
          estimated_cycle_day: number | null
          estimated_cycle_phase: string
          file_url: string | null
          content_hash: string | null
          id: string
          import_method: string | null
          lab_name: string | null
          lab_source: string | null
          last_period_start_date: string | null
          regeneration_count: number
          report_date: string
          status: string
          upload_date: string
          user_id: string
        }
        Insert: {
          average_cycle_length?: number | null
          context?: Json
          estimated_cycle_day?: number | null
          estimated_cycle_phase?: string
          file_url?: string | null
          content_hash?: string | null
          id?: string
          import_method?: string | null
          lab_name?: string | null
          lab_source?: string | null
          last_period_start_date?: string | null
          regeneration_count?: number
          report_date: string
          status?: string
          upload_date?: string
          user_id: string
        }
        Update: {
          average_cycle_length?: number | null
          context?: Json
          estimated_cycle_day?: number | null
          estimated_cycle_phase?: string
          file_url?: string | null
          content_hash?: string | null
          id?: string
          import_method?: string | null
          lab_name?: string | null
          lab_source?: string | null
          last_period_start_date?: string | null
          regeneration_count?: number
          report_date?: string
          status?: string
          upload_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_results: {
        Row: {
          amani_status: string
          biomarker_name: string
          canonical_biomarker_name: string | null
          created_at: string
          cycle_phase: string | null
          extraction_confidence: string | null
          id: string
          lab_ref_max: number | null
          lab_ref_min: number | null
          lab_report_id: string
          lab_status: string
          normalization_status: string | null
          parser_version: string | null
          raw_biomarker_name: string | null
          review_status: string | null
          reviewed_by_user: boolean | null
          source_format: string | null
          source_snippet: string | null
          unit: string
          unit_normalized: string | null
          unit_original: string | null
          value: number
        }
        Insert: {
          amani_status?: string
          biomarker_name: string
          canonical_biomarker_name?: string | null
          created_at?: string
          cycle_phase?: string | null
          extraction_confidence?: string | null
          id?: string
          lab_ref_max?: number | null
          lab_ref_min?: number | null
          lab_report_id: string
          lab_status?: string
          normalization_status?: string | null
          parser_version?: string | null
          raw_biomarker_name?: string | null
          review_status?: string | null
          reviewed_by_user?: boolean | null
          source_format?: string | null
          source_snippet?: string | null
          unit: string
          unit_normalized?: string | null
          unit_original?: string | null
          value: number
        }
        Update: {
          amani_status?: string
          biomarker_name?: string
          canonical_biomarker_name?: string | null
          created_at?: string
          cycle_phase?: string | null
          extraction_confidence?: string | null
          id?: string
          lab_ref_max?: number | null
          lab_ref_min?: number | null
          lab_report_id?: string
          lab_status?: string
          normalization_status?: string | null
          parser_version?: string | null
          raw_biomarker_name?: string | null
          review_status?: string | null
          reviewed_by_user?: boolean | null
          source_format?: string | null
          source_snippet?: string | null
          unit?: string
          unit_normalized?: string | null
          unit_original?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "lab_results_biomarker_name_fkey"
            columns: ["biomarker_name"]
            isOneToOne: false
            referencedRelation: "biomarker_definitions"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "lab_results_lab_report_id_fkey"
            columns: ["lab_report_id"]
            isOneToOne: false
            referencedRelation: "lab_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string | null
          fertile_reminders: boolean
          id: string
          intervention_reminders: boolean
          lab_reminders: boolean
          ovulation_reminders: boolean
          period_reminders: boolean
          reminder_time: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          fertile_reminders?: boolean
          id?: string
          intervention_reminders?: boolean
          lab_reminders?: boolean
          ovulation_reminders?: boolean
          period_reminders?: boolean
          reminder_time?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          fertile_reminders?: boolean
          id?: string
          intervention_reminders?: boolean
          lab_reminders?: boolean
          ovulation_reminders?: boolean
          period_reminders?: boolean
          reminder_time?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      parser_debug: {
        Row: {
          ai_input_json: Json | null
          analyte_blocks_json: Json | null
          created_at: string | null
          file_name: string | null
          id: string
          mapping_debug_json: Json | null
          page_count: number | null
          parsed_candidates_json: Json | null
          raw_text: string | null
          report_id: string | null
          user_id: string
        }
        Insert: {
          ai_input_json?: Json | null
          analyte_blocks_json?: Json | null
          created_at?: string | null
          file_name?: string | null
          id?: string
          mapping_debug_json?: Json | null
          page_count?: number | null
          parsed_candidates_json?: Json | null
          raw_text?: string | null
          report_id?: string | null
          user_id: string
        }
        Update: {
          ai_input_json?: Json | null
          analyte_blocks_json?: Json | null
          created_at?: string | null
          file_name?: string | null
          id?: string
          mapping_debug_json?: Json | null
          page_count?: number | null
          parsed_candidates_json?: Json | null
          raw_text?: string | null
          report_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parser_debug_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "lab_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      period_logs: {
        Row: {
          created_at: string | null
          end_date: string | null
          flow_intensity: string | null
          id: string
          notes: string | null
          start_date: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          end_date?: string | null
          flow_intensity?: string | null
          id?: string
          notes?: string | null
          start_date: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          end_date?: string | null
          flow_intensity?: string | null
          id?: string
          notes?: string | null
          start_date?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      processed_stripe_events: {
        Row: {
          event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          processed_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          endpoint: string
          id: string
          user_id: string
          window_start: string
        }
        Insert: {
          count?: number
          endpoint: string
          id?: string
          user_id: string
          window_start: string
        }
        Update: {
          count?: number
          endpoint?: string
          id?: string
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          created_at: string | null
          delivered: boolean
          id: string
          metadata: Json | null
          read: boolean
          reminder_type: string
          scheduled_for: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          delivered?: boolean
          id?: string
          metadata?: Json | null
          read?: boolean
          reminder_type: string
          scheduled_for: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          delivered?: boolean
          id?: string
          metadata?: Json | null
          read?: boolean
          reminder_type?: string
          scheduled_for?: string
          user_id?: string
        }
        Relationships: []
      }
      report_analytes: {
        Row: {
          canonical_analyte_id: string | null
          canonical_slug: string | null
          confidence_score: string
          created_at: string | null
          display_name: string | null
          id: string
          is_core: boolean
          lab_report_id: string
          needs_review: boolean
          normalization_status: string
          normalized_max: number | null
          normalized_min: number | null
          normalized_operator: string | null
          normalized_operator_value: number | null
          parse_status: string
          parser_version: string | null
          raw_name: string
          raw_reference_range: string | null
          raw_value_text: string | null
          review_status: string
          reviewed_by_user: boolean
          source_format: string
          source_snippet: string | null
          system_category: string | null
          unit: string | null
          unit_normalized: string | null
          unit_original: string | null
          value_numeric: number | null
        }
        Insert: {
          canonical_analyte_id?: string | null
          canonical_slug?: string | null
          confidence_score?: string
          created_at?: string | null
          display_name?: string | null
          id?: string
          is_core?: boolean
          lab_report_id: string
          needs_review?: boolean
          normalization_status?: string
          normalized_max?: number | null
          normalized_min?: number | null
          normalized_operator?: string | null
          normalized_operator_value?: number | null
          parse_status?: string
          parser_version?: string | null
          raw_name: string
          raw_reference_range?: string | null
          raw_value_text?: string | null
          review_status?: string
          reviewed_by_user?: boolean
          source_format?: string
          source_snippet?: string | null
          system_category?: string | null
          unit?: string | null
          unit_normalized?: string | null
          unit_original?: string | null
          value_numeric?: number | null
        }
        Update: {
          canonical_analyte_id?: string | null
          canonical_slug?: string | null
          confidence_score?: string
          created_at?: string | null
          display_name?: string | null
          id?: string
          is_core?: boolean
          lab_report_id?: string
          needs_review?: boolean
          normalization_status?: string
          normalized_max?: number | null
          normalized_min?: number | null
          normalized_operator?: string | null
          normalized_operator_value?: number | null
          parse_status?: string
          parser_version?: string | null
          raw_name?: string
          raw_reference_range?: string | null
          raw_value_text?: string | null
          review_status?: string
          reviewed_by_user?: boolean
          source_format?: string
          source_snippet?: string | null
          system_category?: string | null
          unit?: string | null
          unit_normalized?: string | null
          unit_original?: string | null
          value_numeric?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "report_analytes_canonical_analyte_id_fkey"
            columns: ["canonical_analyte_id"]
            isOneToOne: false
            referencedRelation: "canonical_analytes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_analytes_lab_report_id_fkey"
            columns: ["lab_report_id"]
            isOneToOne: false
            referencedRelation: "lab_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_items: {
        Row: {
          canonical_slug: string | null
          category: string | null
          confidence_score: string | null
          created_at: string | null
          id: string
          is_core_biomarker: boolean | null
          lab_report_id: string
          needs_review: boolean | null
          normalized_reference_max: number | null
          normalized_reference_min: number | null
          raw_name: string
          raw_reference_range: string | null
          reference_operator: string | null
          reference_operator_value: number | null
          source_snippet: string | null
          status: string | null
          unit: string | null
          value_numeric: number
          value_text: string | null
        }
        Insert: {
          canonical_slug?: string | null
          category?: string | null
          confidence_score?: string | null
          created_at?: string | null
          id?: string
          is_core_biomarker?: boolean | null
          lab_report_id: string
          needs_review?: boolean | null
          normalized_reference_max?: number | null
          normalized_reference_min?: number | null
          raw_name: string
          raw_reference_range?: string | null
          reference_operator?: string | null
          reference_operator_value?: number | null
          source_snippet?: string | null
          status?: string | null
          unit?: string | null
          value_numeric: number
          value_text?: string | null
        }
        Update: {
          canonical_slug?: string | null
          category?: string | null
          confidence_score?: string | null
          created_at?: string | null
          id?: string
          is_core_biomarker?: boolean | null
          lab_report_id?: string
          needs_review?: boolean | null
          normalized_reference_max?: number | null
          normalized_reference_min?: number | null
          raw_name?: string
          raw_reference_range?: string | null
          reference_operator?: string | null
          reference_operator_value?: number | null
          source_snippet?: string | null
          status?: string | null
          unit?: string | null
          value_numeric?: number
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_items_lab_report_id_fkey"
            columns: ["lab_report_id"]
            isOneToOne: false
            referencedRelation: "lab_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_customers: {
        Row: {
          created_at: string | null
          customer_id: string
          deleted_at: string | null
          id: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          customer_id: string
          deleted_at?: string | null
          id?: never
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          customer_id?: string
          deleted_at?: string | null
          id?: never
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      stripe_orders: {
        Row: {
          amount_subtotal: number
          amount_total: number
          checkout_session_id: string
          created_at: string | null
          currency: string
          customer_id: string
          deleted_at: string | null
          id: number
          payment_intent_id: string
          payment_status: string
          status: Database["public"]["Enums"]["stripe_order_status"]
          updated_at: string | null
        }
        Insert: {
          amount_subtotal: number
          amount_total: number
          checkout_session_id: string
          created_at?: string | null
          currency: string
          customer_id: string
          deleted_at?: string | null
          id?: never
          payment_intent_id: string
          payment_status: string
          status?: Database["public"]["Enums"]["stripe_order_status"]
          updated_at?: string | null
        }
        Update: {
          amount_subtotal?: number
          amount_total?: number
          checkout_session_id?: string
          created_at?: string | null
          currency?: string
          customer_id?: string
          deleted_at?: string | null
          id?: never
          payment_intent_id?: string
          payment_status?: string
          status?: Database["public"]["Enums"]["stripe_order_status"]
          updated_at?: string | null
        }
        Relationships: []
      }
      stripe_subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: number | null
          current_period_start: number | null
          customer_id: string
          deleted_at: string | null
          id: number
          payment_method_brand: string | null
          payment_method_last4: string | null
          price_id: string | null
          status: Database["public"]["Enums"]["stripe_subscription_status"]
          subscription_id: string | null
          updated_at: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: number | null
          current_period_start?: number | null
          customer_id: string
          deleted_at?: string | null
          id?: never
          payment_method_brand?: string | null
          payment_method_last4?: string | null
          price_id?: string | null
          status: Database["public"]["Enums"]["stripe_subscription_status"]
          subscription_id?: string | null
          updated_at?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: number | null
          current_period_start?: number | null
          customer_id?: string
          deleted_at?: string | null
          id?: never
          payment_method_brand?: string | null
          payment_method_last4?: string | null
          price_id?: string | null
          status?: Database["public"]["Enums"]["stripe_subscription_status"]
          subscription_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      symptom_logs: {
        Row: {
          created_at: string | null
          id: string
          log_date: string
          notes: string | null
          symptoms: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          log_date: string
          notes?: string | null
          symptoms?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          log_date?: string
          notes?: string | null
          symptoms?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          age_range: string | null
          created_at: string
          default_cycle_length: number | null
          default_period_length: number | null
          email: string
          goal: string
          has_consented: boolean
          id: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string
          trial_start_date: string
        }
        Insert: {
          age_range?: string | null
          created_at?: string
          default_cycle_length?: number | null
          default_period_length?: number | null
          email: string
          goal?: string
          has_consented?: boolean
          id: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          trial_start_date?: string
        }
        Update: {
          age_range?: string | null
          created_at?: string
          default_cycle_length?: number | null
          default_period_length?: number | null
          email?: string
          goal?: string
          has_consented?: boolean
          id?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          trial_start_date?: string
        }
        Relationships: []
      }
    }
    Views: {
      stripe_user_orders: {
        Row: {
          amount_subtotal: number | null
          amount_total: number | null
          checkout_session_id: string | null
          currency: string | null
          customer_id: string | null
          order_date: string | null
          order_id: number | null
          order_status:
            | Database["public"]["Enums"]["stripe_order_status"]
            | null
          payment_intent_id: string | null
          payment_status: string | null
        }
        Relationships: []
      }
      stripe_user_subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          current_period_end: number | null
          current_period_start: number | null
          customer_id: string | null
          payment_method_brand: string | null
          payment_method_last4: string | null
          price_id: string | null
          subscription_id: string | null
          subscription_status:
            | Database["public"]["Enums"]["stripe_subscription_status"]
            | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      stripe_order_status: "pending" | "completed" | "canceled"
      stripe_subscription_status:
        | "not_started"
        | "incomplete"
        | "incomplete_expired"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "unpaid"
        | "paused"
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
      stripe_order_status: ["pending", "completed", "canceled"],
      stripe_subscription_status: [
        "not_started",
        "incomplete",
        "incomplete_expired",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "paused",
      ],
    },
  },
} as const
