import { z } from "npm:zod@^3.25.76";

// Mirrors the JSON schema embedded in the system prompt of
// `generate-interpretation/index.ts` (see "Required schema:" block).
// Used by `callOpenAIOnce` to validate the model's structured output before
// it is handed off to `validateInterpretationOutput` / sanitization.
export const InterpretationSchema = z.object({
  headline: z.string(),
  primary_concern: z.object({
    title: z.string(),
    summary: z.string(),
    why_it_matters: z.string(),
  }),
  key_findings: z.array(
    z.object({
      biomarker_slug: z.string(),
      title: z.string(),
      status: z.string(),
      explanation: z.string(),
    }),
  ),
  pattern_signals: z.array(
    z.object({
      title: z.string(),
      confidence: z.string(),
      explanation: z.string(),
      related_biomarkers: z.array(z.string()),
    }),
  ),
  what_you_can_do_now: z.array(z.string()),
  what_to_do_next: z.array(z.string()),
  overall_interpretation: z.string(),
  questions_for_doctor: z.array(z.string()),
  cycle_context: z.unknown(),
  disclaimer: z.string(),
});

export type Interpretation = z.infer<typeof InterpretationSchema>;
