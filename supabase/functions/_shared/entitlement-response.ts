import type { EntitlementResult } from "./entitlement.ts";

export function entitlementUnavailable(headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ code: "entitlement_unavailable", retryable: true }), {
    status: 503, headers: { ...headers, "Content-Type": "application/json" },
  });
}

export function premiumRequired(result: EntitlementResult): boolean {
  return result.allowed && result.plan === "free";
}

/** No config read on the inactive path. An OFF switch forces a fresh legacy
 * entitlement check, before model spend, metadata, costs, or ledger access. */
export async function generationVisibilityMode(input: {
  active: boolean;
  entitlement: EntitlementResult;
  readEnabled: () => Promise<boolean>;
  warn: () => void;
}): Promise<boolean> {
  if (!input.active || !input.entitlement.allowed || input.entitlement.plan !== "free") return input.active;
  if (await input.readEnabled()) return true;
  input.warn();
  return false;
}
