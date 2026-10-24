# Nutrient Discussion Guidelines

This document outlines the strict rules and validation logic for how nutrients and supplements are mentioned in AI-generated lab interpretations.

## Core Principles

1. **Only include nutrients if directly tied to a specific lab value or reported symptom**
2. **Never provide prescriptive advice** - all mentions must be framed as discussion topics with a clinician
3. **Never include dosages, timing, frequencies, or brands**
4. **Maintain medical boundaries** - the app is educational, not diagnostic or prescriptive

## Allowed Nutrients (Allow-List)

Nutrients may ONLY be discussed as supplements if they are in this allow-list AND directly related to a lab value or symptom. The list is `ALLOWED_NUTRIENTS` in `supabase/functions/_shared/nutrient-policy.ts`, and it is **enforced, not advisory**: `validateInterpretationOutput` flags any supplementation language that does not name one of these nine.

- **vitamin D**
- **vitamin B12**
- **folate**
- **iron**
- **magnesium**
- **omega-3**
- **iodine**
- **selenium**
- **zinc**

Five extra spellings resolve to an entry above (`b12`, `cobalamin`, `vitamin d3`, `cholecalciferol`, `folic acid`). Hyphen and space variants such as `omega 3` are matched automatically, as are plurals.

> **Open question for the product owner.** Selenium and zinc have been in the code's allow-list and in its prompt list since the module was written, but were never in this document's list of seven. They are enforced as allowed today. Narrowing enforcement back to seven would also mean decoupling `ALLOWED_NUTRIENTS_PROMPT_LIST` from `ALLOWED_NUTRIENTS`, because the system prompt uses that string as the list of nutrient names the model must **not** put in `what_you_can_do_now` — shrinking it would let the model name selenium and zinc there.

## Banned Content

### 1. Banned Herbal/Alternative Supplements

These are a violation on bare mention, with no supplementation context required. The list is `BANNED_SUPPLEMENTS` (30 terms) plus `BANNED_SUPPLEMENT_ABBREVIATIONS` (2) in `_shared/nutrient-policy.ts`:

ashwagandha, maca, vitex, chasteberry, chaste tree, diindolylmethane, evening primrose, black cohosh, rhodiola, ginseng, saw palmetto, berberine, inositol, n-acetylcysteine, n-acetyl cysteine, red clover, dong quai, licorice root, milk thistle, st john's wort, st. john's wort, saint john's wort, tribulus, fenugreek, melatonin, adaptogen, 5-htp, valerian, kava, shatavari.

Valerian, kava and shatavari were added in October 2026 (review F096), with "saint john's wort" as one more spelling of an existing entry, because a model names herbs without the word "supplement", so the allow-list rule never sees them. The clinical owner has not yet reviewed which herbs belong on this list.

Abbreviations are matched separately: `NAC` in any case, since it is not an English word; `DIM` in capitals anywhere, and in sentence or lower case only where it reads as the supplement ("Dim is…", "a dim supplement", "take dim"), so the ordinary adjective ("dim the lights") is not flagged.

The deny-list is the second layer, not the first. Anything nobody thought to list is caught by the allow-list rule above, which fails closed on supplementation language that names no allow-listed nutrient.

### 2. Banned Prescriptive Language

The following are forbidden when aimed at something ingestible: "take", "start taking", "begin taking", "consume", "swallow", "prescribe"/"prescribed", each followed by an article or a number.

These fire only when the same string also carries substance context — a supplement/vitamin/mineral/pill/capsule/tablet/dose word, a dosage unit, or a named nutrient. Without that guard the validator flags ordinary English ("energy and focus are the first things to **take a** hit") and sends a clean report to the non-AI fallback for no reason.

**Directives aimed at a substance are forbidden too.** An imperative or recommending verb — take/taking, start/starting, begin, add, try, use, increase, continue, consider, stop, discontinue, resume, boost, switch to, supplement with — followed within three filler words by a nutrient, a banned supplement or a dosage form is a violation: "Consider taking vitamin D", "Start a magnesium supplement", "You should supplement with iron", "Try taking iron every other day". The verb has to sit where it instructs the reader: at the start of a clause, after "you (should/could/may want to…)", after a lead-in such as "make sure to", or after "recommend/suggest/advise". So consultative phrasing still passes — "Ask your provider whether you should take iron", "If you take iron already, mention it" — as does a nutrient named as a lab measurement ("Consider a vitamin D level check", "iron studies", "iron-rich foods").

**A substance recommended with no action verb is forbidden as well.** Recommend, advise or encourage, in any tense, followed (after at most "that", "you", "to" and three filler words) by a nutrient, a banned supplement or a dosage form is a violation: "We recommend iron for your low ferritin", "I'd advise magnesium", "We'd encourage vitamin D", a bare "Recommend iron". "Suggest" counts the same way only when I or we is suggesting, or as an imperative ("Your ferritin was low; we suggest iron"), because with any other subject it means "indicate": "These results suggest your vitamin D is low" passes. Also passing: her own clinician as the subject ("Your doctor may recommend iron"), "you" asking a clinician ("Would you recommend iron?"), a whether/if clause ("Ask your provider whether they would recommend iron", "If your doctor recommends iron, ask how long to take it"), and a nutrient named as a lab measurement ("We recommend a vitamin D recheck").

### 3. Banned Dosage/Timing Language

Never include:

- Specific dosage units (IU, international units, mg, mcg, µg/μg/ug, g, mL, grams, milligrams, micrograms, singular or plural, hyphenated or not) adjacent to a number, whether the number is digits ("2,000") or words ("two thousand")
- A counted dosage form ("two capsules", "3 tablets")
- Frequency terms (daily, nightly, twice a/per day, once/twice/three times a day or week, once a day, per day, every day/morning/night/evening, every other day, each day/morning/night/evening)
- Timing instructions (with food, with meals, with your largest meal, between meals, on an empty stomach, at bedtime, before bed)
- A time of day (at night, in the morning, in the afternoon, in the evening) tied to a substance: within three words after a nutrient, a banned supplement or a dosage form ("Magnesium at night", "Iron supplements are best taken at night", "Vitamin D in the morning"), or in a sentence with a dosing verb (take, have, use, in any tense) aimed at one ("Take your vitamin D with a glass of water in the morning"). Anywhere else a time of day is ordinary text ("Do you wake up at night?", "Low iron can cause restless legs at night"), and so is a nutrient named as a lab measurement ("Serum iron peaks in the morning", "Have your iron checked in the morning")
- Brand names or product recommendations. The validator catches a trademark sign (®, ™, ℠) anywhere, and, in substance context, the words "brand", "brand-name", "branded" and quality-seal endorsements ("third-party tested", "USP verified", "NSF certified", "pharmaceutical grade"). A bare brand name with no mark is not detected: there is no brand list yet, and the clinical owner decides what goes on one.

**Lab concentrations are not dosages.** `95 mg/dL`, `13.2 g/dL` and `45 µg/dL` are measurements the interpretation is supposed to quote, so the dosage pattern exempts a volume denominator (`/dL`, `/L`, `/mL`). A per-mass dosing expression such as `5 mg/kg` is still flagged. Frequency terms, like prescriptive verbs, require substance context in the same string — "track your energy daily" is not a dosing instruction.

## Required Language Patterns

All nutrient mentions MUST use consultative phrasing:

✅ **CORRECT:**
- "Some clinicians may discuss vitamin D in the context of..."
- "You may want to ask your provider about..."
- "This could be a topic to explore with your healthcare team..."

❌ **INCORRECT:**
- "Consider taking vitamin D"
- "You should supplement with..."
- "Take 2000 IU daily"
- "Start a magnesium supplement"

## Gating Logic

### When to Include a Nutrient

A nutrient should ONLY be included if:

1. A specific lab value is outside the reference range OR near a boundary AND the nutrient is known to directly relate to that biomarker
2. A user-reported symptom directly correlates with a documented nutrient deficiency pattern AND a related lab value shows a pattern

### When NOT to Include a Nutrient

Do NOT include nutrients:

- As general wellness advice
- Based on population statistics alone
- Without a clear connection to specific data
- As preventive suggestions

## Where nutrients appear in the output

The interpretation JSON does **not** carry a dedicated `nutrient_topics_to_discuss` field. Instead, nutrient mentions appear inline within the existing freeform output sections — most often `what_you_can_do_now` and `what_to_do_next`. Validation runs across the entire output rather than against a single field.

The system prompt enforces consultative phrasing at generation time; the server-side validator enforces it again at parse time.

## Server-Side Validation

The validator lives in `supabase/functions/_shared/nutrient-policy.ts` and is invoked by `generate-interpretation/index.ts` after every OpenAI response.

### Single source of truth

`_shared/nutrient-policy.ts` exports:

- `ALLOWED_NUTRIENTS` — the enforced allow-list (9 nutrients), and `ALLOWED_NUTRIENT_ALIASES` (5 alternate spellings).
- `ALLOWED_NUTRIENTS_PROMPT_LIST` — **derived** from `ALLOWED_NUTRIENTS` (`.join(", ")`) and interpolated into the system prompt, so the prompt cannot drift from what is enforced.
- `BANNED_SUPPLEMENTS` and `BANNED_SUPPLEMENT_ABBREVIATIONS` — banned herbal/adaptogen/nutraceutical names.
- Internal regexes for dosage units, prescriptive verbs, dosing-frequency words, supplementation context, and substance context.
- `findTextViolations(text)` → `string[]` for one freeform string. The shared primitive both of the below are built on.
- `validateInterpretationOutput(parsed)` → `{ valid, violations }`, checked per string across a recursive walk of the whole object.
- `sanitizeViolations(parsed)` → `Record<string, unknown> | null`. See the fail-closed contract below.

`_shared/nutrient-policy.test.ts` and `_shared/nutrient-policy.adversarial.test.ts` are the regression net for all of the above. Run `npm test` after any change to this module.

Any change to the allow-list, banned patterns, or phrasing rules goes in `_shared/nutrient-policy.ts` only — and the edge function must be redeployed.

### Validation flow

1. **First call** — OpenAI generates the interpretation; server runs `validateInterpretationOutput`.
2. **If violations are detected** — server logs the violations, appends a stricter reminder to the prompt, and calls OpenAI a second time.
3. **If the second response also violates** — server runs `sanitizeViolations`, which:
   1. filters every **top-level array of strings** (`what_you_can_do_now`, `what_to_do_next`, `questions_for_doctor`), dropping items that carry a violation. These are advice lists, so losing one item costs nothing else;
   2. re-validates the whole object;
   3. returns `null` if anything still violates. Scalar strings and strings nested inside objects — `headline`, `overall_interpretation`, `primary_concern.summary`, `key_findings[].explanation` — carry the clinical content and cannot be partially edited without either mangling the medicine or silently keeping unsafe text, so the interpretation is discarded instead.

**The `null` contract.** `tryOpenAI` returns `null`, the handler logs "OpenAI failed, using fallback" and calls `generateFallbackInterpretation` — deterministic, template-driven, no AI text. The user still gets a report; it is just not the AI one. Any future caller of `sanitizeViolations` MUST handle `null` the same way. Returning the object unchanged is what this replaced: a violation in `overall_interpretation` was detected on both attempts and then persisted untouched, while the log claimed it had sanitized.

### Banned patterns

The validator walks every freeform string in the parsed output and checks each one independently (so a match cannot be assembled across two unrelated fields).

Each string is **normalized first** (`normalizePolicyText`): typographic apostrophes become `'`, Unicode is NFKD-decomposed (fullwidth letters, ligatures, non-breaking spaces), invisible format characters (zero-width spaces and joiners, soft hyphens, word joiners) are deleted, accents are stripped, dash variants become `-`, and Cyrillic/Greek lookalike letters are folded to Latin. So "St John’s wort", "ashwa​gandha" with a zero-width space, "ber­berine" with a soft hyphen and "аshwagandha" with a Cyrillic `а` all match. Then, per string:

1. **Dosage units** (`dosage_unit`) — `IU`/`IUs`/`I.U.`, `international units`, `mg`, `mcg`, `µg`/`μg`/`ug`, `g`, `mL`/`ml`, `grams`, `milligrams`, `micrograms`, singular or plural, adjacent (or hyphenated) to a number in digits or words, except when followed by a lab denominator (`/dL`, `/L`, `/mL`, `/g`, `/min`, `/24h`…), which makes it a lab concentration rather than a dose. Unconditional.
2. **Counted dosage forms** (`dosage_amount`) — a number followed by capsules, tablets, pills, softgels, gummies, lozenges, drops, scoops, sachets or doses. Unconditional.
3. **Banned supplements** (`banned_supplement`) — the 30 terms and 2 abbreviations listed above. Unconditional.
4. **Prescriptive verb patterns** (`prescriptive_verb`) — `take`, `start taking`, `begin taking`, `consume`, `swallow`, `prescribe(d)` followed by an article or a digit, which requires substance context in the same string; or a directive aimed at a named substance, or a substance recommended with no action verb (both under "Banned Prescriptive Language" above), which name their own substance and so need no separate context.
5. **Dosing frequency** (`dosing_frequency`) — the frequency and timing terms listed above, including a time of day tied to a substance. Requires substance context in the same string.
6. **Brand names** (`brand_name`) — a trademark sign anywhere; brand and quality-seal words in substance context.
7. **Unlisted nutrient** (`unlisted_nutrient`) — supplementation language (`supplement`/`supplements`/`supplementing`/`supplementation`) in a string that names no allow-listed nutrient. This is the allow-list rule, and it is what makes the policy fail closed on berberine, inositol, red clover, dong quai and everything else nobody enumerated.
8. **General wellness** (`general_wellness`) — supplementation language next to "overall/general health", "overall wellness", "immune support", "preventive" or "for prevention". Nutrients may not be offered as general wellness advice.

Substance context means a supplement/vitamin/mineral/pill/capsule/tablet/dose/medication word, a tea, root, leaf, tonic or remedy ("root cause" does not count), or a named nutrient or banned supplement.

**Known gaps.** A medication named without a medication word ("Discuss starting metformin or levothyroxine") and a brand named without a trademark sign are not detected; both need a list that the clinical owner has not yet provided. Whether a nutrient mention is tied to a specific lab value is semantic and stays with the prompt.

The recommended-substance and time-of-day rules (October 2026, closing "recommend iron" and "at night") still miss a time of day placed before the substance or more than three words after it with no dosing verb ("At night, magnesium can help"), a passive recommendation ("Iron is recommended"), and "suggest" with a third-person subject ("Research suggests omega-3 for mood"). Two outcomes wait on the clinical owner: her own clinician recommending ("Your doctor may recommend iron") passes, and a list of analytes before a lab noun still reads as a directive ("Consider iron and B12 testing", "We recommend iron and B12 testing").

`_shared/nutrient-policy.adversarial.test.ts` pins every list literally and holds the adversarial corpus (obfuscated spellings, number words, plural and hyphenated units, recommending verbs, herbs, brands) plus a corpus of consultative and lifestyle sentences that must keep passing.

Violations are reported as `code:match` strings, deduplicated across the object.

## Examples

These illustrate the kind of phrasing the policy expects to see (and reject) inside freeform output fields like `what_you_can_do_now`.

### ✅ COMPLIANT phrasing

> "For your vitamin D: dietary sources and a few minutes of midday sun a few times a week can help. Worth asking your provider whether supplementation is appropriate for you."

Tied to a flagged lab value, consultative framing, no dosage, no prescriptive verb.

### ❌ NON-COMPLIANT phrasing (validator catches each)

| Phrase | Why it fails |
|---|---|
| "Take 2000 IU of vitamin D daily" | dosage unit (`IU`) + frequency (`daily`) + prescriptive verb (`take`) |
| "You should start taking a vitamin D supplement" | prescriptive verb (`start taking`) |
| "Consider an ashwagandha or rhodiola stack for stress" | banned supplements |
| "Magnesium is important for overall health, ask your provider about a supplement" | general-wellness supplementation (`overall health` beside the word "supplement"). Whether a nutrient is tied to a specific lab value is semantic, not regex, so the prompt still carries most of that rule |
| "Some clinicians discuss berberine supplementation" | banned supplement, and supplementation naming no allow-listed nutrient |
| "Ask your provider about calcium supplementation" | `calcium` is not in the allow-list, so the supplementation rule fails closed |

## Implementation Files

- **Policy module (single source of truth)**: `/supabase/functions/_shared/nutrient-policy.ts`
  - Exports `ALLOWED_NUTRIENTS` (enforced), `ALLOWED_NUTRIENTS_PROMPT_LIST` (derived from it), `BANNED_SUPPLEMENTS`, `BANNED_SUPPLEMENT_ABBREVIATIONS`, banned-pattern regexes
  - Exports `findTextViolations()`, `validateInterpretationOutput()` and `sanitizeViolations()`
- **Tests**: `/supabase/functions/_shared/nutrient-policy.test.ts`, `/supabase/functions/_shared/nutrient-policy.adversarial.test.ts`
- **Edge function (consumer)**: `/supabase/functions/generate-interpretation/index.ts`
  - Imports from the policy module above
  - Interpolates `ALLOWED_NUTRIENTS_PROMPT_LIST` into the system prompt
  - Calls `validateInterpretationOutput()` after every OpenAI response; regenerates on first violation; calls `sanitizeViolations()` on second violation and treats a `null` result as "no usable AI output", falling back to the deterministic interpretation

## Monitoring and Logging

When validation fails, the edge function logs the violations on each attempt. Check function logs for:

```
[generate-interpretation] nutrient validation failed (attempt 1): <violations>
[generate-interpretation] nutrient validation failed (attempt 2), sanitizing: <violations>
[generate-interpretation] OpenAI failed, using fallback
```

The third line after the second is the fail-closed path: sanitization could not save the output and the deterministic fallback was served. A rising rate there means the prompt and the validator have drifted apart, not that users are at risk.

## UI Display

There is no dedicated nutrient section in the report UI. `nutrient_topics_to_discuss` survives only as an optional field on a TypeScript interface (`src/types/index.ts`); nothing writes it and nothing renders it.

Food and nutrient discussion is owned by the **Support Plan** card (`src/components/GuidanceCards.tsx`, built deterministically by `src/lib/cards/buildCards.ts`) — not by the AI. The system prompt correspondingly forbids the model from naming foods, nutrients, or the word "supplement" in `what_you_can_do_now` and `what_to_do_next`.

## Updates and Maintenance

To modify these guidelines:

1. Edit `ALLOWED_NUTRIENTS` / `BANNED_SUPPLEMENTS` / the regexes in `supabase/functions/_shared/nutrient-policy.ts`. That module is the only place policy lives; the prompt list derives from it.
2. Update `supabase/functions/_shared/nutrient-policy.test.ts` and the pinned lists in `nutrient-policy.adversarial.test.ts`, then run `npm test`.
3. Update this document to match.
4. Deploy the edge function: `supabase functions deploy generate-interpretation`. The policy module is bundled with it, so a policy change is inert until this runs.

## Rationale

These strict guidelines ensure:

1. **Legal compliance**: No prescriptive medical advice
2. **User safety**: No risk of inappropriate self-medication
3. **Medical boundaries**: Clear scope as educational tool
4. **Professional standard**: Encourages proper clinician consultation
