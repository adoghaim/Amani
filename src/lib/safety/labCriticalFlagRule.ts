/*
  Review F014 interim: the audit identity of the lab-printed critical flag rule
  (src/lib/safety/labCriticalFlags.ts) and the shape of its findings. Every
  finding and every notice carries this id and version; a change to the marker
  table or to where a marker is read is a new version. No imports, so the
  safety channel (insightCopy.labCriticalFlagWarnings) can name the rule without
  loading the recognizer's parser vocabulary into every page that uses it.
*/
export const LAB_CRITICAL_FLAG_RULE = Object.freeze({ ruleId: 'lab-printed-critical-flag', version: '1' } as const);

export interface LabCriticalFinding {
  readonly ruleId: string;
  readonly version: string;
  readonly analyteId: string;
  /** The result's name as the report shows it. */
  readonly name: string;
  /** The marker, e.g. "HH", and the token as the lab printed it, e.g. "(HH)". */
  readonly marker: string;
  readonly printed: string;
}
