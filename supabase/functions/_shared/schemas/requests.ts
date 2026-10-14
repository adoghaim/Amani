import { z } from "npm:zod@^3.25.76";

export const GenerateInterpretationRequestSchema = z.object({
  reportId: z.string().uuid(),
  primary_canonical_slug: z.string().nullish().optional(),
  // TASK-048: per-tap identity of a regeneration; required once the report
  // holds an interpretation, so a retried regeneration appends no second version.
  request_id: z.string().uuid().optional(),
  // PK-REGEN-01: what the request is for, which decides whether a written
  // version spends one of the report's regenerations (_shared/regeneration-limit.ts).
  // Absent means an ordinary regeneration. "correction" is not accepted until
  // PK-CORRECT-01 establishes the correction on the server.
  purpose: z.enum(["regenerate", "fuller_analysis"]).optional(),
});
export type GenerateInterpretationRequest = z.infer<
  typeof GenerateInterpretationRequestSchema
>;

export const ExtractBiomarkersRequestSchema = z.object({
  text: z.string().min(1),
});
export type ExtractBiomarkersRequest = z.infer<
  typeof ExtractBiomarkersRequestSchema
>;

export const LabInsightsRequestSchema = z.object({
  currentReportId: z.string().uuid(),
  previousReportId: z.string().uuid().optional(),
});
export type LabInsightsRequest = z.infer<typeof LabInsightsRequestSchema>;
