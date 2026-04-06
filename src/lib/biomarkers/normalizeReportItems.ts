import type { ReportItem } from '../../utils/parser/types';
import { resolveAlias, getEntry } from './dictionary';
import type { BiomarkerName } from '../../types';

export function normalizeReportItems(items: ReportItem[]): ReportItem[] {
  return items.map(item => {
    if (item.canonical_slug) {
      const entry = getEntry(item.canonical_slug as BiomarkerName);
      if (entry) {
        return {
          ...item,
          canonical_biomarker_name: entry.key,
          category: entry.category,
          is_core_biomarker: true,
          normalization_status: 'mapped' as const,
        };
      }
    }

    const candidates = [item.raw_biomarker_name, item.raw_name, item.canonical_slug].filter(Boolean) as string[];
    for (const candidate of candidates) {
      const resolved = resolveAlias(candidate);
      if (resolved) {
        const entry = getEntry(resolved);
        if (entry) {
          return {
            ...item,
            canonical_slug: entry.key,
            canonical_biomarker_name: entry.key,
            category: entry.category,
            is_core_biomarker: true,
            normalization_status: 'mapped' as const,
          };
        }
      }
    }

    return {
      ...item,
      normalization_status: 'unmapped' as const,
    };
  });
}
