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

// Review-2 runtime projection: the owner-approved 1:1 unit identities, keyed
// like the legacy dictionary. The value is used unchanged; no factor is applied.
export function projectUnitEquivalences(catalog) {
  validateCatalog(catalog);
  const keys = new Map(catalog.analytes.map(a => [a.slug, a.legacy_key ?? a.slug]));
  return catalog.unit_equivalences.map(e => ({ key: keys.get(e.slug), unit: e.unit, canonicalUnit: e.canonical_unit }));
}

// V2-03 runtime projection: review state and context modifiers for every
// shipping band, keyed like the legacy dictionary. Values stay in
// projectEntries so a band's endpoints have exactly one client source.
// Fields are built in a fixed order so seed key order cannot change bytes.
export function projectContext(catalog) {
  validateCatalog(catalog);
  return catalog.analytes.map(a => ({
    key: a.legacy_key ?? a.slug,
    cycleDependent: a.is_cycle_dependent === true,
    bands: a.ranges.filter(r => !r.candidate_id).map(r => ({
      kind: r.kind,
      phase: r.phase,
      provenance: { evidence_grade: r.evidence_grade, review_status: r.review_status, source: r.source,
        source_date: r.source_date, reviewer: r.reviewer, reviewed_at: r.reviewed_at },
      modifiers: { sex: r.modifiers.sex, age: r.modifiers.age, cycle: r.modifiers.cycle,
        pregnancy: r.modifiers.pregnancy, life_stage: r.modifiers.life_stage },
    })),
  }));
}
