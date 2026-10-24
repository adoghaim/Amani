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
  "saint john's wort",
  "tribulus",
  "fenugreek",
  "melatonin",
  "adaptogen",
  "5-htp",
  // Herbs a model names without the word "supplement" (review F096), so the
  // allow-list rule never sees them. Pending clinical-owner review of the list.
  "valerian",
  "kava",
  "shatavari",
] as const;

// Abbreviations a model actually writes. "NAC" is not an English word, so it is
// matched in any case. "DIM" is matched in capitals anywhere, and in sentence or
// lower case only where it reads as the supplement ("Dim is…", "a dim
// supplement", "take dim"), so the ordinary adjective ("dim the lights") passes.
export const BANNED_SUPPLEMENT_ABBREVIATIONS = ["DIM", "NAC"] as const;

// ─── Text normalization ───────────────────────────────────────────────────────
// Every pattern below runs on normalized text, so a typographic apostrophe, a
// zero-width or soft-hyphen split, a fullwidth or accented letter, or a
// Cyrillic/Greek lookalike cannot slip a banned term past an ASCII regex.

const APOSTROPHES = /[‘’‚‛′‵ʹʻʼʽ`´＇]/g;
const DASHES = /[‐-―⁃−﹘﹣－]/g;
// Format characters (zero-width space/joiners, soft hyphen, word joiner, BOM,
// bidi marks), the combining grapheme joiner, Hangul fillers and variation
// selectors render as nothing, so they are deleted rather than spaced.
const INVISIBLES = /[\p{Cf}͏ᅟᅠ឴឵ㅤﾠ︀-️]/gu;
const COMBINING_MARKS = /\p{M}/gu;
// Cyrillic and Greek letters that render like Latin ones. Greek mu is left
// alone: NFKD turns the micro sign into it, and the dosage pattern matches it.
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "в": "b", "е": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c",
  "т": "t", "у": "y", "х": "x", "ѕ": "s", "і": "i", "ј": "j", "ԁ": "d", "һ": "h", "ԛ": "q",
  "ԝ": "w", "ӏ": "l", "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
  "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X", "Ѕ": "S", "І": "I", "Ј": "J",
  "α": "a", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "Α": "A", "Β": "B", "Ε": "E",
  "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T",
  "Υ": "Y", "Χ": "X", "ɑ": "a", "ɡ": "g", "ı": "i",
};
const HOMOGLYPH_REGEX = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");

/** The text every policy pattern is matched against. */
export function normalizePolicyText(text: string): string {
  return text
    .replace(APOSTROPHES, "'")
    .normalize("NFKD")
    .replace(INVISIBLES, "")
    .replace(COMBINING_MARKS, "")
    .replace(DASHES, "-")
    .replace(HOMOGLYPH_REGEX, (c) => HOMOGLYPHS[c] ?? c)
    .replace(/[^\S\n]+/g, " ");
}

// ─── Pattern matching ─────────────────────────────────────────────────────────

// Escape a literal term, then let any hyphen or space in it match either
// ("omega-3" ≡ "omega 3" ≡ "omega3") and make an apostrophe optional
// ("st john's" ≡ "st johns"). Allows an optional plural "s".
function termSource(term: string): string {
  return term
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[-\s]/g, "[-\\s]?")
    .replace(/'/g, "'?");
}

function termToRegex(term: string): RegExp {
  return new RegExp(`\\b${termSource(term)}s?\\b`, "i");
}

const ALLOWED_NUTRIENT_REGEXES = [
  ...ALLOWED_NUTRIENTS,
  ...ALLOWED_NUTRIENT_ALIASES,
].map((t) => termToRegex(t));

const BANNED_SUPPLEMENT_REGEXES = BANNED_SUPPLEMENTS.map((t) => ({
  term: t,
  regex: termToRegex(t),
}));

// Words naming an ingestible dosage form.
const DOSAGE_FORMS =
  "supplements?|multivitamins?|vitamins?|minerals?|pills?|capsules?|tablets?|gummies|gummy|softgels?|lozenges?|doses?|drops|powders?|tinctures?|extracts?|herbs|herbal|botanicals?|medications?|medicines?|meds|drugs?|prescriptions?|injections?|infusions?";

const ABBREVIATION_PATTERNS: Record<
  (typeof BANNED_SUPPLEMENT_ABBREVIATIONS)[number],
  RegExp[]
> = {
  DIM: [
    /\bDIM\b/, // capitals: always the supplement
    new RegExp(`\\bdim\\s+(?:${DOSAGE_FORMS})\\b`, "i"),
    /\bdim\s+for\s+(?:estrogen|oestrogen|hormon)/i,
    /(?:^|[.!?;:\n]\s*)dim\s+(?:is|was|may|can|could|might|helps?|supports?|works?)\b/i,
    /\b(?:take|taking|discuss|discussing|about|like|including|called|try|trying|with)\s+dim\b(?!\s+(?:lights?|lighting|lamps?|rooms?|screens?|bulbs?|settings?|the)\b)/i,
  ],
  NAC: [/\bNAC\b/i],
};

const BANNED_ABBREVIATION_REGEXES = BANNED_SUPPLEMENT_ABBREVIATIONS.map((t) => ({
  term: t,
  regexes: ABBREVIATION_PATTERNS[t],
}));

// "2000 IU", "500mg", "5 g", "1 mcg" — a number adjacent to a dosage unit.
// Numbers may be digits ("2,000") or words ("two thousand"); units may be
// plural or hyphenated ("IUs", "500-milligram", "international units").
// The negative lookahead exempts lab concentration units, where the same
// letters are a measurement rather than a dose: 95 mg/dL, 13.2 g/dL, 45 µg/dL,
// 30 mg/g creatinine, 45 µg/24h, 90 mL/min (eGFR is reported per minute).
// `/kg` is deliberately absent: "5 mg/kg" is genuine weight-based dosing.
const NUMBER_WORD =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half";
// An amount starts only at the head of its run of number words or digit groups:
// a start inside the run matches nothing the head does not. Without the two
// lookbehinds a long run was retried from every word (quadratic in the dose
// patterns) and could be split between the directive's filler slots (cubic).
const AMOUNT = `(?:(?<!\\b\\d+[.,])\\d+(?:[.,]\\d+)*|(?<!\\b(?:${NUMBER_WORD})[-\\s]+(?:and[-\\s]+)?)(?:${NUMBER_WORD})(?:[-\\s]+(?:and[-\\s]+)?(?:${NUMBER_WORD}))*)`;
const DOSAGE_REGEX = new RegExp(
  `\\b${AMOUNT}\\s*-?\\s*(?:i\\.?u\\.?s?|international\\s+units?|mgs?|mcgs?|[µμu]g|gm?s?|mls?|grams?|milligrams?|micrograms?)(?![a-z0-9])(?!\\s*\\/\\s*(?:d?l|ml|100\\s*ml|g|mg|mmol|mol|min|24\\s*h(?:r|rs|ours)?)\\b)`,
  "i",
);

// "two capsules", "3 tablets" — a counted dosage form is a dose too.
const DOSE_COUNT_REGEX = new RegExp(
  `\\b${AMOUNT}\\s*-?\\s*(?:capsules?|caps|tablets?|pills?|softgels?|gummies|lozenges?|drops|scoops?|sachets?|doses?)\\b`,
  "i",
);

// Prescriptive verbs aimed at something ingestible.
const PRESCRIPTIVE_VERB_REGEX =
  /\b(?:take|start taking|begin taking|consume|swallow|prescribe|prescribed)\b\s+(?:a\s+|an\s+|some\s+|the\s+|\d)/i;

// Directives aimed at a named substance (review F015): an imperative or
// recommending verb, up to three filler words, then a nutrient, a banned
// supplement or a dosage form — "Consider taking vitamin D", "Start a
// magnesium supplement", "You should supplement with iron". The verb must sit
// where it instructs the reader: at a clause start, after "you (should …)",
// after a lead-in ("make sure to"), or after "recommend/suggest/advise".
// "Ask whether you should take iron" and "If you take iron…" stay consultative.
const VERB_HEAD =
  "take|start|begin|add|try|use|increase|continue|consider|stop|discontinue|resume|boost|switch\\s+to|supplement\\s+with";
const VERB_ING =
  "taking|starting|beginning|adding|trying|using|increasing|continuing|supplementing\\s+with";
const FILLER =
  `a|an|the|some|any|your|more|extra|additional|another|regular|daily|nightly|liquid|chewable|prenatal|supplemental|low-dose|high-dose|over-the-counter|otc|of|on|couple|few|${VERB_ING}|${AMOUNT}`;
const SUBSTANCE_TERM = [
  ...[...ALLOWED_NUTRIENTS, ...ALLOWED_NUTRIENT_ALIASES, ...BANNED_SUPPLEMENTS]
    .map(termSource)
    .sort((a, b) => b.length - a.length)
    .map((t) => `${t}s?`),
  DOSAGE_FORMS,
].join("|");
const CLAUSE_START = '(?:^|[.!?;:()\\[\\]"\\n]|\\s-+)\\s*(?:(?:[-•*]|\\d+[.)])\\s*)?';
const SECOND_PERSON =
  "(?<!\\b(?:whether|if)\\s+)\\byou(?:'ll|'d)?\\s+(?:(?:should|could|might|can|may|must|will|would|need|ought|have|want|also|really|definitely|probably)\\s+)*(?:to\\s+)?";
const LEAD_IN =
  "\\b(?:please|then|also|just|simply|and|worth|try to|be sure to|make sure to|make sure you|remember to|don't forget to|aim to|it's (?:best|wise|worth|important|helpful|a good idea) to|it is (?:best|wise|worth|important|helpful|a good idea) to|(?:it )?(?:may|might|can|could) help to|you may benefit from)\\s+";
const DIRECTIVE_BODY =
  `(?:${VERB_HEAD}|${VERB_ING})\\s+(?:(?:${FILLER})\\s+){0,3}(?:${SUBSTANCE_TERM})\\b`;
const DIRECTIVE_REGEX = new RegExp(
  `(?:${CLAUSE_START}|${SECOND_PERSON}|${LEAD_IN})(?<d>${DIRECTIVE_BODY})` +
    `|(?<r>\\b(?:recommend|suggest|advise|encourage)(?:s|ed|ing)?\\s+(?:that\\s+)?(?:you\\s+)?(?:to\\s+)?${DIRECTIVE_BODY})`,
  "gi",
);

// A nutrient named as a lab measurement is not a substance being handed out:
// "Consider a vitamin D level check", "iron studies", "iron-rich foods".
const LAB_NOUN_AFTER =
  /^(?:[-\s]?(?:d[23]?|b12|b|c|e|k)\b)?[-\s]?(?:levels?|status|stores?|stud(?:y|ies)|panels?|tests?|testing|results?|markers?|readings?|values?|deficienc(?:y|ies)|saturation|binding|rich|absorption|labs?|draws?|numbers?|measurements?|metabolism|range|rechecks?|rechecking|retests?|retesting|checks?|screening|workup|work-up)\b/i;

function findDirective(text: string): string | null {
  for (const m of text.matchAll(DIRECTIVE_REGEX)) {
    const end = (m.index ?? 0) + m[0].length;
    if (!LAB_NOUN_AFTER.test(text.slice(end))) return m.groups?.d ?? m.groups?.r ?? m[0];
  }
  return null;
}

// A substance recommended with no action verb: "We recommend iron", "I'd
// advise magnesium", a bare "Recommend iron" — the recommending branch above
// without its verb. Any subject counts except her own clinician ("Your doctor
// may recommend iron", "Your doctor will likely recommend iron", "Discuss with
// your doctor, who may recommend iron", "Ask your doctor to advise on iron",
// "If your doctor agrees, they may recommend iron") and "you", a question to
// one ("Would you recommend iron?"). "Suggest" also means "indicate" ("these
// results suggest your vitamin D is low"), so it counts only after I or we, or
// as an imperative. A whether/if clause stays consultative, as in
// SECOND_PERSON, and so does a recheck recommended for a nutrient ("We
// recommend that your iron be rechecked").
const RECOMMENDED_SUBSTANCE_REGEX = new RegExp(
  `\\b(?:(?<s>suggest(?:s|ed|ing)?)|recommend(?:s|ed|ing)?|advis(?:e|es|ed|ing)|encourag(?:e|es|ed|ing))` +
    `\\s+(?:that\\s+)?(?:you\\s+)?(?:to\\s+)?(?:(?:${FILLER})\\s+){0,3}(?:${SUBSTANCE_TERM})\\b`,
  "gi",
);
const RECOMMENDER_AUX =
  "(?:(?:may|might|can|could|will|would|should|must|do|does|did|also|often|usually|typically|generally|sometimes|probably|really|strongly|definitely|still|now|then|first|am|are|have|had|is|be|likely|possibly|perhaps|well|already|commonly|routinely|want|wants|need|needs|to)\\s+)*";
const CLINICIAN =
  "doctors?|providers?|clinicians?|physicians?|practitioners?|(?:care\\s+)?team|ob(?:-|/)?gyns?|gyn(?:a?e)cologists?|endocrinologists?|midwi(?:fe|ves)|nurses?|specialists?|gps?";
const YOUR_CLINICIAN = `\\byour\\s+(?:[\\w-]+\\s+){0,2}(?:${CLINICIAN})\\b`;
const CONSULTED_SUBJECT = new RegExp(
  `(?:${YOUR_CLINICIAN}(?:\\s*,\\s*(?:who|which)\\b[^,.!?;:\\n]{0,80},|\\s*,?\\s+(?:who|that))?` +
    `|${YOUR_CLINICIAN}[^.!?;:\\n]*\\b(?:they|she|he)|\\byou(?:'d|'ll)?)\\s+${RECOMMENDER_AUX}$`,
  "i",
);
const SPEAKER = new RegExp(`(?:\\b(?:i|we)(?:'d|'ll|'m|'re|'ve)?\\s+${RECOMMENDER_AUX}|${CLAUSE_START})$`, "i");
const WHETHER_IF_CLAUSE = /\b(?:whether|if)\b[^,.!?;:\n]*$/i;
// Participles that make a nutrient a lab measurement ("iron was drawn", "your
// iron be rechecked").
const LAB_PARTICIPLES = "drawn|measured|tested|checked|rechecked|retested|collected|monitored";
const RECHECK_AFTER = new RegExp(`^\\s+(?:be|is|are|gets?|being)\\s+(?:\\w+\\s+)?(?:${LAB_PARTICIPLES})\\b`, "i");
// How far back the subject and whether/if checks read; it keeps the scan linear.
const LOOKBACK = 120;

function findRecommendedSubstance(text: string): string | null {
  for (const m of text.matchAll(RECOMMENDED_SUBSTANCE_REGEX)) {
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - LOOKBACK), start);
    const after = text.slice(start + m[0].length);
    if (LAB_NOUN_AFTER.test(after) || RECHECK_AFTER.test(after) || WHETHER_IF_CLAUSE.test(before)) continue;
    if (m.groups?.s ? SPEAKER.test(before) : !CONSULTED_SUBJECT.test(before)) return m[0];
  }
  return null;
}

// "daily", "twice a day", "every other day", "at bedtime", "with food" —
// dosing schedule language.
const FREQUENCY_REGEX =
  /\b(?:daily|nightly|twice (?:a |per )day|(?:once|twice|three times|\d+ times) (?:a|per|each) (?:day|week)|every (?:other )?(?:day|morning|night|evening)|each (?:day|morning|night|evening)|once a day|per day|at bedtime|before (?:bed|bedtime|sleep)|with (?:food|meals?|breakfast|lunch|dinner)|with (?:a|your) (?:\w+ )?(?:meal|breakfast|lunch|dinner)|between meals|on an empty stomach)\b/i;

// A time of day tied to a substance: "Magnesium at night", "Vitamin D in the
// morning", "Iron supplements are best taken at night". Ordinary text uses the
// same words ("Do you wake up at night?", "Low iron can cause restless legs at
// night"), so the phrase counts only within three words after a substance
// term, or in a sentence with a dosing verb aimed at one, before it ("Take
// your vitamin D with a glass of water in the morning") or after it ("Iron
// supplements are usually best taken at night", "Vitamin D is easiest to take
// in the morning"). A substance named as a lab measurement does not count:
// "Serum iron peaks in the morning", "Low magnesium can cause cramps at
// night", "Have your iron checked in the morning", "Retest iron in the
// morning", "Your vitamin D sample was taken in the morning". Nor does a time
// of day naming the draw ("Your vitamin D was 25 ng/mL in the morning draw"),
// nor "drops", as often a verb as a dosage form ("cortisol drops in the
// evening").
const TIME_OF_DAY = "at night|in the (?:morning|afternoon|evening)s?";
const NOT_A_DRAW =
  "(?!\\s+(?:(?:fasting|blood|lab)\\s+)?(?:draws?|samples?|specimens?|collections?|blood\\s*work|lab\\s*work|labs?|panels?|tests?|readings?)\\b)";
const TIME_OF_DAY_REGEX = new RegExp(`\\b(?:${TIME_OF_DAY})\\b${NOT_A_DRAW}`, "i");
const TIMED_SUBSTANCE_REGEX = new RegExp(
  `\\b(?:${SUBSTANCE_TERM})\\b(?=(?<gap>(?:[ ,]+[^\\s,.!?;:]+){0,3}?)[ ,]+(?<time>${TIME_OF_DAY})\\b${NOT_A_DRAW})`,
  "gi",
);
const DOSED_SUBSTANCE_REGEX = new RegExp(
  `\\b(?:take|takes|taking|taken|took|have|has|having|had|use|uses|using|used)\\s+(?:(?:${FILLER})\\s+){0,3}(?<sub>${SUBSTANCE_TERM})\\b`,
  "gi",
);
// The substance (and maybe one more word: "magnesium glycinate"), a form of
// "be", up to three words with no new subject ("you had" is not a dose), then
// taken, used, had or to take/use/have: "Iron supplements are usually best
// taken", "Iron should ideally be taken", "Magnesium's best taken", "Vitamin
// D is easiest to take".
const DOSED_AFTER_REGEX = new RegExp(
  `\\b(?<sub>${SUBSTANCE_TERM})\\b(?:\\s+[a-z][\\w-]*)?` +
    `(?:'s|'re|\\s+(?:(?:can|could|may|might|should|must|will|would|had\\s+better|tends?\\s+to|needs?\\s+to)\\s+(?:[a-z]+\\s+)?)?(?:is|are|was|were|be|been|being|gets?|got))` +
    `(?:\\s+(?!(?:you|she|he|they|we|i|it|your|her|his|their|our|my)\\b)[^\\s,.!?;:]+){0,3}?` +
    `(?:\\s+(?:when|if|once))?\\s+(?:taken|used(?!\\s+to\\b)|had(?!\\s+(?:been|\\w+ed)\\b)|to\\s+(?:take|use|have))\\b`,
  "gi",
);
const LAB_WORD_BEFORE =
  /\b(?:low|lower|high|higher|elevated|reduced|serum|plasma|blood|urine|urinary|(?:(?:re)?(?:test|check)(?:s|ed|ing)?|measur(?:e|es|ed|ing)|monitor(?:s|ed|ing)?|draw(?:s|ing)?)(?:\s+(?:your|the|a))?)\s+$/i;
const LAB_PARTICIPLE = new RegExp(`\\b(?:${LAB_PARTICIPLES})\\b`, "i");
// Sample words LAB_NOUN_AFTER (shared with the directive rule) does not list.
const LAB_SAMPLE_AFTER = /^[-\s]?(?:samples?|specimens?|collections?|blood\s*work|lab\s*work)\b/i;
// A dosage form is never a lab result: "a low dose", "check your dose".
const DOSAGE_FORM_TERM = new RegExp(`^(?:${DOSAGE_FORMS})$`, "i");

// `start` and `end` bound the substance term; `next` is the text after it
// that may hold a participle ("iron was drawn", "iron checked").
function isLabMention(text: string, start: number, end: number, next: string): boolean {
  const after = text.slice(end);
  return (
    LAB_NOUN_AFTER.test(after) ||
    LAB_SAMPLE_AFTER.test(after) ||
    (!DOSAGE_FORM_TERM.test(text.slice(start, end)) &&
      LAB_WORD_BEFORE.test(text.slice(Math.max(0, start - 40), start))) ||
    LAB_PARTICIPLE.test(next)
  );
}

// In the three-word window only nearness ties the time to the substance, so
// these read as a measurement or a body process, not a dose: a level or value
// after a nutrient ("Your iron was low in the morning sample", "Iron is
// highest in the morning", "Iron naturally peaks in the morning"; "Your dose
// is lower in the morning" still counts), the body making it ("Your body
// makes vitamin D from sunlight in the morning"), or a result the timing
// affects ("Thyroid medication in the morning can affect your TSH result").
const ADVERB =
  "(?:usually|typically|often|naturally|generally|normally|still|now|also|slightly|somewhat|much|even|already|always)\\s+";
const ANALYTE_PREDICATE = new RegExp(
  `^\\s+(?:${ADVERB})?(?:(?:is|was|are|were|runs?|ran|reads?|came\\s+(?:back|in)|comes?\\s+(?:back|in)|tends?\\s+to\\s+(?:be|run|read))\\s+(?:${ADVERB})?` +
    `(?:(?:low|lower|lowest|high|higher|highest|elevated|raised|reduced|normal)(?![\\w-])|in\\s+range|within\\s+(?:the\\s+)?(?:[\\w']+\\s+)?range|out\\s+of\\s+range|(?:below|above|under|over)\\s+(?:the\\s+|your\\s+)?(?:lab|reference|normal|range|\\d)|\\d)` +
    `|(?:peaks?|peaked|rises?|rose|falls?|fell|dips?|dipped|varies|varied|fluctuates?|fluctuated)\\b)`,
  "i",
);
const BODY_MAKES_BEFORE =
  /\b(?:body|skin)\s+(?:(?:can|naturally|also|only|mostly|usually)\s+)?(?:makes|made|produces|produced|synthesi[sz]es|synthesi[sz]ed|forms|formed|creates|created)\s+(?:(?:its\s+own|more|less|enough|some)\s+)?$/i;
const LAB_EFFECT_AFTER =
  /^\s+(?:(?:can|could|may|might|will|would|does|do|often|also|sometimes|be)\s+){0,2}(?:affect(?:s|ed|ing)?|skew(?:s|ed|ing)?|interfer(?:e|es|ed|ing)\s+with|alter(?:s|ed|ing)?|throw(?:s|ing)?\s+off|threw\s+off|distort(?:s|ed|ing)?)\s+(?:[\w'-]+\s+){0,3}?(?:results?|tests?|readings?|labs?|draws?|values?|measurements?)\b/i;

function findSubstanceTiming(text: string): string | null {
  for (const m of text.matchAll(TIMED_SUBSTANCE_REGEX)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const gap = m.groups?.gap ?? "";
    const time = m.groups?.time ?? "";
    const timeEnd = text.indexOf(time, end + gap.length) + time.length;
    const notADose =
      isLabMention(text, start, end, gap) ||
      (!DOSAGE_FORM_TERM.test(m[0]) && ANALYTE_PREDICATE.test(text.slice(end))) ||
      BODY_MAKES_BEFORE.test(text.slice(Math.max(0, start - 40), start)) ||
      LAB_EFFECT_AFTER.test(text.slice(timeEnd));
    if (time && !notADose && !/^drops$/i.test(m[0])) return time;
  }
  for (const sentence of text.split(/[.!?;:\n]/)) {
    const time = sentence.match(TIME_OF_DAY_REGEX)?.[0];
    if (!time) continue;
    for (const m of sentence.matchAll(DOSED_SUBSTANCE_REGEX)) {
      const end = (m.index ?? 0) + m[0].length;
      const start = end - (m.groups?.sub ?? "").length;
      const nextWord = sentence.slice(end).match(/^\s+\S+/)?.[0] ?? "";
      if (!isLabMention(sentence, start, end, nextWord)) return time;
    }
    for (const m of sentence.matchAll(DOSED_AFTER_REGEX)) {
      const start = m.index ?? 0;
      const end = start + (m.groups?.sub ?? "").length;
      if (!isLabMention(sentence, start, end, m[0].slice(end - start))) return time;
    }
  }
  return null;
}

// Brands and product endorsements, which NUTRIENT_GUIDELINES.md bans. A
// trademark sign is checked on the raw text, because NFKD spells ™ as "TM".
const BRAND_MARK_REGEX = /[®™℠]/;
const BRAND_WORD_REGEX =
  /\b(?:brands?|brand[-\s]name|name[-\s]brand|branded|third[-\s]party[-\s]tested|usp[-\s]verified|nsf[-\s]certified|pharmaceutical[-\s]grade)\b/i;

// Supplementation offered as general wellness rather than tied to a result.
const GENERAL_WELLNESS_REGEX =
  /\b(?:(?:overall|general) (?:health|wellness|well-?being)|immune support|preventive|preventative|for prevention)\b/i;

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
//
// Teas, roots, tonics and remedies are how herbs get named without the word
// "supplement" ("spearmint tea twice a day"); "root cause" is not one.
const SUBSTANCE_CONTEXT_REGEX =
  /\b(?:supplement(?:s|ed|ing|ation)?|multivitamins?|vitamins?|minerals?|pills?|capsules?|tablets?|gummies|gummy|softgels?|lozenges?|dose|doses|dosage|dosing|drops|powder|tincture|extract|herbs?|herbal|botanical|medications?|medicines?|meds|drugs?|prescriptions?|teas?|roots?(?!\s+caus)|leaf|tonics?|remed(?:y|ies))\b/i;

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
export function findTextViolations(raw: string): string[] {
  const violations: string[] = [];
  const text = normalizePolicyText(raw);

  const dosageMatch = text.match(DOSAGE_REGEX);
  if (dosageMatch) violations.push(`dosage_unit:${dosageMatch[0]}`);

  const countMatch = text.match(DOSE_COUNT_REGEX);
  if (countMatch) violations.push(`dosage_amount:${countMatch[0]}`);

  for (const { term, regex } of BANNED_SUPPLEMENT_REGEXES) {
    if (regex.test(text)) violations.push(`banned_supplement:${term}`);
  }
  for (const { term, regexes } of BANNED_ABBREVIATION_REGEXES) {
    if (regexes.some((r) => r.test(text))) violations.push(`banned_supplement:${term}`);
  }

  const hasSubstanceContext =
    SUBSTANCE_CONTEXT_REGEX.test(text) ||
    ALLOWED_NUTRIENT_REGEXES.some((r) => r.test(text)) ||
    BANNED_SUPPLEMENT_REGEXES.some(({ regex }) => regex.test(text));

  // A directive names its own substance, so it needs no separate context.
  const verbMatch =
    (hasSubstanceContext && text.match(PRESCRIPTIVE_VERB_REGEX)?.[0]) ||
    findDirective(text) ||
    findRecommendedSubstance(text);
  if (verbMatch) violations.push(`prescriptive_verb:${verbMatch}`);

  if (hasSubstanceContext) {
    const freqMatch = text.match(FREQUENCY_REGEX)?.[0] ?? findSubstanceTiming(text);
    if (freqMatch) violations.push(`dosing_frequency:${freqMatch}`);

    const brandMatch = text.match(BRAND_WORD_REGEX);
    if (brandMatch) violations.push(`brand_name:${brandMatch[0]}`);
  }

  const markMatch = raw.match(BRAND_MARK_REGEX);
  if (markMatch) violations.push(`brand_name:${markMatch[0]}`);

  // Allow-list enforcement: supplementation may only be discussed in terms of
  // an allow-listed nutrient. Anything else — named or not — fails closed.
  const supplementMatch = text.match(SUPPLEMENT_CONTEXT_REGEX);
  if (supplementMatch && !ALLOWED_NUTRIENT_REGEXES.some((r) => r.test(text))) {
    violations.push(`unlisted_nutrient:${supplementMatch[0]}`);
  }

  // Even an allow-listed nutrient may not be offered as general wellness
  // advice: supplementation has to be tied to a specific result.
  const wellnessMatch = supplementMatch && text.match(GENERAL_WELLNESS_REGEX);
  if (wellnessMatch) violations.push(`general_wellness:${wellnessMatch[0]}`);

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
