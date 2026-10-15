/**
 * PK-PRIV-01 (EXP-6): strip direct identifiers from lab text before it is
 * sent to OpenAI.
 *
 * Pure and dependency-free, so Vitest drives it directly and every Deno
 * handler (extract-biomarkers, generate-interpretation, lab-insights) calls it
 * at the one place it builds the OpenAI user message.
 *
 * What it removes:
 *   - name    patient name fields ("Patient Name:", "Patient:", "Name:"), and
 *             the name line directly under a "Patient Information" heading
 *   - dob     date of birth ("DOB", "D.O.B.", "Date of Birth", "Birth Date")
 *   - id      MRN, patient / member / account ids, accession, specimen and
 *             requisition numbers (labelled, value must contain a digit)
 *   - address labelled address fields, street lines ("12 Main St"), PO boxes
 *             and "City, ST 12345" lines
 *   - phone   labelled phone / fax fields and unlabelled North-American numbers
 *   - email   any e-mail address
 *   - ssn     "123-45-6789" and labelled SSN fields
 *
 * What it deliberately keeps: biomarker names, values, units, flags,
 * reference ranges, collection / report dates, age, sex, and the user's
 * chosen "Preferred name" line in the interpretation prompt (a deliberate
 * personalisation in _shared/schemas/context.ts; see the PR's [Pending]).
 *
 * Design rule: a missed identifier is a silent false negative (recorded as an
 * accepted risk in the CEO plan's failure registry, mitigated by tests + ZDR),
 * but a false positive can corrupt a biomarker row and change a result, so
 * every unlabelled pattern is narrow and every labelled one needs the label.
 * Matching is line by line, so line structure (which the extraction model
 * relies on) is preserved.
 */

export type RedactionKind = "name" | "dob" | "id" | "address" | "phone" | "email" | "ssn";

export interface RedactionResult {
  /** The text with identifiers replaced by `[REDACTED-<KIND>]` tokens. */
  text: string;
  /** How many replacements of each kind were made (counts only, never values). */
  counts: Record<RedactionKind, number>;
  total: number;
}

export const REDACTION_TOKEN: Record<RedactionKind, string> = {
  name: "[REDACTED-PERSON]", // not "NAME": the client parser reads "na" in it as sodium
  dob: "[REDACTED-DOB]",
  id: "[REDACTED-ID]",
  address: "[REDACTED-ADDRESS]",
  phone: "[REDACTED-PHONE]",
  email: "[REDACTED-EMAIL]",
  ssn: "[REDACTED-SSN]",
};

type LabelRule = { kind: RedactionKind; source: string; strong: boolean };

/*
 * Strong labels are unambiguous, so they are recognised after any whitespace
 * ("Sex: F DOB: 01/02/1990"). Weak labels ("Name", "Patient", "Address") are
 * common words, so they count only at the start of a line or a column (after a
 * tab, a pipe, or two or more spaces). That is what keeps "Preferred name:" in
 * the interpretation prompt and a "Name" column header from matching.
 */
const LABEL_RULES: LabelRule[] = [
  { kind: "dob", strong: true, source: String.raw`D\.?O\.?B\.?|Date\s+of\s+Birth|Birth\s*Date|Birthdate` },
  { kind: "ssn", strong: true, source: String.raw`SSN|Social\s+Security(?:\s+(?:Number|No\.?|#))?` },
  {
    kind: "id",
    strong: true,
    source: String.raw`MRN|Medical\s+Record(?:\s+(?:Number|No\.?|#))?|Patient\s+ID|Pt\.?\s+ID|Member\s+ID|Subscriber\s+ID|Insurance\s+ID|Policy\s+(?:Number|No\.?|#)|Accession(?:\s+(?:Number|No\.?|#|ID))?|Acc\.?\s*#|Client\s*#|Lab\s+Ref\.?\s*#|Specimen\s+(?:ID|Number|No\.?|#)|Requisition(?:\s+(?:Number|No\.?|#|ID))?|Req\.?\s*#|Control\s+(?:Number|No\.?|#)|Account\s+(?:Number|No\.?|#|ID)|Acct\.?\s*#|Chart\s+(?:Number|No\.?|#)|Order\s+(?:ID|Number|No\.?|#)|Lab\s+(?:ID|Number|No\.?|#)`,
  },
  { kind: "name", strong: true, source: String.raw`Patient(?:'s)?\s+(?:Full\s+)?Name|Pt\.?\s+Name|(?:Last|First|Middle)\s+Name` },
  { kind: "email", strong: true, source: String.raw`E-?mail(?:\s+Address)?` },
  { kind: "phone", strong: true, source: String.raw`(?:Home\s+|Work\s+|Mobile\s+|Cell\s+|Patient\s+)?(?:Phone|Telephone)(?:\s+(?:Number|No\.?|#))?` },
  { kind: "address", strong: true, source: String.raw`Patient\s+Address|(?:Home\s+|Mailing\s+|Street\s+)Address|City\s*/\s*State\s*/\s*Zip` },
  { kind: "name", strong: false, source: String.raw`Patient|Name` },
  { kind: "id", strong: false, source: String.raw`Account|Acct|Specimen` },
  // Not "Ph" (urinalysis pH) and not "Cell" (cell counts).
  { kind: "phone", strong: false, source: String.raw`Tel|Fax|Mobile` },
  { kind: "address", strong: false, source: String.raw`Address|Addr|Street` },
];

// Boundaries: strong labels after start / whitespace / punctuation; weak ones
// only at the start of a line or column.
const STRONG_BOUNDARY = String.raw`(?<=^|[\s|,;(])`;
const WEAK_BOUNDARY = String.raw`(?<=^\s*|\t|\||\s{2})`;
// A label needs a ":" or "#" after it. DOB alone may also be followed by a date
// with no colon ("DOB 01/02/1990"), handled by DOB_BARE below.
const LABEL_SEP = String.raw`\s*(?:[:#]|\.\s*:)\s*`;

const LABEL_RE = new RegExp(
  LABEL_RULES.map((r, i) => `${r.strong ? STRONG_BOUNDARY : WEAK_BOUNDARY}(?<L${i}>${r.source})${LABEL_SEP}`).join("|"),
  "gi",
);

const DATE_SRC = String.raw`(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[ -](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?[ -]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})`;
const DOB_BARE = new RegExp(String.raw`(?<=^|[\s|,;(])(D\.?O\.?B\.?|Date\s+of\s+Birth|Birth\s*Date)(\s+)${DATE_SRC}`, "gi");

// A value runs to end of line, to the next column gap, to the next identifier
// label, or to a non-identifier field that shares the line ("Sex: F").
const COLUMN_GAP = /\s{2,}|\t|\|/;
const NEXT_FIELD = /\s(?:Age|Sex|Gender|Collected|Collection|Received|Reported|Fasting|Ordering|Physician|Provider|Specimen|Status|Date|Time)\b[^:#\n]{0,20}[:#]/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SSN_RE = /(?<![\w.-])\d{3}-\d{2}-\d{4}(?![\w.-])/g;
// North-American numbers: "(555) 123-4567", "555-123-4567", "555.123.4567",
// "+1 555 123 4567". The two separators must be the same character unless the
// area code is parenthesised, so a value followed by a range ("450 232-1245",
// vitamin B12 and its interval) never matches, and neither does a bare
// ten-digit accession number or a "150-400" range.
const PHONE_RE = /(?<![\w.\/-])(?:\+?1[\s.-]?\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\+?1([\s.-])\d{3}\1\d{3}\1\d{4}|\d{3}([.-])\d{3}\2\d{4})(?![\w.\/-])/g;
const STREET_SUFFIX = String.raw`(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy|Circle|Cir|Highway|Hwy|Square|Sq|Trail|Trl)`;
const STREET_RE = new RegExp(
  String.raw`(?<![\w.])\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][A-Za-z'-]*\s+){1,4}${STREET_SUFFIX}\b\.?(?:,?\s*(?:Apt|Suite|Ste|Unit|#)\.?\s*[\w-]+)?`,
  "g",
);
const PO_BOX_RE = /\bP\.?\s?O\.?\s+Box\s+\d+/gi;
const CITY_STATE_ZIP_RE = /(?<![\w])[A-Z][A-Za-z.'-]+(?:\s[A-Z][A-Za-z.'-]+){0,3},\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?(?!\d)/g;

const PATIENT_HEADING_RE = /^\s*(?:Patient(?:\s+(?:Information|Info|Details|Demographics))?|Patient\s+Name)\s*:?\s*$/i;
// "DOE, JANE A" / "Jane A. Doe": letters only, 2-5 words, no digits.
const NAME_LINE_RE = /^\s*[A-Za-z][A-Za-z'.-]*,?(?:\s[A-Za-z][A-Za-z'.-]*,?){1,4}\s*$/;

const LABEL_LIKE = /[:#]/;

function firstColumn(line: string): string {
  const body = line.replace(/^\s+/, "");
  const gap = body.search(COLUMN_GAP);
  return gap === -1 ? body : body.slice(0, gap);
}

function emptyCounts(): Record<RedactionKind, number> {
  return { name: 0, dob: 0, id: 0, address: 0, phone: 0, email: 0, ssn: 0 };
}

function kindOfMatch(groups: Record<string, string | undefined>): RedactionKind {
  for (let i = 0; i < LABEL_RULES.length; i++) {
    if (groups[`L${i}`] !== undefined) return LABEL_RULES[i].kind;
  }
  return "name";
}

const LEADING_DATE = new RegExp(`^${DATE_SRC}`, "i");
const LEADING_PHONE = /^[+(]?\d[\d().\s-]{5,}\d(?:\s*(?:x|ext\.?)\s*\d+)?/i;

/** Keep only the identifier itself when the field carries more on the line. */
function narrowValue(kind: RedactionKind, value: string): string {
  if (kind === "dob") return value.match(LEADING_DATE)?.[0] ?? value;
  if (kind === "id" || kind === "ssn" || kind === "email") return value.split(/\s+/)[0] ?? value;
  if (kind === "phone") return value.match(LEADING_PHONE)?.[0] ?? value;
  return value;
}

function redactLabelledFields(line: string, counts: Record<RedactionKind, number>): string {
  const matches = [...line.matchAll(LABEL_RE)];
  if (matches.length === 0) return line;
  let out = "";
  let cursor = 0;
  for (let m = 0; m < matches.length; m++) {
    const match = matches[m];
    const valueStart = (match.index ?? 0) + match[0].length;
    const nextLabel = m + 1 < matches.length ? (matches[m + 1].index ?? line.length) : line.length;
    const rest = line.slice(valueStart, nextLabel);
    const ends = [rest.search(COLUMN_GAP), rest.search(NEXT_FIELD)].filter((n) => n >= 0);
    let value = ends.length ? rest.slice(0, Math.min(...ends)) : rest;
    value = value.replace(/\s+$/, "");
    const kind = kindOfMatch(match.groups ?? {});
    value = narrowValue(kind, value);
    out += line.slice(cursor, valueStart);
    cursor = valueStart;
    // Numeric identifiers must contain a digit, so "Account: Active" keeps its
    // word and a stray "Phone:" heading is left alone.
    const needsDigit = kind === "id" || kind === "phone" || kind === "ssn" || kind === "dob";
    const accept = value.length > 0 && !value.startsWith("[REDACTED-") && (!needsDigit || /\d/.test(value));
    if (accept) {
      out += REDACTION_TOKEN[kind];
      counts[kind] += 1;
      cursor = valueStart + value.length;
    }
  }
  return out + line.slice(cursor);
}

function replaceAll(line: string, re: RegExp, kind: RedactionKind, counts: Record<RedactionKind, number>): string {
  return line.replace(re, () => {
    counts[kind] += 1;
    return REDACTION_TOKEN[kind];
  });
}

/** Redact direct identifiers from lab text. Never throws; empty in, empty out. */
export function redactLabText(input: string): RedactionResult {
  const counts = emptyCounts();
  if (typeof input !== "string" || input.length === 0) {
    return { text: typeof input === "string" ? input : "", counts, total: 0 };
  }

  const lines = input.split(/(\r?\n)/); // keep the separators so output joins byte-identically
  let nameLineExpected = false;
  for (let i = 0; i < lines.length; i += 2) {
    let line = lines[i];
    // Name directly under a "Patient Information" heading. PDF text often lays
    // the patient, specimen and client blocks out as columns, so both tests
    // look at the first column only.
    if (nameLineExpected && line.trim().length > 0) {
      nameLineExpected = false;
      const lead = line.match(/^\s*/)?.[0] ?? "";
      const body = line.slice(lead.length);
      const gap = body.search(COLUMN_GAP);
      const first = gap === -1 ? body : body.slice(0, gap);
      if (NAME_LINE_RE.test(first) && first.trim().length <= 60 && !LABEL_LIKE.test(first)) {
        counts.name += 1;
        line = lead + REDACTION_TOKEN.name + body.slice(first.length);
      }
    }
    if (PATIENT_HEADING_RE.test(firstColumn(line))) {
      nameLineExpected = true;
      lines[i] = line;
      continue;
    }
    line = replaceAll(line, EMAIL_RE, "email", counts);
    line = line.replace(DOB_BARE, (_m, label: string, space: string) => {
      counts.dob += 1;
      return `${label}${space}${REDACTION_TOKEN.dob}`;
    });
    line = redactLabelledFields(line, counts);
    line = replaceAll(line, SSN_RE, "ssn", counts);
    line = replaceAll(line, PHONE_RE, "phone", counts);
    line = replaceAll(line, PO_BOX_RE, "address", counts);
    line = replaceAll(line, STREET_RE, "address", counts);
    line = replaceAll(line, CITY_STATE_ZIP_RE, "address", counts);
    lines[i] = line;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { text: lines.join(""), counts, total };
}
