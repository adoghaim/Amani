import { describe, expect, it, vi } from 'vitest';
import { readInterpretation, type InterpretationReadActions } from './interpretation-read';
import { resolveEntitlement } from './entitlement';
import { buildBasicProjection } from './interpretation-visibility';
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
