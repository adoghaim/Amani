/**
 * Claim-only legacy remediation (TASK-048).
 *
 * A customer whose report holds an introductory deep-access claim, and whose
 * stored interpretation is legacy (quarantined at read time), is owed a usable
 * deep interpretation. This module orders that remediation; the database owns
 * the decisions:
 *
 *   - eligibility is `evaluate_legacy_remediation(user, report)`: a protected
 *     legacy row plus a claim on that report or its server-derived draw. Never
 *     tier, depth, subscription state or any client-supplied flag;
 *   - the only write is `append_remediation_version`, which re-evaluates
 *     eligibility at commit and appends a version beside the untouched history.
 *
 * Ordering, in full:
 *
 *     evaluate ── error ─────────────▶ failed (no model spend, no writes)
 *        │ not eligible ─────────────▶ not_available
 *     find version for (report, request_id) ── found ─▶ served, no model spend
 *     generate (the ordinary pipeline) ── null / not deep AI ─▶ failed
 *     append ── P0490 ───────────────▶ not_available
 *            ── 22023 and a twin committed this request ─▶ served (the twin)
 *            ── anything else ────────▶ failed
 *
 * Nothing here can save an interpretation in place, consume a claim, touch the
 * regeneration counter or consult a subscription: the port has no such action.
 * A failure never falls back to the historical prose — there is no action that
 * could read it.
 */

export const LEGACY_REMEDIATION_MODE = "legacy_remediation";
/** The same stamp `save_interpretation` writes for ordinary generation. */
export const REMEDIATION_DISCLAIMER_VERSION = "1.0";
/** SQLSTATE raised by `append_remediation_version` for an ineligible report. */
export const REMEDIATION_NOT_AVAILABLE_SQLSTATE = "P0490";
/** SQLSTATE the history guard raises when anything overwrites protected history. */
export const HISTORY_PROTECTED_SQLSTATE = "55000";

/** Stable response codes the client turn maps to the approved copy. */
export const REMEDIATION_NOT_AVAILABLE = "remediation_not_available";
export const REMEDIATION_FAILED = "remediation_failed";
export const LEGACY_HISTORY_PROTECTED = "legacy_history_protected";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RemediationRequest =
  | { kind: "ordinary" }
  | { kind: "remediation"; requestId: string }
  | { kind: "invalid" };

/**
 * Reads the optional remediation fields from a request body the ordinary schema
 * has already accepted. No `mode` keeps today's behaviour; an unknown mode or a
 * missing/non-UUID `request_id` is refused rather than treated as ordinary.
 */
export function parseRemediationRequest(body: unknown): RemediationRequest {
  if (!body || typeof body !== "object") return { kind: "ordinary" };
  const record = body as Record<string, unknown>;
  if (record.mode === undefined) return { kind: "ordinary" };
  if (record.mode !== LEGACY_REMEDIATION_MODE) return { kind: "invalid" };
  const requestId = record.request_id;
  if (typeof requestId !== "string" || !UUID.test(requestId)) return { kind: "invalid" };
  return { kind: "remediation", requestId: requestId.toLowerCase() };
}

export interface RemediationEligibility {
  eligible: boolean;
  historyId: string | null;
  claimId: string | null;
}

/** A committed version. Never the historical row: its own id and time. */
export interface RemediationVersion {
  versionId: string;
  historicalInterpretationId: string;
  generatedAt: string;
  full: Record<string, unknown>;
  basic: Record<string, unknown>;
}

/** What the ordinary generation pipeline produced for this report. */
export interface RemediationOutput {
  full: Record<string, unknown>;
  basic: Record<string, unknown>;
  depth: "deep" | "standard";
  source: "ai" | "fallback";
  provenance: Record<string, unknown>;
}

export interface RemediationAppendInput {
  userId: string;
  reportId: string;
  requestId: string;
  output: RemediationOutput;
}

/** Carries the SQLSTATE of a refused append, so ordering can act on it. */
export class RemediationAppendError extends Error {
  constructor(readonly code: string | null, message = "append_remediation_version failed") {
    super(message);
    this.name = "RemediationAppendError";
  }
}

/** Every effect remediation may have. There is deliberately nothing else. */
export interface RemediationActions {
  /** Throws on lookup failure; the caller fails closed. */
  evaluate(userId: string, reportId: string): Promise<RemediationEligibility>;
  /** The version already committed for this request, if any. Throws on failure. */
  findVersion(reportId: string, requestId: string): Promise<RemediationVersion | null>;
  /** The ordinary pipeline. Null when the model or a policy stage failed. */
  generate(): Promise<RemediationOutput | null>;
  /** Throws `RemediationAppendError` when the database refuses. */
  append(input: RemediationAppendInput): Promise<RemediationVersion>;
}

export type RemediationFailureStage = "eligibility" | "lookup" | "generation" | "policy" | "append";

export type RemediationOutcome =
  | { status: "not_available" }
  | { status: "served"; version: RemediationVersion; created: boolean }
  | { status: "failed"; stage: RemediationFailureStage };

export interface RemediationInput {
  userId: string;
  reportId: string;
  requestId: string;
}

const failed = (stage: RemediationFailureStage): RemediationOutcome => ({ status: "failed", stage });

/** Only a version anchored on the history the evaluator resolved may be served. */
function servable(version: RemediationVersion | null, historyId: string): version is RemediationVersion {
  return version !== null && version.historicalInterpretationId === historyId;
}

export async function runLegacyRemediation(
  actions: RemediationActions,
  input: RemediationInput,
): Promise<RemediationOutcome> {
  const { userId, reportId, requestId } = input;

  let eligibility: RemediationEligibility;
  try {
    eligibility = await actions.evaluate(userId, reportId);
  } catch {
    return failed("eligibility");
  }
  if (!eligibility.eligible || !eligibility.historyId || !eligibility.claimId) return { status: "not_available" };
  const historyId = eligibility.historyId;

  // A retry of a committed request is answered without spending on the model.
  try {
    const existing = await actions.findVersion(reportId, requestId);
    if (existing) return servable(existing, historyId) ? { status: "served", version: existing, created: false } : failed("lookup");
  } catch {
    return failed("lookup");
  }

  let output: RemediationOutput | null;
  try {
    output = await actions.generate();
  } catch {
    return failed("generation");
  }
  if (!output) return failed("generation");
  // Remediation restores a deep AI interpretation. A deterministic fallback is
  // the ordinary path's safety net, not a replacement for what is owed.
  if (output.source !== "ai" || output.depth !== "deep") return failed("policy");

  try {
    const version = await actions.append({ userId, reportId, requestId, output });
    return servable(version, historyId) ? { status: "served", version, created: true } : failed("append");
  } catch (error) {
    if (error instanceof RemediationAppendError) {
      if (error.code === REMEDIATION_NOT_AVAILABLE_SQLSTATE) return { status: "not_available" };
      // The primitive refuses a request id reused with different output. That is
      // a concurrent twin of this request having committed first: serve it.
      if (error.code === "22023") {
        try {
          const twin = await actions.findVersion(reportId, requestId);
          if (servable(twin, historyId)) return { status: "served", version: twin, created: false };
        } catch {
          // fall through to failed
        }
      }
    }
    return failed("append");
  }
}

/** HTTP status and body for the two non-served outcomes. Neither says why. */
export function remediationErrorResponse(
  outcome: Exclude<RemediationOutcome, { status: "served" }>,
): { status: number; body: Record<string, unknown> } {
  return outcome.status === "not_available"
    ? { status: 404, body: { error: REMEDIATION_NOT_AVAILABLE } }
    : { status: 503, body: { error: REMEDIATION_FAILED, retryable: true } };
}

/** Explicit identities: the version is never presented as the historical row. */
export function remediationServedBody(version: RemediationVersion, created: boolean): Record<string, unknown> {
  return {
    success: true,
    mode: LEGACY_REMEDIATION_MODE,
    source: "ai",
    access: "full",
    interpretation: version.full,
    historical_interpretation_id: version.historicalInterpretationId,
    version: { id: version.versionId, generated_at: version.generatedAt },
    reused: !created,
  };
}

/** A database error raised by the history guard (ordinary writers on legacy rows). */
export function isHistoryProtected(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === HISTORY_PROTECTED_SQLSTATE;
}

/** Thrown by the ordinary claim commit when the history guard refused it. */
export class ProtectedHistoryError extends Error {
  constructor() {
    super("historical interpretation is protected");
    this.name = "ProtectedHistoryError";
  }
}

/**
 * Ordinary regeneration of a protected legacy row. Not an error about the
 * report: nothing was written, the report keeps its status, and the client can
 * act on the code. Turn 8 owns the client handling and any refund.
 */
export const legacyHistoryProtectedResponse = { status: 409, body: { error: LEGACY_HISTORY_PROTECTED } };
