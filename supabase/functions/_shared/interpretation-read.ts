import type { EntitlementResult } from "./entitlement.ts";
import { FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS } from "./tier.ts";
import { findFloorViolations, type InterpretationPayload } from "./response-shaping.ts";
import { sanitizeBasicProjection, buildBasicProjection, isDeterministicSource } from "./interpretation-visibility.ts";
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
  } | null>;
  countClaims(): Promise<number>;
}

export async function readInterpretation(actions: InterpretationReadActions, freemiumActive: boolean): Promise<{
  status: number; body: {
    access: "full" | "basic" | "error" | "generation_needed";
    interpretation: InterpretationPayload | null;
    preview: unknown; locked: LockedCounts;
    plan: "premium" | "free" | null;
    complimentary: { used: number; total: number; remaining: number } | null;
    stored_depth: string | null;
    code?: string; retryable?: boolean;
  };
}> {
  const empty = { stored_depth: null, interpretation: null, preview: null,
    locked: { patterns: 0, cross_report: 0, lifestyle: 0 }, plan: null, complimentary: null };
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
      return { status: 200, body: { ...empty, plan,
        access: row ? "full" : "generation_needed",
        interpretation: row?.json_output ?? null, stored_depth: row?.stored_depth ?? null } };
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
    const common = { plan: entitlement.plan, stored_depth: row?.stored_depth ?? null,
      complimentary: { used, total: FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS,
        remaining: Math.max(0, FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS - used) } };
    if (!row) return { status: 200, body: { ...empty, ...common, access: "generation_needed" } };
    const full = premium || row.has_claim;
    const provenance = { source: row.interpretation_source ?? null };
    if (full && row.stored_depth !== "deep") {
      const basic = buildBasicProjection(row.json_output, undefined, provenance);
      // A deterministic body IS the medical floor: serve it whole, still asking
      // for the deep generation this reader is entitled to.
      const interpretation = isDeterministicSource(provenance.source) ? row.json_output : basic;
      return { status: 200, body: { ...common, access: "generation_needed", interpretation,
        preview: basic.preview, locked: basic.locked as LockedCounts } };
    }
    const violations = findFloorViolations(row.json_output);
    if (violations.length) console.error("[get-interpretation] MEDICAL FLOOR VIOLATION — serving stored payload", violations);
    // Basic arrives precompiled; rebuilding it would discard its chosen preview.
    const projection = full ? buildBasicProjection(row.json_output, undefined, provenance) : row.json_output;
    return { status: 200, body: { ...common, access: full ? "full" : "basic",
      interpretation: full ? row.json_output : sanitizeBasicProjection(row.json_output, provenance.source), preview: projection.preview ?? null,
      locked: (projection.locked ?? empty.locked) as LockedCounts } };
  } catch {
    return failure(503, "entitlement_unavailable", true);
  }
}
