// Single source of truth for the medical-boundary rules described in
// NUTRIENT_GUIDELINES.md. Imported by both the prompt builder and the
// post-OpenAI validator so the two cannot drift.

// ─── Allow-list ───────────────────────────────────────────────────────────────
// Load-bearing: `validateInterpretationOutput` flags supplementation language
// that does not name one of these. A deny-list alone fails open on every
// supplement nobody thought to list (berberine, inositol, red clover, …),
// several of which are contraindicated in pregnancy.

export const ALLOWED_NUTRIENTS = [
  "vitamin D",
  "vitamin B12",
  "folate",
  "iron",
  "magnesium",
  "omega-3",
  "iodine",
  "selenium",
  "zinc",
] as const;

// Alternate spellings that resolve to an entry in ALLOWED_NUTRIENTS. Hyphen and
// space variants ("omega 3", "omega-3") are handled by `termToRegex`, so only
// genuinely different words belong here.
export const ALLOWED_NUTRIENT_ALIASES = [
  "b12",
  "cobalamin",
  "vitamin d3",
  "cholecalciferol",
  "folic acid",
] as const;

// Display string the prompt embeds when naming nutrients. Derived from
// ALLOWED_NUTRIENTS so the prompt cannot drift from what is enforced.
export const ALLOWED_NUTRIENTS_PROMPT_LIST = ALLOWED_NUTRIENTS.join(", ");

// ─── Deny-list ────────────────────────────────────────────────────────────────
// Substances that are a violation on bare mention, with no supplementation
// context required. Matched case-insensitively as substrings-with-boundaries.

export const BANNED_SUPPLEMENTS = [
  "ashwagandha",
  "maca",
  "vitex",
  "chasteberry",
  "chaste tree",
  "diindolylmethane",
  "evening primrose",
  "black cohosh",
  "rhodiola",
  "ginseng",
  "saw palmetto",
  "berberine",
  "inositol",
  "n-acetylcysteine",
  "n-acetyl cysteine",
  "red clover",
  "dong quai",
  "licorice root",
  "milk thistle",
  "st john's wort",
  "st. john's wort",
  "tribulus",
  "fenugreek",
  "melatonin",
  "adaptogen",
  "5-htp",
] as const;

// Abbreviations a model actually writes. Matched case-SENSITIVELY with word
// boundaries: `\bDIM\b` catches the supplement without flagging the ordinary
// adjective "dim", and `\bNAC\b` likewise.
export const BANNED_SUPPLEMENT_ABBREVIATIONS = ["DIM", "NAC"] as const;

// ─── Pattern matching ─────────────────────────────────────────────────────────

// Escape a literal term, then let any hyphen or space in it match either
// ("omega-3" ≡ "omega 3" ≡ "omega3"). Allows an optional plural "s".
function termToRegex(term: string): RegExp {
  const escaped = term
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[-\s]/g, "[-\\s]?");
  return new RegExp(`\\b${escaped}s?\\b`, "i");
}

const ALLOWED_NUTRIENT_REGEXES = [
  ...ALLOWED_NUTRIENTS,
  ...ALLOWED_NUTRIENT_ALIASES,
].map((t) => termToRegex(t));

const BANNED_SUPPLEMENT_REGEXES = BANNED_SUPPLEMENTS.map((t) => ({
  term: t,
  regex: termToRegex(t),
}));

const BANNED_ABBREVIATION_REGEXES = BANNED_SUPPLEMENT_ABBREVIATIONS.map((t) => ({
  term: t,
  regex: new RegExp(`\\b${t}\\b`), // case-sensitive on purpose
}));

// "2000 IU", "500mg", "5 g", "1 mcg" — a number adjacent to a dosage unit.
// The negative lookahead exempts lab concentration units, where the same
// letters are a measurement rather than a dose: 95 mg/dL, 13.2 g/dL, 45 µg/dL,
// 30 mg/g creatinine, 45 µg/24h, 90 mL/min (eGFR is reported per minute).
// `/kg` is deliberately absent: "5 mg/kg" is genuine weight-based dosing.
const DOSAGE_REGEX =
  /\b\d+(?:[.,]\d+)?\s*(?:iu|mg|mcg|µg|ug|g|ml|grams?|milligrams?|micrograms?)\b(?!\s*\/\s*(?:d?l|ml|100\s*ml|g|mg|mmol|mol|min|24\s*h(?:r|rs|ours)?)\b)/i;

// Prescriptive verbs aimed at something ingestible.
const PRESCRIPTIVE_VERB_REGEX =
  /\b(?:take|start taking|begin taking|consume|swallow|prescribe|prescribed)\b\s+(?:a\s+|an\s+|some\s+|the\s+|\d)/i;

// "daily", "twice a day", "every morning", "with food" — dosing schedule language.
const FREQUENCY_REGEX =
  /\b(?:daily|twice (?:a |per )day|every (?:day|morning|night|evening)|once a day|per day|with food|on an empty stomach)\b/i;

// Supplementation language. Presence of this without an allow-listed nutrient
// in the same string is what makes ALLOWED_NUTRIENTS load-bearing.
const SUPPLEMENT_CONTEXT_REGEX = /\bsupplement(?:s|ed|ing|ation)?\b/i;

// Words that mark a string as being about an ingestible substance. Prescriptive
// verbs and dosing-frequency language are only violations in this company —
// otherwise "energy and focus take a hit" and "track your symptoms daily" are
// flagged as medical-boundary breaches, which sends clean reports to the
// non-AI fallback for no reason.
//
// Bare dosage units (mg, mL, IU, …) are deliberately NOT listed. `/` is a word
// boundary, so `\bmg\b` matches inside "210 mg/dL" — every ordinary glucose or
// cholesterol sentence would supply substance context and re-enable the very
// checks this guard exists to suppress ("cholesterol 210 mg/dL; these numbers
// take a hit with poor sleep" → prescriptive_verb). They add no coverage
// either: a unit next to a number is already an unconditional DOSAGE_REGEX
// violation, and a real dosing sentence also names a nutrient or a dosage form
// ("capsule", "dose"), both of which are substance context on their own.
const SUBSTANCE_CONTEXT_REGEX =
  /\b(?:supplement(?:s|ed|ing|ation)?|vitamins?|minerals?|pills?|capsules?|tablets?|gummies|gummy|softgels?|lozenges?|dose|doses|dosage|dosing|drops|powder|tincture|extract|herbs?|herbal|botanical|medications?|drugs?)\b/i;

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

/**
 * Every medical-boundary violation in a single freeform string.
 *
 * Violation strings keep the `code:match` shape the edge function logs and
 * feeds back into the regeneration prompt.
 */
export function findTextViolations(text: string): string[] {
  const violations: string[] = [];

  const dosageMatch = text.match(DOSAGE_REGEX);
  if (dosageMatch) violations.push(`dosage_unit:${dosageMatch[0]}`);

  for (const { term, regex } of BANNED_SUPPLEMENT_REGEXES) {
    if (regex.test(text)) violations.push(`banned_supplement:${term}`);
  }
  for (const { term, regex } of BANNED_ABBREVIATION_REGEXES) {
    if (regex.test(text)) violations.push(`banned_supplement:${term}`);
  }

  const hasSubstanceContext =
    SUBSTANCE_CONTEXT_REGEX.test(text) ||
    ALLOWED_NUTRIENT_REGEXES.some((r) => r.test(text)) ||
    BANNED_SUPPLEMENT_REGEXES.some(({ regex }) => regex.test(text));

  if (hasSubstanceContext) {
    const verbMatch = text.match(PRESCRIPTIVE_VERB_REGEX);
    if (verbMatch) violations.push(`prescriptive_verb:${verbMatch[0]}`);

    const freqMatch = text.match(FREQUENCY_REGEX);
    if (freqMatch) violations.push(`dosing_frequency:${freqMatch[0]}`);
  }

  // Allow-list enforcement: supplementation may only be discussed in terms of
  // an allow-listed nutrient. Anything else — named or not — fails closed.
  const supplementMatch = text.match(SUPPLEMENT_CONTEXT_REGEX);
  if (supplementMatch && !ALLOWED_NUTRIENT_REGEXES.some((r) => r.test(text))) {
    violations.push(`unlisted_nutrient:${supplementMatch[0]}`);
  }

  return violations;
}

export function validateInterpretationOutput(
  parsed: Record<string, unknown>,
): ValidationResult {
  const violations = new Set<string>();
  for (const text of collectFreeformStrings(parsed)) {
    for (const violation of findTextViolations(text)) violations.add(violation);
  }
  return { valid: violations.size === 0, violations: [...violations] };
}

/**
 * Last-resort cleanup after the regeneration retry has already failed.
 *
 * Top-level arrays of strings (`what_you_can_do_now`, `what_to_do_next`,
 * `questions_for_doctor`) are advice lists, so an offending item can simply be
 * dropped. Scalar strings and strings nested inside objects — `headline`,
 * `overall_interpretation`, `primary_concern.summary`, `key_findings[].explanation`
 * — carry the clinical content and cannot be partially edited without either
 * mangling the medicine or silently keeping unsafe text.
 *
 * So: filter what can be filtered, then re-validate the whole object. If
 * anything still violates, return `null` and let the caller fall back. Callers
 * MUST treat `null` as "no usable AI output" — `generate-interpretation` already
 * does, dropping to its deterministic non-AI interpretation.
 */
export function sanitizeViolations(
  parsed: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...parsed };

  for (const [key, value] of Object.entries(out)) {
    if (Array.isArray(value) && value.every((i) => typeof i === "string")) {
      out[key] = (value as string[]).filter(
        (item) => findTextViolations(item).length === 0,
      );
    }
  }

  return validateInterpretationOutput(out).valid ? out : null;
}

function collectFreeformStrings(parsed: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(parsed);
  return parts;
}
