/*
  User-facing copy for the Free/Premium experience (VITE_FREEMIUM_ACTIVE on).

  Every string a flag-on surface shows that differs from the 1.0.5 copy lives
  here, so the "no trial wording under the flag" rule is checkable in one place
  (`copy.test.ts`) as well as on the rendered pages (`freemiumSurfaces.test.tsx`).
  The flag-off strings stay inline in their components, untouched, because they
  already ship in 1.0.5.

  The complimentary counter strings are LOCKED by FREEMIUM-V1-SPEC §6. Do not
  reword them here; change the spec first.
*/

import { FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS } from '../tier';

export const COMPLIMENTARY_INTRO =
  'Every Amani account includes 3 complimentary Premium analyses.';

export const COMPLIMENTARY_EXHAUSTED =
  "You've used your 3 complimentary Premium analyses. Future reports still include Basic insights and Premium Previews.";

export interface ComplimentaryCounterCopy {
  /** "Premium Analysis N of 3 included", once at least one has been used. */
  usage: string | null;
  /** Remaining count, the intro line before any use, or the exhausted line. */
  status: string;
}

/**
 * The locked counter copy for a lifetime usage count. Clamped, so a count the
 * ledger should never produce (negative, fractional, over the limit) still
 * reads as one of the four specified states rather than "4 of 3".
 */
export function complimentaryCounterCopy(used: number): ComplimentaryCounterCopy {
  const total = FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS;
  const n = Number.isFinite(used) ? Math.min(total, Math.max(0, Math.floor(used))) : 0;
  const remaining = total - n;
  const usage = n > 0 ? `Premium Analysis ${n} of ${total} included` : null;
  if (n === 0) return { usage, status: COMPLIMENTARY_INTRO };
  if (remaining === 0) return { usage, status: COMPLIMENTARY_EXHAUSTED };
  return {
    usage,
    status: remaining === 1
      ? '1 complimentary Premium analysis remaining'
      : `${remaining} complimentary Premium analyses remaining`,
  };
}

/** Locked-card titles on a Basic report. The plural patterns and cross-report labels are §6. */
export function lockedPatternsLabel(count: number): string {
  return count === 1 ? FREEMIUM_COPY.lockedCards.patternsOne : `${count} additional patterns found`;
}
export const LOCKED_CROSS_REPORT_LABEL = 'Cross-report relationship available';
export function lockedLifestyleLabel(count: number): string {
  return count === 1
    ? FREEMIUM_COPY.lockedCards.lifestyleOne
    : FREEMIUM_COPY.lockedCards.lifestyleMany.replace('{n}', String(count));
}

export const FREEMIUM_COPY = Object.freeze({
  lockedCards: {
    // Not a §6 locked string; owner to confirm. (§6 locks "N additional patterns found".)
    patternsOne: '1 additional pattern found',
    // Not a §6 locked string; owner to confirm.
    lifestyleOne: '1 lifestyle insight available',
    // Not a §6 locked string; owner to confirm.
    lifestyleMany: '{n} lifestyle insights available',
  },
  report: {
    // Owner-approved TASK-035 R3, 2026-09-27.
    changesHeading: 'Changes since your last report',
    basicHeading: 'Basic insights',
    previewLabel: 'Premium Preview',
    lockedHint: 'Included with Premium',
    upgradeTitle: 'See the full Premium analysis',
    upgradeBody: 'Premium explains how your results connect across markers and across your reports.',
    upgradeCta: 'Unlock Premium',
    errorTitle: "We couldn't load your analysis",
    errorBody: 'Your lab values are saved and shown below. Please try again in a moment.',
    errorRateLimited: "You've reached today's limit for loading analyses. Please try again tomorrow.",
    retry: 'Try again',
    // Not a §6 locked string; owner to confirm.
    regenerateErrorTitle: "We couldn't regenerate your analysis",
    // Not a §6 locked string; owner to confirm.
    regenerateErrorBody: 'Your current analysis is unchanged. Please try again in a moment.',
    generateTitle: 'Your analysis is not ready yet',
    generateBody: 'Generate it now. Your lab values are saved and shown below.',
    generateCta: 'Generate analysis',
    generateFullTitle: 'A fuller analysis is available for this report',
    generateFullCta: 'Generate full Amani analysis',
    generating: 'Generating your analysis',
  },
  plan: {
    free: 'Plan: Free',
    premium: 'Plan: Premium',
    complimentary: 'Complimentary access',
    sourceStripe: 'Billed through Stripe',
    sourceIos: 'Billed through the App Store',
    sourceAndroid: 'Billed through Google Play',
    upgrade: 'Upgrade to Premium',
    seePremium: 'See Premium',
    loadError: "We couldn't load your plan.",
    freeSummary: 'Basic insights and a Premium Preview on every report.',
    manageFreeBody: 'Premium unlocks the full analysis on every report.',
  },
  paywall: {
    title: 'Amani Premium',
    intro: 'Premium unlocks the full analysis on every report, including patterns across markers and across your reports.',
    premiumRequiredBody: 'Comparing reports is part of Amani Premium.',
  },
  pricing: {
    intro: 'Both Premium plans include the full analysis on every report. Cancel any time from inside the app.',
    signedOut: COMPLIMENTARY_INTRO,
    premiumActive: 'Premium is active on your account.',
    subscribe: 'Subscribe',
  },
  auth: {
    signupTitle: 'Create your account',
    signupIncluded: [
      'Basic insights on every report, free',
      'The cycle day of your test, when you add the day your last period started',
      '3 complimentary Premium analyses included',
      'Questions to take to your appointment',
    ],
    loginCreateAccount: 'Create an account',
  },
  landing: {
    navCta: 'Get started',
    heroCta: 'Create your free account',
    heroNote: 'Free to start, with 3 complimentary Premium analyses. Premium is $9.99 a month, or $99.99 a year.',
    pricingBody: 'Premium, billed monthly or yearly. Every account includes 3 complimentary Premium analyses, and you can cancel from inside the app.',
    cardCta: 'Get started',
  },
  success: {
    confirming: 'Confirming your purchase',
    confirmingBody: 'Your payment went through. We’re waiting for your Premium subscription to be confirmed — this usually takes a few seconds.',
    confirmed: 'Premium is active',
    confirmedBody: 'Thank you for subscribing. Your Premium subscription is confirmed on your account.',
  },
  terms: {
    heading: 'Free access, subscriptions, and renewal',
    freeAccountLabel: 'Free account:',
    freeAccount: 'Amani provides a free account with certain included features and a limited number of complimentary Premium analyses.',
    premiumLabel: 'Premium:',
    premium: 'additional Premium features require a paid subscription.',
    changesLabel: 'Changes:',
    changes: 'available features and limits may change.',
  },
});
