# Nutrient Discussion Guidelines

This document outlines the strict rules and validation logic for how nutrients and supplements are mentioned in AI-generated lab interpretations.

## Core Principles

1. **Only include nutrients if directly tied to a specific lab value or reported symptom**
2. **Never provide prescriptive advice** - all mentions must be framed as discussion topics with a clinician
3. **Never include dosages, timing, frequencies, or brands**
4. **Maintain medical boundaries** - the app is educational, not diagnostic or prescriptive

## Allowed Nutrients (Allow-List)

Nutrients may ONLY be mentioned if they are in this allow-list AND directly related to a lab value or symptom:

- **vitamin D** (vitamin_d)
- **vitamin B12** (b12)
- **folate** (folate)
- **iron** (iron)
- **magnesium** (magnesium)
- **omega-3** (omega_3)
- **iodine** (iodine)

## Banned Content

### 1. Banned Herbal/Alternative Supplements

These supplements must NEVER be mentioned:

- Ashwagandha
- Maca
- Vitex (chasteberry)
- DIM (diindolylmethane)
- Evening primrose oil
- Black cohosh
- Any adaptogen
- Any herbal supplement

### 2. Banned Prescriptive Language

The following words and phrases are FORBIDDEN:

- "take"
- "start"
- "increase"
- "decrease"
- "recommended"
- "prescribe"

### 3. Banned Dosage/Timing Language

Never include:

- Specific dosage units (IU, mg, mcg, g, mL)
- Frequency terms (daily, twice, per day, every day)
- Timing instructions (morning, evening, with food)
- Brand names or product recommendations

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

- `ALLOWED_NUTRIENTS_PROMPT_LIST` — interpolated into the prompt's "supplements allowed" line so the prompt cannot drift from the validator.
- `BANNED_SUPPLEMENTS` — array of banned herbal/adaptogen names.
- Internal regexes for dosage units, prescriptive verbs, and dosing-frequency words.
- `validateInterpretationOutput(parsed)` → `{ valid, violations }`.
- `sanitizeViolations(parsed)` → filters `what_you_can_do_now` and `what_to_do_next` arrays of items containing any violation pattern.

Any change to the allow-list, banned patterns, or phrasing rules goes in `_shared/nutrient-policy.ts` only — and the edge function must be redeployed.

### Validation flow

1. **First call** — OpenAI generates the interpretation; server runs `validateInterpretationOutput`.
2. **If violations are detected** — server logs the violations, appends a stricter reminder to the prompt, and calls OpenAI a second time.
3. **If the second response also violates** — server runs `sanitizeViolations` to drop offending items from `what_you_can_do_now` and `what_to_do_next`, then returns the sanitized output. Other freeform fields are left intact (the validator's first line of defense is the regenerate retry; sanitization is the fail-closed floor).

### Banned patterns

The validator scans every freeform string in the parsed output (recursive walk) for:

1. **Dosage units**: `IU`, `mg`, `mcg`, `µg`/`ug`, `g`, `mL`/`ml`, `grams`, `milligrams`, `micrograms` — when adjacent to a number.
2. **Banned supplements**: ashwagandha, maca, vitex, chasteberry, diindolylmethane, evening primrose, black cohosh, rhodiola, ginseng, saw palmetto.
3. **Prescriptive verb patterns**: `take`, `start taking`, `begin taking`, `consume`, `swallow`, `prescribe(d)` — when followed by an article or a digit.
4. **Dosing frequency**: `daily`, `twice a/per day`, `every day/morning/night/evening`, `once a day`, `per day`, `with food`, `on an empty stomach`.

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
| "Magnesium is important for overall health, ask your provider about a supplement" | not tied to a specific lab value or symptom — semantic, not regex; the prompt rejects this, the validator does not |
| "Some clinicians discuss zinc supplementation" | `zinc` is not in the canonical allow-list |

## Implementation Files

- **Policy module (single source of truth)**: `/supabase/functions/_shared/nutrient-policy.ts`
  - Exports `ALLOWED_NUTRIENTS_PROMPT_LIST`, `BANNED_SUPPLEMENTS`, banned-pattern regexes
  - Exports `validateInterpretationOutput()` and `sanitizeViolations()`
- **Edge function (consumer)**: `/supabase/functions/generate-interpretation/index.ts`
  - Imports from the policy module above
  - Interpolates `ALLOWED_NUTRIENTS_PROMPT_LIST` into the system prompt
  - Calls `validateInterpretationOutput()` after every OpenAI response; regenerates on first violation; calls `sanitizeViolations()` on second violation

## Monitoring and Logging

When validation fails, the system logs:
- Which violations were detected
- Whether a retry was attempted
- Whether the nutrient section was removed

Check edge function logs for:
```
"Nutrient content validation failed: [violations]"
"Attempting regeneration with stricter prompt..."
"Setting nutrient_topics_to_discuss to empty array due to validation failures"
```

## UI Display

The nutrient discussion section is displayed in the report view with:

**Section Title**: "Nutrient topics to discuss with your clinician"

**Disclaimer Text**: "Conversation starters only — your clinician can advise what's appropriate for you."

**Content Display**: For each nutrient topic:
- Nutrient name (formatted for display)
- "Why this came up" explanation
- Discussion prompt text

The section only appears if `nutrient_topics_to_discuss` array is not empty.

## Updates and Maintenance

To modify these guidelines:

1. Update the allow-list in this document
2. Update the system prompt in `generate-interpretation/index.ts`
3. Update validation patterns in the `validateNutrientContent()` function
4. Deploy the updated edge function
5. Test with various lab scenarios to ensure compliance

## Rationale

These strict guidelines ensure:

1. **Legal compliance**: No prescriptive medical advice
2. **User safety**: No risk of inappropriate self-medication
3. **Medical boundaries**: Clear scope as educational tool
4. **Professional standard**: Encourages proper clinician consultation
