import { cycleRuleModel } from './cycleRuleModel';
import type { EstimatedPhase } from './cycleDayRule';

/*
  PK-FIX-06-EXT (owner decision D10): what a report's cycle line says, on every
  screen that names a report's cycle (the report header, the dashboard's recent
  reports, the Reports list).

  It reads the same model as the report's cycle rule (cycleRuleModel), so the
  line and the rule never disagree:
  - the cycle day comes first;
  - a phase is shown only when the rule draws one, and always with
    "estimate for a 28-day cycle";
  - no cycle day on the report (no period start entered) means no line at all,
    never a phase on its own;
  - the day never wraps: day 37 stays day 37.
*/

export type ReportCycleFacts = {
  estimated_cycle_day?: unknown;
  estimated_cycle_phase?: unknown;
  average_cycle_length?: unknown;
};

export interface ReportCycleLineFacts {
  day: number;
  phase: EstimatedPhase | null;
}

/** The day and the shown phase for a report, or null when it has no cycle day. */
export function reportCycleLine(report: ReportCycleFacts): ReportCycleLineFacts | null {
  const model = cycleRuleModel(report);
  if (model.state === 'empty') return null;
  return { day: model.tickDay, phase: model.phase };
}
