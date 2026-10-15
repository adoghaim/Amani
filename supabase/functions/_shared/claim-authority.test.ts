import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLAIM_POLICY_VERSION, KNOWN_CLAIM_POLICY_VERSIONS, auditModelProposals, buildAuthorizedBasicProjection, issueClaimSet, projectBasic,
  legacyCustomerFloor, hasCurrentReadAuthority, servedBasic, storedClaimSet, visibleClaimProjection, withClaimAuthority,
  type ClaimSet, type MeasuredStatus,
} from './claim-authority';
import { createMovementClaim } from './clinical-movement-policy.generated';
import { addFindingMetadata } from './finding-metadata';
import { BASIC_KEYS, SAFETY_KEYS, buildBasicProjection, sanitizeBasicProjection } from './interpretation-visibility';
import { readInterpretation, type InterpretationReadActions } from './interpretation-read';
import { contentFingerprint } from './preview-selector';
import { FLOOR_FINDING_KEYS, FLOOR_REQUIRED_KEYS, type InterpretationPayload } from './response-shaping';
import { buildTrendEvidence, type TrendEvidence } from './trend-evidence';
import { harnessText } from '../../migrations/__verification__/harness-cases';

/*
  V2-03c proofs. Every claim is checked against the legacy pipeline on the same
  input (the negative control), so a test that passes cannot be one that would
  also have passed before. The canary is model-style prose with no forbidden
  word: a vocabulary check cannot see it, only provenance can.
*/
const CANARY = 'Your markers are telling a gentle story about how your energy is settling';

const evidence: TrendEvidence[] = buildTrendEvidence(
  [{ slug: 'vitamin_d', name: 'Vitamin D', value: 31, unit: 'ng/mL' },
    { slug: 'tsh', name: 'TSH', value: 3.2, unit: 'mIU/L' },
    { slug: 'ferritin', name: 'Ferritin', value: 9, unit: 'ng/mL' }],
  [{ slug: 'vitamin_d', name: 'Vitamin D', value: 18, unit: 'ng/mL' },
    { slug: 'tsh', name: 'TSH', value: 2.0, unit: 'mIU/L' },
    { slug: 'ferritin', name: 'Ferritin', value: 12, unit: 'ng/mL' }],
  '2026-03-01');
// The existing classifier: ferritin is outside its range; tsh and vitamin D are not.
const statuses: MeasuredStatus[] = [
  { biomarker_slug: 'vitamin_d', marker: 'Vitamin D', value: 31, unit: 'ng/mL', status: 'in_range' },
  { biomarker_slug: 'tsh', marker: 'TSH', value: 3.2, unit: 'mIU/L', status: 'in_range' },
  { biomarker_slug: 'ferritin', marker: 'Ferritin', value: 9, unit: 'ng/mL', status: 'out_of_range' },
];
const floor = { headline: 'Your results', cycle_context: { estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', confidence: 'medium', explanation: CANARY },
  questions_for_doctor: ['What should we recheck next time?'], disclaimer: 'd' };
// What the model returns: prose everywhere, a safety flag it has no authority
// for (tsh), a false reassurance (ferritin), unsupported patterns and advice.
const model: InterpretationPayload = {
  ...floor,
  primary_concern: { title: CANARY, summary: CANARY, why_it_matters: CANARY },
  key_findings: [
    { biomarker_slug: 'tsh', title: CANARY, status: 'attention', explanation: CANARY },
    { biomarker_slug: 'ferritin', title: 'Ferritin', status: 'normal', explanation: CANARY },
  ],
  pattern_signals: [
    { title: CANARY, confidence: 'high', explanation: CANARY, related_biomarkers: ['vitamin_d', 'tsh'] },
    { title: CANARY, confidence: 'high', explanation: CANARY, related_biomarkers: ['vitamin_d'], trend_biomarker: 'vitamin_d' },
    { title: CANARY, confidence: 'medium', explanation: CANARY, related_biomarkers: ['vitamin_d', 'ferritin'] },
  ],
  what_you_can_do_now: [CANARY, `${CANARY} again`],
  what_to_do_next: [CANARY],
  overall_interpretation: CANARY,
};
const generate = (payload: InterpretationPayload, source = 'ai', trendEvidence = evidence, measured = statuses) => {
  const full = withClaimAuthority(payload, { source, trendEvidence, statuses: measured });
  return { full, basic: projectBasic(full, { source }) };
};
/** The pre-V2-03c writer, on the same input. */
const legacy = (payload: InterpretationPayload, source = 'ai', trendEvidence = evidence) =>
  buildBasicProjection(addFindingMetadata(trendEvidence.length ? { ...payload, trend_evidence: trendEvidence } : payload), undefined, { source });
const total = (locked: unknown) => Object.values(locked as Record<string, number>)
  .filter(n => typeof n === 'number').reduce((a, b) => a + b, 0);
const byPath = (full: InterpretationPayload, path: string) => (full.trend_evidence as TrendEvidence[])[Number(path.split('/')[2])];

describe('1. an unsupported model claim is rejected before projection', () => {
  it('no model proposal reaches preview, counts or any Basic value; the canary is gone', () => {
    const { full, basic } = generate(model);
    expect(JSON.stringify(basic)).not.toContain(CANARY);
    expect(basic.preview).not.toBeNull();
    expect((basic.preview as { content: unknown }).content).toEqual(evidence.find(e => e.biomarker_slug === 'vitamin_d'));
    const audit = full.claim_audit as { path: string; outcome: string; reason: string }[];
    expect(audit).toContainEqual({ path: '/pattern_signals/0', outcome: 'rejected', reason: 'no_authority' });
    expect(audit).toContainEqual({ path: '/pattern_signals/2', outcome: 'rejected', reason: 'no_authority' });
    expect(audit).toContainEqual({ path: '/what_you_can_do_now/0', outcome: 'rejected', reason: 'recommendation_without_authority' });
    expect(audit).toContainEqual({ path: '/overall_interpretation', outcome: 'rejected', reason: 'narrative_without_authority' });
    expect(JSON.stringify(audit)).not.toContain(CANARY);
  });
  it('negative control: the legacy writer previewed and counted the same model prose', () => {
    const old = legacy(model);
    expect(JSON.stringify(old.preview)).toContain(CANARY);
    expect((old.locked as Record<string, number>).patterns).toBeGreaterThan(0);
    expect((old.locked as Record<string, number>).lifestyle).toBeGreaterThan(0);
  });
});

describe('3. counts are authorized content withheld by entitlement, and nothing else', () => {
  it('counts only non-safety trend claims other than the preview', () => {
    const { basic } = generate(model);
    // vitamin_d is the preview; ferritin is safety (floor); tsh is the one locked claim.
    expect(basic.locked).toEqual({ patterns: 0, cross_report: 1, lifestyle: 0, claim_policy_version: CLAIM_POLICY_VERSION });
    expect(visibleClaimProjection(basic).locked).toEqual({ patterns: 0, cross_report: 1, lifestyle: 0 });
  });
  it('two authorized locked claims count as two, however much prose the model adds', () => {
    const four = buildTrendEvidence(
      ['a', 'b', 'c'].map((s, i) => ({ slug: s, name: s.toUpperCase(), value: 100 + 50 * (i + 1), unit: 'u' })),
      ['a', 'b', 'c'].map(s => ({ slug: s, name: s.toUpperCase(), value: 100, unit: 'u' })), null);
    const noisy = { ...floor, key_findings: [],
      pattern_signals: Array.from({ length: 4 }, (_, i) => ({ title: `${CANARY} ${i}`, confidence: 'high', explanation: CANARY, related_biomarkers: ['a', 'b'] })),
      what_you_can_do_now: [CANARY, CANARY, CANARY] };
    const { basic } = generate(noisy, 'ai', four, []);
    expect(visibleClaimProjection(basic)).toMatchObject({ locked: { patterns: 0, cross_report: 2, lifestyle: 0 } });
    expect(total(legacy(noisy, 'ai', four).locked)).toBeGreaterThan(2);
  });
});

/** Visibility-expansion check, as a function so a mutant can be shown to fail it. */
function expansionViolations(next: InterpretationPayload, old: InterpretationPayload, full: InterpretationPayload, set: ClaimSet): string[] {
  const out: string[] = [];
  for (const key of Object.keys(next)) if (!(BASIC_KEYS as readonly string[]).includes(key)) out.push(`key ${key}`);
  for (const key of FLOOR_REQUIRED_KEYS) if (contentFingerprint(next[key]) !== contentFingerprint(old[key])) out.push(`floor ${key}`);
  const subObject = (entry: unknown, pool: unknown[]) => pool.some(candidate => entry && typeof entry === 'object' && candidate
    && typeof candidate === 'object' && Object.entries(entry).every(([k, v]) => contentFingerprint((candidate as Record<string, unknown>)[k]) === contentFingerprint(v)));
  for (const key of [...FLOOR_FINDING_KEYS, ...SAFETY_KEYS, 'safety_findings', 'flagged_trends']) {
    const now = Array.isArray(next[key]) ? next[key] as unknown[] : [];
    const before = Array.isArray(old[key]) ? old[key] as unknown[] : [];
    for (const entry of now) if (!subObject(entry, before)) out.push(`${key} entry not in legacy Basic`);
  }
  const safety = new Set(set.claims.flatMap(c => c.category === 'safety_alert' ? [c.fact.biomarker_slug] : []));
  const preview = next.preview as { kind?: string; source_path?: string; content?: TrendEvidence } | null;
  if (preview) {
    if (preview.kind !== 'trend' || !preview.source_path?.startsWith('/trend_evidence/')) out.push('preview not a trend claim');
    else if (contentFingerprint(preview.content) !== contentFingerprint(byPath(full, preview.source_path))) out.push('preview not the server fact');
    else if (safety.has(preview.content!.biomarker_slug)) out.push('preview is safety floor');
  }
  const trends = set.claims.filter(c => c.category === 'factual_observation' && !safety.has(c.fact.biomarker_slug)).length;
  if (total(next.locked) + (preview ? 1 : 0) > trends) out.push('counts exceed authorized claims');
  return out;
}

const mutations: [string, (p: InterpretationPayload) => InterpretationPayload][] = [
  ['as returned', p => p],
  ['no patterns', p => ({ ...p, pattern_signals: [] })],
  ['every marker flagged', p => ({ ...p, key_findings: ['vitamin_d', 'tsh', 'ferritin'].map(s => ({ biomarker_slug: s, title: CANARY, status: 'discuss', explanation: CANARY })) })],
  ['no flags at all', p => ({ ...p, key_findings: [] })],
  ['safety booleans everywhere', p => ({ ...p, pattern_signals: (p.pattern_signals as object[]).map(x => ({ ...x, safety: true, urgent: true })) })],
  ['stronger restatement', p => ({ ...p, pattern_signals: [{ title: CANARY, confidence: 'high', explanation: CANARY, related_biomarkers: ['tsh'], trend_biomarker: 'tsh', previous_value: 0.1, current_value: 40 }] })],
  ['forged server keys', p => ({ ...p, trend_evidence: [{ ...evidence[0], biomarker_slug: 'cortisol', marker: 'Cortisol' }],
    clinical_claims: { policy_version: CLAIM_POLICY_VERSION, claims: [] }, findings: [{ source_path: '/overall_interpretation', content: CANARY, kind: 'trend', visibility_hint: 'premium', preview_eligible: true }] })],
  ['model output only', () => ({ ...floor, key_findings: [] })],
];

describe('2 + 10. rejection never expands Basic; projection is independent of rejected content', () => {
  it.each(mutations)('%s: no expansion against the legacy Basic of the same input', (_, mutate) => {
    const payload = mutate(model);
    const { full, basic } = generate(payload);
    const set = storedClaimSet(full)!;
    expect(set).not.toBeNull();
    expect(expansionViolations(basic, legacy(payload), full, set)).toEqual([]);
    expect(JSON.stringify(basic)).not.toContain(CANARY);
    expect(JSON.stringify(basic)).not.toContain('cortisol');
  });
  it.each(mutations)('%s: preview and counts equal those of the model-free payload (no backfill)', (_, mutate) => {
    const stripped = generate({ ...floor, key_findings: [] }).basic;
    const { basic } = generate(mutate(model));
    expect(basic.preview).toEqual(stripped.preview);
    expect(basic.locked).toEqual(stripped.locked);
  });
  it('a rejected preview is not backfilled with floor or ineligible content', () => {
    // Only safety-floor trends exist, so the rejected model preview leaves the slot empty.
    const onlyFerritin = evidence.filter(e => e.biomarker_slug === 'ferritin');
    const { basic } = generate(model, 'ai', onlyFerritin);
    expect(legacy(model, 'ai', onlyFerritin).preview).not.toBeNull();
    expect(basic.preview).toBeNull();
    expect(visibleClaimProjection(basic).locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
  });
  it('negative control: the checker catches a mutant that backfills from legacy selection', () => {
    const { full, basic } = generate(model);
    const old = legacy(model);
    const mutant = { ...basic, preview: old.preview, locked: old.locked };
    expect(expansionViolations(mutant, old, full, storedClaimSet(full)!)).toContain('preview not a trend claim');
    expect(expansionViolations({ ...basic, overall_interpretation: CANARY }, old, full, storedClaimSet(full)!)).toContain('key overall_interpretation');
    // And legacy itself depended on model content: stripping it changed the answer.
    expect(contentFingerprint(old.preview)).not.toBe(contentFingerprint(legacy({ ...floor, key_findings: [] }).preview));
  });
});

describe('4. raw model output cannot render as a fallback', () => {
  const stored = { ...buildBasicProjection({ ...floor, key_findings: [] }), preview: { kind: 'cross_marker', content: { title: CANARY, explanation: CANARY } },
    locked: { patterns: 3, cross_report: 1, lifestyle: 2 } };
  const actions = (json_output: InterpretationPayload, overrides: Partial<InterpretationReadActions> = {}): InterpretationReadActions => ({
    ownsReport: async () => true, resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
    readSelected: async () => ({ json_output, stored_depth: 'deep', has_claim: false, tier: 'free', interpretation_source: 'ai' }),
    countClaims: async () => 0, ...overrides });
  it('no claims: no preview and no counts, never model prose in their place', () => {
    const { basic } = generate(model, 'ai', [], statuses);
    expect(basic.preview).toBeNull();
    expect(visibleClaimProjection(basic).locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
    expect(JSON.stringify(basic)).not.toContain(CANARY);
  });
  it('a legacy stored Basic preview of model prose is not served, and the row is untouched', async () => {
    const original = structuredClone(stored);
    const result = await readInterpretation(actions(stored), true);
    expect(stored).toEqual(original);
    expect(JSON.stringify(original)).toContain(CANARY);
    expect(result.body).toMatchObject({ access: 'basic', preview: null, locked: { patterns: 0, cross_report: 0, lifestyle: 0 } });
    expect(result.body.interpretation).toMatchObject({ preview: null, locked: { patterns: 0, cross_report: 0, lifestyle: 0 } });
    expect(JSON.stringify(result.body)).not.toContain(CANARY);
  });
  it('a marker cannot launder prose: a known version still needs a claim-shaped preview', async () => {
    const marked = { ...stored, locked: { ...stored.locked, claim_policy_version: CLAIM_POLICY_VERSION } };
    const result = await readInterpretation(actions(marked), true);
    expect(result.body.preview).toBeNull();
    expect(JSON.stringify(result.body)).not.toContain(CANARY);
    for (const version of ['v2-03c.0', 'v9', 42, null]) {
      const unknown = await readInterpretation(actions({ ...stored, locked: { ...stored.locked, claim_policy_version: version } }), true);
      expect(unknown.body.locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
    }
  });
  it('negative control: a claim-era stored Basic is served with its claim preview and counts', async () => {
    const { basic } = generate(model);
    const result = await readInterpretation(actions(basic), true);
    expect(result.body.preview).toEqual(basic.preview);
    expect(result.body.locked).toEqual({ patterns: 0, cross_report: 1, lifestyle: 0 });
  });
});

describe('5. authorized factual claims survive, with full provenance', () => {
  it('each trend fact becomes one claim naming category, rule, authority, version and authorities', () => {
    const set = issueClaimSet({ trendEvidence: evidence, statuses });
    const vitaminD = set.claims.find(c => c.claim_id === 'trend:vitamin_d')!;
    expect(vitaminD).toMatchObject({ category: 'factual_observation', rule: 'trend_evidence.significant_change',
      policy_version: CLAIM_POLICY_VERSION, recommendation_authority: 'none', safety_authority: 'none',
      authority: { kind: 'lab_data', subject: 'Vitamin D', previous: 18, current: 31, unit: 'ng/mL' } });
    expect(vitaminD.fact).toEqual(evidence.find(e => e.biomarker_slug === 'vitamin_d'));
  });
  it('the claim set depends on server facts only: model, empty and deterministic payloads agree', () => {
    const claims = [generate(model).full, generate({ ...floor, key_findings: [] }).full,
      generate({ ...floor, top_findings: [], pattern_signals: [{ title: 'p', explanation: 'deterministic' }] }, 'fallback').full]
      .map(full => full.clinical_claims);
    expect(claims[1]).toEqual(claims[0]);
    expect(claims[2]).toEqual(claims[0]);
  });
  it('same fact, same authority as the generated movement policy (standing rule 5)', () => {
    const set = issueClaimSet({ trendEvidence: evidence, statuses: [] });
    for (const claim of set.claims) {
      if (claim.category !== 'factual_observation') continue;
      for (const significance of ['minor', 'moderate', 'significant'] as const) {
        expect(claim.authority).toEqual(createMovementClaim({ displayName: claim.fact.marker,
          previousValue: claim.fact.previous_value, currentValue: claim.fact.current_value,
          unit: claim.fact.unit ?? '', significance }).authority);
      }
    }
  });
  it('generation and read serve the same preview and counts for the same row', async () => {
    const { full, basic } = generate(model);
    const generated = visibleClaimProjection(basic);
    const read = await readInterpretation({ ownsReport: async () => true, resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
      readSelected: async () => ({ json_output: basic, stored_depth: 'deep', has_claim: false, tier: 'free', interpretation_source: 'ai' }),
      countClaims: async () => 0 }, true);
    const fullReader = await readInterpretation({ ownsReport: async () => true, resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
      readSelected: async () => ({ json_output: full, stored_depth: 'standard', has_claim: true, tier: 'free', interpretation_source: 'ai' }),
      countClaims: async () => 1 }, true);
    expect({ preview: read.body.preview, locked: read.body.locked }).toEqual(generated);
    expect({ preview: fullReader.body.preview, locked: fullReader.body.locked }).toEqual(generated);
    expect(servedBasic(basic).preview).toEqual(generated.preview);
  });
});

describe('6. deterministic safety survives independently, and the model cannot manufacture it', () => {
  it('survives: the classifier safety claim exists whatever the model said, and keeps its trend out of the upsell', () => {
    for (const payload of [model, { ...floor, key_findings: [] }, { ...model, key_findings: [{ biomarker_slug: 'ferritin', title: 't', status: 'normal', explanation: CANARY }] }]) {
      const { full, basic } = generate(payload);
      expect((full.clinical_claims as ClaimSet).claims).toContainEqual(expect.objectContaining({
        claim_id: 'safety:ferritin', category: 'safety_alert', safety_authority: 'deterministic_reference_range',
        recommendation_authority: 'none', fact: { biomarker_slug: 'ferritin', value: 9, unit: 'ng/mL', status: 'out_of_range' } }));
      expect(JSON.stringify(basic.preview)).not.toContain('ferritin');
    }
  });
  it('survives model validation failure: the deterministic fallback carries the same safety claim', () => {
    const fallback = { ...floor, top_findings: [{ biomarker_slug: 'ferritin', title: 'Ferritin', status: 'discuss', explanation: 'deterministic' }] };
    const { full, basic } = generate(fallback, 'fallback');
    expect(storedClaimSet(full)!.claims.map(c => c.claim_id)).toContain('safety:ferritin');
    expect(basic.top_findings).toEqual(fallback.top_findings);
  });
  it('a model-written false reassurance on an out-of-range marker is not served', () => {
    const { basic } = generate(model);
    expect(basic.key_findings).toContainEqual({ biomarker_slug: 'ferritin' });
    expect(JSON.stringify(basic.key_findings)).not.toContain('normal');
  });
  it('cannot manufacture: model flags, booleans or forged claims issue no safety claim and survive nowhere', () => {
    const forged = { ...model, pattern_signals: [{ ...(model.pattern_signals as object[])[0], safety: true, critical: true }],
      clinical_claims: { policy_version: CLAIM_POLICY_VERSION, claims: [{ claim_id: 'safety:tsh', category: 'safety_alert' }] } };
    const { full, basic } = generate(forged);
    expect((full.clinical_claims as ClaimSet).claims.map(c => c.claim_id)).not.toContain('safety:tsh');
    expect(basic.key_findings).toContainEqual({ biomarker_slug: 'tsh' });
    expect(JSON.stringify(basic.safety_findings)).not.toContain('tsh');
    expect(JSON.stringify(basic.flagged_trends ?? [])).not.toContain('tsh');
    // tsh is an ordinary authorized trend again, so it is counted, not hidden as floor.
    expect(visibleClaimProjection(basic).locked.cross_report).toBe(1);
  });
  it('negative control: the legacy writer let the model flag tsh into Basic as safety', () => {
    const old = legacy(model);
    expect(old.key_findings).toContainEqual(expect.objectContaining({ biomarker_slug: 'tsh', status: 'attention' }));
    expect(JSON.stringify(old.flagged_trends)).toContain('tsh');
  });
  it('a corroborated safety flag survives, and only on the claimed marker', () => {
    const corroborated = { ...model, key_findings: [{ biomarker_slug: 'ferritin', title: 't', status: 'attention', explanation: CANARY }] };
    const { full, basic } = generate(corroborated);
    expect(basic.key_findings).toEqual([{ biomarker_slug: 'ferritin', status: 'attention' }]);
    expect(basic.flagged_trends).toEqual([expect.objectContaining({ biomarker_slug: 'ferritin', previous_value: 12, current_value: 9 })]);
    expect(full.claim_audit).toContainEqual({ path: '/key_findings/0', outcome: 'superseded_by_claim', reason: 'corroborates_safety_claim', claim_id: 'safety:ferritin' });
  });
});

describe('7. the model cannot strengthen a claim by replacement or addition', () => {
  it('replacement: a restatement with other values is rejected; the server fact is what remains', () => {
    const strong = { ...model, pattern_signals: [{ title: CANARY, confidence: 'high', explanation: CANARY,
      related_biomarkers: ['vitamin_d'], trend_biomarker: 'vitamin_d', previous_value: 2, current_value: 90 }] };
    const set = issueClaimSet({ trendEvidence: evidence, statuses });
    expect(auditModelProposals(strong, set)).toContainEqual({ path: '/pattern_signals/0', outcome: 'rejected', reason: 'values_disagree', claim_id: 'trend:vitamin_d' });
    const { basic } = generate(strong);
    expect((basic.preview as { content: TrendEvidence }).content).toMatchObject({ previous_value: 18, current_value: 31 });
    expect(JSON.stringify(basic)).not.toMatch(/"(previous|current)_value":(2|90)\b/);
  });
  it('addition: model-supplied trend_evidence, findings and clinical_claims never reach storage', () => {
    const added = { ...model, trend_evidence: [{ ...evidence[0], biomarker_slug: 'cortisol', marker: 'Cortisol' }],
      findings: [{ source_path: '/overall_interpretation', content: CANARY, kind: 'trend', visibility_hint: 'premium', preview_eligible: true }],
      clinical_claims: { policy_version: CLAIM_POLICY_VERSION, claims: [{ claim_id: 'trend:cortisol' }] }, claim_audit: [] };
    const { full } = generate(added);
    expect(full.trend_evidence).toEqual(evidence);
    expect(full.clinical_claims).toEqual(issueClaimSet({ trendEvidence: evidence, statuses }));
    expect(JSON.stringify(full.findings)).not.toContain(CANARY);
    // With no server evidence, the model's trend_evidence is still dropped.
    expect(generate(added, 'ai', []).full).not.toHaveProperty('trend_evidence');
  });
  it('addition at rest: a stored set that does not re-derive fails closed to no preview and no counts', () => {
    const { full } = generate(model);
    const set = full.clinical_claims as ClaimSet;
    const tampered: InterpretationPayload[] = [
      { ...full, clinical_claims: { ...set, claims: [...set.claims, { ...set.claims[0], claim_id: 'trend:extra' }] } },
      { ...full, clinical_claims: { ...set, claims: set.claims.map(c => c.category === 'safety_alert' ? { ...c, recommendation_authority: 'supplement' } : c) } },
      { ...full, clinical_claims: { ...set, claims: set.claims.map(c => c.category === 'factual_observation' ? { ...c, safety_authority: 'deterministic_reference_range' } : c) } },
      { ...full, clinical_claims: { ...set, policy_version: 'v2-03c.0' } },
      { ...full, trend_evidence: (full.trend_evidence as TrendEvidence[]).map(e => ({ ...e, current_value: e.current_value * 2 })) },
    ];
    for (const row of tampered) {
      expect(storedClaimSet(row)).toBeNull();
      expect(visibleClaimProjection(projectBasic(row, { source: 'ai' }))).toEqual({ preview: null, locked: { patterns: 0, cross_report: 0, lifestyle: 0 } });
    }
    expect(storedClaimSet(full)).toEqual(set);
  });
  it('negative control: the legacy catalog accepted a model trend_evidence and could preview it', () => {
    const old = buildBasicProjection(addFindingMetadata({ ...floor, key_findings: [],
      trend_evidence: [{ ...evidence[0], biomarker_slug: 'cortisol', marker: 'Cortisol' }] }), undefined, { source: 'ai' });
    expect(JSON.stringify(old.preview)).toContain('cortisol');
  });
});

describe('8. one policy, generated and byte-identity checked', () => {
  it('the server claim module takes movement authority from the generated kernel, never from client code', () => {
    const source = readFileSync(new URL('./claim-authority.ts', import.meta.url), 'utf8');
    expect(source).toContain('from "./clinical-movement-policy.generated.ts"');
    expect(source).not.toMatch(/from ["'][^"']*src\//);
  });
  it('the generated kernel is still the exact client bytes; one changed byte fails', async () => {
    const { movementPolicyBytes, checkLanguageArtifact, languageArtifact } = await import('../../../tools/clinical/language-policy.mjs');
    const root = new URL('../../../', import.meta.url);
    const expected = movementPolicyBytes(readFileSync(new URL('src/lib/scoring/insightCopy.ts', root), 'utf8'));
    expect(() => checkLanguageArtifact(expected, readFileSync(new URL(languageArtifact, root), 'utf8'))).not.toThrow();
    expect(() => checkLanguageArtifact(expected, expected.replace('neutral', 'neutrał'))).toThrow(/drifted/);
  });
});

describe('9. legacy rows stay safe through version distinction, not rewriting', () => {
  it('a legacy full body (no claim set) projects neutral defaults with no preview or counts', () => {
    const stored = addFindingMetadata({ ...model, trend_evidence: evidence });
    const original = structuredClone(stored);
    const basic = projectBasic(stored, { source: 'ai' });
    expect(stored).toEqual(original);
    const { preview, locked, ...floorOnly } = basic;
    const { preview: _p, locked: _l, ...legacyFloor } = legacyCustomerFloor();
    expect(floorOnly).toEqual(legacyFloor);
    expect({ preview, locked }).toEqual({ preview: null, locked: { patterns: 0, cross_report: 0, lifestyle: 0 } });
  });
  it('the claim era is a version, not a shape: removing the version makes a row legacy', () => {
    const { full } = generate(model);
    const unversioned = { ...full, clinical_claims: { ...(full.clinical_claims as ClaimSet), policy_version: undefined } };
    expect(visibleClaimProjection(projectBasic(unversioned, { source: 'ai' })).preview).toBeNull();
    expect(visibleClaimProjection(projectBasic(full, { source: 'ai' })).preview).not.toBeNull();
  });
});

/** Every Basic item a reader can see: array entries plus the preview. */
const visibleItems = (basic: InterpretationPayload) =>
  [...FLOOR_FINDING_KEYS, ...SAFETY_KEYS, 'safety_findings', 'flagged_trends']
    .reduce((n, key) => n + (Array.isArray(basic[key]) ? (basic[key] as unknown[]).length : 0), 0) + (basic.preview ? 1 : 0);

describe('owner R3: visibility is monotonic downward; counts are truthful, not monotonic', () => {
  it('R3.1 an out-of-range marker the model did not flag gets no unauthorized replacement line', () => {
    // ferritin is out of range by the classifier; the model never mentions it.
    const silent = { ...model, key_findings: [{ biomarker_slug: 'tsh', title: CANARY, status: 'attention', explanation: CANARY }] };
    const { full, basic } = generate(silent);
    const set = storedClaimSet(full)!;
    expect(set.claims.map(c => c.claim_id)).toContain('safety:ferritin');
    const old = legacy(silent);
    expect(expansionViolations(basic, old, full, set)).toEqual([]);
    for (const key of [...FLOOR_FINDING_KEYS, ...SAFETY_KEYS, 'safety_findings', 'flagged_trends']) {
      expect(JSON.stringify(basic[key] ?? [])).not.toContain('ferritin');
    }
    expect(JSON.stringify(basic.preview)).not.toContain('ferritin');
    expect(visibleItems(basic)).toBeLessThanOrEqual(visibleItems(old));
  });
  it('R3.1 negative control: a classifier-backed replacement line is caught as an expansion', () => {
    const silent = { ...model, key_findings: [{ biomarker_slug: 'tsh', title: CANARY, status: 'attention', explanation: CANARY }] };
    const { full, basic } = generate(silent);
    const replacement = { ...basic, key_findings: [...basic.key_findings as unknown[], { biomarker_slug: 'ferritin', status: 'out_of_range', value: 9 }] };
    expect(expansionViolations(replacement, legacy(silent), full, storedClaimSet(full)!)).toContain('key_findings entry not in legacy Basic');
  });
  it('R3.2 an in-range marker the model falsely flagged loses free-floor treatment', () => {
    const { full, basic } = generate(model);
    expect(storedClaimSet(full)!.claims.map(c => c.claim_id)).not.toContain('safety:tsh');
    expect(basic.key_findings).toContainEqual({ biomarker_slug: 'tsh' });
    for (const key of ['safety_findings', 'flagged_trends']) expect(JSON.stringify(basic[key] ?? [])).not.toContain('tsh');
    // Its trend is an ordinary authorized claim now: withheld and counted, not floor.
    expect(visibleClaimProjection(basic).locked.cross_report).toBe(1);
  });
  it('R3.2 negative control: the legacy writer gave the same marker floor treatment', () => {
    const old = legacy(model);
    expect(old.key_findings).toContainEqual(expect.objectContaining({ biomarker_slug: 'tsh', status: 'attention' }));
    expect(JSON.stringify(old.flagged_trends)).toContain('tsh');
  });
  // Two in-range trends; the model falsely flags tsh. The preview is the same
  // fact in both writers, so the only thing that moves is the count.
  const twoTrends = evidence.filter(e => e.biomarker_slug !== 'ferritin');
  const inRange = statuses.filter(s => s.biomarker_slug !== 'ferritin');
  const flagsTsh = { ...floor, key_findings: [{ biomarker_slug: 'tsh', title: 't', status: 'attention', explanation: CANARY }] };
  it('R3.3 the locked count rises while the visible Basic set stays equal or smaller', () => {
    const { full, basic } = generate(flagsTsh, 'ai', twoTrends, inRange);
    const old = legacy(flagsTsh, 'ai', twoTrends);
    expect(total(visibleClaimProjection(basic).locked)).toBeGreaterThan(total(old.locked));
    expect((basic.preview as { content: unknown }).content).toEqual((old.preview as { content: unknown }).content);
    expect(expansionViolations(basic, old, full, storedClaimSet(full)!)).toEqual([]);
    expect(visibleItems(basic)).toBeLessThan(visibleItems(old));
  });
  it('R3.3 negative control: revealing the newly counted claim is caught', () => {
    const { full, basic } = generate(flagsTsh, 'ai', twoTrends, inRange);
    const old = legacy(flagsTsh, 'ai', twoTrends);
    const tsh = twoTrends.find(e => e.biomarker_slug === 'tsh')!;
    const revealed = { ...basic, flagged_trends: [{ biomarker_slug: 'tsh', previous_value: tsh.previous_value, current_value: tsh.current_value, unit: tsh.unit, delta: 999 }] };
    expect(expansionViolations(revealed, old, full, storedClaimSet(full)!)).toContain('flagged_trends entry not in legacy Basic');
    expect(visibleItems(revealed)).toBeGreaterThan(visibleItems(basic));
  });
  it('R3.4 a rising count cannot cause an additional preview, at generation or read', async () => {
    for (const [, mutate] of mutations) {
      const payload = mutate(model);
      const { basic } = generate(payload);
      const old = legacy(payload);
      if (total(visibleClaimProjection(basic).locked) > total(old.locked)) {
        expect(basic.preview === null || contentFingerprint((basic.preview as { content: unknown }).content)
          === contentFingerprint((generate({ ...floor, key_findings: [] }).basic.preview as { content: unknown }).content)).toBe(true);
      }
    }
    // Stored: authorized locked claims with an empty slot stay an empty slot.
    const { basic } = generate(model);
    const stored = { ...basic, preview: null, locked: { patterns: 0, cross_report: 2, lifestyle: 0, claim_policy_version: CLAIM_POLICY_VERSION } };
    const read = await readInterpretation({ ownsReport: async () => true, resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
      readSelected: async () => ({ json_output: stored, stored_depth: 'deep', has_claim: false, tier: 'free', interpretation_source: 'ai' }),
      countClaims: async () => 0 }, true);
    expect(read.body).toMatchObject({ preview: null, locked: { patterns: 0, cross_report: 2, lifestyle: 0 } });
  });
  it('R3.4 negative control: preview-eligible authorized content existed for that empty slot', () => {
    const { full } = generate(model);
    expect(claimCatalogEligible(full)).toBeGreaterThan(0);
  });
});

const claimCatalogEligible = (full: InterpretationPayload) =>
  ((full.findings ?? []) as { kind?: string; visibility_hint?: string }[]).filter(f => f.kind === 'trend' && f.visibility_hint === 'premium').length;

/* ── 20261008000000: the compatibility view applies the same read gate ──── */
const root = new URL('../../../', import.meta.url);
const gateMigration = readFileSync(new URL('supabase/migrations/20261008000000_claim_policy_basic_gate.sql', root), 'utf8');
const gatePrelude = readFileSync(new URL('supabase/migrations/__verification__/claim-policy-gate.prelude.sql', root), 'utf8');
const gateRollback = readFileSync(new URL('supabase/migrations/__verification__/claim-policy-gate.rollback.sql', root), 'utf8');
const basicCycleMigration = readFileSync(new URL('supabase/migrations/20260927000001_basic_cycle_context.sql', root), 'utf8');
type GateCase = { name: string; source: string; preview?: unknown; claim_preview?: Record<string, unknown> & { claim?: Record<string, unknown> };
  locked?: unknown; expected_preview: 'stored' | null; expected_locked: Record<string, number> };
const gateFixture: { floor: InterpretationPayload; claim_preview: Record<string, unknown> & { claim: Record<string, unknown> }; cases: GateCase[] } =
  JSON.parse(gatePrelude.match(/\$claim_gate_cases\$([\s\S]*?)\$claim_gate_cases\$/)![1]);
/** The same construction as claim-policy-gate.prelude.sql. */
const gateBasic = (c: GateCase): InterpretationPayload => {
  const basic: InterpretationPayload = { ...gateFixture.floor };
  if ('locked' in c) basic.locked = c.locked;
  if ('preview' in c) basic.preview = c.preview;
  else if (c.claim_preview) {
    const { claim, ...rest } = c.claim_preview;
    basic.preview = { ...gateFixture.claim_preview, ...rest, claim: { ...gateFixture.claim_preview.claim, ...(claim ?? {}) } };
  }
  return basic;
};

describe('20261008000000 historical gate fixture (legacy SQL parity pending TASK-047 turn 3)', () => {
  it('the fixture claim preview is a real claim-era preview, not a hand-written lookalike', () => {
    const { basic } = generate(model);
    expect(gateFixture.claim_preview).toEqual(basic.preview);
    expect(gateBasic(gateFixture.cases[3]).locked).toEqual(basic.locked);
  });
  it.each(gateFixture.cases.map(c => [c.name, c] as const))('%s', async (_, c) => {
    const basic = gateBasic(c);
    const expected = { preview: c.expected_preview === 'stored' ? basic.preview : null, locked: c.expected_locked };
    expect(visibleClaimProjection(basic)).toEqual(expected);
    // The edge-function Basic read: what the SQL view must equal row for row.
    const read = await readInterpretation({ ownsReport: async () => true, resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
      readSelected: async () => ({ json_output: basic, stored_depth: 'deep', has_claim: false, tier: 'free', interpretation_source: c.source }),
      countClaims: async () => 0 }, true);
    const trusted = c.source === 'fallback' || c.source === 'deterministic' || hasCurrentReadAuthority(basic, false);
    expect(read.body.interpretation).toEqual(trusted ? { ...sanitizeBasicProjection(basic, c.source), ...expected } : legacyCustomerFloor());
  });
  it('known policy versions in SQL are exactly KNOWN_CLAIM_POLICY_VERSIONS (drift fails here)', () => {
    const list = `= ANY(ARRAY[${KNOWN_CLAIM_POLICY_VERSIONS.map(v => `'${v}'`).join(',')}])`;
    expect(gateMigration.split(list)).toHaveLength(3);
    expect(gateMigration.match(/ANY\(ARRAY\[/g)).toHaveLength(2);
  });
  it('gates only the client view, rewrites no row, and leaves the service RPC to the TS gate', () => {
    expect(gateMigration).toContain('ELSE public.interpretation_claim_gate(public.interpretation_sanitize_basic(i.json_output_basic,i.interpretation_source)) END');
    expect(gateMigration).toContain('THEN i.json_output\n');
    expect(gateMigration).not.toMatch(/\bUPDATE\s+public\./);
    expect(gateMigration).not.toMatch(/FUNCTION public\.read_interpretation_for_server/);
    expect(gateMigration).not.toMatch(/GRANT[^;]*interpretation_claim_gate[^;]*authenticated/);
  });
  it('the rollback restores the 20260927000001 view function byte for byte', () => {
    const body = (sql: string) => sql.match(/CREATE OR REPLACE FUNCTION public\.read_compatible_interpretations\(\)[\s\S]*?\n\$\$;\n/)![0];
    expect(body(gateRollback)).toBe(body(basicCycleMigration));
    expect(body(gateMigration)).not.toBe(body(basicCycleMigration));
  });
  it('the harness runs the case: refusal, forward, replay, rollback, fresh chain and the baseline compare', () => {
    // run.sh plus its cases/ files, in run order (PK-INT-01 moved the cases out of run.sh).
    const harness = harnessText();
    expect(harness).toContain('GATE=20261008000000_claim_policy_basic_gate.sql');
    expect(harness.match(/-f "\/tmp\/\$GATE"/g)!.length).toBeGreaterThanOrEqual(6);
    for (const step of ['claim-policy-gate.rollback.sql', 'claim-policy-gate.compare.sql', 'claim_gate_fresh', 'target=claim_gate_before']) {
      expect(harness).toContain(step);
    }
  });
});

describe('Basic body confidentiality under the claim era', () => {
  it('server-owned and premium keys never enter Basic for an AI source', () => {
    const { basic } = generate(model);
    for (const key of ['clinical_claims', 'claim_audit', 'trend_evidence', 'findings', 'pattern_signals',
      'what_you_can_do_now', 'overall_interpretation', 'primary_concern']) expect(basic).not.toHaveProperty(key);
    expect(Object.keys(basic).every(k => (BASIC_KEYS as readonly string[]).includes(k))).toBe(true);
  });
  it('buildAuthorizedBasicProjection does not mutate the full body', () => {
    const { full } = generate(model);
    const original = structuredClone(full);
    buildAuthorizedBasicProjection(full, storedClaimSet(full)!, { source: 'ai' });
    expect(full).toEqual(original);
  });
});


describe('object-shaped safety authority regression', () => {
  it.each(['ai', 'unknown'])('strips an unbacked single-object critical flag for %s', source => {
    const payload = { ...floor, critical_findings: { biomarker_slug: 'tsh', critical: true } };
    const set = issueClaimSet({ trendEvidence: [], statuses: [] });
    // Exact SQL-fixture shape: the old floor deliberately preserves this flag.
    expect(buildBasicProjection(payload, [], { source }).critical_findings)
      .toEqual({ biomarker_slug: 'tsh', critical: true });
    const projected = buildAuthorizedBasicProjection(payload, set, { source }).critical_findings;
    expect(projected).toEqual([{ biomarker_slug: 'tsh' }]);
  });
  it('preserves a backed object alert independently of rejected model prose', () => {
    const payload = { ...model, critical_findings: { biomarker_slug: 'ferritin', critical: true } };
    const { basic } = generate(payload);
    expect(basic.critical_findings).toEqual([{ biomarker_slug: 'ferritin', critical: true }]);
    expect(JSON.stringify(basic)).not.toContain(CANARY);
  });
});


describe('served AI Basic safety containers: every SAFETY_KEYS dimension', () => {
  const keys = ['safety_notes', 'abnormal_flags', 'flags', 'warnings', 'critical_findings', 'what_to_do_next'] as const;
  it('enumerates the complete safety-key contract', () => {
    expect(keys).toEqual(SAFETY_KEYS);
  });
  it.each(keys)('%s: served shape for backed and unbacked lone objects', async key => {
    for (const [slug, expected] of [
      ['ferritin', { biomarker_slug: 'ferritin', critical: true }],
      ['tsh', { biomarker_slug: 'tsh' }],
    ] as const) {
      const payload = { ...model, [key]: { biomarker_slug: slug, critical: true, explanation: CANARY } };
      const { basic } = generate(payload);
      const read = await readInterpretation({
        ownsReport: async () => true,
        resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
        readSelected: async () => ({ json_output: basic, stored_depth: 'deep', has_claim: false, tier: 'free', interpretation_source: 'ai' }),
        countClaims: async () => 0,
      }, true);
      expect(read.body.access).toBe('basic');
      expect(read.body.interpretation).toHaveProperty(key, key === 'what_to_do_next' ? [] : [expected]);
      expect(JSON.stringify(read.body.interpretation)).not.toContain(CANARY);
      // Pre-authority projection retains a lone object and its unbacked flag.
      // Narrative next steps are already discarded by the confidentiality floor.
      expect(buildBasicProjection(payload, [], { source: 'ai' })[key])
        .toEqual(key === 'what_to_do_next' ? [] : { biomarker_slug: slug, critical: true });
    }
  });
});

describe('TASK-047 current-policy response identity (M7)', () => {
  it.each(['ai', 'unknown', 'fallback', 'deterministic'])('%s: preserves current bodies, previews, counts and safety across customer routes', async source => {
    const { full, basic } = generate({ ...model, critical_findings: { biomarker_slug: 'ferritin', critical: true } }, source);
    const expectedBasic = { ...sanitizeBasicProjection(basic, source), ...visibleClaimProjection(basic) };
    expect(basic.preview).not.toBeNull();
    expect(total(visibleClaimProjection(basic).locked)).toBeGreaterThan(0);
    expect(basic.critical_findings).toEqual(source === 'ai' || source === 'unknown'
      ? [{ biomarker_slug: 'ferritin', critical: true }] : { biomarker_slug: 'ferritin', critical: true });
    for (const enabled of [false, true]) for (const premium of [false, true]) for (const claimed of [false, true])
      for (const depth of ['deep', 'standard', 'unknown']) {
        const selected = !enabled || premium || claimed ? full : basic;
        const before = JSON.stringify(selected);
        const result = await readInterpretation({
          ownsReport: async () => true,
          resolveEntitlement: async () => ({ allowed: true, plan: premium ? 'premium' : 'free' }),
          readSelected: async () => ({ json_output: selected, stored_depth: depth, has_claim: claimed, tier: 'free', interpretation_source: source }),
          countClaims: async () => 0,
        }, enabled);
        const expected = !enabled ? full : premium || claimed
          ? depth === 'deep' || source === 'fallback' || source === 'deterministic' ? full : servedBasic(basic)
          : expectedBasic;
        expect(JSON.stringify(result.body.interpretation)).toBe(JSON.stringify(expected));
        expect(result.body.preview).toEqual(enabled ? basic.preview : null);
        expect(result.body.locked).toEqual(enabled ? visibleClaimProjection(basic).locked : { patterns: 0, cross_report: 0, lifestyle: 0 });
        if (enabled && !(premium || claimed)) {
          // A second visibleClaimProjection on the served body loses these counts.
          expect(result.body.interpretation?.locked).toEqual(result.body.locked);
          expect(result.body.interpretation?.preview).toEqual(result.body.preview);
        }
        expect(JSON.stringify(selected)).toBe(before);
      }
  });
});
