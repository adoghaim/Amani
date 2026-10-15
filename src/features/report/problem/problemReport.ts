/**
 * "Report a problem with this interpretation" (PK-HARM-01; design decision
 * D20, owner-approved 2026-10-12/13). The chooser's categories, the length
 * cap, and the one write: a row in public.interpretation_feedback.
 *
 * The write sits behind an injected port so tests need no network. The app's
 * port inserts through the Supabase client; RLS lets her insert only for her
 * own report, and the server sets user_id, status and times
 * (20261015020000_interpretation_feedback.sql).
 *
 * Shipped behind features.interpretation_feedback, off by default (D5, D6.2):
 * the table exists only after the owner pushes the migration.
 */
import { supabase } from '../../../lib/supabase';

export const INTERPRETATION_FEEDBACK_FLAG = 'interpretation_feedback';
/** PK-CORRECT-01's flag: "A value is wrong" continues into its correction screen when on. */
export const VALUE_CORRECTIONS_FLAG = 'value_corrections';

/** Problem-report text cap (engineering re-review Q4). The database CHECK holds the same number. */
export const PROBLEM_TEXT_MAX = 1000;

export type ProblemCategory = 'value_wrong' | 'explanation' | 'worried' | 'other';

/** The chooser, in D20's order and wording. */
export const PROBLEM_CATEGORIES: readonly { id: ProblemCategory; label: string }[] = [
  { id: 'value_wrong', label: 'A value is wrong' },
  { id: 'explanation', label: 'The explanation is confusing or wrong' },
  { id: 'worried', label: 'Something here worried me' },
  { id: 'other', label: 'Other' },
];

/** Where to get help, shown before anything else on the worried path (D20). Pending clinical review (D7.9). */
export const WORRIED_HELP_LINES = [
  'If you have questions about anything in this report, your clinician is the right person to ask.',
  'If you feel unwell right now, call your local emergency number.',
] as const;

export const IDENTIFIER_WARNING =
  "Please don't include your name, date of birth, or anything else that could identify you.";

const CATEGORY_IDS = new Set<string>(PROBLEM_CATEGORIES.map(category => category.id));

/** The category flags the report for the clinical reviewer (docs/ops/adverse-event-triage.md). */
export function flagsForClinicalReview(category: ProblemCategory): boolean {
  return category === 'worried';
}

/** What she chose and wrote, as the flow holds it. */
export interface ProblemReportInput {
  reportId: string;
  /** The explanation on screen (the interpretations view's id), or null when unknown. */
  interpretationId: string | null;
  category: ProblemCategory;
  text: string;
}

/** The row the app inserts: exactly the four columns authenticated may write. */
export interface InterpretationFeedbackInsert {
  report_id: string;
  interpretation_version_id: string | null;
  category: ProblemCategory;
  text: string | null;
}

export type ProblemReportProblem = 'no_report' | 'unknown_category' | 'text_too_long';

/**
 * The row for her input, or why there is none. Text is trimmed; blank text is
 * sent as null, never ''. Text over the cap is refused, not cut: she sees the
 * count and decides what to drop.
 */
export function problemReportRow(input: ProblemReportInput):
  { ok: true; row: InterpretationFeedbackInsert } | { ok: false; problem: ProblemReportProblem } {
  if (!input.reportId) return { ok: false, problem: 'no_report' };
  if (!CATEGORY_IDS.has(input.category)) return { ok: false, problem: 'unknown_category' };
  const text = input.text.trim();
  if (text.length > PROBLEM_TEXT_MAX) return { ok: false, problem: 'text_too_long' };
  return {
    ok: true,
    row: {
      report_id: input.reportId,
      interpretation_version_id: input.interpretationId || null,
      category: input.category,
      text: text.length > 0 ? text : null,
    },
  };
}

/** Where the row goes. Resolves with an error message, or null when stored. */
export interface ProblemReportPort {
  insert(row: InterpretationFeedbackInsert): Promise<{ error: string | null }>;
}

export type ProblemReportResult = { ok: true } | { ok: false; reason: ProblemReportProblem | 'not_saved' };

/** Builds the row and writes it once. Never throws: a failed write is `not_saved`. */
export async function submitProblemReport(port: ProblemReportPort, input: ProblemReportInput): Promise<ProblemReportResult> {
  const built = problemReportRow(input);
  if (!built.ok) return { ok: false, reason: built.problem };
  try {
    const { error } = await port.insert(built.row);
    return error ? { ok: false, reason: 'not_saved' } : { ok: true };
  } catch {
    return { ok: false, reason: 'not_saved' };
  }
}

/** The app's port: one insert through the Supabase client, nothing read back. */
export const supabaseProblemReportPort: ProblemReportPort = {
  async insert(row) {
    const { error } = await supabase.from('interpretation_feedback').insert(row);
    return { error: error ? error.message : null };
  },
};
