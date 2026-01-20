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
- **vitamin B12** (vitamin_b12)
- **folate** (folate)
- **iron** (iron)
- **magnesium** (magnesium)
- **omega-3** (omega_3)
- **zinc** (zinc)

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
- "you should"
- "consider taking"
- "supplement with"
- "recommend taking"
- "start taking"

### 3. Banned Dosage/Timing Language

Never include:

- Specific amounts (mg, mcg, IU, g, ml)
- Frequency terms (daily, weekly, twice, per day, every day, once)
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
      "name": "vitamin_d",
      "why_it_came_up": "Your vitamin D level (18 ng/mL) is below the reference range (30-100 ng/mL)",
      "discussion_prompt": "Some clinicians may discuss vitamin D supplementation or increased sun exposure in the context of your lab results. You may want to ask your provider about options that would be appropriate for your situation."
    }
  ]
}
```

### Required Fields

- **name**: Must be one of the allowed nutrient identifiers
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
   - Remove the entire `nutrient_topics_to_discuss` section
   - Proceed with the rest of the interpretation intact

### Banned Pattern Detection

The validator checks for:

1. **Dosage patterns**: Numbers followed by units (mg, mcg, IU, g, ml)
2. **Frequency words**: daily, weekly, twice, per day, every day, once
3. **Prescriptive verbs**: take, you should, consider taking, supplement with, recommend taking
4. **Banned supplements**: ashwagandha, maca, vitex, DIM, evening primrose, black cohosh, adaptogen, herbal

### Validation Behavior

```typescript
// If violations detected on first attempt
if (attemptNumber === 1 && !validation.valid) {
  // Regenerate once
  return await callOpenAIWithRetry(..., attemptNumber: 2);
}

// If violations detected on second attempt
if (attemptNumber === 2 && !validation.valid) {
  // Remove nutrient section entirely
  return sanitizeNutrientSection(parsedJson);
}
```

## Examples

### ✅ COMPLIANT Example

**Lab Value**: Vitamin D = 18 ng/mL (Reference: 30-100 ng/mL)

**Symptom**: User reports "fatigue"

**Output**:
```json
{
  "name": "vitamin_d",
  "why_it_came_up": "Your vitamin D level (18 ng/mL) is below the reference range, and you mentioned experiencing fatigue, which can sometimes be associated with low vitamin D levels",
  "discussion_prompt": "Some clinicians may discuss vitamin D in the context of your lab results and symptoms. You may want to ask your provider about whether this could be relevant to your health and what approaches might be appropriate for you."
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
  "name": "ashwagandha",
  "discussion_prompt": "Some clinicians may discuss adaptogenic herbs..."
}
```
❌ Banned supplement type

**Example 4 - General wellness advice**:
```json
{
  "name": "magnesium",
  "why_it_came_up": "Magnesium is important for overall health",
  "discussion_prompt": "You may want to discuss magnesium with your provider"
}
```
❌ Not tied to a specific lab value or symptom

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
"Removing nutrient_topics_to_discuss section due to validation failures"
```

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
