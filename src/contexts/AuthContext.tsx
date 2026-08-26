import { createContext, useContext, useEffect, useState } from 'react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { publicOrigin, publicUrl } from '../lib/appUrl';
import type { User } from '../types';

export interface OnboardingAnswers {
  full_name: string | null;
  health_goals: string[];
  symptoms: string[];
  age_range: string | null;
  sex_at_birth: string | null;
  pregnancy_status: string | null;
  supplements: string[];
  known_conditions: string[];
}

interface AuthContextType {
  user: SupabaseUser | null;
  userProfile: User | null;
  loading: boolean;
  isPasswordRecovery: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshUserProfile: () => Promise<void>;
  markOnboardingComplete: (answers: OnboardingAnswers) => Promise<{ error: string | null }>;
  markOnboardingSkipped: () => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  const fetchUserProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data) {
      setUserProfile(data as User);
      return data as User;
    }
    return null;
  };

  const refreshUserProfile = async () => {
    if (user) {
      await fetchUserProfile(user.id);
    }
  };

  useEffect(() => {
    let initializedFromSession = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      initializedFromSession = true;
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserProfile(session.user.id).then(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        if (event === 'TOKEN_REFRESHED') {
          setUser(session?.user ?? null);
          return;
        }

        if (event === 'PASSWORD_RECOVERY') {
          setIsPasswordRecovery(true);
          setUser(session?.user ?? null);
          if (!initializedFromSession) setLoading(false);
          return;
        }

        if (event === 'SIGNED_IN') {
          setUser(session?.user ?? null);
          if (session?.user) {
            const profile = await fetchUserProfile(session.user.id);
            // OAuth round-trip: the auth.users insert and the SECURITY DEFINER
            // trigger that backfills public.users can finish a few ms after our
            // SELECT lands. Retry once before giving up so OnboardingGate
            // doesn't strand a fresh OAuth user on Loading.
            if (!profile) {
              await new Promise((resolve) => setTimeout(resolve, 400));
              await fetchUserProfile(session.user.id);
            }
          }
          if (!initializedFromSession) setLoading(false);
          return;
        }

        if (event === 'SIGNED_OUT') {
          setUser(null);
          setUserProfile(null);
          setLoading(false);
          return;
        }

        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchUserProfile(session.user.id);
        } else {
          setUserProfile(null);
        }
        if (!initializedFromSession) setLoading(false);
      })();
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: undefined,
      },
    });

    if (error) throw error;

    if (data.user) {
      // Belt to the handle_new_user trigger's braces: the trigger already
      // created this row inside the auth.users insert, so this is only a
      // fallback for the case where it did not.
      //
      // ignoreDuplicates makes the conflict path DO NOTHING rather than an
      // UPDATE, and subscription_status is gone from the payload — neither it
      // nor email is client-writable any more (see
      // 20260823000000_lock_users_privileged_columns.sql), and the trigger and
      // the column default both set it to 'trial' regardless.
      await supabase
        .from('users')
        .upsert(
          {
            id: data.user.id,
            email: data.user.email!,
            has_consented: true,
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
  };

  const signInWithProvider = async (provider: 'google' | 'apple') => {
    const origin = publicOrigin();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${origin}/app`,
      },
    });
    if (error) throw error;
  };

  const signInWithGoogle = () => signInWithProvider('google');
  const signInWithApple = () => signInWithProvider('apple');

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUserProfile(null);
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: publicUrl('/reset-password'),
    });
    if (error) throw error;
  };

  /**
   * Starts the 7-day trial clock, which the client cannot write directly.
   *
   * `trial_start_date` used to be part of the onboarding UPDATE payload, but
   * RLS gates rows and not columns: any user could PATCH their own row and hand
   * themselves a fresh trial every week, and the server-side entitlement check
   * reads that same column. It is no longer granted to `authenticated` (see
   * supabase/migrations/20260823000000_lock_users_privileged_columns.sql).
   *
   * `start_trial_if_unset` is a SECURITY DEFINER function that writes the
   * column only while it is NULL, so calling it twice cannot buy more trial.
   * Returns an error message, or null on success.
   */
  const startTrialIfNeeded = async (currentTrialStart: string | null): Promise<string | null> => {
    if (currentTrialStart != null) return null;
    const { error } = await supabase.rpc('start_trial_if_unset');
    return error?.message ?? null;
  };

  const markOnboardingComplete = async (answers: OnboardingAnswers): Promise<{ error: string | null }> => {
    if (!user) return { error: 'No user' };

    const currentTrialStart = (userProfile as User & { trial_start_date?: string | null } | null)?.trial_start_date ?? null;

    const payload: Record<string, unknown> = {
      onboarding_completed: true,
      full_name: answers.full_name ?? null,
      health_goals: answers.health_goals,
      symptoms: answers.symptoms,
      age_range: answers.age_range,
      sex_at_birth: answers.sex_at_birth,
      pregnancy_status: answers.pregnancy_status,
      supplements: answers.supplements,
      known_conditions: answers.known_conditions,
    };

    const { error } = await supabase
      .from('users')
      .update(payload)
      .eq('id', user.id);

    if (error) return { error: error.message };

    const trialError = await startTrialIfNeeded(currentTrialStart);
    if (trialError) return { error: trialError };

    await fetchUserProfile(user.id);
    return { error: null };
  };

  const markOnboardingSkipped = async (): Promise<{ error: string | null }> => {
    if (!user) return { error: 'No user' };

    const currentTrialStart = (userProfile as User & { trial_start_date?: string | null } | null)?.trial_start_date ?? null;

    const { error } = await supabase
      .from('users')
      .update({ onboarding_skipped: true })
      .eq('id', user.id);

    if (error) return { error: error.message };

    const trialError = await startTrialIfNeeded(currentTrialStart);
    if (trialError) return { error: trialError };

    await fetchUserProfile(user.id);
    return { error: null };
  };

  const value = {
    user,
    userProfile,
    loading,
    isPasswordRecovery,
    signUp,
    signIn,
    signInWithGoogle,
    signInWithApple,
    signOut,
    resetPassword,
    refreshUserProfile,
    markOnboardingComplete,
    markOnboardingSkipped,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
