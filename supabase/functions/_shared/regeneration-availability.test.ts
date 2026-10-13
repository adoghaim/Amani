import { describe, expect, it, vi } from 'vitest';
import { decideIntroductoryAccess, introductoryAccessDecision, type IntroductoryAccessActions } from './introductory-access';
import { decideDeepGeneration, shouldGenerateDeepInterpretation } from './response-shaping';
import { regenerationAvailability, regenerationFailedResponse } from './interpretation-version-write';
import { readInterpretation, type InterpretationReadActions } from './interpretation-read';
import { buildBasicProjection } from './interpretation-visibility';
import { FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS, type Tier } from './tier';

/**
 * PK-PL-A (owner-ruled pre-launch item c): the Free post-limit Regenerate CTA is
 * hidden when a regeneration cannot succeed, and "cannot succeed" is the
 * server's own decision, written once. generate-interpretation decides every
 * request's depth with decideDeepGeneration over introductoryAccessDecision;
 * get-interpretation answers `regeneration` with the same two functions over the
 * readers' claim facts. The executed-handler parity lives in
 * regeneration-failure.handler.test.ts.
 */

const POST_LIMIT = [undefined, 'always', 'on_demand', 'invalid', ''] as const;
const deepAfterExhaustion = (postLimit: string | undefined) => postLimit === undefined || postLimit === 'always';

describe('introductoryAccessDecision: the ledger rule, pure', () => {
  it('Plus is granted without metering, whatever the facts', () => {
    for (const existingClaim of [false, true]) for (const claimsUsed of [0, 3, 7]) {
      expect(introductoryAccessDecision({ tier: 'plus', existingClaim, claimsUsed })).toEqual({
        granted: true, reason: 'plus', claimsUsed: 0, claimsRemaining: FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS, consumesCredit: false });
    }
  });
  it('an existing claim is granted before the budget is looked at, even when exhausted', () => {
    for (const claimsUsed of [1, 3, 4]) {
      expect(introductoryAccessDecision({ tier: 'free', existingClaim: true, claimsUsed })).toMatchObject({
        granted: true, reason: 'existing_claim', consumesCredit: false });
    }
  });
  it('credit available below the limit, exhausted at it', () => {
    for (const claimsUsed of [0, 1, 2]) {
      expect(introductoryAccessDecision({ tier: 'free', existingClaim: false, claimsUsed })).toEqual({
        granted: true, reason: 'credit_available', claimsUsed, claimsRemaining: 3 - claimsUsed, consumesCredit: true });
    }
    for (const claimsUsed of [3, 4]) {
      expect(introductoryAccessDecision({ tier: 'free', existingClaim: false, claimsUsed })).toEqual({
        granted: false, reason: 'introductory_access_exhausted', claimsUsed, claimsRemaining: 0, consumesCredit: false });
    }
  });
  it('decideIntroductoryAccess is exactly the pure rule over the facts its port reads', async () => {
    for (const tier of ['plus', 'free'] as Tier[]) for (const existingClaim of [false, true]) for (const claimsUsed of [0, 1, 2, 3, 4]) {
      const actions: IntroductoryAccessActions = {
        findClaim: vi.fn(async () => existingClaim ? { user_id: 'u', blood_draw_id: 'd', report_id: 'r', evidence_tier: 'content_hash' as const, claimed_at: 'x' } : null),
        countClaims: vi.fn(async () => claimsUsed),
        commitDeepAccess: vi.fn(),
      };
      const decided = await decideIntroductoryAccess(actions, { tier, userId: 'u', bloodDrawId: 'd' });
      expect(decided).toEqual(introductoryAccessDecision({ tier, existingClaim, claimsUsed: tier === 'plus' ? 0 : claimsUsed }));
      // Plus never reads the ledger.
      expect(actions.findClaim).toHaveBeenCalledTimes(tier === 'plus' ? 0 : 1);
      expect(actions.commitDeepAccess).not.toHaveBeenCalled();
    }
  });
});

describe('decideDeepGeneration: the one depth decision', () => {
  it('flag off: every entitled caller resolves to Plus and generates deeply', () => {
    for (const postLimitGeneration of POST_LIMIT) {
      expect(decideDeepGeneration({ freemiumActive: false, tier: 'plus', decision: null, postLimitGeneration })).toBe(true);
    }
  });
  it('is shouldGenerateDeepInterpretation with the grant read from the decision (the handler\'s former inline rule)', () => {
    for (const freemiumActive of [false, true]) for (const tier of ['plus', 'free'] as Tier[]) for (const postLimitGeneration of POST_LIMIT)
      for (const facts of [null, { existingClaim: true, claimsUsed: 3 }, { existingClaim: false, claimsUsed: 1 }, { existingClaim: false, claimsUsed: 3 }]) {
        const decision = facts && freemiumActive && tier === 'free' ? introductoryAccessDecision({ tier, ...facts }) : null;
        // The handler used to set deepAccessGranted = tier === 'plus', then decision.granted when the ledger ran.
        const deepAccessGranted = decision ? decision.granted : tier === 'plus';
        expect(decideDeepGeneration({ freemiumActive, tier, decision, postLimitGeneration }))
          .toBe(shouldGenerateDeepInterpretation({ freemiumActive, tier, deepAccessGranted, decision, postLimitGeneration }));
      }
  });
  it('Free: a claim or a credit generates deeply; exhaustion only under the post-limit default', () => {
    for (const postLimitGeneration of POST_LIMIT) {
      const deep = (existingClaim: boolean, claimsUsed: number) => decideDeepGeneration({ freemiumActive: true, tier: 'free',
        decision: introductoryAccessDecision({ tier: 'free', existingClaim, claimsUsed }), postLimitGeneration });
      expect(deep(true, 3)).toBe(true);
      expect(deep(false, 2)).toBe(true);
      expect(deep(false, 3)).toBe(deepAfterExhaustion(postLimitGeneration));
    }
  });
  it('regenerationAvailability names the answer; unavailable is the request the server refuses as not retryable', () => {
    expect(regenerationAvailability(true)).toBe('available');
    expect(regenerationAvailability(false)).toBe('unavailable');
    // generate-interpretation answers a refused regeneration with retryable = its depth decision.
    expect(regenerationFailedResponse(false)).toEqual({ status: 503, body: { error: 'regeneration_failed', retryable: false } });
  });
});

const full = { headline: 'h', cycle_context: {}, questions_for_doctor: [], disclaimer: 'd', key_findings: [] };
function reader(input: { plan: 'free' | 'premium'; hasClaim: boolean; used: number; postLimitGeneration?: string;
  row?: 'deep' | 'standard' | null }): InterpretationReadActions {
  return {
    ownsReport: async () => true,
    resolveEntitlement: async () => input.plan === 'premium'
      ? { allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' }
      : { allowed: true, plan: 'free' },
    readSelected: async premium => input.row === null ? null : ({ json_output: premium || input.hasClaim ? full : buildBasicProjection(full),
      stored_depth: input.row ?? 'deep', has_claim: input.hasClaim, tier: 'free', interpretation_source: 'ai' }),
    countClaims: async () => input.used,
    ...(input.postLimitGeneration === undefined ? {} : { postLimitGeneration: input.postLimitGeneration }),
  };
}

describe('get-interpretation `regeneration`: the server says whether Regenerate can succeed', () => {
  it('Premium: available for every stored depth and post-limit setting', async () => {
    for (const postLimitGeneration of POST_LIMIT) for (const row of ['deep', 'standard'] as const) {
      const result = await readInterpretation(reader({ plan: 'premium', hasClaim: false, used: 3, postLimitGeneration, row }), true);
      expect(result.body.regeneration).toBe('available');
    }
  });
  it('Free with a claim on the report, or a credit left: available', async () => {
    for (const postLimitGeneration of POST_LIMIT) {
      expect((await readInterpretation(reader({ plan: 'free', hasClaim: true, used: 3, postLimitGeneration }), true)).body.regeneration).toBe('available');
      for (const used of [0, 1, 2]) {
        expect((await readInterpretation(reader({ plan: 'free', hasClaim: false, used, postLimitGeneration }), true)).body.regeneration).toBe('available');
      }
    }
  });
  it('Free post-limit: available only when post-limit generation is on; otherwise unavailable', async () => {
    for (const postLimitGeneration of POST_LIMIT) for (const row of ['deep', 'standard'] as const) {
      const result = await readInterpretation(reader({ plan: 'free', hasClaim: false, used: 3, postLimitGeneration, row }), true);
      expect(result.body.access).toBe('basic');
      expect(result.body.regeneration).toBe(deepAfterExhaustion(postLimitGeneration) ? 'available' : 'unavailable');
    }
  });
  it('agrees with the depth decision over the same facts, for every combination', async () => {
    for (const plan of ['free', 'premium'] as const) for (const hasClaim of [false, true]) for (const used of [0, 2, 3])
      for (const postLimitGeneration of POST_LIMIT) {
        const result = await readInterpretation(reader({ plan, hasClaim, used, postLimitGeneration }), true);
        const tier: Tier = plan === 'premium' ? 'plus' : 'free';
        const deep = decideDeepGeneration({ freemiumActive: true, tier, postLimitGeneration,
          decision: tier === 'plus' ? null : introductoryAccessDecision({ tier, existingClaim: hasClaim, claimsUsed: used }) });
        expect(result.body.regeneration).toBe(deep ? 'available' : 'unavailable');
      }
  });
  it('absent where no regeneration decision is made: nothing stored, flag off, or an error', async () => {
    const none = await readInterpretation(reader({ plan: 'free', hasClaim: false, used: 3, postLimitGeneration: 'on_demand', row: null }), true);
    expect(none.body.access).toBe('generation_needed');
    expect(none.body).not.toHaveProperty('regeneration');
    const off = await readInterpretation(reader({ plan: 'free', hasClaim: false, used: 3, postLimitGeneration: 'on_demand' }), false);
    expect(off.body.access).toBe('full');
    expect(off.body).not.toHaveProperty('regeneration');
    const failed = await readInterpretation({ ...reader({ plan: 'free', hasClaim: false, used: 3 }),
      countClaims: async () => { throw new Error('offline'); } }, true);
    expect(failed.status).toBe(503);
    expect(failed.body).not.toHaveProperty('regeneration');
  });
  it('the endpoint reads the post-limit switch exactly as generate-interpretation does', async () => {
    const { readFileSync } = await import('node:fs');
    const read = readFileSync(new URL('../get-interpretation/index.ts', import.meta.url), 'utf8');
    const generate = readFileSync(new URL('../generate-interpretation/index.ts', import.meta.url), 'utf8');
    const env = 'Deno.env.get("FREEMIUM_POST_LIMIT_GENERATION")';
    expect(read).toContain(`postLimitGeneration: ${env}`);
    expect(generate).toContain(`postLimitGeneration: ${env}`);
    // One decision function on the generation path; the inline grant rule is gone.
    expect(generate).toContain('const generateDeep = decideDeepGeneration({');
    expect(generate).not.toContain('shouldGenerateDeepInterpretation(');
  });
});
