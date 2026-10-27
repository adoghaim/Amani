import type { LabReportContext } from '../types';

/*
  Review F018. The context objects the upload page writes to lab_reports for
  the synthetic choices its contract test makes. NewReport.context.test.tsx
  drives the real page and pins that it writes exactly these;
  supabase/functions/_shared/schemas/context.test.ts feeds the same objects
  through the edge function's LabReportContextSchema, the only way this
  context reaches the interpretation. Synthetic only.
*/
export const NEW_REPORT_CONTEXTS = {
  /** "Fatigue" and "Hot flashes" chosen. */
  twoSymptoms: {
    birth_control: 'unsure', pregnant: 'unsure', postpartum: 'unsure',
    top_symptoms: ['fatigue', 'hot_flashes'], submission_mode: 'standard',
  },
  /** Nothing chosen. */
  noSymptoms: {
    birth_control: 'unsure', pregnant: 'unsure', postpartum: 'unsure',
    top_symptoms: [], submission_mode: 'standard',
  },
  /** "Cramps" chosen; the report_analytes insert then reports a missing column and the page rewrites the context. */
  compatibility: {
    birth_control: 'unsure', pregnant: 'unsure', postpartum: 'unsure',
    top_symptoms: ['cramps'], submission_mode: 'compatibility',
  },
} satisfies Record<string, LabReportContext>;
