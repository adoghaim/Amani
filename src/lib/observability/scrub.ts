/*
  PHI scrubbing for Sentry error reports.

  Amani handles protected health information: biomarker values, cycle data,
  symptom logs, uploaded lab files. Sentry is an outbound channel to a third
  party, so everything leaving through it passes through this module first.

  Everything here is pure and free of Sentry runtime imports (the types below
  are structural, not imported), so the whole policy is unit-testable without a
  browser, a DSN, or an initialised client. `initSentry.ts` is the only wiring.

  The rule this encodes: identifiers and free text are redacted; structure —
  exception type, stack frames, breadcrumb categories, route shape — is kept,
  because an error report nobody can debug is a failure too.
*/

/** The subset of a Sentry event this module reads or rewrites. */
export interface ScrubbableEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  request?: {
    url?: string;
    data?: unknown;
    query_string?: unknown;
    cookies?: Record<string, string>;
    headers?: { [key: string]: string };
  };
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: ScrubbableBreadcrumb[];
  contexts?: Record<string, unknown>;
  extra?: { [key: string]: unknown };
  user?: unknown;
}

/** The subset of a Sentry breadcrumb this module reads or rewrites. */
export interface ScrubbableBreadcrumb {
  category?: string;
  message?: string;
  data?: { [key: string]: unknown };
}

/*
  Free-text redaction patterns.

  Only ever used with `String.prototype.replace`, never `.test()` or `.exec()`:
  a module-level /g regex carries `lastIndex` between calls, and `replace` is
  the one method that resets it.
*/
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
/* Supabase access/refresh tokens are JWTs; they always start with the base64 of `{"`. */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g;

/**
 * Redact direct identifiers from a free-text string.
 *
 * Deliberately narrow. It removes the things that are identifiers by
 * construction — emails, UUIDs, JWTs — and leaves prose alone, so an exception
 * message stays readable enough to act on.
 */
export function scrubText(text: string): string {
  return text
    .replace(JWT_PATTERN, '[token]')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(UUID_PATTERN, '[id]');
}

/** A path segment that identifies one row rather than naming a route. */
function isIdentifierSegment(segment: string): boolean {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)
  ) {
    return true;
  }
  /* `${Date.now()}.pdf` storage keys, and any numeric row id. */
  return /^\d{6,}(?:\.[A-Za-z0-9]+)?$/.test(segment);
}

/**
 * Reduce a URL to the part that is safe to transmit: origin plus route shape.
 *
 * Two separate jobs.
 *
 * The query string and fragment go entirely. Supabase runs with
 * `detectSessionInUrl`, so an auth callback lands with `access_token` in the
 * hash and the PKCE `code` in the query — neither may reach a third party.
 *
 * Identifying path segments are then parameterised: `/app/reports/<uuid>`
 * becomes `/app/reports/:id`. A report id identifies one person's lab results,
 * and knowing *which* report crashed is worth less than not shipping the
 * identifier — the route shape is what points at the bug.
 */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  const withoutSecrets = cut === -1 ? url : url.slice(0, cut);
  const parameterised = withoutSecrets
    .split('/')
    .map((segment) => (isIdentifierSegment(segment) ? ':id' : segment))
    .join('/');
  return scrubText(parameterised);
}

/*
  Attributes whose values are user-facing copy, and therefore may be PHI.

  Sentry builds `ui.click` / `ui.input` breadcrumb messages with
  `htmlTreeAsString`, which unconditionally appends `[aria-label="…"]`,
  `[title="…"]` and `[alt="…"]` for every element in the ancestor chain. That
  loop is hardcoded in @sentry/core — there is NO init option that turns it
  off, so it has to be undone here.

  It is a real leak, not a theoretical one: `CycleDial` renders
  aria-label="Cycle day 21 of 28, luteal phase", so one tap on the dashboard
  would otherwise put a user's cycle position in a breadcrumb.

  `type` and `name` are kept: they are developer-chosen machine identifiers
  ("submit", "email"), and they are part of what makes a target string useful.
*/
const REDACTED_DOM_ATTRIBUTES = /\[(aria-label|title|alt)="[^"]*"\]/gi;

/**
 * Strip user-facing attribute values out of a Sentry DOM target string, keeping
 * the element path (tag, id, classes) that makes it debuggable.
 */
export function scrubDomTarget(target: string): string {
  return scrubText(target.replace(REDACTED_DOM_ATTRIBUTES, '[$1]'));
}

/*
  PK-FIX-01b: free text that can carry report content. An exception message is
  where a parser or JSON error echoes what it was reading ("Unexpected token in
  'Jane Doe ... Ferritin 12 ng/mL'"), so on top of scrubText it loses quoted
  text (where names and report text sit), every number-with-unit (a lab value),
  and everything past MAX_FREE_TEXT_LENGTH characters.
*/
const QUOTED_PATTERN = /"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g;
/* A quoted lower-case identifier ('value', 'json_output') names code, not a person: kept. */
const CODE_IDENTIFIER = /^(["'`])[a-z_$][A-Za-z0-9_$.]*\1$/;
const MEASUREMENT_PATTERN =
  /(?:[<>≤≥]\s?)?\d+(?:[.,]\d+)?\s?(?:%|[A-Za-zµμ]{1,5}\/[A-Za-z0-9.^]{1,6}|(?:mmol|pmol|nmol|mIU|uIU|µIU|mcg|mg|ng|pg|µg|ug|IU|iu|U|g|L|dL|mL|fL|kg|lb|bpm)\b)/g;
export const MAX_FREE_TEXT_LENGTH = 500;
export const REPORT_TEXT_REMOVED = '[report text removed]';

/**
 * scrubText, plus quoted text, lab values, and echoed report text: for
 * messages that may carry report content.
 *
 * A message holding more than one lab value, or longer than
 * MAX_FREE_TEXT_LENGTH, is report text echoed by a parser or JSON error, where
 * names and dates of birth sit unquoted and cannot be found by pattern. It is
 * cut to its first three words, which name the failure, plus a marker.
 */
export function scrubFreeText(text: string): string {
  const out = scrubText(text)
    .replace(QUOTED_PATTERN, (quoted) => (CODE_IDENTIFIER.test(quoted) ? quoted : '[text]'))
    .replace(MEASUREMENT_PATTERN, '[value]');
  const values = out.split('[value]').length - 1;
  if (values > 1 || text.length > MAX_FREE_TEXT_LENGTH) {
    return `${out.split(/\s+/).filter(Boolean).slice(0, 3).join(' ')} ${REPORT_TEXT_REMOVED}`;
  }
  return out;
}

const MAX_SCRUB_DEPTH = 6;

/*
  PK-FIX-01b: keys whose values are a person's details or her health content,
  whatever their shape. Redacted outright rather than pattern-scrubbed, because
  a name or a lab value has no pattern to find.
*/
const SENSITIVE_KEY =
  /^(?:[a-z]+_)?(?:name|first_?name|last_?name|full_?name|display_?name|email|phone|dob|birth_?date|date_of_birth|address|value|value_numeric|values|result|results|raw_?text|text|report_?text|extracted_?text|notes?|interpretation|biomarkers?|analytes?)$/i;

/** Recursively redact identifiers from an arbitrary structured value. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  /* Past the depth cap, fail closed: an unscrubbed subtree must not be sent. */
  if (depth >= MAX_SCRUB_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrubValue(entry, depth + 1);
  }
  return out;
}

/*
  Breadcrumb data keys that hold a URL: `to`/`from` on navigation crumbs, `url`
  on fetch and xhr.
*/
const URL_DATA_KEYS = ['url', 'to', 'from'];

/**
 * Scrub one breadcrumb in place. Returns `null` for breadcrumbs that must be
 * dropped outright rather than cleaned.
 *
 * Mutates rather than copying because Sentry's `beforeBreadcrumb` hands back
 * the same object it passes in; the pure logic all lives in the helpers above.
 */
export function scrubBreadcrumb(
  crumb: ScrubbableBreadcrumb,
): ScrubbableBreadcrumb | null {
  /*
    Console breadcrumbs are already off in the init options. Dropping them here
    too means the guarantee survives someone re-enabling the integration:
    `pdfExtractor` console.logs the first 500 characters of the lab report.
  */
  if (crumb.category === 'console') return null;

  if (typeof crumb.message === 'string') {
    crumb.message = crumb.category?.startsWith('ui.')
      ? scrubDomTarget(crumb.message)
      : scrubFreeText(crumb.message);
  }

  const data = crumb.data;
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (URL_DATA_KEYS.includes(key)) {
        if (typeof value === 'string') data[key] = scrubUrl(value);
      } else {
        data[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrubValue(value);
      }
    }
  }

  return crumb;
}

/**
 * Scrub a whole Sentry event in place, and return it.
 *
 * What survives on purpose: exception type, exception message (identifiers
 * redacted), the full stack trace, release, environment, platform, and
 * breadcrumb structure. Stack frames are never touched — they are the payload
 * that makes a crash fixable, they hold code paths rather than user data, and
 * an uploaded source map can symbolicate them (vite.config.ts publishes none).
 */
export function scrubEvent(event: ScrubbableEvent): ScrubbableEvent {
  /*
    No direct identifiers. Nothing calls Sentry.setUser today; deleting
    unconditionally keeps that true if someone adds a call later, and takes
    `ip_address` with it.
  */
  delete event.user;
  /*
    `extra` is a free-form bag. Nothing populates it today, so dropping it costs
    nothing now and fails closed if a future call site puts a biomarker payload
    in there.
  */
  delete event.extra;

  if (typeof event.message === 'string') {
    event.message = scrubFreeText(event.message);
  }
  if (event.logentry) {
    if (typeof event.logentry.message === 'string') {
      event.logentry.message = scrubFreeText(event.logentry.message);
    }
    /* Format arguments are values by definition (PK-FIX-01b): never sent. */
    delete event.logentry.params;
  }

  const request = event.request;
  if (request) {
    if (typeof request.url === 'string') request.url = scrubUrl(request.url);
    /*
      `httpContextIntegration` fills headers.Referer from `document.referrer` —
      a full URL, complete with the auth-callback fragment and any report id.
      The previous configuration scrubbed request.url but not this.
    */
    const headers = request.headers;
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'cookie' || lower === 'authorization') {
          delete headers[key];
        } else if (lower === 'referer' || lower === 'referrer') {
          headers[key] = scrubUrl(value);
        }
      }
    }
    /* Request/response bodies are the classic leak path. Never send them. */
    delete request.data;
    delete request.query_string;
    delete request.cookies;
  }

  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === 'string') value.value = scrubFreeText(value.value);
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  }

  if (event.breadcrumbs) {
    const kept: ScrubbableBreadcrumb[] = [];
    for (const crumb of event.breadcrumbs) {
      if (scrubBreadcrumb(crumb)) kept.push(crumb);
    }
    event.breadcrumbs = kept;
  }

  return event;
}
