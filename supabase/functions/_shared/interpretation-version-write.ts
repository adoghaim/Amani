/**
 * Ordinary regeneration through the version store (TASK-048 turn 10).
 *
 * The first interpretation of a report is its anchor row (save_interpretation
 * or the claim commit). Any later regeneration of a report that already holds
 * an anchor appends a version through `append_interpretation_version` and the
 * pointer selects it; the anchor is never overwritten in place. The writer
 * decides nothing about entitlement: generate-interpretation does, exactly as
 * before. Only a deep, current-policy AI body may become a version — anything
 * else persists nothing and leaves the selected interpretation as it was.
 */
import { CLAIM_POLICY_VERSION } from "./claim-authority.ts";

/** SQLSTATE the history guard raises when anything overwrites protected history. */
export const HISTORY_PROTECTED_SQLSTATE = "55000";
/** SQLSTATE the primitive raises for a request id reused with different output. */
export const REQUEST_REUSED_SQLSTATE = "22023";

/** Stable response codes. */
export const LEGACY_HISTORY_PROTECTED = "legacy_history_protected";
export const REQUEST_ID_REQUIRED = "request_id_required";
export const REGENERATION_FAILED = "regeneration_failed";

/** The same stamp save_interpretation writes for ordinary generation. */
export const VERSION_DISCLAIMER_VERSION = "1.0";

/** A database error raised by the history guard. */
export function isHistoryProtected(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === HISTORY_PROTECTED_SQLSTATE;
}

/** Thrown when the history guard refused a write (claim commit or writer). */
export class ProtectedHistoryError extends Error {
  constructor() {
    super("historical interpretation is protected");
    this.name = "ProtectedHistoryError";
  }
}

/**
 * Defence in depth: an in-place write reached protected history. Not an error
 * about the report — nothing was written and it keeps its status.
 */
export const legacyHistoryProtectedResponse = { status: 409, body: { error: LEGACY_HISTORY_PROTECTED } };

/** A committed version. Never the historical row: its own id and time. */
export interface StoredVersion {
  versionId: string;
  historicalInterpretationId: string;
  generatedAt: string;
  full: Record<string, unknown>;
  basic: Record<string, unknown>;
}

/** Explicit identities: the version is never presented as the historical row. */
export function versionIdentity(version: StoredVersion): Record<string, unknown> {
  return {
    historical_interpretation_id: version.historicalInterpretationId,
    version: { id: version.versionId, generated_at: version.generatedAt },
  };
}

/** Only the model's deep work, through claim authority and the floor, is a version. */
export function isVersionable(output: { source: string; depth: string; floorViolations: readonly unknown[] }): boolean {
  return output.source === "ai" && output.depth === "deep" && output.floorViolations.length === 0;
}

/** Deterministic per request, so an identical retry presents identical provenance. */
export function regenerationProvenance(): Record<string, unknown> {
  return { pipeline: "generate-interpretation", mode: "regeneration", claim_policy_version: CLAIM_POLICY_VERSION };
}

/** Nothing was persisted; the previously selected interpretation stands. */
export function regenerationFailedResponse(retryable: boolean): { status: number; body: Record<string, unknown> } {
  return { status: 503, body: { error: REGENERATION_FAILED, retryable } };
}

/**
 * Whether a regeneration of a report that already holds an interpretation can
 * succeed for this viewer, as get-interpretation reports it (PK-PL-A). Only a
 * deep body is ever appended (`isVersionable`), so it can iff the request would
 * generate deeply: `deepGeneration` is `decideDeepGeneration`'s answer, the same
 * call generate-interpretation makes. `unavailable` is the request that would
 * end in `regenerationFailedResponse(false)` with nothing written.
 */
export type RegenerationAvailability = "available" | "unavailable";

export function regenerationAvailability(deepGeneration: boolean): RegenerationAvailability {
  return deepGeneration ? "available" : "unavailable";
}
