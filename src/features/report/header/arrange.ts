import type { ReportHeaderAction, ReportHeaderContext, ResolvedReportHeaderAction } from './types';

/** The last action in More, always: deleting is behind its confirmation and never the primary (D19). */
export const DELETE_REPORT_ACTION_ID = 'delete-report';

export type ArrangedReportHeaderAction = ResolvedReportHeaderAction & { id: string };

export interface ArrangedReportHeader {
  primary: ArrangedReportHeaderAction | null;
  more: ArrangedReportHeaderAction[];
}

/**
 * D19: one primary action plus a labelled More menu. The primary is the first
 * available action that can be primary, in list order. More lists every other
 * available action that belongs there, in list order.
 */
export function arrangeReportHeader(actions: readonly ReportHeaderAction[], context: ReportHeaderContext): ArrangedReportHeader {
  const available = actions.flatMap(action => {
    const resolved = action.resolve(context);
    return resolved ? [{ action, arranged: { ...resolved, id: action.id } }] : [];
  });
  const primary = available.find(({ action }) => action.primary) ?? null;
  return {
    primary: primary?.arranged ?? null,
    more: available.filter(entry => entry !== primary && entry.action.more).map(({ arranged }) => arranged),
  };
}

/** Why an action list breaks the header's rules; empty when it holds. */
export function reportHeaderProblems(actions: readonly ReportHeaderAction[]): string[] {
  const problems: string[] = [];
  const ids = actions.map(action => action.id);
  for (const id of new Set(ids)) {
    if (ids.indexOf(id) !== ids.lastIndexOf(id)) problems.push(`${id} is listed twice`);
  }
  for (const action of actions) {
    if (!action.primary && !action.more) problems.push(`${action.id} is neither a primary candidate nor in More`);
  }
  const remove = actions.find(action => action.id === DELETE_REPORT_ACTION_ID);
  if (!remove) problems.push(`${DELETE_REPORT_ACTION_ID} is missing`);
  else {
    if (remove.primary) problems.push(`${DELETE_REPORT_ACTION_ID} can never be the primary action`);
    if (!remove.more) problems.push(`${DELETE_REPORT_ACTION_ID} belongs in More`);
    if (ids[ids.length - 1] !== DELETE_REPORT_ACTION_ID) problems.push(`${DELETE_REPORT_ACTION_ID} must be last`);
  }
  return problems;
}
