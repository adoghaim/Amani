// Single source of truth for the medical-boundary rules described in
// NUTRIENT_GUIDELINES.md. Imported by both the prompt builder and the
// post-OpenAI validator so the two cannot drift.

export const ALLOWED_NUTRIENTS = [
  "vitamin d",
  "vitamin b12",
  "b12",
  "folate",
  "iron",
  "magnesium",
  "omega-3",
  "omega 3",
  "iodine",
] as const;

// Display string the prompt embeds when listing allowed nutrients to the model.
export const ALLOWED_NUTRIENTS_PROMPT_LIST =
  "vitamin D, vitamin B12, folate, iron, magnesium, omega-3, iodine";

export const BANNED_SUPPLEMENTS = [
  "ashwagandha",
  "maca",
  "vitex",
  "chasteberry",
  "diindolylmethane",
  "evening primrose",
  "black cohosh",
  "rhodiola",
  "ginseng",
  "saw palmetto",
] as const;

// "2000 IU", "500mg", "5 g", "10 mL", "1 mcg" — any number adjacent to a dosage unit.
const DOSAGE_REGEX =
  /\b\d+(?:[.,]\d+)?\s*(?:iu|mg|mcg|µg|ug|g|ml|grams?|milligrams?|micrograms?)\b/i;

// Prescriptive verbs immediately followed by something that looks like a supplement instruction.
const PRESCRIPTIVE_VERB_REGEX =
  /\b(?:take|start taking|begin taking|consume|swallow|prescribe|prescribed)\b\s+(?:a\s+|some\s+|the\s+|\d)/i;

// "daily", "twice a day", "every morning", "with food" — dosing schedule language.
const FREQUENCY_REGEX =
  /\b(?:daily|twice (?:a |per )day|every (?:day|morning|night|evening)|once a day|per day|with food|on an empty stomach)\b/i;

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

export function validateInterpretationOutput(
  parsed: Record<string, unknown>,
): ValidationResult {
  const violations: string[] = [];
  const text = collectFreeformText(parsed);
  const lower = text.toLowerCase();

  const dosageMatch = text.match(DOSAGE_REGEX);
  if (dosageMatch) violations.push(`dosage_unit:${dosageMatch[0]}`);

  for (const banned of BANNED_SUPPLEMENTS) {
    if (lower.includes(banned)) violations.push(`banned_supplement:${banned}`);
  }

  const verbMatch = text.match(PRESCRIPTIVE_VERB_REGEX);
  if (verbMatch) violations.push(`prescriptive_verb:${verbMatch[0]}`);

  const freqMatch = text.match(FREQUENCY_REGEX);
  if (freqMatch) violations.push(`dosing_frequency:${freqMatch[0]}`);

  return { valid: violations.length === 0, violations };
}

// Filter the array fields most likely to contain prescriptive supplement copy
// (`what_you_can_do_now`, `what_to_do_next`). Items containing a violation
// pattern are dropped. Other fields are left intact — the validator's first
// line of defense is the regenerate retry; sanitization is the fail-closed
// floor, not a content rewriter.
export function sanitizeViolations(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed };
  for (const field of ["what_you_can_do_now", "what_to_do_next"]) {
    const arr = out[field];
    if (Array.isArray(arr)) {
      out[field] = arr.filter(
        (item) => typeof item === "string" && !textHasViolation(item),
      );
    }
  }
  return out;
}

function textHasViolation(text: string): boolean {
  const lower = text.toLowerCase();
  if (DOSAGE_REGEX.test(text)) return true;
  if (PRESCRIPTIVE_VERB_REGEX.test(text)) return true;
  if (FREQUENCY_REGEX.test(text)) return true;
  for (const banned of BANNED_SUPPLEMENTS) {
    if (lower.includes(banned)) return true;
  }
  return false;
}

function collectFreeformText(parsed: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(parsed);
  return parts.join("\n");
}
