import { z } from "npm:zod@4.6.7";

// z.guid() takes any 8-4-4-4-12 hex id, as zod 3's uuid() did. zod 4's uuid()
// also checks the RFC 9562 version and variant digits.
export const GenerateInterpretationRequestSchema = z.object({
  reportId: z.guid(),
  primary_canonical_slug: z.string().nullish().optional(),
  // TASK-048: per-tap identity of a regeneration; required once the report
  // holds an interpretation, so a retried regeneration appends no second version.
  request_id: z.guid().optional(),
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
  currentReportId: z.guid(),
  previousReportId: z.guid().optional(),
});
export type LabInsightsRequest = z.infer<typeof LabInsightsRequestSchema>;
