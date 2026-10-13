import type { EntitlementResult } from "./entitlement.ts";
import { FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS } from "./tier.ts";
import { decideDeepGeneration, findFloorViolations, type InterpretationPayload } from "./response-shaping.ts";
import { introductoryAccessDecision } from "./introductory-access.ts";
import { regenerationAvailability, type RegenerationAvailability } from "./interpretation-version-write.ts";
import { sanitizeBasicProjection, isDeterministicSource } from "./interpretation-visibility.ts";
import { projectBasic, servedBasic, visibleClaimProjection, quarantineCustomerRead } from "./claim-authority.ts";
import type { LockedCounts } from "./preview-selector.ts";

export interface InterpretationReadActions {
  /** User-JWT ownership read. Null means missing or another user's report. */
  ownsReport(): Promise<boolean>;
  resolveEntitlement(): Promise<EntitlementResult>;
  /** Must enforce ownership and return ONLY the selected projection. The
   * service RPC receives the TS decision; no request parameter can supply it. */
  readSelected(premium: boolean): Promise<{
    json_output: InterpretationPayload; stored_depth: string; has_claim: boolean; tier: string;
    /** Absent from a pre-20260926000004 RPC; treated as non-deterministic. */
    interpretation_source?: string | null;
    /** TASK-048 (20261011000002): set only when the RPC served the selected
     * version; absent from older RPCs and NULL for the historical row. */
    historical_interpretation_id?: string | null;
    selected_version_id?: string | null;
    selected_generated_at?: string | null;
  } | null>;
  countClaims(): Promise<number>;
  /** FREEMIUM_POST_LIMIT_GENERATION exactly as generate-interpretation reads it
   * (absent: its default). Decides `regeneration` with that function's rule. */
  postLimitGeneration?: string;
}

export interface SelectedVersion { id: string; generated_at: string }

/** The served version's own identity, never the historical row's. All three
 * fields or none: a partial or self-referencing identity is a corrupt selection
 * and fails closed rather than presenting a body under the wrong identity. */
function selectedIdentity(row: Awaited<ReturnType<InterpretationReadActions["readSelected"]>>): {
  historical_interpretation_id: string | null; version: SelectedVersion | null;
} {
  const history = row?.historical_interpretation_id ?? null;
  const id = row?.selected_version_id ?? null;
  const at = row?.selected_generated_at ?? null;
  if (history === null && id === null && at === null) return { historical_interpretation_id: null, version: null };
  if (typeof history !== "string" || typeof id !== "string" || typeof at !== "string" || id === history) {
    throw new Error("Incoherent selected interpretation identity");
  }
  return { historical_interpretation_id: history, version: { id, generated_at: at } };
}

export async function readInterpretation(actions: InterpretationReadActions, freemiumActive: boolean): Promise<{
  status: number; body: {
    access: "full" | "basic" | "error" | "generation_needed";
    interpretation: InterpretationPayload | null;
    preview: unknown; locked: LockedCounts;
    plan: "premium" | "free" | null;
    complimentary: { used: number; total: number; remaining: number } | null;
    stored_depth: string | null;
    historical_interpretation_id: string | null;
    version: SelectedVersion | null;
    /** PK-PL-A: whether regenerating this stored report can append a version for
     * this viewer — generate-interpretation's own depth decision. Present only on
     * a flag-on answer for a stored report (no stored report is first generation). */
    regeneration?: RegenerationAvailability;
    code?: string; retryable?: boolean;
  };
}> {
  const empty = { stored_depth: null, interpretation: null, preview: null,
    locked: { patterns: 0, cross_report: 0, lifestyle: 0 }, plan: null, complimentary: null,
    historical_interpretation_id: null, version: null };
  const failure = (status: number, code: string, retryable = false) => ({
    status, body: { ...empty, access: "error" as const, code, retryable },
  });
  try {
    if (!await actions.ownsReport()) return failure(404, "report_not_found");
    if (!freemiumActive) {
      // Legacy entitlement is informational on reads: expiry, onboarding, or a
      // failed plan lookup must not turn an owned stored report into a paywall.
      const entitlement = await actions.resolveEntitlement().catch(() => null);
      const plan = !entitlement || entitlement.reason === "error" ? null
        : entitlement.allowed && (entitlement.plan === "premium"
          || ["active_subscription", "active_iap", "complimentary"].includes(entitlement.reason ?? ""))
          ? "premium" as const : "free" as const;
      const row = await actions.readSelected(true);
      return { status: 200, body: { ...empty, plan, ...selectedIdentity(row),
        access: row ? "full" : "generation_needed",
        interpretation: row ? quarantineCustomerRead(row.json_output, true, row.interpretation_source) : null, stored_depth: row?.stored_depth ?? null } };
    }
    const entitlement = await actions.resolveEntitlement();
    if (!entitlement.allowed) return entitlement.reason === "error"
      ? failure(503, "entitlement_unavailable", true) : failure(403, "onboarding_incomplete");
    // Flag-on reads require the current TS model (premium-first). A
    // legacy 'trial' result is not proof of Premium and cannot unlock storage.
    if (entitlement.plan !== "free" && entitlement.plan !== "premium") return failure(503, "entitlement_unavailable", true);
    const premium = entitlement.plan === "premium";
    const row = await actions.readSelected(premium);
    const used = await actions.countClaims();
    if (!Number.isInteger(used) || used < 0) throw new Error("Invalid claim count");
    const common = { plan: entitlement.plan, stored_depth: row?.stored_depth ?? null, ...selectedIdentity(row),
      complimentary: { used, total: FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS,
        remaining: Math.max(0, FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS - used) } };
    if (!row) return { status: 200, body: { ...empty, ...common, access: "generation_needed" } };
    const full = premium || row.has_claim;
    // The decision generate-interpretation makes for this viewer and report: the
    // same ledger rule over the readers' claim coverage and count, then the same
    // depth rule. A regeneration persists only a deep body, so no deep
    // generation means it cannot succeed (503 regeneration_failed, retryable:false).
    const regeneration = regenerationAvailability(decideDeepGeneration({
      freemiumActive: true, tier: premium ? "plus" : "free",
      decision: premium ? null : introductoryAccessDecision({ tier: "free", existingClaim: row.has_claim, claimsUsed: used }),
      postLimitGeneration: actions.postLimitGeneration,
    }));
    const provenance = { source: row.interpretation_source ?? null };
    const customer = quarantineCustomerRead(row.json_output, full, provenance.source);
    if (full && row.stored_depth !== "deep") {
      // V2-03c: preview and counts only from a validated claim set (legacy: none).
      const basic = servedBasic(projectBasic(customer, provenance));
      // A deterministic body IS the medical floor: serve it whole, still asking
      // for the deep generation this reader is entitled to.
      const interpretation = isDeterministicSource(provenance.source) ? customer : basic;
      return { status: 200, body: { ...common, regeneration, access: "generation_needed", interpretation,
        preview: basic.preview, locked: basic.locked as LockedCounts } };
    }
    const violations = findFloorViolations(customer);
    if (violations.length) console.error("[get-interpretation] MEDICAL FLOOR VIOLATION — serving stored payload", violations);
    // Basic arrives precompiled and is not rebuilt. Its preview and counts are
    // served only if compiled under a known claim policy (V2-03c); a legacy
    // row's were chosen from unvalidated model content and are withheld.
    const projection = full ? projectBasic(customer, provenance) : customer;
    const visible = visibleClaimProjection(projection);
    return { status: 200, body: { ...common, regeneration, access: full ? "full" : "basic",
      interpretation: full ? customer : { ...sanitizeBasicProjection(customer, provenance.source), ...visible },
      preview: visible.preview, locked: visible.locked } };
  } catch {
    return failure(503, "entitlement_unavailable", true);
  }
}
