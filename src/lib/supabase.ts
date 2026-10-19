import { createClient } from '@supabase/supabase-js'
import { authSessionStorage } from './native'

/*
  No fallback to the production project. The anon key is public by design, so
  the old `?? '<prod url/key>'` literals were never a key leak — the danger was
  that they were silent. A renamed or missing env var on a Netlify preview
  branch would compile cleanly against PRODUCTION, and whoever was testing the
  preview would write real users' rows.

  Failing at import is the loud version of that. Every environment now has to
  declare where it points, including local dev: copy `.env.example` to `.env`.
*/
function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env for local dev, or set it in ` +
        `the Netlify site environment. Note that VITE_* values are baked in at ` +
        `build time, so changing one needs a rebuild, not just a redeploy.`
    )
  }
  return value
}

const supabaseUrl = requireEnv('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = requireEnv('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY)

const sessionStorage = authSessionStorage()

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Web and pre-1.0.7 native retain exactly the default auth options.
    ...(sessionStorage ? { storage: sessionStorage } : {})
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