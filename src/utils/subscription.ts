import type { User } from '../types';
import { supabase } from '../lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { resolveEntitlement, type IapRecord } from '../lib/entitlement';

/**
 * Check whether the user has an active subscription or valid trial.
 */
export function isTrialActive(userProfile: User | null): boolean {
  if (!userProfile) return false;
  if (userProfile.subscription_status === 'active') return true;
  if (userProfile.subscription_status === 'trial') {
    // Pre-onboarding users have trial_start_date === null. They're not yet
    // on the 7-day clock; the trial begins when onboarding completes or skips.
    if (!userProfile.trial_start_date) return false;
    const trialStart = new Date(userProfile.trial_start_date);
    const daysSinceStart = Math.floor(
      (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceStart < 7;
  }
  return false;
}

/**
 * Get the number of trial days remaining. Returns null if the user isn't on a trial
 * or hasn't started one yet (pre-onboarding).
 */
export function getTrialDaysRemaining(userProfile: User | null): number | null {
  if (!userProfile || userProfile.subscription_status !== 'trial') return null;
  if (!userProfile.trial_start_date) return null;
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
 * Check subscription state live from Supabase, across all three storefronts
 * (Stripe on web, StoreKit on iOS, Play Billing on Android).
 *
 * Decision logic lives in `lib/entitlement.ts` so this and the server guard
 * cannot drift — see the parity test in `lib/entitlement.test.ts`.
 *
 * Returns the redirect target:
 *   - /billing  — had a paid subscription that lapsed
 *   - /pricing  — never subscribed
 */
export async function checkSubscriptionLive(): Promise<ClientSubscriptionState> {
  const [{ data: subData }, { data: iapData, error: iapError }, { data: userData }] =
    await Promise.all([
      supabase.from('stripe_user_subscriptions').select('subscription_status').maybeSingle(),
      supabase.from('iap_subscriptions').select('status, expires_at, environment'),
      supabase.from('users').select('trial_start_date').maybeSingle(),
    ]);

  // A failed IAP read must not silently demote a paying App Store customer to
  // "never subscribed" and route them to /pricing. Send them to /billing, where
  // existing customers belong, and let the server's 402 be the real gate.
  if (iapError) {
    return { allowed: false, redirectTo: '/billing' };
  }

  const result = resolveEntitlement({
    stripeStatus: subData?.subscription_status ?? null,
    iapRecords: (iapData ?? []) as IapRecord[],
    trialStartDate: userData?.trial_start_date ?? null,
    now: Date.now(),
    // Sandbox never entitles in the shipped client; the server decides for real.
    allowSandbox: false,
  });

  if (result.allowed) return { allowed: true };

  // 'no_subscription' means there was a paid relationship that lapsed — those
  // users want the billing screen, not the marketing pricing page.
  return {
    allowed: false,
    redirectTo: result.reason === 'no_subscription' ? '/billing' : '/pricing',
  };
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
