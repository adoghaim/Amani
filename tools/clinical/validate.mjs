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
      if (rule.properties?.[key]) validateSchema(item, rule.properties[key], `${path}.${key}`);
      else if (rule.additionalProperties === false) fail(`unknown field ${key}`);
    }
  }
  if (Array.isArray(value) && rule.items) value.forEach((item, i) => validateSchema(item, rule.items, `${path}[${i}]`));
}

export function validateCatalog(catalog) {
  validateSchema(catalog, schema);
  const slugs = new Set();
  for (const analyte of catalog.analytes) {
    if (slugs.has(analyte.slug)) throw new Error(`Duplicate slug ${analyte.slug}`);
    slugs.add(analyte.slug);
    const weight = { critical: 3, important: 2, supporting: 1 }[analyte.importance];
    if (analyte.score_weight !== weight) throw new Error(`${analyte.slug}: legacy weight mismatch`);
    const bands = new Set();
    for (const range of analyte.ranges) {
      const key = `${range.population}/${range.phase}/${range.kind}`;
      if (bands.has(key)) throw new Error(`${analyte.slug}: duplicate range ${key}`);
      bands.add(key);
      if (range.min !== null && range.max !== null && range.min > range.max) throw new Error(`${analyte.slug}: reversed range`);
      if (range.evidence_grade === 'unsourced' && (range.source !== null || range.source_url !== null || range.source_date !== null)) throw new Error(`${analyte.slug}: unsourced range carries a citation`);
      if (range.evidence_grade !== 'unsourced' && (!range.source || !range.source_date)) throw new Error(`${analyte.slug}: sourced range requires source and date`);
      if (range.review_status === 'SAFE' && (range.evidence_grade === 'unsourced' || !range.reviewer || !range.reviewed_at)) throw new Error(`${analyte.slug}: SAFE requires evidence and review`);
    }
    // V1 compatibility has one general population. Refuse to silently discard
    // future populations or disputed candidates during legacy projection.
    if (analyte.ranges.some(r => r.population !== 'general' || r.review_status === 'DISPUTED')) throw new Error(`${analyte.slug}: range needs a new projection policy`);
    for (const phase of new Set([null, ...analyte.ranges.map(r => r.phase)])) {
      for (const kind of ['amani_context', 'lab_reference']) {
        if (!bands.has(`general/${phase}/${kind}`)) throw new Error(`${analyte.slug}: missing ${phase}/${kind}`);
      }
    }
  }
  return catalog;
}
