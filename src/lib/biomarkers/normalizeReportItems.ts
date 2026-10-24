import type { ReportItem } from '../../utils/parser/types';
import { resolveAlias, getEntry } from './dictionary';
import { UNIT_EQUIVALENCES } from './rangeContext.generated';
import type { BiomarkerName } from '../../types';

const UNIT_ALIASES: Record<string, string> = {
  'miu/ml': 'mIU/mL',
  'uiu/ml': 'uIU/mL',
  'ng/ml': 'ng/mL',
  'pg/ml': 'pg/mL',
  'mg/dl': 'mg/dL',
  'g/dl': 'g/dL',
  'ng/dl': 'ng/dL',
  'ug/dl': 'ug/dL',
  'nmol/l': 'nmol/L',
  'iu/ml': 'IU/mL',
  'u/l': 'U/L',
  'k/ul': 'K/uL',
  'm/ul': 'M/uL',
  'meq/l': 'mEq/L',
  'mm/hr': 'mm/hr',
  'mg/l': 'mg/L',
  'fl': 'fL',
  'pg': 'pg',
  '%': '%',
  'ml/min/1.73m2': 'mL/min/1.73m2',
  'pmol/l': 'pmol/L',
  'umol/l': 'umol/L',
  'mmol/l': 'mmol/L',
  'g/l': 'g/L',
  'kiu/l': 'kIU/L',
  'miu/l': 'mIU/L',
};

function normalizeUnit(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  return UNIT_ALIASES[lower] ?? raw.trim();
}

// Notations of one and the same unit, matched after the spelling rules above.
const UNIT_NOTATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // A ratio is a bare number: "ratio" names no unit (Chol/HDL, A/G, BUN/Creatinine).
  [/^ratio$/, ''],
  // Thousands and millions per microlitre, however the power is written.
  [/^(?:[x×*]?10(?:\^|e|\*{1,2})3|k|thou|thousand)\/ul$/, 'k/ul'],
  [/^(?:[x×*]?10(?:\^|e|\*{1,2})6|m|mill|million)\/ul$/, 'm/ul'],
  // Millimetres per hour.
  [/^mm\/hr?$/, 'mm/h'],
  // Per 1.73 m² of body surface, printed without its m².
  [/^ml\/min\/1\.73(?:m2)?$/, 'ml/min/1.73m2'],
];

function unitSpelling(raw: string | null | undefined): string {
  const spelled = (raw ?? '').toLowerCase().replace(/\s+/g, '').replace(/[µμ]/g, 'u').replace(/(^|\/)mc(?=[a-z])/g, '$1u')
    .replace(/10³/g, '10^3').replace(/10⁶/g, '10^6').replace(/²/g, '2').replace(/³/g, '3');
  const notation = UNIT_NOTATIONS.find(([pattern]) => pattern.test(spelled));
  return notation ? notation[1] : spelled;
}

/**
 * Whether two unit strings name the same unit. Only spelling is ignored: case,
 * spacing, superscript digits (m², m2), how the micro prefix is written (µ, μ,
 * mc, u), and the notations in UNIT_NOTATIONS ("ratio" for a bare number;
 * x10E3/uL, 10^3/uL, thou/uL and K/uL; x10E6/uL and M/uL; mm/h and mm/hr).
 * Different units never match, however they relate (mmol/L and mg/dL, uIU/mL
 * and mIU/L, mmol/L and mEq/L, IU/L and U/L): the catalog approves no unit
 * conversions (review F011, PK-05-B V2-05-03). The few 1:1 identities the
 * catalog does record hold per analyte only: see isCatalogUnit.
 */
export function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  return unitSpelling(a) === unitSpelling(b);
}

/**
 * Whether `unit` is the catalog unit of the analyte `key`: the same unit
 * (sameUnit), or a unit the catalog records as an owner-approved 1:1
 * equivalent for exactly this analyte (catalog unit_equivalences, review-2:
 * mmol/L for sodium, potassium, chloride and CO2; uIU/mL for TSH; IU/L for
 * ALT, AST and alkaline phosphatase). A value in such a unit is used unchanged.
 * Every other unit of every analyte fails closed.
 */
export function isCatalogUnit(key: string, unit: string | null | undefined): boolean {
  const entry = getEntry(key as BiomarkerName);
  if (!entry) return false;
  return sameUnit(unit, entry.defaultUnit) || UNIT_EQUIVALENCES.some(e =>
    e.key === entry.key && sameUnit(e.canonicalUnit, entry.defaultUnit) && sameUnit(e.unit, unit));
}

export interface NormalizedReportItem extends ReportItem {
  _normalized: true;
  _display_name: string;
  _system_category: string | null;
  _normalized_unit: string | null;
}

function resolveEntry(item: ReportItem) {
  if (item.canonical_slug) {
    const entry = getEntry(item.canonical_slug as BiomarkerName);
    if (entry) return entry;
  }

  const candidates = [
    item.raw_biomarker_name,
    item.raw_name,
    item.canonical_slug,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const resolved = resolveAlias(candidate);
    if (resolved) {
      const entry = getEntry(resolved);
      if (entry) return entry;
    }
  }
  return null;
}

/**
 * The name the report shows for an item: its catalogue display name ("Vitamin
 * D", "HbA1c") when it resolves to an entry, else its printed label. It is the
 * `_display_name` normalizeReportItems saves as report_analytes.display_name,
 * so the upload's confirm step names each marker the way the report will.
 */
export function reportItemDisplayName(item: ReportItem): string {
  return resolveEntry(item)?.displayName ?? item.raw_name;
}

export function normalizeReportItems(items: ReportItem[]): NormalizedReportItem[] {
  return items.map(item => {
    const rawName = item.raw_biomarker_name ?? item.raw_name;
    const entry = resolveEntry(item);
    const unitNorm = normalizeUnit(item.unit);

    if (entry) {
      const unitMatches =
        unitNorm !== null &&
        unitNorm.toLowerCase() === entry.defaultUnit.toLowerCase();
      // Amani's bands are in the catalog unit and no conversion is approved: an
      // item in another unit keeps its lab interval but is not scored (F011).
      // A catalog-recorded 1:1 equivalent of the catalog unit is that unit (review-2).
      const catalogUnit = isCatalogUnit(entry.key, unitNorm);

      return {
        ...item,
        raw_biomarker_name: rawName,
        canonical_slug: entry.key,
        canonical_biomarker_name: entry.key,
        category: entry.category,
        is_core_biomarker: catalogUnit,
        normalization_status: catalogUnit ? 'mapped' as const : 'partial' as const,
        unit_original: item.unit,
        unit_normalized: unitMatches ? entry.defaultUnit : unitNorm,
        _normalized: true as const,
        _display_name: entry.displayName,
        _system_category: entry.category,
        _normalized_unit: unitMatches ? entry.defaultUnit : unitNorm,
      };
    }

    return {
      ...item,
      raw_biomarker_name: rawName,
      normalization_status: 'unmapped' as const,
      unit_original: item.unit,
      unit_normalized: unitNorm,
      _normalized: true as const,
      _display_name: item.raw_name,
      _system_category: null,
      _normalized_unit: unitNorm,
    };
  });
}
