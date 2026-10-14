import { describe, expect, it } from 'vitest';
import { decideIntroductoryAccess, introductoryAccessDecision, type ClaimRecord } from './introductory-access';
import { shouldGenerateDeepInterpretation } from './response-shaping';
import { decideDeepGeneration, regenerationAvailability } from './regeneration-availability';
import { FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS } from './tier';

const CLAIM: ClaimRecord = { user_id: 'u', blood_draw_id: 'd', report_id: 'r', evidence_tier: 'content_hash', claimed_at: '2026-10-01T00:00:00Z' };
const POST_LIMIT = [undefined, 'always', 'on_demand', 'unknown_value'];

describe('introductoryAccessDecision: the ledger rule, extracted without change', () => {
  it('matches decideIntroductoryAccess for every tier, claim and count', async () => {
    for (const tier of ['free', 'plus'] as const) {
      for (const existing of [CLAIM, null]) {
        for (const used of [0, 1, 2, 3, 4]) {
          const ported = await decideIntroductoryAccess({
            findClaim: async () => existing, countClaims: async () => used,
            commitDeepAccess: async () => { throw new Error('not called'); },
          }, { tier, userId: 'u', bloodDrawId: 'd' });
          expect(introductoryAccessDecision({ tier, existingClaim: existing !== null, claimsUsed: used })).toEqual(ported);
        }
      }
    }
  });

  it('Plus never reads the ledger', async () => {
    const touched: string[] = [];
    await decideIntroductoryAccess({
      findClaim: async () => { touched.push('findClaim'); return null; },
      countClaims: async () => { touched.push('countClaims'); return 0; },
      commitDeepAccess: async () => { throw new Error('not called'); },
    }, { tier: 'plus', userId: 'u', bloodDrawId: 'd' });
    expect(touched).toEqual([]);
  });
});

describe('decideDeepGeneration: the single depth decision', () => {
  it('reproduces the handler rule it replaced (deepAccessGranted from the decision, else Plus)', () => {
    for (const freemiumActive of [false, true]) {
      for (const tier of ['free', 'plus'] as const) {
        for (const existingClaim of [false, true]) {
          for (const used of [0, 2, 3]) {
            for (const postLimitGeneration of POST_LIMIT) {
              // generate-interpretation consulted the ledger only for an activated Free request.
              const decision = freemiumActive && tier === 'free'
                ? introductoryAccessDecision({ tier, existingClaim, claimsUsed: used }) : null;
              const before = shouldGenerateDeepInterpretation({
                freemiumActive, tier, decision, postLimitGeneration,
                deepAccessGranted: decision ? decision.granted : tier === 'plus',
              });
              expect(decideDeepGeneration({ freemiumActive, tier, decision, postLimitGeneration })).toBe(before);
            }
          }
        }
      }
    }
  });

  it('flag off and Plus always generate deeply; an exhausted Free request follows the post-limit setting', () => {
    expect(decideDeepGeneration({ freemiumActive: false, tier: 'plus', decision: null, postLimitGeneration: 'on_demand' })).toBe(true);
    expect(decideDeepGeneration({ freemiumActive: true, tier: 'plus', decision: null, postLimitGeneration: 'on_demand' })).toBe(true);
    const exhausted = introductoryAccessDecision({ tier: 'free', existingClaim: false, claimsUsed: FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS });
    expect(exhausted.granted).toBe(false);
    expect(POST_LIMIT.map(postLimitGeneration =>
      decideDeepGeneration({ freemiumActive: true, tier: 'free', decision: exhausted, postLimitGeneration })))
      .toEqual([true, true, false, false]);
  });
});

describe('regenerationAvailability (flag on, a stored report)', () => {
  it.each(POST_LIMIT)('Premium can always regenerate (post-limit %s)', postLimitGeneration => {
    for (const hasClaim of [false, true]) for (const claimsUsed of [0, 3]) {
      expect(regenerationAvailability({ premium: true, hasClaim, claimsUsed, postLimitGeneration }))
        .toEqual({ available: true, reason: null });
    }
  });

  it.each(POST_LIMIT)('Free with a claim on the report, or a credit left, can regenerate (post-limit %s)', postLimitGeneration => {
    expect(regenerationAvailability({ premium: false, hasClaim: true, claimsUsed: 3, postLimitGeneration }).available).toBe(true);
    for (const claimsUsed of [0, 1, 2]) {
      expect(regenerationAvailability({ premium: false, hasClaim: false, claimsUsed, postLimitGeneration }).available).toBe(true);
    }
  });

  it('Free post-limit with no claim on the report: available only while post-limit generation is "always" (the default)', () => {
    const at = (postLimitGeneration: string | undefined, claimsUsed = 3) =>
      regenerationAvailability({ premium: false, hasClaim: false, claimsUsed, postLimitGeneration });
    expect(at(undefined)).toEqual({ available: true, reason: null });
    expect(at('always')).toEqual({ available: true, reason: null });
    expect(at('on_demand')).toEqual({ available: false, reason: 'introductory_access_exhausted' });
    // Unknown values fail cheap, as they do for generation itself.
    expect(at('unknown_value')).toEqual({ available: false, reason: 'introductory_access_exhausted' });
    expect(at('on_demand', 7)).toEqual({ available: false, reason: 'introductory_access_exhausted' });
  });
});
