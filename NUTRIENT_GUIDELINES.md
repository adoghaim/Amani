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

These are a violation on bare mention, with no supplementation context required. The list is `BANNED_SUPPLEMENTS` (26 terms) plus `BANNED_SUPPLEMENT_ABBREVIATIONS` (2) in `_shared/nutrient-policy.ts`:

ashwagandha, maca, vitex, chasteberry, chaste tree, diindolylmethane, evening primrose, black cohosh, rhodiola, ginseng, saw palmetto, berberine, inositol, n-acetylcysteine, n-acetyl cysteine, red clover, dong quai, licorice root, milk thistle, st john's wort, st. john's wort, tribulus, fenugreek, melatonin, adaptogen, 5-htp.

Abbreviations are matched separately and **case-sensitively** with word boundaries, so the supplement `DIM` is caught without flagging the ordinary adjective "dim": `DIM`, `NAC`.

The deny-list is the second layer, not the first. Anything nobody thought to list is caught by the allow-list rule above, which fails closed on supplementation language that names no allow-listed nutrient.

### 2. Banned Prescriptive Language

The following are forbidden when aimed at something ingestible: "take", "start taking", "begin taking", "consume", "swallow", "prescribe"/"prescribed", each followed by an article or a number.

These fire only when the same string also carries substance context — a supplement/vitamin/mineral/pill/capsule/tablet/dose word, a dosage unit, or a named nutrient. Without that guard the validator flags ordinary English ("energy and focus are the first things to **take a** hit") and sends a clean report to the non-AI fallback for no reason.

### 3. Banned Dosage/Timing Language

Never include:

- Specific dosage units (IU, mg, mcg, µg/ug, g, mL, grams, milligrams, micrograms) adjacent to a number
- Frequency terms (daily, twice a/per day, once a day, per day, every day/morning/night/evening)
- Timing instructions (with food, on an empty stomach)
- Brand names or product recommendations

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

`_shared/nutrient-policy.test.ts` is the regression net for all of the above. Run `npm test` after any change to this module.

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

The validator walks every freeform string in the parsed output and checks each one independently (so a match cannot be assembled across two unrelated fields). Per string:

1. **Dosage units** — `IU`, `mg`, `mcg`, `µg`/`ug`, `g`, `mL`/`ml`, `grams`, `milligrams`, `micrograms` adjacent to a number, except when followed by a volume denominator (`/dL`, `/L`, `/mL`), which makes it a lab concentration rather than a dose. Unconditional.
2. **Banned supplements** — the 26 terms and 2 abbreviations listed above. Unconditional.
3. **Prescriptive verb patterns** — `take`, `start taking`, `begin taking`, `consume`, `swallow`, `prescribe(d)` followed by an article or a digit. Requires substance context in the same string.
4. **Dosing frequency** — `daily`, `twice a/per day`, `every day/morning/night/evening`, `once a day`, `per day`, `with food`, `on an empty stomach`. Requires substance context in the same string.
5. **Unlisted nutrient** — supplementation language (`supplement`/`supplements`/`supplementing`/`supplementation`) in a string that names no allow-listed nutrient. This is the allow-list rule, and it is what makes the policy fail closed on berberine, inositol, red clover, dong quai and everything else nobody enumerated.

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
| "Magnesium is important for overall health, ask your provider about a supplement" | **passes the validator.** `magnesium` is allow-listed; "not tied to a specific lab value" is semantic, not regex, so only the prompt rejects this |
| "Some clinicians discuss berberine supplementation" | banned supplement, and supplementation naming no allow-listed nutrient |
| "Ask your provider about calcium supplementation" | `calcium` is not in the allow-list, so the supplementation rule fails closed |

## Implementation Files

- **Policy module (single source of truth)**: `/supabase/functions/_shared/nutrient-policy.ts`
  - Exports `ALLOWED_NUTRIENTS` (enforced), `ALLOWED_NUTRIENTS_PROMPT_LIST` (derived from it), `BANNED_SUPPLEMENTS`, `BANNED_SUPPLEMENT_ABBREVIATIONS`, banned-pattern regexes
  - Exports `findTextViolations()`, `validateInterpretationOutput()` and `sanitizeViolations()`
- **Tests**: `/supabase/functions/_shared/nutrient-policy.test.ts`
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
2. Update `supabase/functions/_shared/nutrient-policy.test.ts` and run `npm test`.
3. Update this document to match.
4. Deploy the edge function: `supabase functions deploy generate-interpretation`. The policy module is bundled with it, so a policy change is inert until this runs.

## Rationale

These strict guidelines ensure:

1. **Legal compliance**: No prescriptive medical advice
2. **User safety**: No risk of inappropriate self-medication
3. **Medical boundaries**: Clear scope as educational tool
4. **Professional standard**: Encourages proper clinician consultation
