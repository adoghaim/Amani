import type { EntitlementResult } from "./entitlement.ts";
import { FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS } from "./tier.ts";
import { findFloorViolations, type InterpretationPayload } from "./response-shaping.ts";
import { buildBasicProjection } from "./interpretation-visibility.ts";
import type { LockedCounts } from "./preview-selector.ts";

export interface InterpretationReadActions {
  /** User-JWT ownership read. Null means missing or another user's report. */
  ownsReport(): Promise<boolean>;
  resolveEntitlement(): Promise<EntitlementResult>;
  /** Must enforce ownership and return ONLY the selected projection. The
   * service RPC receives the TS decision; no request parameter can supply it. */
  readSelected(premium: boolean): Promise<{
    json_output: InterpretationPayload; stored_depth: string; has_claim: boolean; tier: string;
  } | null>;
  countClaims(): Promise<number>;
}

export async function readInterpretation(actions: InterpretationReadActions): Promise<{
  status: number; body: {
    access: "full" | "basic" | "error" | "generation_needed";
    interpretation: InterpretationPayload | null;
    preview: unknown; locked: LockedCounts;
    plan: "premium" | "free" | null;
    complimentary: { used: number; total: number; remaining: number } | null;
    code?: string; retryable?: boolean;
  };
}> {
  const empty = { interpretation: null, preview: null,
    locked: { patterns: 0, cross_report: 0, lifestyle: 0 }, plan: null, complimentary: null };
  const failure = (status: number, code: string, retryable = false) => ({
    status, body: { ...empty, access: "error" as const, code, retryable },
  });
  try {
    if (!await actions.ownsReport()) return failure(404, "report_not_found");
    const entitlement = await actions.resolveEntitlement();
    if (!entitlement.allowed) return entitlement.reason === "error"
      ? failure(503, "entitlement_unavailable", true) : failure(403, "onboarding_incomplete");
    // New endpoint always requests the current TS model (premium-first). A
    // legacy 'trial' result is not proof of Premium and cannot unlock storage.
    if (entitlement.plan !== "free" && entitlement.plan !== "premium") return failure(503, "entitlement_unavailable", true);
    const premium = entitlement.plan === "premium";
    const row = await actions.readSelected(premium);
    const used = await actions.countClaims();
    if (!Number.isInteger(used) || used < 0) throw new Error("Invalid claim count");
    const common = { plan: entitlement.plan,
      complimentary: { used, total: FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS,
        remaining: Math.max(0, FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS - used) } };
    if (!row) return { status: 200, body: { ...empty, ...common, access: "generation_needed" } };
    const full = premium || row.has_claim;
    if (full && row.stored_depth !== "deep") {
      const basic = buildBasicProjection(row.json_output);
      return { status: 200, body: { ...common, access: "generation_needed", interpretation: basic,
        preview: basic.preview, locked: basic.locked as LockedCounts } };
    }
    if (findFloorViolations(row.json_output).length) throw new Error("Invalid interpretation floor");
    // Basic arrives precompiled; rebuilding it would discard its chosen preview.
    const projection = full ? buildBasicProjection(row.json_output) : row.json_output;
    return { status: 200, body: { ...common, access: full ? "full" : "basic",
      interpretation: row.json_output, preview: projection.preview ?? null,
      locked: (projection.locked ?? empty.locked) as LockedCounts } };
  } catch {
    return failure(503, "entitlement_unavailable", true);
  }
}
