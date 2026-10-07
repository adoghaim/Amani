import type { BiomarkerName } from '../../types';
import { assessAmaniContext, type PhysiologicalContext } from './amaniContext';

/*
  V2-03 amendment 2 (B1): if Amani will not score an input, it must not assert
  a pattern built from it. This is mechanical, not clinical: no rule threshold
  or wording is read or changed here. A rule match is dropped when any analyte
  it declares in biomarkers_involved is present on the report and withheld for
  the report's context. A declared analyte absent from the report is not an
  input and does not gate. A rule that declares no analytes is ungated.
*/

export interface GatedInsightMatch {
  rule_id: string;
  biomarkers_involved: string[];
}

export function withheldInputs(
  match: GatedInsightMatch,
  values: ReadonlyMap<string, number>,
  context: PhysiologicalContext,
): string[] {
  return match.biomarkers_involved.filter(key => {
    const value = values.get(key);
    return value !== undefined
      && assessAmaniContext(key as BiomarkerName, value, context).kind === 'withheld';
  });
}

export function gateInsightMatches<T extends GatedInsightMatch>(
  matches: readonly T[],
  biomarkers: readonly { name: string; value: number }[],
  context: PhysiologicalContext,
): T[] {
  const values = new Map(biomarkers.map(b => [b.name, b.value] as const));
  return matches.filter(m => withheldInputs(m, values, context).length === 0);
}
