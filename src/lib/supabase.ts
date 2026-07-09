import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://eyfvqdnczorscwveaadv.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5ZnZxZG5jem9yc2N3dmVhYWR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0NTEwMjksImV4cCI6MjA4NDAyNzAyOX0.4sEp3Z2D3BNSPjaX57HhEUr_yRTX8BUHayjZkY8X4CI'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})

export type Database = {
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
          onboarding_completed: boolean
          onboarding_skipped: boolean
          health_goals: string[]
          symptoms: string[]
          sex_at_birth: string | null
          pregnancy_status: string | null
          supplements: string[]
          known_conditions: string[]
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
          onboarding_completed?: boolean
          onboarding_skipped?: boolean
          health_goals?: string[]
          symptoms?: string[]
          sex_at_birth?: string | null
          pregnancy_status?: string | null
          supplements?: string[]
          known_conditions?: string[]
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
          onboarding_completed?: boolean
          onboarding_skipped?: boolean
          health_goals?: string[]
          symptoms?: string[]
          sex_at_birth?: string | null
          pregnancy_status?: string | null
          supplements?: string[]
          known_conditions?: string[]
        }
      }
      stripe_user_subscriptions: {
        Row: {
          customer_id: string | null
          subscription_id: string | null
          subscription_status: string | null
          price_id: string | null
          current_period_start: number | null
          current_period_end: number | null
          cancel_at_period_end: boolean | null
          payment_method_brand: string | null
          payment_method_last4: string | null
        }
      }
    }
    Views: {
      stripe_user_subscriptions: {
        Row: {
          customer_id: string | null
          subscription_id: string | null
          subscription_status: string | null
          price_id: string | null
          current_period_start: number | null
          current_period_end: number | null
          cancel_at_period_end: boolean | null
          payment_method_brand: string | null
          payment_method_last4: string | null
        }
      }
    }
  }
}