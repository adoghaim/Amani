import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateCatalog } from './validate.mjs';
import { projectEntries } from './project.mjs';

export const migrationArtifact = 'supabase/migrations/20261006000000_clinical_catalog.sql';
export const rollbackArtifact = 'supabase/migrations/__verification__/clinical-catalog.rollback.sql';
export function stableJson(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
// V2-01 migration 20261006000000 is frozen by the Lead. Its 198 shipping
// rows must retain UNKNOWN even where the repository audit disagrees (43 rows).
// V2-03 needs a NEW migration before any consumer may read audit status from DB.
export const FROZEN_V2_01_REVIEW_STATUS = 'UNKNOWN';
export function sqlPayload(catalog) {
  validateCatalog(catalog);
  return {
    registry: catalog.analytes.flatMap(a => a.registry_identity ? [a.registry_identity] : []),
    synonyms: catalog.analytes.flatMap(a => a.extraction_synonyms.map(s => ({ analyte_slug: a.slug, ...s }))),
    metadata: catalog.analytes.flatMap(a => a.catalog_metadata ? [{ ...a.catalog_metadata,
      sex_applicability: a.catalog_metadata.sex_applicability === 'all' ? 'both' : a.catalog_metadata.sex_applicability }] : []),
    entries: catalog.analytes.map(a => ({ slug: a.slug, legacy_key: a.legacy_key ?? a.slug,
      range_unit: a.canonical_unit,
      registry_slug: a.unit_mapping?.status === 'verified' ? a.slug : null,
      registry_unit: a.unit_mapping?.registry_unit ?? null,
      legacy_to_registry_factor: a.unit_mapping?.legacy_to_registry_factor ?? null,
      // This is the V2-01 payload, not persistence for the TASK-042 audit.
      // Its specimen was null for every entry. Offline specimen hypotheses
      // and audit provenance stay in the seed/queue until a separately authorized
      // migration exists. Shipping review_status also retains its V2-01 value
      // below; clinical values and other historical fields still detect drift.
      metadata: { ...Object.fromEntries(Object.entries(a).filter(([key]) => !['ranges', 'specimen_basis'].includes(key))), specimen: null } })),
    ranges: catalog.analytes.flatMap(a => a.ranges.filter(r => !r.candidate_id).map(r => ({ slug: a.slug, unit: a.canonical_unit,
      candidate_id: r.candidate_id ?? 'shipping', ...Object.fromEntries(Object.entries(r)
        .filter(([key]) => !['value_origin', 'value_origin_table', 'modifiers', 'audit'].includes(key))),
      // Frozen V2-01 shipping history, not the current audit disposition.
      // Persisting TASK-042 statuses requires a separately authorized migration.
      review_status: FROZEN_V2_01_REVIEW_STATUS }))),
  };
}
export function renderSql(catalog) {
  const payload = stableJson(sqlPayload(catalog));
  const clientRanges = projectEntries(catalog).flatMap(e => [
    ...['optimal', 'clinical'].map(kind => ({ key: e.key, unit: e.defaultUnit, phase: null,
      kind: kind === 'optimal' ? 'amani_context' : 'lab_reference', ...e[kind] })),
    ...Object.entries(e.phaseRanges ?? {}).flatMap(([phase, bands]) => ['optimal', 'clinical'].map(kind => ({
      key: e.key, unit: e.defaultUnit, phase, kind: kind === 'optimal' ? 'amani_context' : 'lab_reference', ...bands[kind] }))),
  ]);
  const hash = createHash('sha256').update(payload).digest('hex');
  const literal = value => "'" + value.replaceAll("'", "''") + "'::jsonb";
  const replacements = { __PAYLOAD__: literal(payload), __CLIENT_RANGES__: literal(stableJson(clientRanges)), __HASH__: hash };
  const delimiter = `$clinical_${hash}$`;
  if (payload.includes(delimiter)) throw new Error('SQL body delimiter appears in seed');
  const render = name => readFileSync(new URL(name, import.meta.url), 'utf8')
    .replaceAll('$clinical$', () => delimiter)
    .replace(/__PAYLOAD__|__CLIENT_RANGES__|__HASH__/g, marker => replacements[marker]);
  return { [migrationArtifact]: render('migration.sql.txt'), [rollbackArtifact]: render('rollback.sql.txt'),
    'supabase/migrations/__verification__/clinical-catalog.seed.sql': render('verification.sql.txt') };
}
