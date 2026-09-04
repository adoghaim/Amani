/**
 * Reading the sandbox-IAP beta allowlist, and failing closed when that read
 * goes wrong.
 *
 * `entitlement.ts` owns the *decision* — which sandbox receipts a given
 * `iap_beta_testers` row permits. This module owns the *read policy*: when to
 * go and get the row at all, and what to do when the database says no.
 *
 * Like `entitlement.ts`, `iap-verification.ts` and `account-deletion.ts`, it is
 * pure — no Deno, no Supabase, no clock — with the real I/O behind the
 * `BetaAllowlistActions` port, so Vitest can drive every branch with a fake.
 * `subscription-guard.ts` and `verify-iap-purchase` are the wiring.
 */

import { toBetaTester, type BetaTester, type IapRecord } from "./entitlement.ts";

export interface BetaAllowlistActions {
  /**
   * The user's `iap_beta_testers` row exactly as stored, or null when there is
   * none.
   *
   * MUST throw on a read failure rather than returning null. The two outcomes
   * are indistinguishable to the caller otherwise, and "the query failed" would
   * quietly become "this person is not a tester" — which is the right answer by
   * luck rather than by design, and hides a broken allowlist until a tester
   * files a bug.
   */
  findBetaTesterRow(userId: string): Promise<unknown>;
}

/**
 * Is there any sandbox receipt here at all?
 *
 * The allowlist is consulted only when the answer is yes. Two reasons, and the
 * second is the one that matters: it saves a query for every real customer, and
 * it makes "the allowlist is irrelevant to production receipts" structural
 * rather than merely true — for a user with no sandbox row the table is never
 * even read, so nothing about it can change their entitlement.
 */
export function hasSandboxIapRecord(records: readonly IapRecord[]): boolean {
  return records.some((r) => r.environment === "sandbox");
}

/**
 * Resolves the beta-allowlist row to hand `resolveEntitlement`, or null.
 *
 * Fails closed on a read error: null means "not a beta tester", so a sandbox
 * receipt does not entitle. That is deliberately narrower than the guard's
 * other failure paths, which deny outright — denying outright here would let a
 * hiccup on a table that exists purely for testers lock out real, paying App
 * Store customers. A failed allowlist read may only ever take away the *beta*
 * exception, never someone's actual purchase.
 *
 * The error is reported through `onError` rather than swallowed, so a
 * misconfigured or missing table is loud in the function logs instead of
 * showing up as "sandbox purchases mysteriously stopped working".
 */
export async function loadBetaTester(
  actions: BetaAllowlistActions,
  userId: string,
  iapRecords: readonly IapRecord[],
  onError: (error: unknown) => void,
): Promise<BetaTester | null> {
  if (!hasSandboxIapRecord(iapRecords)) return null;

  let row: unknown;
  try {
    row = await actions.findBetaTesterRow(userId);
  } catch (error) {
    onError(error);
    return null;
  }

  return toBetaTester(row);
}
