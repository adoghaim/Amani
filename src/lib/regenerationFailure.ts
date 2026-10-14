/*
  What a failed regeneration means, and what to say about it (PK-PL-A, Adell's
  pre-launch rulings).

  Once a report holds an interpretation, generate-interpretation regenerates it
  by appending a version keyed by the tap's `request_id` (TASK-048), and it
  writes that version only on success. Every failure answer means nothing was
  written: no version, no claim, no change to the interpretation on screen. A
  failure is therefore never an "error" on the report and never spends one of
  its regeneration attempts. ReportView puts back the status and the attempt it
  spent optimistically, in both flag states, and shows one of the calm notices
  below.

  The server's outcomes, and what they mean here:

    402                                  premium_required  the plan does not include it
    429                                  rate_limited      today's analysis limit
    409 legacy_history_protected         already_saved     another write won; nothing replaced
    400 request_id_required              unavailable       this request cannot be keyed
    503 regeneration_failed, retryable   retryable         nothing appended; try again
    503 regeneration_failed, !retryable  unavailable       cannot succeed for this viewer now
    anything else, or no answer          retryable         a retry re-sends the same request_id

  409 is read from the status as well as the code, so a later rename of
  `legacy_history_protected` keeps working (see the PK-PL-A [Pending]).

  Pure apart from reading the failed Response's body, which it clones so the
  other readers (`handle402`, `rateLimitMessage`) still can.
*/

import { FREEMIUM_COPY } from './freemium/copy';

export type RegenerationFailureKind =
  | 'premium_required'
  | 'rate_limited'
  | 'already_saved'
  | 'unavailable'
  | 'retryable';

/** The kinds that are shown as an inline notice above the analysis. */
export type RegenerationNoticeKind = Extract<RegenerationFailureKind, 'already_saved' | 'unavailable' | 'retryable'>;

/** Stable server codes (generate-interpretation, `_shared/interpretation-version-write.ts`). */
export const REGENERATION_FAILED = 'regeneration_failed';
export const REQUEST_ID_REQUIRED = 'request_id_required';
export const LEGACY_HISTORY_PROTECTED = 'legacy_history_protected';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** What a failed generate-interpretation call means, from its status and body. */
export function classifyRegenerationFailure(status: number | undefined, body: unknown): RegenerationFailureKind {
  if (status === 402) return 'premium_required';
  if (status === 429) return 'rate_limited';
  const code = isRecord(body) && typeof body.error === 'string' ? body.error : null;
  if (status === 409 || code === LEGACY_HISTORY_PROTECTED) return 'already_saved';
  if (code === REQUEST_ID_REQUIRED) return 'unavailable';
  if (code === REGENERATION_FAILED && isRecord(body) && body.retryable === false) return 'unavailable';
  return 'retryable';
}

/** A `FunctionsHttpError`'s Response, recognised by shape so tests need not construct one. */
function failedResponse(error: unknown): { status: number; clone: () => { json: () => Promise<unknown> } } | null {
  if (!isRecord(error) || !isRecord(error.context)) return null;
  const context = error.context as { status?: unknown; clone?: unknown };
  if (typeof context.status !== 'number' || typeof context.clone !== 'function') return null;
  return { status: context.status, clone: () => (context.clone as () => { json: () => Promise<unknown> }).call(error.context) };
}

/** Reads a failed call. A network or relay failure has no answer: retryable. */
export async function regenerationFailureOf(error: unknown): Promise<RegenerationFailureKind> {
  const response = failedResponse(error);
  if (!response) return 'retryable';
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    // Already read, or not JSON: the status alone decides.
  }
  return classifyRegenerationFailure(response.status, body);
}

/*
  Copy. The retryable strings are the flag-on ones already in FREEMIUM_COPY
  (TASK-048 turn 10, not §6-locked, owner to confirm); the other two are new
  with PK-PL-A, owner to confirm. None names a plan, so both flag states use
  them. No "error" wording: the analysis on screen is intact.
*/
export const REGENERATION_COPY: Readonly<Record<RegenerationNoticeKind, { title: string; body: string }>> = Object.freeze({
  retryable: {
    title: FREEMIUM_COPY.report.regenerateErrorTitle,
    body: FREEMIUM_COPY.report.regenerateErrorBody,
  },
  unavailable: {
    title: "A new analysis isn't available for this report",
    body: 'Your current analysis is unchanged.',
  },
  already_saved: {
    title: 'Your saved analysis was kept',
    body: 'Nothing was replaced. You are seeing the analysis saved for this report.',
  },
});
