/**
 * Amani Free / Plus tiering.
 *
 * Today entitlement is binary: `resolveEntitlement` says allowed or not, and
 * the four gated edge functions turn "not" into a 402 that the client redirects
 * to /pricing. Freemium inverts that — a Free user is never bounced. They
 * upload, they get a deterministic interpretation, they see every value and
 * every abnormal flag. What differs is the *depth* of what comes back.
 *
 * So this module returns a tier plus an allowance set, and keeps the legacy
 * gate decision alongside it rather than replacing it.
 *
 * ## The activation contract
 *
 * `freemiumActive` is false in production until the fresh-user E2E test is
 * green. While it is false this module is *inert*:
 *
 *   - every caller resolves to `plus`, so no response is ever Free-shaped;
 *   - `gate` reproduces the pre-freemium 402 exactly, including its reason.
 *
 * `tier.test.ts` asserts both properties against the entitlement matrix, which
 * is the real guarantee — a flag states intent, a test proves behaviour.
 *
 * ## The medical floor
 *
 * `MEDICAL_FLOOR` is what neither tier may withhold: the user's own values,
 * whether each is out of range, their history, and a deterministic (non-AI)
 * interpretation. Amani shows people their own medical data; paywalling an
 * abnormal flag would be indefensible whatever the business model says. It is a
 * single frozen object shared by both allowance sets so the two cannot drift,
 * and a test asserts Free and Plus expose identical floors.
 *
 * Pure — mirrored client-side in `src/lib/tier.ts`, with `src/lib/tier.test.ts`
 * failing if the copies disagree. Same convention as `entitlement.ts`.
 */

import type { EntitlementResult } from "./entitlement.ts";

export type Tier = "free" | "plus";

/**
 * Never gated, at any tier.
 *
 * Frozen. Changing anything here is a medical-ethics decision, not a pricing
 * one — treat it like `nutrient-policy.ts`.
 */
export const MEDICAL_FLOOR = Object.freeze({
  /** Every extracted biomarker value, verbatim. */
  rawValues: true,
  /** In/out of reference range, and the direction. */
  abnormalFlags: true,
  /** Every past report the user uploaded. */
  fullHistory: true,
  /** The rule-based interpretation. Not the AI one — the deterministic one. */
  deterministicInterpretation: true,
} as const);

export type MedicalFloor = typeof MEDICAL_FLOOR;

/** Lifetime Introductory Deep Access credits on Free. Frozen by the spec. */
export const FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS = 3;


/*
  Beta limits, frozen 2026-09-04.

  `FREE_REVEALED_TREND_INSIGHTS` is named for what it actually meters: how many
  premium trend *analyses* are revealed. It is deliberately NOT named for a
  count of biomarkers. Every biomarker and every raw result stays visible on
  Free — that is `MEDICAL_FLOOR`, above — and a limit named
  `FREE_TREND_BIOMARKERS` would read, to someone skimming this file in six
  months, as permission to show only three of them. It is not. What is metered
  is the analysis about them, never their visibility.
*/
export const FREE_AI_QUESTIONS_PER_MONTH = 5;
export const FREE_REVEALED_TREND_INSIGHTS = 1;

export type Quota =
  | { kind: "unlimited" }
  | { kind: "lifetime"; limit: number }
  | { kind: "monthly"; limit: number }
  | { kind: "capped"; limit: number };

const UNLIMITED: Quota = Object.freeze({ kind: "unlimited" });

export interface Allowances {
  /** Never gated. Identical across tiers by construction. */
  floor: MedicalFloor;
  /** Full AI interpretation of a draw. */
  deepInterpretation: Quota;
  /** Full before/after comparison across two comparable reports. */
  fullComparison: Quota;
  /** Follow-up questions against a report. */
  aiQuestions: Quota;
  /** How many premium trend analyses are revealed. Not a biomarker cap. */
  revealedTrendInsights: Quota;
}

export const PLUS_ALLOWANCES: Allowances = Object.freeze({
  floor: MEDICAL_FLOOR,
  deepInterpretation: UNLIMITED,
  fullComparison: UNLIMITED,
  aiQuestions: UNLIMITED,
  revealedTrendInsights: UNLIMITED,
});

export const FREE_ALLOWANCES: Allowances = Object.freeze({
  floor: MEDICAL_FLOOR,
  deepInterpretation: Object.freeze({
    kind: "lifetime",
    limit: FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS,
  }),
  fullComparison: Object.freeze({
    kind: "capped",
    limit: 0,
  }),
  aiQuestions: Object.freeze({
    kind: "monthly",
    limit: FREE_AI_QUESTIONS_PER_MONTH,
  }),
  revealedTrendInsights: Object.freeze({
    kind: "lifetime",
    limit: FREE_REVEALED_TREND_INSIGHTS,
  }),
});

/** What the caller should do with the request, before any tier shaping. */
export type GateDecision =
  | { gate: "allow" }
  | { gate: "block"; reason: EntitlementResult["reason"] };

export interface TierDecision {
  tier: Tier;
  allowances: Allowances;
  /** Legacy 402 decision. Identical to pre-freemium behaviour while inactive. */
  gate: GateDecision;
  /** Why this tier — drives upgrade copy, never access. */
  reason:
    | "entitled"
    | "freemium_inactive"
    | "free_tier"
    | "onboarding_incomplete"
    | "error";
}

export interface TierInput {
  entitlement: EntitlementResult;
  /**
   * Master switch. False everywhere until the production E2E passes; see the
   * activation contract above.
   */
  freemiumActive: boolean;
}

/**
 * Maps an entitlement result onto a tier and a gate decision.
 *
 * An incomplete account blocks at both settings: `onboarding_incomplete` means
 * the user never finished signup, so there is no Free experience to give them
 * either — they belong back in onboarding, not on a paywall or a Free report.
 */
export function resolveTier(input: TierInput): TierDecision {
  const { entitlement, freemiumActive } = input;

  if (freemiumActive && !entitlement.allowed && entitlement.reason === "error") {
    return {
      tier: "plus",
      allowances: PLUS_ALLOWANCES,
      gate: { gate: "block", reason: "error" },
      reason: "error",
    };
  }

  if (!entitlement.allowed && entitlement.reason === "onboarding_incomplete") {
    return {
      tier: "plus",
      allowances: PLUS_ALLOWANCES,
      gate: { gate: "block", reason: "onboarding_incomplete" },
      reason: "onboarding_incomplete",
    };
  }

  if (!freemiumActive) {
    // Inert: pre-freemium behaviour, byte for byte. Everyone who gets a
    // response gets a Plus-shaped one; everyone who was blocked stays blocked
    // with the same reason the client already knows how to route on.
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

  if (entitlement.allowed && entitlement.plan !== "free") {
    return {
      tier: "plus",
      allowances: PLUS_ALLOWANCES,
      gate: { gate: "allow" },
      reason: "entitled",
    };
  }

  // Freemium active and not entitled: Free, and let them in.
  return {
    tier: "free",
    allowances: FREE_ALLOWANCES,
    gate: { gate: "allow" },
    reason: "free_tier",
  };
}

/**
 * Whether an unknown tier string from a *newer* server should be treated as
 * Plus-shaped by an older client.
 *
 * Fail open on shape, closed on entitlement: a shipped native build that has
 * never heard of a tier must still render the response rather than crash, but
 * it must not infer premium access from its own ignorance. Rendering is safe
 * because the server has already removed anything the tier may not see — the
 * client is a renderer here, not a gate.
 */
export function normalizeTierForClient(raw: unknown): Tier {
  return raw === "free" ? "free" : "plus";
}

/** Owner vocabulary, 2026-09-26. SQL's frozen migration copy is parity-tested. */
export const FINDING_STATUS = Object.freeze({
  NORMAL: ["reassuring", "normal", "in_range", "within_range", "optimal"],
  BORDERLINE: ["monitor"],
  ABNORMAL: ["attention", "discuss"],
} as const);

export function isAbnormalStatus(value: unknown): boolean {
  return typeof value === "string" && (FINDING_STATUS.ABNORMAL as readonly string[]).includes(value.toLowerCase());
}

/** Only explicit boolean flags and the abnormal vocabulary confer safety status. */
export function carriesFindingSafety(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(carriesFindingSafety);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (/^(abnormal|is_abnormal|safety|safety_related|is_safety|critical|urgent)$/.test(key)) return child === true;
    if (/^(flag|flagged|status|current_status)$/.test(key) && isAbnormalStatus(child)) return true;
    return carriesFindingSafety(child);
  });
}
