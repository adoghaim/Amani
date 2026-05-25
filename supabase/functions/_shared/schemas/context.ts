import { z } from "npm:zod@^3.25.76";

// `lab_reports.context` is jsonb and user-writable via standard RLS UPDATE,
// so anything that flows from here into the OpenAI prompt is a prompt-
// injection surface. Accept only the four expected fields, bound symptom
// strings, and reject anything else. Unknown values become undefined.
export const LabReportContextSchema = z
  .object({
    birth_control: z.enum(["yes", "no"]).optional(),
    pregnant: z.enum(["yes", "no"]).optional(),
    postpartum: z.enum(["yes", "no"]).optional(),
    top_symptoms: z
      .array(z.string())
      .transform((arr) => arr.map((s) => s.slice(0, 80)).slice(0, 10))
      .optional(),
  })
  .strip();

export type LabReportContext = z.infer<typeof LabReportContextSchema>;
