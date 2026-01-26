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
          created_at: string
          age_range: string | null
          goal: string
          has_consented: boolean
          subscription_status: string
          trial_start_date: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          default_cycle_length: number | null
          default_period_length: number | null
        }
        Insert: {
          id: string
          email: string
          created_at?: string
          age_range?: string | null
          goal?: string
          has_consented?: boolean
          subscription_status?: string
          trial_start_date?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          default_cycle_length?: number | null
          default_period_length?: number | null
        }
        Update: {
          id?: string
          email?: string
          created_at?: string
          age_range?: string | null
          goal?: string
          has_consented?: boolean
          subscription_status?: string
          trial_start_date?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          default_cycle_length?: number | null
          default_period_length?: number | null
        }
      }
      lab_reports: {
        Row: {
          id: string
          user_id: string
          report_date: string
          upload_date: string
          file_url: string | null
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
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          event_date: string
          event_type: string
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          event_date?: string
          event_type?: string
          notes?: string | null
          created_at?: string
        }
      }
    }
  }
}
