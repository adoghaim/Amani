import type { ReportItem } from '../../utils/parser/types';
import { resolveAlias, getEntry } from './dictionary';
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

export function normalizeReportItems(items: ReportItem[]): NormalizedReportItem[] {
  return items.map(item => {
    const rawName = item.raw_biomarker_name ?? item.raw_name;
    const entry = resolveEntry(item);
    const unitNorm = normalizeUnit(item.unit);

    if (entry) {
      const unitMatches =
        unitNorm !== null &&
        unitNorm.toLowerCase() === entry.defaultUnit.toLowerCase();

      return {
        ...item,
        raw_biomarker_name: rawName,
        canonical_slug: entry.key,
        canonical_biomarker_name: entry.key,
        category: entry.category,
        is_core_biomarker: true,
        normalization_status: 'mapped' as const,
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
