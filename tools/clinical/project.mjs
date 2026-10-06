import { validateCatalog } from './validate.mjs';

export function projectEntries(catalog) {
  validateCatalog(catalog);
  return catalog.analytes.map(a => {
    const band = (kind, phase) => {
      const r = a.ranges.find(r => !r.candidate_id && r.kind === kind && r.phase === phase);
      return { min: r.min, max: r.max };
    };
    const entry = { key: a.legacy_key ?? a.slug, displayName: a.display_name, aliases: a.aliases,
      defaultUnit: a.canonical_unit, category: a.category, importance: a.importance,
      optimal: band('amani_context', null), clinical: band('lab_reference', null) };
    const phases = [...new Set(a.ranges.filter(r => !r.candidate_id).map(r => r.phase).filter(p => p !== null))];
    if (phases.length) entry.phaseRanges = Object.fromEntries(phases.map(phase => [phase,
      { optimal: band('amani_context', phase), clinical: band('lab_reference', phase) }]));
    if ('higher_is_better' in a) entry.higherIsBetter = a.higher_is_better;
    return entry;
  });
}
