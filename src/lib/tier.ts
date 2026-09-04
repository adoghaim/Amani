/**
 * Amani Free / Plus tiering.
 *
 * `resolveTier` is a MIRROR of `supabase/functions/_shared/tier.ts`, following
 * the same convention as `src/lib/entitlement.ts` / `_shared/entitlement.ts`.
 * The server copy is authoritative — it is the security boundary, and it is
 * what decides what actually goes in a response. This copy drives UX: which
 * upgrade prompt to show, whether to render a locked state, how many
 * introductory reports are left. `src/lib/tier.test.ts` fails if the two ever
 * disagree.
 *
 * See the server module for the activation contract and the medical floor. The
 * short version: while `freemiumActive` is false, everyone resolves Plus and
 * the legacy 402 gate is reproduced exactly, so nothing about production
 * behaviour changes until the switch is thrown deliberately.
 */

import type { EntitlementResult } from "./entitlement";

export type Tier = "free" | "plus";

/** Never gated, at any tier. See the server copy for why this is frozen. */
export const MEDICAL_FLOOR = Object.freeze({
  rawValues: true,
  abnormalFlags: true,
  fullHistory: true,
  deterministicInterpretation: true,
} as const);

export type MedicalFloor = typeof MEDICAL_FLOOR;

/** Lifetime Introductory Deep Access credits on Free. Frozen by the spec. */
export const FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS = 2;

/** Full before/after comparisons on Free, once comparable data exists. Frozen. */
export const FREE_FULL_COMPARISONS = 1;

/* Provisional — the spec freezes that these are "limited", not the numbers. */
export const FREE_AI_QUESTIONS_PER_MONTH = 5;
export const FREE_TREND_BIOMARKERS = 3;

export type Quota =
  | { kind: "unlimited" }
  | { kind: "lifetime"; limit: number }
  | { kind: "monthly"; limit: number }
  | { kind: "capped"; limit: number };

const UNLIMITED: Quota = Object.freeze({ kind: "unlimited" });

export interface Allowances {
  floor: MedicalFloor;
  deepInterpretation: Quota;
  fullComparison: Quota;
  aiQuestions: Quota;
  trendsAndCorrelations: Quota;
}

export const PLUS_ALLOWANCES: Allowances = Object.freeze({
  floor: MEDICAL_FLOOR,
  deepInterpretation: UNLIMITED,
  fullComparison: UNLIMITED,
  aiQuestions: UNLIMITED,
  trendsAndCorrelations: UNLIMITED,
});

export const FREE_ALLOWANCES: Allowances = Object.freeze({
  floor: MEDICAL_FLOOR,
  deepInterpretation: Object.freeze({
    kind: "lifetime",
    limit: FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS,
  }),
  fullComparison: Object.freeze({
    kind: "lifetime",
    limit: FREE_FULL_COMPARISONS,
  }),
  aiQuestions: Object.freeze({
    kind: "monthly",
    limit: FREE_AI_QUESTIONS_PER_MONTH,
  }),
  trendsAndCorrelations: Object.freeze({
    kind: "capped",
    limit: FREE_TREND_BIOMARKERS,
  }),
});

export type GateDecision =
  | { gate: "allow" }
  | { gate: "block"; reason: EntitlementResult["reason"] };

export interface TierDecision {
  tier: Tier;
  allowances: Allowances;
  gate: GateDecision;
  reason:
    | "entitled"
    | "freemium_inactive"
    | "free_tier"
    | "onboarding_incomplete";
}

export interface TierInput {
  entitlement: EntitlementResult;
  freemiumActive: boolean;
}

export function resolveTier(input: TierInput): TierDecision {
  const { entitlement, freemiumActive } = input;

  if (!entitlement.allowed && entitlement.reason === "onboarding_incomplete") {
    return {
      tier: "plus",
      allowances: PLUS_ALLOWANCES,
      gate: { gate: "block", reason: "onboarding_incomplete" },
      reason: "onboarding_incomplete",
    };
  }

  if (!freemiumActive) {
    return entitlement.allowed
      ? {
        tier: "plus",
        allowances: PLUS_ALLOWANCES,
        gate: { gate: "allow" },
        reason: "entitled",
      }
      : {
        tier: "plus",
        allowances: PLUS_ALLOWANCES,
        gate: { gate: "block", reason: entitlement.reason },
        reason: "freemium_inactive",
      };
  }

  if (entitlement.allowed) {
    return {
      tier: "plus",
      allowances: PLUS_ALLOWANCES,
      gate: { gate: "allow" },
      reason: "entitled",
    };
  }

  return {
    tier: "free",
    allowances: FREE_ALLOWANCES,
    gate: { gate: "allow" },
    reason: "free_tier",
  };
}

/**
 * Reads a tier off a server response.
 *
 * Fail open on shape, closed on entitlement. A shipped native build that has
 * never heard of a future tier name must render the response rather than crash
 * on it, but it must not infer premium access from its own ignorance — so
 * anything that is not literally `"free"` renders Plus-shaped, and the server
 * has already stripped whatever that viewer may not see.
 *
 * This is the rule that keeps installed 1.0.3 builds working through the
 * freemium rollout. PR #32 already paid for the lesson: the shipped native
 * bundle cannot self-heal the way the web bundle does.
 */
export function normalizeTierForClient(raw: unknown): Tier {
  return raw === "free" ? "free" : "plus";
}

/**
 * Whether freemium is switched on for this client build.
 *
 * Mirrors the server's `FREEMIUM_ACTIVE`. Both stay false until the production
 * fresh-user E2E test is green; the client copy exists so UI can be built and
 * previewed behind it, never so the client can grant itself anything.
 */
export function clientFreemiumActive(): boolean {
  return import.meta.env.VITE_FREEMIUM_ACTIVE === "true";
}
