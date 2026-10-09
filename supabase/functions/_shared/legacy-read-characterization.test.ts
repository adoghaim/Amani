/** TASK-047 turn 1: records existing exposure, NOT desired quarantine behavior. */
import { describe, expect, it } from 'vitest';
import { projectBasic, servedBasic, storedClaimSet } from './claim-authority';
import { buildBasicProjection, sanitizeBasicProjection } from './interpretation-visibility';
import { readInterpretation, type InterpretationReadActions } from './interpretation-read';
import type { InterpretationPayload } from './response-shaping';

const zero = { patterns: 0, cross_report: 0, lifestyle: 0 };
const fixture = (): InterpretationPayload => ({
  headline: 'Amber paper boats', questions_for_doctor: ['Violet paper boats', { text: 'discard me' }],
  disclaimer: 'model disclaimer', cycle_context: { estimated_cycle_day: 7, estimated_cycle_phase: 'follicular', confidence: 'high', explanation: 'discard me' },
  key_findings: [{ biomarker_slug: 'x', value: 12, unit: 'mg/L', status: 'normal', critical: false, explanation: 'discard me' }],
  critical_findings: { biomarker_slug: 'x', critical: true, status: 'discuss', explanation: 'discard me' },
  primary_concern: { biomarker_slug: 'x', urgent: true, explanation: 'Silver paper boats' },
  overall_interpretation: 'Indigo paper boats', what_to_do_next: ['discard me'],
  preview: { content: 'stored preview' }, locked: { patterns: 8, cross_report: 7, lifestyle: 6 },
});
const port = (payload: InterpretationPayload, premium = false, claimed = false, depth = 'deep'): InterpretationReadActions => ({
  ownsReport: async () => true,
  resolveEntitlement: async () => ({ allowed: true, plan: premium ? 'premium' : 'free' }),
  readSelected: async () => ({ json_output: payload, stored_depth: depth, has_claim: claimed, tier: 'free', interpretation_source: 'ai' }),
  countClaims: async () => 0,
});

describe('TASK-047 current exposure (remove/replace when quarantine lands)', () => {
  it('pins the entire legacy projectBasic output, including unauthorized flags and prose channels', () => {
    expect(projectBasic(fixture(), { source: 'ai' })).toEqual({
      headline: 'Amber paper boats', basic_interpretation: 'Amber paper boats',
      questions_for_doctor: ['Violet paper boats'],
      disclaimer: 'This report is for educational purposes only and does not constitute medical advice.',
      cycle_context: { estimated_cycle_day: 7, estimated_cycle_phase: 'follicular', confidence: 'high', explanation: '' },
      key_findings: [{ biomarker_slug: 'x', value: 12, unit: 'mg/L', status: 'normal', critical: false }],
      top_findings: [], summary_bullets: [], safety_notes: [], abnormal_flags: [], flags: [], warnings: [],
      critical_findings: { biomarker_slug: 'x', critical: true, status: 'discuss' }, what_to_do_next: [],
      safety_findings: [{ urgent: true, biomarker_slug: 'x' }], preview: null, locked: zero,
    });
  });
  it.each([undefined, null, 42, {}, 'future.1'])('unknown/malformed version %j removes preview/counts but not safety', version => {
    const full = { ...fixture(), clinical_claims: { policy_version: version, claims: [] } };
    expect(storedClaimSet(full)).toBeNull();
    expect(projectBasic(full)).toMatchObject({ critical_findings: { critical: true }, preview: null, locked: zero });
    const basic = { ...buildBasicProjection(full), locked: { ...zero, patterns: 9, claim_policy_version: version } };
    expect(servedBasic(sanitizeBasicProjection(basic, 'ai'))).toMatchObject({ critical_findings: { critical: true }, preview: null, locked: zero });
  });
  it('stored Basic flagged_trends is unsanitized, unlike full-to-Basic compilation', async () => {
    const stored = { ...fixture(), flagged_trends: [{ text: 'Copper paper boats', critical: true }] };
    const result = await readInterpretation(port(stored), true);
    expect(result.body.interpretation).toMatchObject({ flagged_trends: stored.flagged_trends, preview: null, locked: zero });
    expect(projectBasic(stored)).not.toHaveProperty('flagged_trends');
  });
  it.each([[true, false, true], [false, true, true], [false, false, false]])('full return bypass: premium=%s claim=%s enabled=%s', async (premium, claim, enabled) => {
    const full = fixture();
    const before = JSON.stringify(full);
    const result = await readInterpretation(port(full, premium, claim), enabled);
    expect(result.body.access).toBe('full');
    expect(result.body.interpretation).toEqual(full);
    expect(JSON.stringify(full)).toBe(before); // In-memory only; not database byte identity.
  });
  it('non-deep premium still receives the unsafe legacy floor', async () => {
    const result = await readInterpretation(port(fixture(), true, false, 'standard'), true);
    expect(result.body).toMatchObject({ access: 'generation_needed', interpretation: { critical_findings: { critical: true } }, preview: null, locked: zero });
  });
  it('Basic compilation trusts the set version, stored-Basic reading trusts a different marker', () => {
    const full = { ...fixture(), clinical_claims: { policy_version: 'future.1', claims: [] },
      locked: { patterns: 9, cross_report: 0, lifestyle: 0, claim_policy_version: 'v2-03c.1' } };
    expect(projectBasic(full).locked).toEqual(zero);
    expect(servedBasic(sanitizeBasicProjection(full, 'ai')).locked).toEqual({ ...zero, patterns: 9 });
  });
  it.each(['ai', 'unknown', null, undefined])('source %s retains the same untrusted floor', source => {
    expect(projectBasic(fixture(), { source })).toEqual(projectBasic(fixture(), { source: 'ai' }));
  });
  it.each(['fallback', 'deterministic'])('DB provenance %s preserves deterministic narrative', source => {
    expect(projectBasic(fixture(), { source })).toMatchObject({
      overall_interpretation: 'Indigo paper boats', preview: null, locked: zero,
      critical_findings: { explanation: 'discard me', critical: true },
    });
  });
  it('a current version with invalid claims is legacy; a root version does not confer authority', () => {
    for (const extra of [
      { clinical_claims: { policy_version: 'v2-03c.1', claims: [{}] } },
      { claim_policy_version: 'v2-03c.1' },
    ]) {
      const full = { ...fixture(), ...extra };
      expect(storedClaimSet(full)).toBeNull();
      expect(projectBasic(full)).toMatchObject({ critical_findings: { critical: true }, preview: null, locked: zero });
    }
  });

});
