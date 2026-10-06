import { readFileSync } from 'node:fs';

export const schema = JSON.parse(readFileSync(new URL('../../clinical/catalog/schema.json', import.meta.url), 'utf8'));

// Deliberately small JSON Schema vocabulary; the schema is checked against it so
// adding a keyword cannot silently weaken validation. No network or dependencies.
export function validateSchema(value, rule, path = '$') {
  const supported = new Set(['$schema', 'title', 'description', 'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'minimum', 'minLength', 'pattern']);
  for (const key of Object.keys(rule)) {
    if (!supported.has(key)) throw new Error(`Unsupported schema keyword: ${key}`);
  }
  const fail = message => { throw new Error(`${path}: ${message}`); };
  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    const matches = types.some(type => type === 'null' ? value === null
      : type === 'array' ? Array.isArray(value)
      : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : type === 'integer' ? Number.isInteger(value)
      : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : typeof value === type);
    if (!matches) fail(`expected ${types.join('|')}`);
  }
  if ('const' in rule && value !== rule.const) fail('unexpected constant');
  if (rule.enum && !rule.enum.includes(value)) fail('unexpected enum value');
  if (typeof value === 'number' && rule.minimum !== undefined && value < rule.minimum) fail('below minimum');
  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) fail('string too short');
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail('pattern mismatch');
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(rule.properties ?? {}, key)) validateSchema(item, rule.properties[key], `${path}.${key}`);
      else if (rule.additionalProperties === false) fail(`unknown field ${key}`);
    }
  }
  if (Array.isArray(value) && rule.items) value.forEach((item, i) => validateSchema(item, rule.items, `${path}[${i}]`));
}

export function validateCatalog(catalog) {
  validateSchema(catalog, schema);
  const slugs = new Set();
  const clientKeys = new Set();
  const synonyms = new Set();
  if (catalog.identity_only.length) throw new Error("Unreconciled identity_only entries");
  for (const analyte of catalog.analytes) {
    if (slugs.has(analyte.slug)) throw new Error(`Duplicate slug ${analyte.slug}`);
    slugs.add(analyte.slug);
    const weight = { critical: 3, important: 2, supporting: 1 }[analyte.importance];
    if (analyte.score_weight !== weight) throw new Error(`${analyte.slug}: legacy weight mismatch`);
    const bands = new Set();
    const clientKey = analyte.legacy_key ?? analyte.slug;
    if (clientKeys.has(clientKey)) throw new Error(`Duplicate client key ${clientKey}`);
    clientKeys.add(clientKey);
    const identity = analyte.registry_identity;
    const mapping = analyte.unit_mapping;
    if (identity) {
      if (identity.slug !== analyte.slug || !mapping || mapping.legacy_unit !== analyte.canonical_unit || mapping.registry_unit !== identity.unit) throw new Error(`${analyte.slug}: inconsistent unit mapping`);
      const approved = {
        neutrophils_abs: ['neutrophils_absolute', 'cells/uL', 'K/uL', 0.001],
        lymphocytes_abs: ['lymphocytes_absolute', 'cells/uL', 'K/uL', 0.001],
        monocytes_abs: ['monocytes_absolute', 'cells/uL', 'K/uL', 0.001],
        eosinophils_abs: ['eosinophils_absolute', 'cells/uL', 'K/uL', 0.001],
        basophils_abs: ['basophils_absolute', 'cells/uL', 'K/uL', 0.001],
        tsh: ['tsh', 'mIU/L', 'uIU/mL', 1],
        rbc: ['rbc', 'M/uL', 'Million/uL', 1],
      };
      if (mapping.status === 'verified') {
        const pair = Object.hasOwn(approved, analyte.slug) ? approved[analyte.slug] : [analyte.slug, analyte.canonical_unit, analyte.canonical_unit, 1];
        if (JSON.stringify([clientKey, mapping.legacy_unit, mapping.registry_unit, mapping.legacy_to_registry_factor]) !== JSON.stringify(pair)) throw new Error(`${analyte.slug}: unapproved unit/key join`);
      } else if (mapping.legacy_to_registry_factor !== null || analyte.legacy_key) throw new Error(`${analyte.slug}: refused mapping cannot join a legacy key`);
    } else if (mapping || analyte.legacy_key || analyte.extraction_synonyms.length) throw new Error(`${analyte.slug}: missing registry identity`);
    if (analyte.catalog_metadata && analyte.catalog_metadata.slug !== analyte.slug) throw new Error(`${analyte.slug}: catalog slug mismatch`);
    for (const synonym of analyte.extraction_synonyms) {
      const key = JSON.stringify([synonym.synonym_text, synonym.source_type]);
      if (synonyms.has(key)) throw new Error(`Duplicate extraction synonym ${key}`);
      synonyms.add(key);
    }
    for (const range of analyte.ranges) {
      const key = `${range.population}/${range.phase}/${range.kind}${range.candidate_id ? `/${range.candidate_id}` : ""}`;
      if (bands.has(key)) throw new Error(`${analyte.slug}: duplicate range ${key}`);
      bands.add(key);
      if (range.min !== null && range.max !== null && range.min > range.max) throw new Error(`${analyte.slug}: reversed range`);
      if (range.evidence_grade === 'unsourced' && (range.source !== null || range.source_url !== null || range.source_date !== null)) throw new Error(`${analyte.slug}: unsourced range carries a citation`);
      if (range.evidence_grade !== 'unsourced' && (!range.source?.trim() || !range.source_date)) throw new Error(`${analyte.slug}: sourced range requires source and date`);
      if (range.review_status === 'SAFE' && (range.evidence_grade === 'unsourced' || !range.reviewer?.trim() || !range.reviewed_at)) throw new Error(`${analyte.slug}: SAFE requires evidence and review`);
    }
    // Candidate rows are persisted with provenance but never projected into the
    // legacy API. Shipping bands must remain explicit and complete.
    if (analyte.ranges.some(r => r.candidate_id
      ? r.review_status !== 'DISPUTED' || r.candidate_id === 'shipping'
      : r.population !== 'general' || r.review_status === 'DISPUTED')) throw new Error(`${analyte.slug}: range needs a new projection policy`);
    for (const phase of new Set([null, ...analyte.ranges.filter(r => !r.candidate_id).map(r => r.phase)])) {
      for (const kind of ['amani_context', 'lab_reference']) {
        if (!bands.has(`general/${phase}/${kind}`)) throw new Error(`${analyte.slug}: missing ${phase}/${kind}`);
      }
    }
  }
  return catalog;
}
