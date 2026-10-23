import type { BiomarkerName } from '../../types';
import { INSIGHT_RULES } from '../../utils/derivedMetrics';
import { getDisplayName } from '../biomarkers/dictionary';
import { assessAmaniContext, type PhysiologicalContext } from './amaniContext';
import {
  authorizedLanguage, combineLanguage, patternRuleObservation,
  type AuthorizedLanguage, type ComparisonBandLanguage, type MeasuredValue, type Placement,
} from './insightCopy';

/*
  V2-03 amendment 2 (B1): if Amani will not score an input, it must not assert
  a pattern built from it. This is mechanical, not clinical: no rule threshold
  or wording is read or changed here. A rule match is dropped when any analyte
  it declares is present on the report and withheld for the report's context.
  A declared analyte absent from the report is not an input and does not gate.

  V2-03 amendment 4 (R3): a rule's declared analytes are safety metadata. The
  gate takes them from the rule definition, by rule_id, and
  insightRuleDependencies.test.ts proves each declaration equals the analytes
  its check body reads. Where a dependency cannot be established the gate
  suppresses: an unknown rule_id, a match that disagrees with its rule, an
  empty declaration not listed in ANALYTE_FREE_RULES, or a present input the
  catalog cannot assess.
*/

export interface GatedInsightMatch {
  rule_id: string;
  biomarkers_involved: string[];
}

/** Rules that read no analyte, declared by id and never inferred. None today. */
export const ANALYTE_FREE_RULES: ReadonlySet<string> = new Set<string>();

const DECLARED: ReadonlyMap<string, readonly string[]> = new Map(
  INSIGHT_RULES.map(rule => [rule.rule_id, rule.biomarkers_involved] as const),
);

export type RuleDependency =
  | { kind: 'analytes'; analytes: readonly string[] }
  | { kind: 'analyte_free' }
  | { kind: 'unestablished' };

const UNESTABLISHED: RuleDependency = { kind: 'unestablished' };

/** The rule's established dependency. The two lookups default to the real rules; tests inject fakes. */
export function ruleDependency(
  match: GatedInsightMatch,
  declarations: ReadonlyMap<string, readonly string[]> = DECLARED,
  analyteFreeRules: ReadonlySet<string> = ANALYTE_FREE_RULES,
): RuleDependency {
  const declared = declarations.get(match.rule_id);
  const carried = match.biomarkers_involved;
  if (!Array.isArray(declared) || !Array.isArray(carried)) return UNESTABLISHED;
  const same = carried.length === declared.length && declared.every(k => carried.includes(k))
    && new Set(declared).size === declared.length;
  if (!same) return UNESTABLISHED;
  const analyteFree = analyteFreeRules.has(match.rule_id);
  if (declared.length === 0) return analyteFree ? { kind: 'analyte_free' } : UNESTABLISHED;
  return analyteFree ? UNESTABLISHED : { kind: 'analytes', analytes: declared };
}

/**
 * Declared inputs present on the report that Amani withholds, or cannot assess, in this context.
 * An input in a unit other than the catalog's cannot be assessed (F011).
 */
export function withheldInputs(
  match: GatedInsightMatch,
  values: ReadonlyMap<string, number>,
  context: PhysiologicalContext,
  units?: ReadonlyMap<string, string | null | undefined>,
): string[] {
  const dependency = ruleDependency(match);
  if (dependency.kind !== 'analytes') return [];
  return dependency.analytes.filter(key => {
    const value = values.get(key);
    if (value === undefined) return false;
    const kind = assessAmaniContext(key as BiomarkerName, value, context, units?.get(key)).kind;
    return kind === 'withheld' || kind === 'unavailable';
  });
}

export function gateInsightMatches<T extends GatedInsightMatch>(
  matches: readonly T[],
  biomarkers: readonly { name: string; value: number; unit?: string | null }[],
  context: PhysiologicalContext,
): T[] {
  const values = new Map(biomarkers.map(b => [b.name, b.value] as const));
  const units = new Map(biomarkers.map(b => [b.name, b.unit] as const));
  return matches.filter(m => {
    const dependency = ruleDependency(m);
    if (dependency.kind === 'unestablished') return false;
    return withheldInputs(m, values, context, units).length === 0;
  });
}

/**
 * The language a rule card may use (amendment 4, R2): the bands of its
 * declared inputs present on the report, combined most-restrictively. No
 * established band means UNKNOWN's neutral language.
 */
export function insightLanguage(
  match: GatedInsightMatch,
  values: ReadonlyMap<string, number>,
  context: PhysiologicalContext,
  units?: ReadonlyMap<string, string | null | undefined>,
): { language: AuthorizedLanguage; placement: Placement; subject: string; keys: string[] } {
  const dependency = ruleDependency(match);
  const keys = dependency.kind === 'analytes' ? dependency.analytes.filter(k => values.has(k)) : [];
  const languages: AuthorizedLanguage[] = [];
  const placements: Placement[] = [];
  for (const key of keys) {
    const assessment = assessAmaniContext(key as BiomarkerName, values.get(key)!, context, units?.get(key));
    languages.push(authorizedLanguage(assessment.kind === 'scored' ? assessment.band : null));
    placements.push(assessment.kind !== 'scored' ? null
      : assessment.status === 'optimal' || assessment.status === 'normal' ? 'within' : 'outside');
  }
  const language = combineLanguage(languages);
  // A placement is stated only for a single input; a pattern spans several.
  const placement = placements.length === 1 ? placements[0]! : null;
  const subject = keys.length > 0 ? keys.map(k => getDisplayName(k as BiomarkerName)).join(' and ') : 'This pattern';
  return { language, placement, subject, keys };
}

export interface AuthorizedInsightMatch extends GatedInsightMatch {
  title: ComparisonBandLanguage;
  description: ComparisonBandLanguage;
  badge: ComparisonBandLanguage;
}

/**
 * V2-03b Stage 2 (owner R2). A rule card is worded by the policy alone: the
 * measured inputs, that an unreviewed rule matched, and the bands' review
 * state. No rule here has clinical authority, so no card names a condition or
 * gives advice. Thresholds, matching and the gate above are untouched.
 */
export function authorizeInsightMatches<T extends GatedInsightMatch>(
  matches: readonly T[],
  biomarkers: readonly { name: string; value: number; unit?: string | null }[],
  context: PhysiologicalContext,
): (T & AuthorizedInsightMatch)[] {
  const values = new Map(biomarkers.map(b => [b.name, b.value] as const));
  const units = new Map(biomarkers.map(b => [b.name, b.unit] as const));
  return matches.map(m => {
    const { language, subject, keys } = insightLanguage(m, values, context, units);
    const measured: MeasuredValue[] = keys.map(k => ({
      name: getDisplayName(k as BiomarkerName), value: values.get(k)!, unit: units.get(k) ?? '',
    }));
    return { ...m, ...patternRuleObservation(subject, measured, language) };
  });
}
