import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { readInterpretation as readWithFlag, type InterpretationReadActions } from './interpretation-read';
import { resolveEntitlement } from './entitlement';
import { buildBasicProjection } from './interpretation-visibility';
const readInterpretation = (actions: InterpretationReadActions) => readWithFlag(actions, true);
const full = { headline: 'h', cycle_context: {}, questions_for_doctor: [], disclaimer: 'd', key_findings: [], private: 'full body' };
function actions(overrides: Partial<InterpretationReadActions> = {}): InterpretationReadActions {
  return { ownsReport: async () => true, resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
    readSelected: async premium => ({ json_output: premium ? full : buildBasicProjection(full), stored_depth: 'deep', has_claim: false, tier: 'free' }),
    countClaims: async () => 3, ...overrides };
}
describe('authoritative interpretation reads', () => {
  it('keeps deep Free rows Basic; upgrades and downgrades without rewriting', async () => {
    const basic = await readInterpretation(actions());
    expect(basic.body.access).toBe('basic');
    expect(basic.body.interpretation).not.toHaveProperty('private');
    expect(basic.body.complimentary).toEqual({ used: 3, total: 3, remaining: 0 });
    const premium = await readInterpretation(actions({ resolveEntitlement: async () => ({ allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' }) }));
    expect(premium.body.access).toBe('full');
    expect(premium.body.interpretation).toEqual(full);
    expect(premium.body.complimentary).toEqual({ used: 3, total: 3, remaining: 0 });
    expect((await readInterpretation(actions())).body).toEqual(basic.body);
  });
  it('unlocks a committed claim, never credits merely remaining', async () => {
    const result = await readInterpretation(actions({ readSelected: async () => ({ json_output: full, stored_depth: 'deep', has_claim: true, tier: 'free' }) }));
    expect(result.body.access).toBe('full');
    expect((await readInterpretation(actions({ countClaims: async () => 0 }))).body.access).toBe('basic');
  });
  it('uses the TS sandbox + beta decision, even without onboarding', async () => {
    const entitlement = resolveEntitlement({ freemiumActive: true, onboarded: false, stripeStatus: null,
      trialStartDate: null, userId: 'u', now: Date.parse('2026-09-26'),
      iapRecords: [{ status: 'active', environment: 'sandbox', platform: 'ios', product_id: 'com.amani.health.premium.monthly', expires_at: '2027-01-01' }],
      betaTester: { user_id: 'u', platform: 'apple', enabled: true, expires_at: null } });
    const result = await readInterpretation(actions({ resolveEntitlement: async () => entitlement }));
    expect(result.body.access).toBe('full');
    expect(result.body.plan).toBe('premium');
  });
  it.each(['standard','unknown'])('requests generation for Premium %s depth', async stored_depth => {
    const result = await readInterpretation(actions({ resolveEntitlement: async () => ({ allowed: true, plan: 'premium', reason: 'complimentary', source: 'complimentary' }),
      readSelected: async () => ({ json_output: full, stored_depth, has_claim: false, tier: 'plus' }) }));
    expect(result.body.access).toBe('generation_needed');
    expect(result.body.stored_depth).toBe(stored_depth);
    expect(result.body.interpretation).not.toHaveProperty('private');
  });
  it('distinguishes missing generation, ownership denial and DB errors', async () => {
    expect((await readInterpretation(actions({ readSelected: async () => null }))).body.access).toBe('generation_needed');
    const read = vi.fn();
    expect((await readInterpretation(actions({ ownsReport: async () => false, readSelected: read }))).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
    for (const key of ['ownsReport','resolveEntitlement','readSelected','countClaims'] as const) {
      const result = await readInterpretation(actions({ [key]: async () => { throw new Error('offline'); } }));
      expect(result).toMatchObject({ status: 503, body: { access: 'error', code: 'entitlement_unavailable', retryable: true, interpretation: null } });
    }
  });
  it('does not treat an entitlement error or legacy allowed result as Premium', async () => {
    const read = vi.fn();
    for (const entitlement of [{ allowed: false as const, reason: 'error' as const, detail: 'offline' }, { allowed: true as const, reason: 'trial' as const }]) {
      const result = await readInterpretation(actions({ resolveEntitlement: async () => entitlement, readSelected: read }));
      expect(result.status).toBe(503);
    }
    expect(read).not.toHaveBeenCalled();
  });
});

it.each([false, true])('serves floor-violating stored Full without an infrastructure denial (claim=%s)', async has_claim => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const payload = { headline: 'Existing full narrative', private: 'paid content' };
    const result = await readInterpretation(actions({
      resolveEntitlement: async () => ({ allowed: true, plan: has_claim ? 'free' : 'premium' }),
      readSelected: async () => ({ json_output: payload, stored_depth: 'deep', has_claim, tier: 'plus' }),
    }));
    expect(result).toMatchObject({ status: 200, body: { access: 'full', interpretation: payload, stored_depth: 'deep' } });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('MEDICAL FLOOR VIOLATION'), expect.any(Array));
  } finally { log.mockRestore(); }
});

describe('Full readers of non-deep rows (read RPC returns interpretation_source)', () => {
  const deterministic = { headline: 'h', cycle_context: {}, questions_for_doctor: [], disclaimer: 'd',
    key_findings: [], top_findings: [], overall_interpretation: 'DETERMINISTIC_OVERALL',
    pattern_signals: [{ title: 'p', explanation: 'DETERMINISTIC_PATTERN' }] };
  const premium = async () => ({ allowed: true as const, plan: 'premium' as const,
    reason: 'active_subscription' as const, source: 'active_subscription' as const });
  const row = (has_claim: boolean, interpretation_source?: string | null) => async () => ({
    json_output: deterministic, stored_depth: 'standard', has_claim, tier: 'free',
    ...(interpretation_source === undefined ? {} : { interpretation_source }) });
  it.each(['fallback', 'deterministic'])('%s standard row: Premium and claimed readers receive the stored deterministic body', async source => {
    for (const overrides of [{ resolveEntitlement: premium, readSelected: row(false, source) }, { readSelected: row(true, source) }]) {
      const result = await readInterpretation(actions(overrides));
      expect(result.body.access).toBe('generation_needed');
      expect(result.body.interpretation).toEqual(deterministic);
    }
  });
  it.each(['ai', null, undefined])('source %s standard row keeps the narrative-free Basic (unchanged)', async source => {
    const result = await readInterpretation(actions({ resolveEntitlement: premium, readSelected: row(false, source) }));
    expect(result.body.access).toBe('generation_needed');
    expect(result.body.interpretation).toEqual(buildBasicProjection(deterministic));
    expect(JSON.stringify(result.body.interpretation)).not.toMatch(/DETERMINISTIC_(OVERALL|PATTERN)/);
  });
});

describe('explicit server dark gate', () => {
  it.each([false, true])('OFF serves owned stored Full independent of claim=%s, depth, or legacy eligibility', async has_claim => {
    const entitlements = [
      { allowed: false as const, reason: 'trial_expired' as const },
      { allowed: false as const, reason: 'no_subscription' as const },
      { allowed: false as const, reason: 'onboarding_incomplete' as const },
      { allowed: true as const, reason: 'trial' as const },
      { allowed: true as const, reason: 'active_subscription' as const },
      { allowed: true as const, reason: 'active_iap' as const },
      { allowed: true as const, reason: 'complimentary' as const },
      { allowed: false as const, reason: 'error' as const, detail: 'offline' },
    ];
    for (const entitlement of entitlements) for (const stored_depth of ['deep', 'standard', 'unknown']) {
      const readSelected = vi.fn(async () => ({ json_output: full, stored_depth, has_claim, tier: 'free' }));
      const countClaims = vi.fn();
      const result = await readWithFlag(actions({ resolveEntitlement: async () => entitlement, readSelected, countClaims }), false);
      expect(result).toEqual({ status: 200, body: {
        access: 'full', interpretation: full, stored_depth, preview: null,
        locked: { patterns: 0, cross_report: 0, lifestyle: 0 }, complimentary: null,
        plan: ['active_subscription', 'active_iap', 'complimentary'].includes(entitlement.reason)
          ? 'premium' : entitlement.reason === 'error' ? null : 'free',
      } });
      expect(readSelected).toHaveBeenCalledTimes(1);
      expect(readSelected).toHaveBeenCalledWith(true);
      expect(countClaims).not.toHaveBeenCalled();
    }
  });
  it.each([false, true])('missing rows request generation with gate=%s', async flag => {
    const result = await readWithFlag(actions({ readSelected: async () => null }), flag);
    expect(result).toMatchObject({ status: 200, body: { access: 'generation_needed', interpretation: null } });
    if (!flag) expect(result.body.complimentary).toBeNull();
  });
  it('OFF plan resolution failure cannot block an owned Full read', async () => {
    const result = await readWithFlag(actions({ resolveEntitlement: async () => { throw new Error('offline'); } }), false);
    expect(result).toMatchObject({ status: 200, body: { access: 'full', interpretation: full, plan: null, complimentary: null } });
  });
  it.each([false, true])('OFF preserves ownership and database errors (owns=%s)', async owns => {
    const read = vi.fn(async () => { throw new Error('offline'); });
    const result = await readWithFlag(actions({ ownsReport: async () => owns, readSelected: read }), false);
    expect(result.status).toBe(owns ? 503 : 404);
    if (!owns) expect(read).not.toHaveBeenCalled();
  });
  it.each([false, true])('ON shallow Free row needs generation only with a claim=%s', async has_claim => {
    const result = await readWithFlag(actions({ readSelected: async () => ({ json_output: buildBasicProjection(full),
      stored_depth: 'standard', has_claim, tier: 'free' }) }), true);
    expect(result.body.access).toBe(has_claim ? 'generation_needed' : 'basic');
  });
  it('sanitizes old stored Basic cycle prose without rebuilding preview/counts or touching Full', async () => {
    const payload = { ...full, cycle_context: { estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
      confidence: 'high', explanation: 'PRIVATE CROSS-MARKER NARRATIVE', other: 'PRIVATE LIFESTYLE' },
      preview: { content: 'chosen preview' }, locked: { patterns: 2, cross_report: 1, lifestyle: 3 } };
    for (const flag of [false, true]) for (const has_claim of [false, true]) {
      const result = await readWithFlag(actions({ readSelected: async () => ({ json_output: payload,
        stored_depth: 'deep', has_claim, tier: 'free' }) }), flag);
      if (flag && !has_claim) {
        expect(JSON.stringify(result.body)).not.toContain('PRIVATE');
        expect(result.body.preview).toEqual(payload.preview);
        expect(result.body.locked).toEqual(payload.locked);
        expect(result.body.interpretation?.cycle_context).toEqual({ estimated_cycle_day: 21,
          estimated_cycle_phase: 'luteal', confidence: 'high', explanation: '' });
      } else expect(result.body.interpretation).toBe(payload);
    }
  });
});

it('endpoint threads the exact environment gate through entitlement and read policy', () => {
  const source = readFileSync(new URL('../get-interpretation/index.ts', import.meta.url), 'utf8');
  expect(source).toContain('const freemiumActive = Deno.env.get("FREEMIUM_ACTIVE") === "true"');
  expect(source).toContain('checkUserSubscription(userClient, user.id, freemiumActive, true)');
  expect(source).toContain('}, freemiumActive)');
  expect(source).not.toMatch(/checkUserSubscription\([^)]*,\s*true\s*,\s*true\s*\)/);
  const policy = readFileSync(new URL('./interpretation-read.ts', import.meta.url), 'utf8');
  expect(policy).not.toContain('Deno.env');
});
