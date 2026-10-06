import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalog, assertAuditInventory } from './generate.mjs';
import { validateCatalog } from './validate.mjs';

export const auditArtifact = 'docs/clinical/AUDIT-QUEUE.md';
const root = new URL('../../', import.meta.url);
const cell = value => String(value).replaceAll('|', '&#124;').replaceAll('\n', ' ');
export const rangeId = (a, r) => `${a.slug}/${r.population}/${r.phase ?? 'unphased'}/${r.kind}`;

export function renderAuditQueue(catalog = readCatalog()) {
  validateCatalog(catalog);
  assertAuditInventory(catalog);
  const rows = catalog.analytes.flatMap(a => a.ranges.map(r => ({ a, r, id: rangeId(a, r) })));
  rows.sort((x, y) => {
    const xKey = `${x.r.audit.tier}/${x.a.slug === 'vitamin_d_25_oh' ? '0' : '1'}/${x.id}`;
    const yKey = `${y.r.audit.tier}/${y.a.slug === 'vitamin_d_25_oh' ? '0' : '1'}/${y.id}`;
    return xKey < yKey ? -1 : xKey > yKey ? 1 : 0;
  });
  if (new Set(rows.map(row => row.id)).size !== 198) throw new Error('Audit queue requires 198 unique range IDs');
  const counts = ['P0', 'P1', 'P2', 'P3'].map(tier => `${tier}: ${rows.filter(({ r }) => r.audit.tier === tier).length}`).join(' · ');
  const lines = [
    '# Clinical audit queue — TASK-042', '',
    'Generated from `clinical/catalog/catalog.json` by `npm run clinical:audit`. **83 analytes / 198 ranges.**', '',
    counts, '',
    'This is an offline triage instrument, not clinical approval. No external clinical source was retrieved. No clinical value changed. Every source, source URL, source date, reviewer and review date remains null; every evidence grade is unsourced and review status UNKNOWN. Requested artifacts below have NOT been obtained.', '',
    '`shipping_dictionary_2fd9433` identifies transcription history with zero clinical weight. It does not establish correctness. No range uses legacy_db_table or the reserved reviewed_evidence origin. Legacy alternatives below are historical observations, never additional seeded ranges.', '',
    'P0 = potential care/action hazard (including owner-designated vitamin D); P1 = reproductive, cycle, pregnancy or life-stage context; P2 = scoring/recommendation interpretation; P3 = informational. Tiers other than owner-designated hazards are conservative implementer judgments for human review, not proven clinical abnormalities. Zero P3 rows is intentional: no range has been established as merely informational. P2 does not establish safety. Vitamin D appears first within P0.', '',
    'For question 1, each range links to its exact catalog identity and aliases below. Questions 2–8 appear in the remaining columns. A blank unit or [] conversions is an explicit gap, not authority to infer a unit/conversion. The separate unit_mapping is a registry join, not an added measurement conversion.', '',
    'Specimen labels are hypotheses, with basis per row: serum_or_plasma leaves the actual matrix unresolved and does not declare interchangeability. UNKNOWN includes calculated results whose component matrices are undocumented. Population general remains the shipping projection key; it is not evidence of universal applicability. All 76 metadata entries remain unreviewed: 44 currently say female and 32 say all; female was the column default, not evidence (see CF-07).', '',
    'Modifier order: sex / age / cycle / pregnancy / life_stage. requires_context flags a review need, not a stratified value; UNKNOWN never means irrelevant. Cycle flags derive from phase structure; other flags are offline analyte-class inferences. False legacy cycle metadata is not proof of independence. Every question asks for confirmation of UNKNOWN modifiers.', '',
    'Kind verification is mechanical: optimal → amani_context, clinical → lab_reference. The latter is DOUBTFUL as a genuine laboratory interval until an assay artifact establishes it; it must never be presented as the patient laboratory range. No interval is promoted to an optimal target.', '',
    '## Full range queue', '',
    '| Tier | Range ID / test (Q1) | Shipping band; unit and conversions (Q3) | Specimen and basis (Q2) | Population (Q4) | Source / origin (Q5) | Kind verification (Q6) | Modifiers (Q7) | Review (Q8) | Triage reason | Open question | Required artifact (not retrieved) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const { a, r, id } of rows) {
    const mapping = a.unit_mapping;
    const unit = `${r.min ?? 'null'}–${r.max ?? 'null'} ${a.canonical_unit || '[empty unit]'}; conversions=${JSON.stringify(a.unit_conversions)}; registry join=${mapping ? `${mapping.legacy_unit || '[empty]'} → ${mapping.registry_unit || '[empty]'} × ${mapping.legacy_to_registry_factor ?? 'REFUSED'} (${mapping.status})` : 'absent'}`;
    lines.push('| ' + [r.audit.tier, `\`${id}\` / [${a.display_name}](#identity-${a.slug})`, unit,
      `${a.specimen}. ${r.audit.specimen_basis}`, `${r.population}; phase=${r.phase ?? 'null'}. ${r.audit.population_context}`,
      `null / null / null; unsourced; ${r.value_origin}; table=${r.value_origin_table ?? 'null'}`,
      r.audit.kind_verification, ['sex', 'age', 'cycle', 'pregnancy', 'life_stage'].map(k => `${k}=${r.modifiers[k]}`).join('; '),
      `${r.review_status}; reviewer=null; reviewed_at=null`, r.audit.reason, r.audit.open_question, r.audit.required_artifact,
    ].map(cell).join(' | ') + ' |');
  }
  lines.push('', '## Catalog identities (Q1)', '', 'Names and aliases establish only the current internal identity; they are not assay-equivalence evidence for unmatched legacy names.', '');
  for (const a of [...catalog.analytes].sort((x, y) => x.slug < y.slug ? -1 : 1)) {
    lines.push(`<a id="identity-${a.slug}"></a>`, '', `### ${a.slug}`, '',
      `Display name: ${a.display_name}. Aliases: ${JSON.stringify(a.aliases)}. Extraction identity: ${a.registry_identity?.slug ?? 'ABSENT'}.`, '');
  }
  lines.push(readFileSync(new URL('docs/clinical/AUDIT-CARRY-FORWARD.md', root), 'utf8').trim(), '');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = renderAuditQueue();
  const path = new URL(auditArtifact, root);
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== output) throw new Error(`${auditArtifact} drifted; run npm run clinical:audit`);
  } else writeFileSync(path, output);
  console.log(`Clinical audit queue ${process.argv.includes('--check') ? 'matches' : 'generated'} (83 analytes / 198 ranges)`);
}
