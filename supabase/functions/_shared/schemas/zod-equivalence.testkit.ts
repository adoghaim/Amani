/*
  RV-ZD1 (GHSA-mrhx-c7xc-m3w5). One corpus of synthetic inputs for the edge
  functions' zod schemas, and one canonical text of what `safeParse` makes of
  each, so a zod upgrade can be held to the zod 3.25.76 results committed in
  zod-equivalence.golden.json. zod-equivalence.test.ts runs it under Vitest;
  Deno 2.1.4 imports it as it is. So: no imports, no vitest, no node:*.

  Compared per case: `success`; on success the data (which keys are present,
  including a key whose value is undefined, their order, and the values); on
  failure the sorted set of issue paths. Messages, codes and issue counts are
  not compared: zod 4 words them differently. Inputs whose result changes on
  purpose (an oversized bounded array that also holds invalid elements, a
  non-finite number) are kept out of the corpus; zod-bounds.test.ts pins
  them. UTF16_CORPUS, at the end, holds strings whose UTF-16 length and
  code-point length fall on different sides of a bound; its zod 3.25.76
  results are in zod-equivalence.utf16.golden.json.
*/

export type SchemaName =
  | "LabReportContextSchema"
  | "UserProfileContextSchema"
  | "InterpretationSchema"
  | "GenerateInterpretationRequestSchema"
  | "ExtractBiomarkersRequestSchema"
  | "LabInsightsRequestSchema"
  | "StripeCheckoutOrderSchema";

export const SCHEMA_NAMES: readonly SchemaName[] = [
  "LabReportContextSchema",
  "UserProfileContextSchema",
  "InterpretationSchema",
  "GenerateInterpretationRequestSchema",
  "ExtractBiomarkersRequestSchema",
  "LabInsightsRequestSchema",
  "StripeCheckoutOrderSchema",
];

export interface ParseIssue {
  readonly path: ReadonlyArray<PropertyKey>;
}

export type ParseResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly error: { readonly issues: ReadonlyArray<ParseIssue> } };

export interface Parser {
  safeParse(input: unknown, params?: { jitless?: boolean }): ParseResult;
}

export type Schemas = Readonly<Record<SchemaName, Parser>>;

export interface CorpusCase {
  readonly schema: SchemaName;
  readonly name: string;
  readonly input: unknown;
}

/** Literal copy of NEW_REPORT_CONTEXTS (src/pages/NewReport.context.testkit.ts), which Deno cannot import. */
export const NEW_REPORT_CONTEXTS_MIRROR = {
  twoSymptoms: {
    birth_control: "unsure", pregnant: "unsure", postpartum: "unsure",
    top_symptoms: ["fatigue", "hot_flashes"], submission_mode: "standard",
  },
  noSymptoms: {
    birth_control: "unsure", pregnant: "unsure", postpartum: "unsure",
    top_symptoms: [], submission_mode: "standard",
  },
  compatibility: {
    birth_control: "unsure", pregnant: "unsure", postpartum: "unsure",
    top_symptoms: ["cramps"], submission_mode: "compatibility",
  },
};

const corpus: CorpusCase[] = [];
function add(schema: SchemaName, name: string, input: unknown): void {
  corpus.push({ schema, name, input });
}

const without = (object: Record<string, unknown>, key: string): Record<string, unknown> => {
  const copy = { ...object };
  delete copy[key];
  return copy;
};
const range = (n: number, label: string): string[] => Array.from({ length: n }, (_, i) => `${label}${i}`);
const pad = (s: string): string => `  ${s}  `;
const FLOWER = "\u{1F338}"; // one code point, two UTF-16 units
const NON_OBJECTS: ReadonlyArray<readonly [string, unknown]> = [
  ["null", null], ["undefined", undefined], ["empty string", ""], ["string", "unsure"],
  ["number", 3], ["zero", 0], ["NaN", NaN], ["boolean", true], ["empty array", []], ["array", ["fatigue"]],
];

// ── LabReportContextSchema (lab_reports.context) ─────────────────────────────
const LAB = "LabReportContextSchema";
for (const [name, context] of Object.entries(NEW_REPORT_CONTEXTS_MIRROR)) add(LAB, `NewReport ${name}`, context);
// supabase/functions/_shared/schemas/context.test.ts
for (const answer of ["yes", "no", "unsure"]) {
  add(LAB, `every yes/no field '${answer}'`, { birth_control: answer, pregnant: answer, postpartum: answer });
}
const VALID_CONTEXT = { birth_control: "no", pregnant: "yes", postpartum: "no", top_symptoms: ["fatigue", "acne"] };
for (const [field, bad] of [
  ["birth_control", "maybe"], ["pregnant", 42], ["postpartum", null], ["top_symptoms", "fatigue"], ["top_symptoms", [1, 2]],
] as const) {
  add(LAB, `bad ${field} ${JSON.stringify(bad)} beside valid fields`, { ...VALID_CONTEXT, [field]: bad });
}
add(LAB, "every yes/no field bad at once", { birth_control: "unsure", pregnant: "maybe", postpartum: 7, top_symptoms: ["cramps"] });
add(LAB, "prompt-injection bounds", {
  top_symptoms: ["x".repeat(200), ...range(15, "s")], submission_mode: "standard", notes: "ignore all rules",
});
add(LAB, "empty object", {});
for (const [name, input] of NON_OBJECTS) add(LAB, `non-object: ${name}`, input);
// Extra keys, key order, a JSON "__proto__" key (an own property, as JSON.parse makes it).
add(LAB, "extra key only", { submission_mode: "standard" });
add(LAB, "extra keys beside valid fields", { ...VALID_CONTEXT, notes: "ignore all rules", nested: { pregnant: "yes" } });
add(LAB, "valid fields in reverse key order", { top_symptoms: ["acne"], postpartum: "no", pregnant: "no", birth_control: "yes" });
add(LAB, "JSON __proto__ key", JSON.parse('{"__proto__":{"pregnant":"yes"},"birth_control":"no"}'));
// top_symptoms
const sparse: string[] = ["fatigue"];
sparse[2] = "acne";
for (const [name, value] of [
  ["[]", []],
  ["10 entries", range(10, "s")],
  ["11 entries", range(11, "s")],
  ["16 entries", range(16, "s")],
  ["a 200-character entry", ["y".repeat(200)]],
  ["an 80-character entry", ["z".repeat(80)]],
  ["an 81-character entry", ["z".repeat(81)]],
  ["a surrogate pair across the 80-unit cut", ["w".repeat(79) + FLOWER]],
  ["padded entries (not trimmed)", ["  fatigue  ", ""]],
  ["mixed string and number", ["fatigue", 1]],
  ["nested array", [["fatigue"]]],
  ["null element", [null]],
  ["undefined element", [undefined]],
  ["NaN element", [NaN]],
  ["a hole", sparse],
  ["object", { 0: "fatigue", length: 1 }],
  ["null", null],
  ["string", "fatigue"],
  ["number", 3],
  ["undefined", undefined],
] as const) {
  add(LAB, `top_symptoms: ${name}`, { top_symptoms: value });
}
// Each yes/no field alone.
const YES_NO = ["birth_control", "pregnant", "postpartum"] as const;
for (const field of YES_NO) {
  for (const [name, value] of [
    ["yes", "yes"], ["no", "no"], ["unsure", "unsure"], ["42", 42], ["null", null], ["undefined", undefined],
    ["YES", "YES"], ["empty string", ""], ["true", true], ["['yes']", ["yes"]],
  ] as const) {
    add(LAB, `${field}: ${name}`, { [field]: value });
  }
  add(LAB, `${field}: absent`, Object.fromEntries(YES_NO.filter((f) => f !== field).map((f) => [f, "yes"])));
}

// ── UserProfileContextSchema (users row, generate-interpretation) ────────────
const PROFILE = "UserProfileContextSchema";
const ROW_KEYS = ["full_name", "age_range", "sex_at_birth", "pregnancy_status", "health_goals", "symptoms"];
add(PROFILE, "row shape, all null", Object.fromEntries(ROW_KEYS.map((k) => [k, null])));
add(PROFILE, "empty object", {});
const PROFILE_ROW = {
  full_name: "Synthetic Fixture", age_range: "30-39", sex_at_birth: "female", pregnancy_status: "not_pregnant",
  health_goals: ["energy", "sleep"], symptoms: ["fatigue"],
};
add(PROFILE, "complete row", PROFILE_ROW);
add(PROFILE, "complete row with unselected and unknown keys", {
  ...PROFILE_ROW, supplements: ["synthetic"], known_conditions: ["synthetic"], updated_at: "2026-01-01T00:00:00Z",
});
add(PROFILE, "complete row in reverse key order", Object.fromEntries(Object.entries(PROFILE_ROW).reverse()));
for (const key of ROW_KEYS) {
  add(PROFILE, `row without ${key}`, without(PROFILE_ROW, key));
  add(PROFILE, `${key}: undefined`, { [key]: undefined });
}
for (const [key, limit] of [["full_name", 80], ["age_range", 40], ["sex_at_birth", 40], ["pregnancy_status", 40]] as const) {
  for (const [name, value] of [
    [`padded ${limit}`, pad("a".repeat(limit))],
    [`padded ${limit + 1}`, pad("a".repeat(limit + 1))],
    [`exactly ${limit}`, "b".repeat(limit)],
    [`exactly ${limit + 1}`, "b".repeat(limit + 1)],
    [`tab and newline around ${limit}`, `\t${"c".repeat(limit)}\n`],
    [`no-break spaces around ${limit}`, `\u00a0${"d".repeat(limit)}\u00a0`],
    ["whitespace only", "   "],
    ["empty", ""],
    [`${limit / 2} astral characters`, FLOWER.repeat(limit / 2)],
    [`${limit + 1} astral characters`, FLOWER.repeat(limit + 1)],
    [`${limit + 1} lone surrogates`, "\ud83c".repeat(limit + 1)],
    ["number", 42],
    ["array", ["a"]],
  ] as const) {
    add(PROFILE, `${key}: ${name}`, { [key]: value });
  }
}
for (const [key, limit] of [["health_goals", 80], ["symptoms", 120]] as const) {
  const many = (n: number) => range(n, `${key}-`);
  for (const [name, value] of [
    ["[]", []],
    [`one element padded ${limit}`, [pad("e".repeat(limit))]],
    [`one element padded ${limit + 1}`, [pad("e".repeat(limit + 1))]],
    [`one element of ${limit / 2} astral characters`, [FLOWER.repeat(limit / 2)]],
    [`one element of ${limit + 1} astral characters`, [FLOWER.repeat(limit + 1)]],
    ["10 valid elements", many(10)],
    ["11 valid elements", many(11)],
    ["10 padded elements", many(10).map(pad)],
    ["a null element within 10", ["energy", null]],
    ["only a null element", [null]],
    ["two null elements within 10", [null, "energy", null]],
    ["a number element", [42]],
    ["a nested array element", [["energy"]]],
    ["a hole", sparse],
    ["string", "energy"],
    ["object", { 0: "energy" }],
    ["number", 7],
  ] as const) {
    add(PROFILE, `${key}: ${name}`, { [key]: value });
  }
}
add(PROFILE, "several bad fields at once", { full_name: 42, age_range: "x".repeat(41), health_goals: "energy", symptoms: [null] });
for (const [name, input] of NON_OBJECTS) add(PROFILE, `non-object: ${name}`, input);

// ── InterpretationSchema (the model's JSON answer) ───────────────────────────
const INTERPRETATION = "InterpretationSchema";
// generation-pipeline.smoke.test.ts modelBody()
const modelBody = (): Record<string, unknown> => ({
  headline: "Synthetic model headline",
  primary_concern: { title: "Vitamin D", summary: "Synthetic summary", why_it_matters: "Synthetic context" },
  key_findings: [], pattern_signals: [], what_you_can_do_now: [], what_to_do_next: [],
  overall_interpretation: "The panel is mainly about iron markers.", questions_for_doctor: [],
  cycle_context: {}, disclaimer: "Educational use only.",
});
const finding = (): Record<string, unknown> => ({
  biomarker_slug: "tsh", title: "Synthetic finding", status: "synthetic", explanation: "Synthetic explanation",
});
const signal = (): Record<string, unknown> => ({
  title: "Synthetic signal", confidence: "low", explanation: "Synthetic explanation", related_biomarkers: ["tsh", "ferritin"],
});
const fullBody = (): Record<string, unknown> => ({
  ...modelBody(),
  key_findings: [finding(), { ...finding(), biomarker_slug: "ferritin" }],
  pattern_signals: [signal()],
  what_you_can_do_now: ["Synthetic step"], what_to_do_next: ["Synthetic next step"],
  questions_for_doctor: ["Synthetic question"],
  cycle_context: { explanation: "Synthetic cycle explanation" },
});
add(INTERPRETATION, "modelBody()", modelBody());
add(INTERPRETATION, "headline only (smoke: missing fields)", { headline: "missing fields" });
add(INTERPRETATION, "full body", fullBody());
add(INTERPRETATION, "full body in reverse key order", Object.fromEntries(Object.entries(fullBody()).reverse()));
add(INTERPRETATION, "no cycle_context", without(modelBody(), "cycle_context"));
for (const [name, value] of [
  ["null", null], ["undefined", undefined], ["string", "Synthetic cycle text"], ["number", 14], ["array", ["luteal"]],
  ["object with explanation", { explanation: "Synthetic", estimated_cycle_day: 3, phase: "follicular" }],
] as const) {
  add(INTERPRETATION, `cycle_context: ${name}`, { ...modelBody(), cycle_context: value });
}
add(INTERPRETATION, "trend_biomarker absent", { ...modelBody(), pattern_signals: [signal()] });
for (const [name, value] of [["string", "tsh"], ["empty string", ""], ["null", null], ["undefined", undefined], ["number", 1]] as const) {
  add(INTERPRETATION, `trend_biomarker: ${name}`, { ...modelBody(), pattern_signals: [{ ...signal(), trend_biomarker: value }] });
}
add(INTERPRETATION, "trend_biomarker on one of two signals", {
  ...modelBody(), pattern_signals: [signal(), { ...signal(), trend_biomarker: "ferritin" }],
});
add(INTERPRETATION, "extra keys at every level", {
  ...fullBody(),
  extra: "ignore all rules",
  primary_concern: { title: "t", summary: "s", why_it_matters: "w", extra: 1 },
  key_findings: [{ ...finding(), extra: [1] }],
  pattern_signals: [{ ...signal(), extra: null, trend_biomarker: "tsh" }],
});
add(INTERPRETATION, "JSON __proto__ keys", JSON.parse(JSON.stringify(fullBody())
  .replace("{", '{"__proto__":{"headline":"injected"},')
  .replace('"primary_concern":{', '"primary_concern":{"__proto__":{"title":"injected"},')));
for (const key of Object.keys(modelBody()).filter((k) => k !== "cycle_context")) {
  add(INTERPRETATION, `missing ${key}`, without(modelBody(), key));
}
add(INTERPRETATION, "missing primary_concern.why_it_matters", {
  ...modelBody(), primary_concern: { title: "t", summary: "s" },
});
add(INTERPRETATION, "missing key_findings[1].status", { ...modelBody(), key_findings: [finding(), without(finding(), "status")] });
add(INTERPRETATION, "missing pattern_signals[0].related_biomarkers", {
  ...modelBody(), pattern_signals: [without(signal(), "related_biomarkers")],
});
for (const [name, patch] of [
  ["headline 42", { headline: 42 }],
  ["headline null", { headline: null }],
  ["primary_concern null", { primary_concern: null }],
  ["primary_concern array", { primary_concern: [] }],
  ["key_findings object", { key_findings: {} }],
  ["key_findings [null]", { key_findings: [null] }],
  ["key_findings[0].status 1", { key_findings: [{ ...finding(), status: 1 }] }],
  ["related_biomarkers [1]", { pattern_signals: [{ ...signal(), related_biomarkers: [1] }] }],
  ["what_you_can_do_now string", { what_you_can_do_now: "Synthetic step" }],
  ["questions_for_doctor [null]", { questions_for_doctor: [null] }],
  ["disclaimer undefined", { disclaimer: undefined }],
] as const) {
  add(INTERPRETATION, `wrong type: ${name}`, { ...modelBody(), ...patch });
}
add(INTERPRETATION, "several bad fields at once", {
  ...modelBody(), headline: 1, key_findings: [{ ...finding(), title: null }, 3], questions_for_doctor: "q",
});
add(INTERPRETATION, "empty strings everywhere", {
  ...modelBody(), headline: "", primary_concern: { title: "", summary: "", why_it_matters: "" },
  overall_interpretation: "", disclaimer: "",
});
add(INTERPRETATION, "empty object", {});
for (const [name, input] of NON_OBJECTS) add(INTERPRETATION, `non-object: ${name}`, input);

// ── Request bodies ───────────────────────────────────────────────────────────
const GENERATE = "GenerateInterpretationRequestSchema";
const EXTRACT = "ExtractBiomarkersRequestSchema";
const INSIGHTS = "LabInsightsRequestSchema";
const UUID_A = "f47ac10b-58cc-4372-a567-0e02b2c3d479"; // version 4, RFC variant
const UUID_B = "9b2f6c3e-1d4a-4f8b-9c7d-2e5a6b7c8d9e"; // version 4, RFC variant
const IDS: ReadonlyArray<readonly [string, unknown]> = [
  ["v4 UUID", UUID_A],
  ["non-RFC UUID 1111", "11111111-1111-1111-1111-111111111111"],
  ["nil UUID", "00000000-0000-0000-0000-000000000000"],
  ["max UUID", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
  ["version 0", "f47ac10b-58cc-0372-a567-0e02b2c3d479"],
  ["variant c", "f47ac10b-58cc-4372-c567-0e02b2c3d479"],
  ["v7 UUID", "01890a5d-ac96-774b-bcce-b302099a8057"],
  ["upper case", UUID_A.toUpperCase()],
  ["braces", `{${UUID_A}}`],
  ["trailing newline", `${UUID_A}\n`],
  ["leading space", ` ${UUID_A}`],
  ["35 characters", UUID_A.slice(0, 35)],
  ["37 characters", `${UUID_A}0`],
  ["no dashes", UUID_A.split("-").join("")],
  ["non-hex digit", `g${UUID_A.slice(1)}`],
  ["urn prefix", `urn:uuid:${UUID_A}`],
  ["empty string", ""],
  ["number", 42],
  ["null", null],
  ["undefined", undefined],
  ["array", [UUID_A]],
];
for (const [name, id] of IDS) {
  add(GENERATE, `reportId: ${name}`, { reportId: id });
  add(GENERATE, `request_id: ${name}`, { reportId: UUID_A, request_id: id });
  add(INSIGHTS, `currentReportId: ${name}`, { currentReportId: id });
  add(INSIGHTS, `previousReportId: ${name}`, { currentReportId: UUID_A, previousReportId: id });
}
add(GENERATE, "reportId: missing", {});
add(GENERATE, "request_id: missing", { reportId: UUID_A });
add(INSIGHTS, "currentReportId: missing", { previousReportId: UUID_B });
add(INSIGHTS, "previousReportId: missing", { currentReportId: UUID_A });
for (const [name, slug] of [
  ["null", null], ["tsh", "tsh"], ["empty string", ""], ["number", 42], ["undefined", undefined], ["array", ["tsh"]],
] as const) {
  add(GENERATE, `primary_canonical_slug: ${name}`, { reportId: UUID_A, primary_canonical_slug: slug });
}
// What the deployed web and native 1.0.6 clients send.
add(GENERATE, "client body {reportId}", { reportId: UUID_A });
add(GENERATE, "client body {reportId, primary_canonical_slug: null}", { reportId: UUID_A, primary_canonical_slug: null });
add(GENERATE, "client body {reportId, primary_canonical_slug}", { reportId: UUID_A, primary_canonical_slug: "ferritin" });
add(GENERATE, "client body {reportId, request_id}", { reportId: UUID_A, request_id: UUID_B });
add(GENERATE, "client body {reportId, primary_canonical_slug, request_id}", {
  reportId: UUID_A, primary_canonical_slug: null, request_id: UUID_B,
});
add(GENERATE, "unknown keys", { reportId: UUID_A, userId: UUID_B, extra: true });
add(GENERATE, "reverse key order", { request_id: UUID_B, primary_canonical_slug: "tsh", reportId: UUID_A });
add(INSIGHTS, "client body {currentReportId}", { currentReportId: UUID_A });
add(INSIGHTS, "client body {currentReportId, previousReportId}", { currentReportId: UUID_A, previousReportId: UUID_B });
add(INSIGHTS, "unknown keys", { currentReportId: UUID_A, previousReportId: UUID_B, extra: 1 });
add(INSIGHTS, "reverse key order", { previousReportId: UUID_B, currentReportId: UUID_A });
for (const [name, text] of [
  ["empty string", ""], ["x", "x"], ["lab text", "TSH 2.85 uIU/mL 0.40-4.50"], ["whitespace", " "], ["newline", "\n"],
  ["one astral character", FLOWER], ["a lone surrogate", "\ud83c"], ["300 characters", "t".repeat(300)],
  ["null", null], ["number", 42], ["undefined", undefined], ["array", ["x"]],
] as const) {
  add(EXTRACT, `text: ${name}`, { text });
}
add(EXTRACT, "text: missing", {});
add(EXTRACT, "client body {text}", { text: "TSH 2.85 uIU/mL" });
add(EXTRACT, "client body {text} with unknown keys", { text: "TSH 2.85", reportId: UUID_A });
for (const [name, input] of NON_OBJECTS) {
  add(GENERATE, `non-object: ${name}`, input);
  add(EXTRACT, `non-object: ${name}`, input);
  add(INSIGHTS, `non-object: ${name}`, input);
}

// ── StripeCheckoutOrderSchema (stripe-webhook one-time payment) ──────────────
const ORDER = "StripeCheckoutOrderSchema";
// stripe-webhook/index.test.ts, one-time payment
const SESSION = {
  id: "cs_once", customer: "cus_bs2_webhook", mode: "payment", payment_status: "paid", payment_intent: "pi_1",
  amount_subtotal: 999, amount_total: 999, currency: "usd",
};
add(ORDER, "stripe-webhook test session", SESSION);
add(ORDER, "nullable fields null", { ...SESSION, payment_intent: null, amount_subtotal: null, amount_total: null, currency: null });
add(ORDER, "optional fields absent", { id: "cs_min", payment_status: "unpaid" });
add(ORDER, "optional fields undefined", {
  id: "cs_min", payment_status: "unpaid", payment_intent: undefined, amount_subtotal: undefined, amount_total: undefined, currency: undefined,
});
add(ORDER, "reverse key order", Object.fromEntries(Object.entries(SESSION).reverse()));
add(ORDER, "session-shaped extra keys", {
  ...SESSION, object: "checkout.session", metadata: { k: "v" }, livemode: false, customer_details: null,
});
for (const key of ["id", "payment_status", "payment_intent", "amount_subtotal", "amount_total", "currency"]) {
  add(ORDER, `missing ${key}`, without(SESSION, key));
}
for (const [name, patch] of [
  ["numeric id", { id: 42 }],
  ["null id", { id: null }],
  ["amount_total '999'", { amount_total: "999" }],
  ["amount_total -0", { amount_total: -0 }],
  ["amount_total NaN", { amount_total: NaN }],
  ["amount_total 0", { amount_total: 0 }],
  ["amount_total 0.5", { amount_total: 0.5 }],
  ["amount_total -999", { amount_total: -999 }],
  ["amount_total 1e21", { amount_total: 1e21 }],
  ["amount_total above MAX_SAFE_INTEGER", { amount_total: 9007199254740993 }],
  ["amount_subtotal true", { amount_subtotal: true }],
  ["payment_intent expanded object", { payment_intent: { id: "pi_1" } }],
  ["payment_intent number", { payment_intent: 1 }],
  ["currency number", { currency: 840 }],
  ["payment_status null", { payment_status: null }],
  ["payment_status number", { payment_status: 1 }],
] as const) {
  add(ORDER, name, { ...SESSION, ...patch });
}
add(ORDER, "several bad fields at once", { ...SESSION, id: 1, payment_status: undefined, amount_total: "1", currency: [] });
add(ORDER, "empty object", {});
for (const [name, input] of NON_OBJECTS) add(ORDER, `non-object: ${name}`, input);

export const CORPUS: readonly CorpusCase[] = corpus;

// ── String bounds counted in UTF-16 units ────────────────────────────────────
// zod 3 measured a string's .max() in UTF-16 units (String#length); zod 4.6
// measures code points, so an astral character (an emoji: two units) counts
// once. Each input below is longer than its bound in units but not in code
// points, or sits exactly at the bound as a control. Its golden,
// zod-equivalence.utf16.golden.json, holds zod 3.25.76's results; it is a
// file of its own so that the commit-1 golden stays as it was.
const utf16: CorpusCase[] = [];
const addUtf16 = (name: string, input: unknown): void => {
  utf16.push({ schema: PROFILE, name, input });
};
for (const [key, limit] of [["full_name", 80], ["age_range", 40], ["sex_at_birth", 40], ["pregnancy_status", 40]] as const) {
  for (const [name, value] of [
    [`${limit / 2 + 1} astral characters (${limit + 2} units)`, FLOWER.repeat(limit / 2 + 1)],
    [`${limit} astral characters (${2 * limit} units)`, FLOWER.repeat(limit)],
    [`${limit - 1} letters and an astral character (${limit + 1} units)`, "a".repeat(limit - 1) + FLOWER],
    [`${limit - 2} letters and an astral character (${limit} units)`, "a".repeat(limit - 2) + FLOWER],
    [`padded ${limit / 2 + 1} astral characters`, pad(FLOWER.repeat(limit / 2 + 1))],
    [`padded ${limit / 2} astral characters`, pad(FLOWER.repeat(limit / 2))],
  ] as const) {
    addUtf16(`${key}: ${name}`, { [key]: value });
  }
}
for (const [key, limit] of [["health_goals", 80], ["symptoms", 120]] as const) {
  for (const [name, value] of [
    [`one element of ${limit / 2 + 1} astral characters`, [FLOWER.repeat(limit / 2 + 1)]],
    [`one element of ${limit} astral characters`, [FLOWER.repeat(limit)]],
    [`one element of ${limit - 1} letters and an astral character`, ["e".repeat(limit - 1) + FLOWER]],
    [`one element of ${limit - 2} letters and an astral character`, ["e".repeat(limit - 2) + FLOWER]],
    [`one padded element of ${limit / 2 + 1} astral characters`, [pad(FLOWER.repeat(limit / 2 + 1))]],
    [`one padded element of ${limit / 2} astral characters`, [pad(FLOWER.repeat(limit / 2))]],
    [`a valid element, then one of ${limit} astral characters`, ["energy", FLOWER.repeat(limit)]],
    [`10 elements of ${limit / 2 + 1} astral characters`, Array.from({ length: 10 }, () => FLOWER.repeat(limit / 2 + 1))],
  ] as const) {
    addUtf16(`${key}: ${name}`, { [key]: value });
  }
}
addUtf16("complete row with a full_name of 41 astral characters", { ...PROFILE_ROW, full_name: FLOWER.repeat(41) });
addUtf16("every bounded field at its bound in astral characters", {
  full_name: FLOWER.repeat(80), age_range: FLOWER.repeat(40), sex_at_birth: FLOWER.repeat(40),
  pregnancy_status: FLOWER.repeat(40), health_goals: [FLOWER.repeat(80)], symptoms: [FLOWER.repeat(120)],
});

export const UTF16_CORPUS: readonly CorpusCase[] = utf16;

// ── Canonical encoding ───────────────────────────────────────────────────────
// JSON cannot say "absent" versus "present with undefined", -0, NaN or
// Infinity, and an object's key order should be explicit, so values are
// encoded first: tags are objects with a "$" key, an object is
// {"$":"object","entries":[[key, value], ...]} in Object.keys order, an
// array stays an array. Anything else (a function, a symbol key, a class
// instance) throws rather than being stringified in an engine-specific way.
type Encoded = null | boolean | string | number | Encoded[] | { [key: string]: Encoded };

export function encode(value: unknown): Encoded {
  if (value === undefined) return { $: "undefined" };
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $: "NaN" };
    if (value === Infinity) return { $: "Infinity" };
    if (value === -Infinity) return { $: "-Infinity" };
    if (Object.is(value, -0)) return { $: "-0" };
    return value;
  }
  if (Array.isArray(value)) {
    const items: Encoded[] = [];
    for (let i = 0; i < value.length; i++) items.push(i in value ? encode(value[i]) : { $: "hole" });
    return items;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error("encode: not a plain object");
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error("encode: symbol key");
    const record = value as Record<string, unknown>;
    const entries: Encoded[] = Object.keys(record).map((key) => [key, encode(record[key])]);
    return proto === null ? { $: "object", proto: "null", entries } : { $: "object", entries };
  }
  throw new Error(`encode: unexpected ${typeof value}`);
}

function encodePath(path: ReadonlyArray<PropertyKey>): Encoded[] {
  return path.map((segment) => {
    if (typeof segment === "symbol") throw new Error("encodePath: symbol segment");
    return encode(segment);
  });
}

/** One line per corpus case: what the parser made of it, canonically encoded. */
export function outcomeLine(entry: CorpusCase, result: ParseResult): string {
  const name = `${entry.schema} / ${entry.name}`;
  if (result.success) return JSON.stringify({ case: name, success: true, data: encode(result.data) });
  const paths = [...new Set(result.error.issues.map((issue) => JSON.stringify(encodePath(issue.path))))].sort();
  return JSON.stringify({ case: name, success: false, paths: paths.map((path) => JSON.parse(path)) });
}

/**
 * The golden text for these schemas: every case of `cases` (by default the
 * corpus) parsed once, on the default path or with `{ jitless: true }` (zod 4
 * then skips its compiled object parser; zod 3 ignores the option).
 */
export function corpusText(
  schemas: Schemas,
  options: { readonly jitless?: true } = {},
  cases: readonly CorpusCase[] = CORPUS,
): string {
  const lines = cases.map((entry) => {
    const parser = schemas[entry.schema];
    const result = options.jitless ? parser.safeParse(entry.input, { jitless: true }) : parser.safeParse(entry.input);
    return outcomeLine(entry, result);
  });
  return `[\n${lines.join(",\n")}\n]\n`;
}
