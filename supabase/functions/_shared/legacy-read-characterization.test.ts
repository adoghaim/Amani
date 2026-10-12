/** TASK-047 turn 2: customer read regression controls; mutations documented in turn-2 report. */
import { describe, expect, it } from 'vitest';
import { projectBasic, servedBasic, storedClaimSet, legacyCustomerFloor, quarantineCustomerRead } from './claim-authority';
import { BASIC_KEYS, SAFETY_KEYS, buildBasicProjection, sanitizeBasicProjection } from './interpretation-visibility';
import { readInterpretation, type InterpretationReadActions } from './interpretation-read';
import { FLOOR_FINDING_KEYS, type InterpretationPayload } from './response-shaping';

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

describe('TASK-047 customer read quarantine', () => {
  it('replaces legacy model fields with policy defaults (M1/M2)', () => {
    expect(buildBasicProjection(fixture()).critical_findings).toMatchObject({ critical: true });
    expect(buildBasicProjection(fixture()).headline).toBe('Amber paper boats');
    expect(projectBasic(fixture(), { source: 'ai' })).toEqual(legacyCustomerFloor());
  });
  it.each([undefined, null, 42, {}, 'future.1', 'v2-03c.1'])('invalid Full set %j fails closed even with current Basic marker (M1/M3)', async version => {
    const body = { ...fixture(), clinical_claims: { policy_version: version, claims: [{}] },
      locked: { patterns: 9, cross_report: 0, lifestyle: 0, claim_policy_version: 'v2-03c.1' } };
    expect(storedClaimSet(body)).toBeNull();
    for (const premium of [false, true]) {
      const result = await readInterpretation(port(body, premium), true);
      expect(result.body.interpretation).toEqual(legacyCustomerFloor());
      expect(result.body.locked).toEqual(zero);
    }
  });
  it.each(['ai', 'unknown', null, undefined])('untrusted DB source %s ignores spoofed body provenance (M1/M2)', async source => {
    const body = { ...fixture(), source: 'deterministic', interpretation_source: 'fallback',
      flagged_trends: [{ text: 'Copper paper boats', critical: true }] };
    const actions = port(body);
    actions.readSelected = async () => ({ json_output: body, stored_depth: 'deep', has_claim: false, tier: 'free', interpretation_source: source });
    expect((await readInterpretation(actions, true)).body.interpretation).toEqual(legacyCustomerFloor());
  });
  it.each(['fallback', 'deterministic'])('authenticated provenance %s keeps existing deterministic behavior (M7)', async source => {
    const body = fixture();
    for (const enabled of [false, true]) for (const premium of [false, true]) {
      const actions = port(body, premium);
      actions.readSelected = async () => ({ json_output: body, stored_depth: 'deep', has_claim: false, tier: 'free', interpretation_source: source });
      const result = await readInterpretation(actions, enabled);
      expect(result.body.interpretation).toEqual(!enabled || premium ? body : servedBasic(sanitizeBasicProjection(body, source)));
    }
  });
  it('all customer entitlement/depth/switch combinations reduce to the neutral shell; input is not mutated (M1-M4)', async () => {
    for (const enabled of [false, true]) for (const premium of [false, true]) for (const claimed of [false, true])
      for (const depth of ['deep', 'standard', 'unknown']) {
        const body = fixture();
        const before = JSON.stringify(body);
        const result = await readInterpretation(port(body, premium, claimed, depth), enabled);
        expect(result.status).toBe(200);
        expect(result.body.access).toBe(!enabled ? 'full' : premium || claimed ? depth === 'deep' ? 'full' : 'generation_needed' : 'basic');
        expect(result.body.interpretation).toEqual(legacyCustomerFloor());
        expect(result.body.preview).toBeNull();
        expect(result.body.locked).toEqual(zero);
        expect(JSON.stringify(body)).toBe(before); // Memory only, NOT storage-byte proof.
      }
  });
  it('legacy quarantine is idempotent without relying on an in-body policy marker (M7-double)', () => {
    const once = quarantineCustomerRead(fixture(), false, 'ai');
    expect(quarantineCustomerRead(once, false, 'ai')).toEqual(once);
    expect(once).not.toHaveProperty('clinical_claims');
    expect(once.locked).not.toHaveProperty('claim_policy_version');
  });
});

it('M4: Basic never imports an omitted Full item or adds a Basic key', async () => {
  const selected = { headline: 'Amber paper boats', locked: { patterns: 6 } };
  const result = await readInterpretation(port(selected), true);
  expect(result.body.access).toBe('basic');
  expect(result.body.interpretation).toEqual(legacyCustomerFloor());
  expect(Object.keys(result.body.interpretation!).every(key => (BASIC_KEYS as readonly string[]).includes(key))).toBe(true);
  expect(result.body.interpretation?.key_findings).toEqual([]);
});

it('M5: removing candidate A cannot promote eligible-looking legacy candidate B', async () => {
  const entry = (slug: string, magnitude: number) => ({ source_path: `/candidates/${slug === 'a' ? 0 : 1}`,
    content: { text: `${slug} paper boats` }, kind: 'trend' as const, preview_eligible: true,
    confidence: 1, magnitude_normalized: magnitude, observed_at: null, visibility_hint: 'premium' as const });
  const a = entry('a', 2), b = entry('b', 1);
  const body = { ...fixture(), candidates: [a.content, b.content], findings: [a, b] };
  expect(buildBasicProjection(body).preview).toEqual(a);
  const removed = { ...body, findings: [b] };
  expect(buildBasicProjection(removed).preview).toEqual(b); // Selector really would promote B.
  for (const candidate of [body, removed]) {
    const result = await readInterpretation(port(candidate), true);
    expect(result.body.interpretation).toEqual(legacyCustomerFloor());
    expect(result.body.preview).toBeNull();
    expect(result.body.locked).toEqual(zero);
  }
});

it('M1: every safety/finding container and flag direction is quarantined in stored Basic and Full', async () => {
  for (const key of [...FLOOR_FINDING_KEYS, ...SAFETY_KEYS, 'flagged_trends', 'safety_findings']) {
    for (const value of [
      { critical: true, abnormal: true, urgent: true, safety: true, is_safety: true, safety_related: true, is_abnormal: true },
      { critical: false, abnormal: false, urgent: false, safety: false, is_safety: false, safety_related: false, is_abnormal: false },
      ...['normal', 'borderline', 'abnormal'].map(status => ({ status, current_status: status, flag: status, flagged: status })),
    ]) for (const shaped of [value, [value], { nested: value }, 'Copper paper boats', null]) {
      for (const premium of [false, true]) {
        const result = await readInterpretation(port({ ...fixture(), [key]: shaped }, premium), true);
        expect(result.body.interpretation).toEqual(legacyCustomerFloor());
      }
    }
  }
});
