/*
  Report-view orchestration for the flag-on read path, kept pure so Vitest can
  drive it without a DOM: when ReportView asks get-interpretation, how a new
  answer is merged with the one on screen, when regenerate is offered, and what
  a failed generate request means.
*/
import type { InterpretationAccessResult } from './interpretationAccess';

/**
 * The identity of one get-interpretation read. Null means "do not ask": flag
 * off, no report yet, or still processing (the 3 s status poll owns that
 * phase and never reads the body). The status itself is deliberately not part
 * of the key — an error → ready flip after a regenerate must not cost a second
 * read on top of the explicit refresh (`nonce`) that follows it.
 */
export function accessRequestKey(input: {
  freemium: boolean;
  reportId: string | undefined;
  status: string | undefined;
  nonce: number;
}): string | null {
  const { freemium, reportId, status, nonce } = input;
  if (!freemium || !reportId || !status || status === 'processing') return null;
  return `${reportId}:${nonce}`;
}

export interface AccessRequester {
  /**
   * Starts a read for `key` unless it is null, already the latest key, or still in flight.
   * Returns whether a request was made. A response is delivered only while
   * its key is active, using the latest callback for that key.
   */
  request(key: string | null, reportId: string, onResult: (result: InterpretationAccessResult) => void): boolean;
}

export function createAccessRequester(
  fetchAccess: (reportId: string) => Promise<InterpretationAccessResult>,
): AccessRequester {
  let latest: string | null = null;
  const inFlight = new Map<string, { onResult: (result: InterpretationAccessResult) => void }>();
  return {
    request(key, reportId, onResult) {
      if (key === null || key === latest) return false;
      latest = key;
      const pending = inFlight.get(key);
      if (pending) {
        pending.onResult = onResult;
        return false;
      }
      const request = { onResult };
      inFlight.set(key, request);
      void fetchAccess(reportId).then(result => {
        inFlight.delete(key);
        if (latest === key) request.onResult(result);
      }, () => {
        // Injected fetchers may reject. Deliver nothing and allow the same key
        // to retry; a stale failure must not clear a newer active request.
        inFlight.delete(key);
        if (latest === key) latest = null;
      });
      return true;
    },
  };
}

const hasBody = (state: InterpretationAccessResult | null) =>
  !!state && (state.access === 'full' || state.access === 'basic') && state.interpretation !== null;

/**
 * Merges a fresh answer into what is on screen. An error (429, 503, network)
 * never replaces a body the user is already reading: the body stays and the
 * error is reported separately, as an inline notice.
 */
export function applyAccessResult(
  current: InterpretationAccessResult | null,
  next: InterpretationAccessResult,
): { state: InterpretationAccessResult; inlineError: InterpretationAccessResult | null } {
  if (next.access === 'error' && hasBody(current)) return { state: current!, inlineError: next };
  return { state: next, inlineError: null };
}

/**
 * Flag on, regenerate is offered by what is stored, not by the viewer's plan:
 * nothing usable yet (`generation_needed`) or a body below the deep analysis.
 * The server decides whether this viewer may have a deep one (402 → paywall).
 * Unknown (no answer yet, or an error) offers nothing.
 */
export function freemiumCanRegenerate(state: InterpretationAccessResult | null, regenerationCount: number): boolean {
  if (regenerationCount >= 3 || !state || state.access === 'error') return false;
  return state.access === 'generation_needed' || state.stored_depth !== 'deep';
}

export type GenerateFailure = 'premium_required' | 'rate_limited' | 'failed';

/** What a failed generate-interpretation call means, by HTTP status. */
export function generateFailureKind(status: number | undefined): GenerateFailure {
  if (status === 402) return 'premium_required';
  if (status === 429) return 'rate_limited';
  return 'failed';
}
