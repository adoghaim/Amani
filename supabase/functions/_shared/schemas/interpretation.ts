import { z } from "npm:zod@4.6.7";

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
      // Additive: requested only when the prompt carries PRIOR-REPORT CHANGES.
      // finding-metadata ignores a slug with no stored trend_evidence entry.
      trend_biomarker: z.string().optional(),
    }),
  ),
  what_you_can_do_now: z.array(z.string()),
  what_to_do_next: z.array(z.string()),
  overall_interpretation: z.string(),
  questions_for_doctor: z.array(z.string()),
  // zod 4 requires the key of a bare z.unknown(); zod 3 did not. The model may
  // leave it out, and the handler fills cycle_context either way.
  cycle_context: z.unknown().optional(),
  disclaimer: z.string(),
});

export type Interpretation = z.infer<typeof InterpretationSchema>;
