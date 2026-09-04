/**
 * Server-owned identity for a blood draw.
 *
 * Introductory Deep Access is metered per *draw*, not per upload. A person can
 * upload two PDFs from one draw (a panel split across reports, or a re-upload
 * after a failed parse), and can have two genuinely different draws on the same
 * date. Metering on `lab_reports.id` would charge a credit for every upload;
 * metering on the collection date alone would merge two real draws into one.
 *
 * So identity comes from the strongest evidence the server can extract, in this
 * order:
 *
 *   1. `accession`               specimen / accession / order identifier
 *   2. `lab_collection_datetime` normalized lab + collection date AND time
 *   3. `lab_collection_date`     normalized lab + collection date
 *   4. `content_hash`            hash of the uploaded file
 *   5. `unidentified`            none of the above — unique per report
 *
 * `lab_reports.report_date` is deliberately NOT an input. It is client-writable
 * (see `20260501000000_lock_lab_reports_user_write_columns.sql` — it is on the
 * allow-list precisely because users correct it), so entitlement must never
 * consult it. Nothing in this module takes it, which is why it takes structured
 * evidence rather than a report row.
 *
 * ## Ambiguity resolves in the user's favour, in both directions
 *
 * Under-identification (tier 5) mints a key unique to the report, so the draw
 * counts as new and *can* claim a credit rather than being wrongly folded into
 * an earlier draw and denied.
 *
 * Over-identification — two real draws colliding on one key, which tier 3 can
 * do when someone draws twice at the same lab on one day — is also benign,
 * because `introductory-access.ts` grants free access to any draw that already
 * holds a claim. The second draw gets deep access *without* spending the second
 * credit. Both failure directions give the user more, never less.
 *
 * ## Trust boundary
 *
 * Evidence is extracted server-side, but from text the client uploaded. This
 * module therefore prevents accidental double-charging and casual tampering —
 * the client can neither assert a draw id nor state how many credits it has
 * used — not a determined user who mutates an accession number between two
 * uploads of the same draw. That residual is acceptable: the same user could
 * upload two genuinely different reports for the same effect, and the ceiling
 * is 2 lifetime credits either way.
 *
 * Pure: no Deno, no network, no clock, no crypto in the derivation path.
 * `hashDrawKey` is the one async export and uses Web Crypto, which Deno and the
 * test runner both provide.
 */

/** Lab identity, mirroring `LabSource` in `src/utils/parser/types.ts`. */
export type LabIdentity = "quest" | "labcorp" | "hone" | "unknown";

/** Which rung of the evidence hierarchy produced the key. Stored alongside the
 *  claim so "why does this person have 1 credit left" is answerable later. */
export type EvidenceTier =
  | "accession"
  | "lab_collection_datetime"
  | "lab_collection_date"
  | "content_hash"
  | "unidentified";

/** Server-extracted evidence about one draw. Every field is nullable: real lab
 *  PDFs omit any of them, and OCR of a phone photo omits most. */
export interface DrawEvidence {
  /** Specimen / accession / order id, already normalized. */
  accessionId: string | null;
  /** Which lab produced the report. */
  labIdentity: LabIdentity | null;
  /** Collection instant as `YYYY-MM-DDTHH:MM` (no zone — lab reports are local
   *  wall-clock and we only need equality, never ordering across zones). */
  collectionDateTime: string | null;
  /** Collection day as `YYYY-MM-DD`, when no time was found. */
  collectionDate: string | null;
}

export interface BloodDrawIdentity {
  /** Deterministic, human-readable canonical key. Hash before storing. */
  key: string;
  tier: EvidenceTier;
  /** True when the key came from collection evidence (tiers 1-3) rather than a
   *  file hash or a per-report fallback. Drives telemetry, not access. */
  identified: boolean;
}

export interface DeriveOptions {
  /** Hex digest of the uploaded file, when the caller has one. */
  contentHash?: string | null;
  /** Report id, used only for the tier-5 fallback so that regenerating the same
   *  report reuses its key instead of minting a second one. */
  reportId: string;
}

const EMPTY_EVIDENCE: DrawEvidence = {
  accessionId: null,
  labIdentity: null,
  collectionDateTime: null,
  collectionDate: null,
};

/**
 * Builds the canonical key for a draw.
 *
 * The key is a readable, prefixed string rather than an opaque id so that a
 * failure is debuggable from the tier column alone. Callers hash it with
 * `hashDrawKey` before persisting — an accession number is a specimen
 * identifier and does not belong in a table in cleartext.
 */
export function deriveBloodDrawIdentity(
  evidence: Partial<DrawEvidence> | null | undefined,
  options: DeriveOptions,
): BloodDrawIdentity {
  const ev: DrawEvidence = { ...EMPTY_EVIDENCE, ...(evidence ?? {}) };
  const lab = ev.labIdentity ?? "unknown";

  if (ev.accessionId) {
    return {
      key: `acc:${lab}:${ev.accessionId}`,
      tier: "accession",
      identified: true,
    };
  }

  if (ev.collectionDateTime) {
    return {
      key: `dt:${lab}:${ev.collectionDateTime}`,
      tier: "lab_collection_datetime",
      identified: true,
    };
  }

  if (ev.collectionDate) {
    return {
      key: `d:${lab}:${ev.collectionDate}`,
      tier: "lab_collection_date",
      identified: true,
    };
  }

  if (options.contentHash) {
    return {
      key: `sha256:${options.contentHash.toLowerCase()}`,
      tier: "content_hash",
      identified: false,
    };
  }

  // Nothing identified this draw. Key it to the report so a regeneration of the
  // same report reuses the same claim, while a genuinely new upload counts as a
  // new draw and stays eligible.
  return {
    key: `report:${options.reportId}`,
    tier: "unidentified",
    identified: false,
  };
}

/* ------------------------------------------------------------------------- *
 * Evidence extraction
 * ------------------------------------------------------------------------- */

/**
 * Accession / specimen / order identifiers.
 *
 * Quest prints "Specimen ID: AB12345678", LabCorp "Accession Number:
 * 1234567890". The generic forms cover the rest. Ordered most specific first;
 * the first match wins.
 */
const ACCESSION_PATTERNS: readonly RegExp[] = [
  /\bspecimen\s*(?:id|number|no|#)\s*[:.#]?\s*([A-Z0-9][A-Z0-9-]{5,29})\b/i,
  /\baccession\s*(?:number|no|id|#)?\s*[:.#]?\s*([A-Z0-9][A-Z0-9-]{5,29})\b/i,
  /\border\s*(?:number|no|id|#)\s*[:.#]?\s*([A-Z0-9][A-Z0-9-]{5,29})\b/i,
  /\brequisition\s*(?:number|no|id|#)?\s*[:.#]?\s*([A-Z0-9][A-Z0-9-]{5,29})\b/i,
  /\blab\s*(?:reference|ref)\s*(?:number|no|id|#)?\s*[:.#]?\s*([A-Z0-9][A-Z0-9-]{5,29})\b/i,
];

/**
 * Collection date, with optional time. Deliberately anchored on collection
 * words — "reported", "printed" and "received" are different instants and two
 * reports from one draw can disagree on them.
 */
const COLLECTION_LABEL = String.raw`(?:date\s*(?:\/|\s+and\s+|\s*&\s*)?\s*time\s+)?(?:collect(?:ed|ion)|drawn|draw\s+date|specimen\s+collected)`;

const COLLECTION_PATTERNS: readonly RegExp[] = [
  // Collected: 08/14/2026 09:30 AM   |   Collection Date/Time: 8/14/26 9:30
  new RegExp(
    String.raw`${COLLECTION_LABEL}[^\n:]{0,24}[:.]?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s*[,;]?\s*(?:at\s*)?(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?[Mm]\.?)?)?`,
    "i",
  ),
  // Collected: 2026-08-14 09:30
  new RegExp(
    String.raw`${COLLECTION_LABEL}[^\n:]{0,24}[:.]?\s*(\d{4})-(\d{2})-(\d{2})(?:\s*[T,;]?\s*(\d{1,2}):(\d{2}))?`,
    "i",
  ),
];

const LAB_PATTERNS: readonly (readonly [RegExp, LabIdentity])[] = [
  [/quest\s*diagnostics/i, "quest"],
  [/labcorp|laboratory\s+corporation/i, "labcorp"],
  [/hone\s+health|honehealth\.com/i, "hone"],
];

/** Accessions must look like identifiers, not like prose or a bare year. */
function isPlausibleAccession(raw: string): boolean {
  const value = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (value.length < 6 || value.length > 30) return false;
  // Needs a digit — "SPECIMEN ID: PENDING" and similar are not identifiers.
  if (!/\d/.test(value)) return false;
  // All-zero / repeated-character placeholders.
  if (/^(.)\1+$/.test(value)) return false;
  return true;
}

function normalizeAccession(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Two-digit years on lab reports are this century; 1926 is not a lab date. */
function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  return 2000 + n;
}

function buildDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function buildTime(
  hour: number,
  minute: number,
  meridiem: string | undefined,
): string | null {
  let h = hour;
  if (meridiem) {
    const isPm = meridiem.toLowerCase() === "p";
    if (h === 12) h = isPm ? 12 : 0;
    else if (isPm) h += 12;
  }
  if (h < 0 || h > 23) return null;
  if (minute < 0 || minute > 59) return null;
  return `${pad2(h)}:${pad2(minute)}`;
}

/**
 * Pulls draw evidence out of raw report text.
 *
 * Returns nulls rather than guessing: a wrong accession is worse than none,
 * because it fabricates a distinct draw. Every consumer treats a null as
 * "fall through to the next tier".
 */
export function extractDrawEvidence(
  rawText: string | null | undefined,
): DrawEvidence {
  if (!rawText || typeof rawText !== "string") return { ...EMPTY_EVIDENCE };

  // Lab reports run to tens of thousands of characters; identifiers and the
  // collection block sit in the header. Bounding the scan keeps this cheap and
  // avoids matching a patient's *previous* results printed further down.
  const head = rawText.slice(0, 8000);

  let labIdentity: LabIdentity | null = null;
  for (const [pattern, identity] of LAB_PATTERNS) {
    if (pattern.test(head)) {
      labIdentity = identity;
      break;
    }
  }

  let accessionId: string | null = null;
  for (const pattern of ACCESSION_PATTERNS) {
    const match = head.match(pattern);
    const captured = match?.[1];
    if (captured && isPlausibleAccession(captured)) {
      accessionId = normalizeAccession(captured);
      break;
    }
  }

  let collectionDateTime: string | null = null;
  let collectionDate: string | null = null;

  for (const [index, pattern] of COLLECTION_PATTERNS.entries()) {
    const match = head.match(pattern);
    if (!match) continue;

    const isIso = index === 1;
    const a = match[1];
    const b = match[2];
    const c = match[3];
    if (!a || !b || !c) continue;

    const date = isIso
      ? buildDate(Number(a), Number(b), Number(c))
      : buildDate(expandYear(c), Number(a), Number(b));
    if (!date) continue;

    const hourRaw = match[4];
    const minuteRaw = match[5];
    if (hourRaw && minuteRaw) {
      const time = buildTime(
        Number(hourRaw),
        Number(minuteRaw),
        isIso ? undefined : match[6],
      );
      if (time) {
        collectionDateTime = `${date}T${time}`;
        break;
      }
    }
    collectionDate = date;
    break;
  }

  return { accessionId, labIdentity, collectionDateTime, collectionDate };
}

/* ------------------------------------------------------------------------- *
 * Storage form
 * ------------------------------------------------------------------------- */

/**
 * SHA-256 of a canonical key, hex-encoded — what actually goes in the ledger.
 *
 * The readable key carries a specimen identifier, which should not sit in a
 * table in cleartext. The `evidence_tier` column preserves the audit trail
 * without it.
 */
export async function hashDrawKey(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
