export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string | null
          created_at: string
          age_range: string | null
          goal: string
          has_consented: boolean
          subscription_status: string
          trial_start_date: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          default_cycle_length: number | null
          default_period_length: number | null
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          created_at?: string
          age_range?: string | null
          goal?: string
          has_consented?: boolean
          subscription_status?: string
          trial_start_date?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          default_cycle_length?: number | null
          default_period_length?: number | null
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          created_at?: string
          age_range?: string | null
          goal?: string
          has_consented?: boolean
          subscription_status?: string
          trial_start_date?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          default_cycle_length?: number | null
          default_period_length?: number | null
        }
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
      }
      lab_reports: {
        Row: {
          id: string
          user_id: string
          report_date: string
          upload_date: string
          file_url: string | null
          content_hash: string | null
          lab_name: string | null
          last_period_start_date: string | null
          average_cycle_length: number | null
          estimated_cycle_day: number | null
          estimated_cycle_phase: string
          context: Json
          status: string
          regeneration_count: number
        }
        Insert: {
          id?: string
          user_id: string
          report_date: string
          upload_date?: string
          file_url?: string | null
          content_hash?: string | null
          lab_name?: string | null
          last_period_start_date?: string | null
          average_cycle_length?: number | null
          estimated_cycle_day?: number | null
          estimated_cycle_phase?: string
          context?: Json
          status?: string
          regeneration_count?: number
        }
        Update: {
          id?: string
          user_id?: string
          report_date?: string
          upload_date?: string
          file_url?: string | null
          content_hash?: string | null
          lab_name?: string | null
          last_period_start_date?: string | null
          average_cycle_length?: number | null
          estimated_cycle_day?: number | null
          estimated_cycle_phase?: string
          context?: Json
          status?: string
          regeneration_count?: number
        }
      }
      biomarkers: {
        Row: {
          id: string
          lab_report_id: string
          name: string
          value: number
          unit: string
          reference_min: number | null
          reference_max: number | null
          flagged: string
        }
        Insert: {
          id?: string
          lab_report_id: string
          name: string
          value: number
          unit: string
          reference_min?: number | null
          reference_max?: number | null
          flagged?: string
        }
        Update: {
          id?: string
          lab_report_id?: string
          name?: string
          value?: number
          unit?: string
          reference_min?: number | null
          reference_max?: number | null
          flagged?: string
        }
      }
      interpretations: {
        Row: {
          id: string
          lab_report_id: string
          json_output: Json
          generated_at: string
          disclaimer_version: string
        }
        Insert: {
          id?: string
          lab_report_id: string
          json_output: Json
          generated_at?: string
          disclaimer_version?: string
        }
        Update: {
          id?: string
          lab_report_id?: string
          json_output?: Json
          generated_at?: string
          disclaimer_version?: string
        }
      }
      cycle_events: {
        Row: {
          id: string
          user_id: string
          event_date: string
          event_type: string
          notes: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          event_date: string
          event_type: string
          notes?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          event_date?: string
          event_type?: string
          notes?: string | null
          metadata?: Json | null
          created_at?: string
        }
      }
      interventions: {
        Row: {
          id: string
          user_id: string
          title: string
          category: string
          start_date: string
          end_date: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          category?: string
          start_date: string
          end_date?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          category?: string
          start_date?: string
          end_date?: string | null
          notes?: string | null
          created_at?: string
        }
      }
      period_logs: {
        Row: {
          id: string
          user_id: string
          start_date: string
          end_date: string | null
          flow_intensity: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          start_date: string
          end_date?: string | null
          flow_intensity?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          start_date?: string
          end_date?: string | null
          flow_intensity?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      symptom_logs: {
        Row: {
          id: string
          user_id: string
          log_date: string
          symptoms: Json
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          log_date: string
          symptoms?: Json
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          log_date?: string
          symptoms?: Json
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      notification_preferences: {
        Row: {
          id: string
          user_id: string
          period_reminders: boolean
          fertile_reminders: boolean
          ovulation_reminders: boolean
          lab_reminders: boolean
          intervention_reminders: boolean
          reminder_time: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          period_reminders?: boolean
          fertile_reminders?: boolean
          ovulation_reminders?: boolean
          lab_reminders?: boolean
          intervention_reminders?: boolean
          reminder_time?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          period_reminders?: boolean
          fertile_reminders?: boolean
          ovulation_reminders?: boolean
          lab_reminders?: boolean
          intervention_reminders?: boolean
          reminder_time?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      reminders: {
        Row: {
          id: string
          user_id: string
          reminder_type: string
          scheduled_for: string
          delivered: boolean
          read: boolean
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          reminder_type: string
          scheduled_for: string
          delivered?: boolean
          read?: boolean
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          reminder_type?: string
          scheduled_for?: string
          delivered?: boolean
          read?: boolean
          metadata?: Json | null
          created_at?: string
        }
      }
    }
  }
}
