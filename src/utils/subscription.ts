import type { User } from '../types';
import { supabase } from '../lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';

/**
 * Check whether the user has an active subscription or valid trial.
 */
export function isTrialActive(userProfile: User | null): boolean {
  if (!userProfile) return false;
  if (userProfile.subscription_status === 'active') return true;
  if (userProfile.subscription_status === 'trial') {
    const trialStart = new Date(userProfile.trial_start_date);
    const daysSinceStart = Math.floor(
      (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceStart < 7;
  }
  return false;
}

/**
 * Get the number of trial days remaining. Returns null if the user isn't on a trial.
 */
export function getTrialDaysRemaining(userProfile: User | null): number | null {
  if (!userProfile || userProfile.subscription_status !== 'trial') return null;
  const trialStart = new Date(userProfile.trial_start_date);
  const daysSinceStart = Math.floor(
    (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
  );
  const remaining = 7 - daysSinceStart;
  return remaining > 0 ? remaining : 0;
}

/**
 * Check whether the user can create new reports (active sub or active trial).
 */
export function canCreateReport(userProfile: User | null): boolean {
  if (!userProfile) return false;
  return userProfile.subscription_status === 'active' || isTrialActive(userProfile);
}

export type ClientSubscriptionState =
  | { allowed: true }
  | { allowed: false; redirectTo: '/billing' | '/pricing' };

/**
 * Check subscription state live from Supabase.
 * Returns the redirect target:
 *   - /billing  — user has a Stripe row but no active status (lapsed/canceled)
 *   - /pricing  — user never subscribed
 */
export async function checkSubscriptionLive(): Promise<ClientSubscriptionState> {
  const ACTIVE = new Set(['active', 'trialing', 'past_due']);
  const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

  const [{ data: subData }, { data: userData }] = await Promise.all([
    supabase.from('stripe_user_subscriptions').select('subscription_status').maybeSingle(),
    supabase.from('users').select('trial_start_date').maybeSingle(),
  ]);

  const stripeStatus = subData?.subscription_status ?? null;
  if (stripeStatus && ACTIVE.has(stripeStatus)) return { allowed: true };

  const trialStart = userData?.trial_start_date ?? null;
  if (trialStart && Date.now() - new Date(trialStart).getTime() < TRIAL_MS) {
    return { allowed: true };
  }

  const redirectTo = stripeStatus !== null ? '/billing' : '/pricing';
  return { allowed: false, redirectTo };
}

/**
 * Handle a 402 from a Supabase edge-function invoke error.
 * Returns the redirect path if the error is subscription-related, null otherwise.
 */
export async function handle402(
  err: unknown,
): Promise<'/billing' | '/pricing' | null> {
  if (!(err instanceof FunctionsHttpError)) return null;
  if (err.context?.status !== 402) return null;

  let reason: string | null = null;
  try {
    const body = await (err.context as Response).json() as { reason?: string };
    reason = body.reason ?? null;
  } catch {
    // ignore parse failure
  }

  // If the user has any Stripe row, send to billing; otherwise to pricing.
  const { data } = await supabase
    .from('stripe_user_subscriptions')
    .select('subscription_status')
    .maybeSingle();

  if (reason === 'onboarding_incomplete') return null;
  return data?.subscription_status !== null && data !== null ? '/billing' : '/pricing';
}
