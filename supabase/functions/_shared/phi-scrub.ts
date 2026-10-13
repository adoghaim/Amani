/**
 * PHI scrubbing for error reports leaving an edge function (PK-FIX-01b, D5.1).
 *
 * The server twin of src/lib/observability/scrub.ts, deliberately stricter:
 * an edge function's error text is built from what it was handling (OCR text,
 * model output, a Postgres error quoting a row), so the reporter sends only a
 * scrubbed, length-capped message and never a request body, a header, a user
 * or a value bag.
 *
 * Removed from every string that leaves:
 *   - direct identifiers: email addresses, UUIDs, JWTs, bearer tokens and
 *     key-shaped secrets (sk-..., sb_...);
 *   - lab values: a number followed by a unit ("4.2 uIU/mL", "95 mg/dL",
 *     "12%"), and every other number (bare values, dates of birth, record and
 *     phone numbers);
 *   - quoted text, which is where Postgres and model errors put row content
 *     ('Key (email)=(jane@x.com)', "unexpected token 'Ferritin 12'");
 *   - echoed report text: a message holding more than one lab value, or longer
 *     than MAX_SCRUBBED_LENGTH characters, is cut to its first three words
 *     (which name the failure) plus REPORT_TEXT_REMOVED.
 *
 * Names cannot be recognised in free text, which is why quoted text and echoed
 * report text go, and why nothing but this scrubbed message, the error type
 * and fixed tags is ever sent.
 *
 * Pure: no Deno, no I/O, so Vitest drives it directly.
 */

export const MAX_SCRUBBED_LENGTH = 300;
export const REPORT_TEXT_REMOVED = "[report text removed]";

/*
  Only ever used with String.prototype.replace, which resets lastIndex; never
  with .test() or .exec(), where a module-level /g regex keeps state.
*/
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_KEY = /\b(?:sk|pk|rk|sb|whsec)[-_][A-Za-z0-9_-]{8,}/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const QUOTED = /"[^"\n]*"|'[^'\n]*'|`[^`\n]*`|\([^()\n]*=[^()\n]*\)/g;
/* A measurement: a number, then a unit ("4.2 uIU/mL", "95 mg/dL", "12 %", "3 IU"). */
const MEASUREMENT =
  /(?:[<>≤≥]\s?)?\d+(?:[.,]\d+)?\s?(?:%|[A-Za-zµμ]{1,5}\/[A-Za-z0-9.^]{1,6}|(?:mmol|pmol|nmol|mIU|uIU|µIU|mcg|mg|ng|pg|µg|ug|IU|iu|U|g|L|dL|mL|fL|kg|lb|bpm)\b)/g;
/* Every other number: a bare value, a date, a phone number, a record number. */
const NUMBER = /\d+(?:[.,:/-]\d+)*/g;

/** Redact identifiers and lab values from one string, and cap its length. */
export function scrubServerText(text: string): string {
  const scrubbed = text
    .replace(JWT, "[token]")
    .replace(BEARER, "Bearer [token]")
    .replace(SECRET_KEY, "[secret]")
    .replace(EMAIL, "[email]")
    .replace(UUID, "[id]")
    .replace(QUOTED, "[text]")
    .replace(MEASUREMENT, "[value]")
    .replace(NUMBER, "[n]");
  // More than one lab value, or a message past the cap, is echoed report text:
  // its unquoted names cannot be found by pattern, so keep only the first
  // words, which name the failure.
  if (scrubbed.split("[value]").length > 2 || text.length > MAX_SCRUBBED_LENGTH) {
    return `${scrubbed.split(/\s+/).filter(Boolean).slice(0, 3).join(" ")} ${REPORT_TEXT_REMOVED}`;
  }
  return scrubbed;
}

/** An error's type: its name when it is an Error, else a fixed label. Never its content. */
export function errorType(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)) return error.name;
  return typeof error === "string" ? "StringError" : "UnknownError";
}

/** An error's message, scrubbed. A non-Error value is described by its type only. */
export function scrubbedErrorMessage(error: unknown): string {
  if (error instanceof Error) return scrubServerText(error.message);
  if (typeof error === "string") return scrubServerText(error);
  return "non-Error value thrown";
}
