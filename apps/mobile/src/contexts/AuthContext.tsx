import React, { createContext, useContext, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { User, validateOnboardingProfile } from '@amani/shared';
import { supabase } from '../lib/supabase';
import {
  authCallbackUrl,
  PASSWORD_RESET_PATH,
  passwordResetUrl,
} from '../navigation/linking';

interface OnboardingProfileInput {
  ageRange: string;
  cycleLength: number;
  periodLength: number;
}

interface AuthContextType {
  user: SupabaseUser | null;
  userProfile: User | null;
  loading: boolean;
  isPasswordRecovery: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  completeOnboarding: (input: OnboardingProfileInput) => Promise<void>;
  refreshUserProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function parseUrlParams(url: string) {
  const queryStart = url.indexOf('?');
  const hashStart = url.indexOf('#');
  const query = queryStart >= 0
    ? url.slice(queryStart + 1, hashStart >= 0 ? hashStart : undefined)
    : '';
  const hash = hashStart >= 0 ? url.slice(hashStart + 1) : '';
  const params = new URLSearchParams(query);
  const hashParams = new URLSearchParams(hash);

  hashParams.forEach((value, key) => {
    params.set(key, value);
  });

  return params;
}

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
      return;
    }

    setUserProfile(null);
  };

  const refreshUserProfile = async () => {
    if (user) {
      await fetchUserProfile(user.id);
    }
  };

  const handleAuthLink = async (url: string) => {
    try {
      const params = parseUrlParams(url);
      const path = (ExpoLinking.parse(url).path ?? '').replace(/^\/+|\/+$/g, '');
      const code = params.get('code');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');
      const isRecoveryLink = type === 'recovery' || path === PASSWORD_RESET_PATH;

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          setIsPasswordRecovery(isRecoveryLink);
        }
        return;
      }

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (!error) {
          setIsPasswordRecovery(isRecoveryLink);
        }
      }
    } catch (error) {
      console.error('Failed to handle auth link:', error);
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

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleAuthLink(url);
      }
    });

    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      handleAuthLink(url);
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
            await fetchUserProfile(session.user.id);
          }
          if (!initializedFromSession) setLoading(false);
          return;
        }

        if (event === 'SIGNED_OUT') {
          setUser(null);
          setUserProfile(null);
          setIsPasswordRecovery(false);
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

    return () => {
      subscription.unsubscribe();
      linkSubscription.remove();
    };
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
      await supabase
        .from('users')
        .upsert(
          {
            id: data.user.id,
            email: data.user.email!,
            goal: userProfile?.goal ?? 'general_health',
            has_consented: true,
            subscription_status: userProfile?.subscription_status ?? 'trial',
            trial_start_date: userProfile?.trial_start_date ?? new Date().toISOString(),
          },
          { onConflict: 'id' }
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

  const sendMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authCallbackUrl,
      },
    });

    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUserProfile(null);
    setIsPasswordRecovery(false);
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: passwordResetUrl,
    });
    if (error) throw error;
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  };

  const completeOnboarding = async ({
    ageRange,
    cycleLength,
    periodLength,
  }: OnboardingProfileInput) => {
    if (!user) {
      throw new Error('No authenticated user found');
    }

    const validation = validateOnboardingProfile({
      ageRange,
      cycleLength,
      periodLength,
    });

    if (!validation.valid) {
      throw new Error(validation.error ?? 'Invalid onboarding profile.');
    }

    const { error } = await supabase.from('users').upsert(
      {
        id: user.id,
        email: user.email ?? userProfile?.email ?? '',
        age_range: ageRange,
        goal: userProfile?.goal ?? 'general_health',
        has_consented: true,
        subscription_status: userProfile?.subscription_status ?? 'trial',
        trial_start_date: userProfile?.trial_start_date ?? new Date().toISOString(),
        default_cycle_length: cycleLength,
        default_period_length: periodLength,
      },
      { onConflict: 'id' }
    );

    if (error) throw error;

    await fetchUserProfile(user.id);
  };

  const value = {
    user,
    userProfile,
    loading,
    isPasswordRecovery,
    signUp,
    signIn,
    sendMagicLink,
    signOut,
    resetPassword,
    updatePassword,
    completeOnboarding,
    refreshUserProfile,
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
