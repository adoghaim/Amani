/*
  Client side of the `get-interpretation` contract (PR 3a).

  The endpoint is the only place a flag-on client reads an interpretation body
  from; the server has already chosen Full or Basic and stripped whatever this
  viewer may not see. This module only has to turn the response — or the
  failure — into one of four render states, and the rule for doing that is:

    fail closed on shape, never on entitlement.

  Anything we cannot read as a well-formed response becomes `error`, which the
  report view renders as a retryable error. It never becomes `basic` (that
  would tell a paying customer they are on Free) and never opens a paywall.

  No Supabase import, so the tests can drive it with a fake `invoke`.
*/

export type InterpretationAccess = 'full' | 'basic' | 'error' | 'generation_needed';

export interface LockedCounts {
  patterns: number;
  cross_report: number;
  lifestyle: number;
}

export interface PremiumPreview {
  kind: string;
  content: unknown;
}

/**
 * PK-PL-A: the server's answer to "can a regeneration of this stored report
 * succeed for this viewer?" — generate-interpretation's own entitlement and
 * depth decision, reported by get-interpretation.
 */
export interface RegenerationAvailability {
  available: boolean;
  /** Why not, in the server's vocabulary; null when available. */
  reason: string | null;
}

export interface InterpretationAccessResult {
  access: InterpretationAccess;
  interpretation: Record<string, unknown> | null;
  preview: PremiumPreview | null;
  locked: LockedCounts;
  plan: 'premium' | 'free' | null;
  complimentary: { used: number; total: number; remaining: number } | null;
  stored_depth: string | null;
  /** Null when the server did not say (nothing stored, flag off, an error, or a
   * server older than PK-PL-A): the stored-state rule decides alone, as before. */
  regeneration: RegenerationAvailability | null;
  code: string | null;
  retryable: boolean;
}

const EMPTY_LOCKED: LockedCounts = Object.freeze({ patterns: 0, cross_report: 0, lifestyle: 0 });

export function accessError(code: string, retryable = true): InterpretationAccessResult {
  return {
    access: 'error', interpretation: null, preview: null, locked: EMPTY_LOCKED,
    plan: null, complimentary: null, stored_depth: null, regeneration: null, code, retryable,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const count = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;

function parseLocked(value: unknown): LockedCounts {
  if (!isRecord(value)) return EMPTY_LOCKED;
  return { patterns: count(value.patterns), cross_report: count(value.cross_report), lifestyle: count(value.lifestyle) };
}

function parsePreview(value: unknown): PremiumPreview | null {
  if (!isRecord(value) || value.content == null || value.content === '') return null;
  return { kind: typeof value.kind === 'string' ? value.kind : 'pattern', content: value.content };
}

/** A malformed answer is treated as no answer: the stored-state rule decides, as before PK-PL-A. */
function parseRegeneration(value: unknown): RegenerationAvailability | null {
  if (!isRecord(value) || typeof value.available !== 'boolean') return null;
  return { available: value.available, reason: typeof value.reason === 'string' ? value.reason : null };
}

function parseComplimentary(value: unknown): InterpretationAccessResult['complimentary'] {
  if (!isRecord(value)) return null;
  const { used, total, remaining } = value;
  if (![used, total, remaining].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0)) return null;
  return { used: used as number, total: total as number, remaining: remaining as number };
}

/** Reads a response body. Unknown `access` values and malformed bodies are errors. */
export function parseInterpretationAccess(raw: unknown): InterpretationAccessResult {
  if (!isRecord(raw)) return accessError('malformed_response');
  const access = raw.access;
  if (access === 'error') {
    return accessError(typeof raw.code === 'string' ? raw.code : 'unknown_error', raw.retryable !== false);
  }
  if (access !== 'full' && access !== 'basic' && access !== 'generation_needed') {
    return accessError('malformed_response');
  }
  const interpretation = isRecord(raw.interpretation) ? raw.interpretation : null;
  // A Full or Basic answer without a body cannot be rendered as either.
  if ((access === 'full' || access === 'basic') && !interpretation) return accessError('malformed_response');
  return {
    access,
    interpretation,
    // Previews and locked cards belong to Basic; a Full body carries no upsell.
    preview: access === 'full' ? null : parsePreview(raw.preview),
    locked: access === 'full' ? EMPTY_LOCKED : parseLocked(raw.locked),
    plan: raw.plan === 'premium' || raw.plan === 'free' ? raw.plan : null,
    complimentary: parseComplimentary(raw.complimentary),
    stored_depth: typeof raw.stored_depth === 'string' ? raw.stored_depth : null,
    regeneration: parseRegeneration(raw.regeneration),
    code: null,
    retryable: false,
  };
}

/** The slice of `supabase.functions.invoke` this module needs. */
export type InvokeFn = (
  name: string,
  options: { body: Record<string, unknown> },
) => Promise<{ data: unknown; error: unknown }>;

/** A `FunctionsHttpError`, recognised by shape so tests need not construct one. */
function httpContext(error: unknown): { status: number; json: () => Promise<unknown> } | null {
  if (!isRecord(error) || !isRecord(error.context)) return null;
  const context = error.context as { status?: unknown; json?: unknown };
  if (typeof context.status !== 'number' || typeof context.json !== 'function') return null;
  return { status: context.status, json: () => (context.json as () => Promise<unknown>).call(error.context) };
}

/**
 * One call to `get-interpretation`. Never throws, never polls — the endpoint is
 * rate limited per day, so the caller decides when (report open, generation
 * complete, explicit retry) and this makes exactly one request.
 */
export async function fetchInterpretationAccess(
  invoke: InvokeFn,
  reportId: string,
): Promise<InterpretationAccessResult> {
  try {
    const { data, error } = await invoke('get-interpretation', { body: { reportId } });
    if (!error) return parseInterpretationAccess(data);
    const http = httpContext(error);
    if (!http) return accessError('network_error');
    const body = await http.json().catch(() => null);
    if (http.status === 429) return accessError('rate_limit_exceeded', false);
    if (isRecord(body) && body.access === 'error') return parseInterpretationAccess(body);
    return accessError(isRecord(body) && typeof body.code === 'string' ? body.code : `http_${http.status}`,
      http.status >= 500);
  } catch {
    return accessError('network_error');
  }
}

/** The Basic interpretation line, when it adds something beyond the headline. */
export function basicInterpretationText(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const text = typeof payload.basic_interpretation === 'string' ? payload.basic_interpretation.trim() : '';
  const headline = typeof payload.headline === 'string' ? payload.headline.trim() : '';
  return text && text !== headline ? text : null;
}

/** Title and body for a preview, whatever shape its content arrived in. */
export function previewText(preview: PremiumPreview): { title: string | null; body: string } | null {
  const { content } = preview;
  if (typeof content === 'string') return content.trim() ? { title: null, body: content.trim() } : null;
  if (!isRecord(content)) return null;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = content[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  };
  const title = pick('title', 'name', 'label');
  const body = pick('explanation', 'summary', 'description', 'text', 'detail');
  if (!body && !title) return null;
  return body ? { title, body } : { title: null, body: title! };
}
