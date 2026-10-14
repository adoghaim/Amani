/**
 * The "Regenerate (N left)" limit, enforced by the server (PK-REGEN-01, R26).
 *
 * Before this module the limit lived only in the browser: ReportView wrote
 * `lab_reports.regeneration_count` itself, so any caller could reset it. Now
 * generate-interpretation owns the count:
 *
 *   - it refuses a counted regeneration once the report has used
 *     REGENERATION_LIMIT, before any model spend, with the calm 4xx shape the
 *     client already reads as "a new analysis isn't available"
 *     (400 {"error":"regeneration_limit_reached"});
 *   - it counts a regeneration only after it wrote a version for this request
 *     (PK-PL-A: a failure that wrote nothing spends no attempt). A retry served
 *     from the version store, or a concurrent twin's version, created nothing
 *     here and is not counted again.
 *
 * What counts is decided in one place, `countsAgainstLimit`:
 *   - an ordinary regeneration of a stored analysis counts;
 *   - the fuller-analysis offer (the flag-on "Generate full Amani analysis" on a
 *     stored body) does not, as on the client before this packet, and only
 *     while the stored analysis is not already the deep one. That fact is read
 *     by the server, so the label alone cannot buy an uncounted regeneration;
 *   - a value-correction refresh (PK-CORRECT-01, D20) follows Adell's ruling.
 *     Until he rules it does not count (the proposed default, [Pending]). The
 *     request schema does not accept it yet: PK-CORRECT-01 must establish the
 *     correction on the server before it may use this purpose.
 *
 * Pure: no Deno, no network, no clock. The handler supplies the actions port.
 */

export const REGENERATION_LIMIT = 3;
export const REGENERATION_LIMIT_REACHED = "regeneration_limit_reached";

/** Adell's D20 ruling, pending: does a value-correction refresh count? Proposed default: no. */
export const CORRECTION_REFRESH_COUNTS = false;

export type RegenerationPurpose = "regenerate" | "fuller_analysis" | "correction";

/** Whether this write, if it happens, spends one of the report's regenerations. */
export function countsAgainstLimit(input: {
  purpose: RegenerationPurpose;
  /** The selected interpretation's stored depth, as the server read it. */
  selectedDepth: string | null;
}): boolean {
  if (input.purpose === "correction") return CORRECTION_REFRESH_COUNTS;
  if (input.purpose === "fuller_analysis") return input.selectedDepth === "deep";
  return true;
}

export interface RegenerationLimitActions {
  /** The report's current count. Throws when it cannot be read: the limit fails closed. */
  readCount(): Promise<number>;
  /** Adds one written regeneration atomically; the new count, or null if no row changed. */
  record(): Promise<number | null>;
  warn(message: string): void;
}

export type RegenerationAdmission = { admitted: true; count: number } | { admitted: false; count: number };

/** Before generation: is there a regeneration left? Only asked for a counted request. */
export async function admitRegeneration(actions: RegenerationLimitActions): Promise<RegenerationAdmission> {
  const count = await actions.readCount();
  if (!Number.isInteger(count) || count < 0) throw new Error("Unexpected regeneration count");
  return { admitted: count < REGENERATION_LIMIT, count };
}

/**
 * After the write: count it, once, only when this request created a version.
 * The version already stands, so a failure to count is logged and never turns
 * a written regeneration into an error answer (the attempt is simply not
 * spent, and the daily rate limit still bounds the cost).
 */
export async function recordRegeneration(
  actions: RegenerationLimitActions,
  input: { counted: boolean; created: boolean },
): Promise<number | null> {
  if (!input.counted || !input.created) return null;
  try {
    const count = await actions.record();
    if (count === null) actions.warn("[regeneration-limit] count not recorded: report row not found for this user");
    return count;
  } catch (err) {
    actions.warn(`[regeneration-limit] count not recorded: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The refusal: calm, 4xx, nothing written, no model spend. */
export const regenerationLimitResponse = { status: 400, body: { error: REGENERATION_LIMIT_REACHED } };
