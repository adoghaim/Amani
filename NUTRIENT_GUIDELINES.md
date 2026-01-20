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

## JSON Output Structure

The AI generates a `nutrient_topics_to_discuss` array in the interpretation JSON:

```json
{
  "nutrient_topics_to_discuss": [
    {
      "nutrient": "vitamin_d",
      "why_it_came_up": "Vitamin D is below the lab reference range (24 vs 30–100).",
      "discussion_prompt": "Some clinicians may discuss dietary sources, sun exposure, or supplementation. You may want to ask your provider what's appropriate for you."
    }
  ]
}
```

### Required Fields

- **nutrient**: Must be one of the allowed nutrient identifiers (vitamin_d, iron, b12, folate, magnesium, omega_3, iodine)
- **why_it_came_up**: Clear explanation of which specific lab value or symptom triggered this inclusion
- **discussion_prompt**: Consultative language only, no prescriptive advice

## Server-Side Validation

The edge function performs automatic validation on all AI-generated content:

### Validation Steps

1. **First Generation Attempt**: AI generates interpretation following the prompt rules
2. **Content Validation**: Server checks for banned keywords and patterns
3. **If Validation Fails**:
   - Log violations
   - Attempt one regeneration with the same strict rules
4. **If Second Attempt Fails**:
   - Set `nutrient_topics_to_discuss` to empty array
   - Proceed with the rest of the interpretation intact

### Banned Pattern Detection

The validator checks for:

1. **Dosage units**: IU, mg, mcg, g (with numbers), mL
2. **Directive verbs**: take, start, increase, decrease, recommended, prescribe
3. **Frequency words**: daily, twice, per day, every day
4. **Allow-list validation**: Ensures all nutrient values are in the approved list (vitamin_d, iron, b12, folate, magnesium, omega_3, iodine)

### Validation Behavior

```typescript
// If violations detected on first attempt
if (attemptNumber === 1 && !validation.valid) {
  // Regenerate once
  return await callOpenAIWithRetry(..., attemptNumber: 2);
}

// If violations detected on second attempt
if (attemptNumber === 2 && !validation.valid) {
  // Set nutrient_topics_to_discuss to empty array
  return sanitizeNutrientSection(parsedJson);
}
```

## Examples

### ✅ COMPLIANT Example

**Lab Value**: Vitamin D = 24 ng/mL (Reference: 30-100 ng/mL)

**Symptom**: User reports "fatigue"

**Output**:
```json
{
  "nutrient": "vitamin_d",
  "why_it_came_up": "Vitamin D is below the lab reference range (24 vs 30–100).",
  "discussion_prompt": "Some clinicians may discuss dietary sources, sun exposure, or supplementation. You may want to ask your provider what's appropriate for you."
}
```

### ❌ NON-COMPLIANT Examples

**Example 1 - Dosage included**:
```json
{
  "discussion_prompt": "Consider taking 2000 IU of vitamin D daily"
}
```
❌ Contains dosage and prescriptive language

**Example 2 - Prescriptive language**:
```json
{
  "discussion_prompt": "You should start taking a vitamin D supplement"
}
```
❌ Uses "you should" and "taking"

**Example 3 - Banned supplement**:
```json
{
  "nutrient": "ashwagandha",
  "discussion_prompt": "Some clinicians may discuss adaptogenic herbs..."
}
```
❌ Banned supplement type (not in allow-list)

**Example 4 - General wellness advice**:
```json
{
  "nutrient": "magnesium",
  "why_it_came_up": "Magnesium is important for overall health",
  "discussion_prompt": "You may want to discuss magnesium with your provider"
}
```
❌ Not tied to a specific lab value or symptom

**Example 5 - Not in allow-list**:
```json
{
  "nutrient": "zinc",
  "why_it_came_up": "Low zinc levels detected",
  "discussion_prompt": "Some clinicians may discuss zinc supplementation"
}
```
❌ "zinc" was removed from the allow-list and is no longer permitted

## Implementation Files

- **Edge Function**: `/supabase/functions/generate-interpretation/index.ts`
  - Contains system prompt with nutrient rules
  - Implements validation logic
  - Handles retry and sanitization

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
