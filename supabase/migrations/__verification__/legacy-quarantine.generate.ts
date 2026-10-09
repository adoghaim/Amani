/** Regenerate deliberately, then review the fixture diff. Never run during tests. */
import { writeFileSync } from 'node:fs';
import { withClaimAuthority, projectBasic, legacyCustomerFloor, storedClaimSet, servedBasic } from '../../functions/_shared/claim-authority.ts';
import { buildBasicProjection, sanitizeBasicProjection, isDeterministicSource } from '../../functions/_shared/interpretation-visibility.ts';
import type { InterpretationPayload } from '../../functions/_shared/response-shaping.ts';
import type { TrendEvidence } from '../../functions/_shared/trend-evidence.ts';

const evidence = ['alpha', 'beta', 'gamma'].map((slug, i) => ({ biomarker_slug: slug, marker: slug,
  previous_value: 10, current_value: 12 + i, delta: 2 + i, percent_change: 20 + 10 * i,
  unit: 'u', previous_date: '2026-01-01', direction: 'increased', summary: `${slug} measured change` })) as TrendEvidence[];
const model = { headline: 'Amber paper boats', questions_for_doctor: ['Violet paper boats'],
  critical_findings: { biomarker_slug: 'gamma', critical: true, value: 14, title: 'Copper paper boats' },
  key_findings: [{ biomarker_slug: 'gamma', status: 'out_of_range', value: 14 }],
  flagged_trends: [{ biomarker_slug: 'gamma', text: 'Silver paper boats', critical: true }],
  pattern_signals: [{ title: 'Indigo paper boats', confidence: 0.9 }],
  overall_interpretation: 'Golden paper boats' };
const current = withClaimAuthority(model, { source: 'ai', trendEvidence: evidence,
  statuses: [{ biomarker_slug: 'gamma', marker: 'gamma', value: 14, unit: 'u', status: 'out_of_range' }] });
const basic = projectBasic(current, { source: 'ai' });
type MutableFixtureSet = { claims: Array<{ fact: Record<string, unknown>; authority: Record<string, unknown>; [key: string]: unknown }> };
const cases: Array<{ name: string; source: string | null; full: InterpretationPayload; basic: InterpretationPayload }> = [];
const add = (name: string, full: InterpretationPayload, source: string | null = 'ai', selected = basic) =>
  cases.push({ name, source, full: structuredClone(full), basic: structuredClone(selected) });
add('current-authorized', current);
add('missing-version-current-basic', model);
for (const version of [null, 3, {}, [], 'v9', 'v2-03c.0']) add(`invalid-version-${JSON.stringify(version)}`,
  { ...current, clinical_claims: { ...current.clinical_claims as object, policy_version: version } });
for (const claims of [null, {}, 'bad', [null], [3], [{}], []]) add(`invalid-claims-${JSON.stringify(claims)}`,
  { ...current, clinical_claims: { policy_version: 'v2-03c.1', claims } });
for (const [name, mutate] of Object.entries({
  'trend-authority': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims[0].authority.current = 99; },
  'trend-fact': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims[0].fact.delta = 99; },
  'trend-extra': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims[0].extra = true; },
  'trend-path': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims[0].source_path = '/trend_evidence/1'; },
  'trend-order': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims.reverse(); },
  'trend-missing': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims.shift(); },
  'safety-authority': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims[3].authority.current = 99; },
  'safety-fact': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims[3].fact.value = 99; },
  'safety-unit': (f: typeof current) => { delete (f.clinical_claims as unknown as MutableFixtureSet).claims[3].fact.unit; },
  'safety-extra': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims[3].extra = true; },
  'safety-whitespace': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims[3].authority.subject = '\t\u00a0'; },
  'unknown-category': (f: typeof current) => { (f.clinical_claims as unknown as MutableFixtureSet).claims[3].category = 'recommendation'; },
})) { const f = structuredClone(current); mutate(f); add(name, f); }
for (const [name, ev] of Object.entries({
  'deduplicated-slug': [evidence[0], evidence[0], evidence[1]],
  'invalid-evidence-ignored': [null, { ...evidence[0], delta: 0 }, evidence[1]],
  'unit-null': [{ ...evidence[0], unit: null }],
  'blank-marker': [{ ...evidence[0], marker: '\t\u00a0' }],
  'wrong-direction': [{ ...evidence[0], direction: 'decreased' }],
  'missing-unit': [{ ...evidence[0], unit: undefined }],
})) {
  const f = withClaimAuthority(model, { source: 'ai', trendEvidence: ev as TrendEvidence[], statuses: [] });
  add(name, JSON.parse(JSON.stringify(f)), 'ai', projectBasic(f, { source: 'ai' }));
}
const rounded = withClaimAuthority(model, { source: 'ai', trendEvidence: [], statuses: [
  { biomarker_slug: 'large', marker: 'large', value: 9007199254740992, unit: null, status: 'out_of_range' },
] });
add('binary64-safety-equality', rounded, 'ai', projectBasic(rounded, { source: 'ai' }));
add('current-empty-set', withClaimAuthority(model, { source: 'ai', trendEvidence: [], statuses: [] }));
add('current-full-future-basic', current, 'ai', { ...basic, locked: { patterns: 9, claim_policy_version: 'v9' } });
add('current-full-missing-basic', current, 'ai', { ...basic, locked: { patterns: 9 } });
for (const source of ['deterministic', 'fallback', 'unknown', null]) {
  const f = { ...model, cycle_context: {}, disclaimer: 'Synthetic deterministic disclaimer' };
  add(`legacy-source-${source}`, f, source, buildBasicProjection(f, [], { source }));
  add(`current-source-${source}`, current, source, projectBasic(current, { source }));
}
add('body-source-cannot-buy-exemption', { ...model, source: 'deterministic', interpretation_source: 'fallback' });
add('reassurance-is-untrusted', { headline: 'White paper boats', critical_findings: { critical: false, status: 'normal' } });
add('no-replacement-preview', { ...model, pattern_signals: [{ title: 'Second paper boats' }] });
const result = cases.map(c => {
  const trusted = isDeterministicSource(c.source) || storedClaimSet(c.full) !== null;
  const rpcBasic = trusted ? sanitizeBasicProjection(c.basic, c.source) : legacyCustomerFloor();
  return { ...c, expected: { current: storedClaimSet(c.full) !== null,
    trust: isDeterministicSource(c.source) ? 'deterministic' : trusted ? 'current' : 'legacy',
    full: trusted ? c.full : legacyCustomerFloor(), rpc_basic: rpcBasic,
    view_basic: trusted ? servedBasic(rpcBasic) : legacyCustomerFloor() } };
});
writeFileSync(new URL('./legacy-quarantine.corpus.json', import.meta.url), JSON.stringify(result).replaceAll('"value":9007199254740992', '"value":9007199254740993') + '\n');
