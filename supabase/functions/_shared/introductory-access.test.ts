import { describe, expect, it, vi } from 'vitest';
import {
  claimCoverage,
  commitDeepAccess,
  commitGeneratedInterpretation,
  decideIntroductoryAccess,
  type ClaimRecord,
  type CommitDeepAccessInput,
  type CommitRequest,
  type DeepAccessCompletion,
  type IntroductoryAccessActions,
} from './introductory-access';
import { shapeInterpretation, shouldGenerateDeepInterpretation } from './response-shaping';
import { decideDeepGeneration } from './regeneration-availability';

/**
 * The ledger exists to make the wrong outcomes impossible rather than unlikely:
 * a retry must not double-charge, a regeneration must not charge at all, a
 * failed generation must not charge either — and, the one that matters most, a
 * broken ledger must not quietly become unlimited Plus.
 */

const USER = 'user-1';
const DRAW = 'a'.repeat(64);
const OTHER_DRAW = 'b'.repeat(64);

const claim = (bloodDrawId: string): ClaimRecord => ({
  user_id: USER,
  blood_draw_id: bloodDrawId,
  report_id: 'report-1',
  evidence_tier: 'accession',
  claimed_at: '2026-09-01T00:00:00Z',
});

/**
 * In-memory stand-in for the Postgres function: interpretation and claim land
 * together or not at all, and the unique constraint plus the limit trigger are
 * both modelled.
 */
function fakeActions(seed: ClaimRecord[] = [], opts: { failCommit?: boolean } = {}) {
  const rows = [...seed];
  const stored: CommitDeepAccessInput[] = [];
  const calls = { commit: 0 };

  const actions: IntroductoryAccessActions = {
    async findClaim(userId, bloodDrawId) {
      return rows.find((r) => r.user_id === userId && r.blood_draw_id === bloodDrawId) ?? null;
    },
    async countClaims(userId) {
      return rows.filter((r) => r.user_id === userId).length;
    },
    async commitDeepAccess(input) {
      calls.commit++;
      if (opts.failCommit) throw new Error('deadlock detected');

      const exists = rows.some(
        (r) => r.user_id === input.userId && r.blood_draw_id === input.bloodDrawId,
      );
      if (exists) {
        stored.push(input); // interpretation still saved; claim already there
        return 'already_claimed';
      }
      if (input.consumeCredit) {
        if (rows.filter((r) => r.user_id === input.userId).length >= 3) {
          // Trigger refuses; the whole transaction rolls back.
          return 'limit_reached';
        }
        rows.push({
          user_id: input.userId,
          blood_draw_id: input.bloodDrawId,
          report_id: input.reportId,
          evidence_tier: input.evidenceTier,
          claimed_at: '2026-09-04T00:00:00Z',
        });
      }
      stored.push(input);
      return 'committed';
    },
  };

  return { actions, rows, stored, calls };
}

const GENERATED: DeepAccessCompletion = {
  parseConfident: true,
  interpretationGenerated: true,
};

const REQUEST: CommitRequest = {
  userId: USER,
  bloodDrawId: DRAW,
  reportId: 'report-9',
  evidenceTier: 'accession',
  interpretation: { overall_interpretation: 'ok' },
};

describe('decideIntroductoryAccess', () => {
  it('never meters a Plus subscriber, and costs no database round trip', async () => {
    let touched = 0;
    const actions: IntroductoryAccessActions = {
      async findClaim() { touched++; return null; },
      async countClaims() { touched++; return 0; },
      async commitDeepAccess() { return 'committed'; },
    };
    const d = await decideIntroductoryAccess(actions, {
      tier: 'plus', userId: USER, bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({ granted: true, reason: 'plus', consumesCredit: false });
    expect(touched).toBe(0);
  });

  it('grants a first draw and marks it as consuming a credit', async () => {
    const { actions } = fakeActions();
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({
      granted: true, reason: 'credit_available', claimsUsed: 0, claimsRemaining: 3,
      consumesCredit: true,
    });
  });

  it('grants a second draw', async () => {
    const { actions } = fakeActions([claim(OTHER_DRAW)]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({ granted: true, reason: 'credit_available', claimsRemaining: 2 });
  });

  it('denies a fourth distinct draw', async () => {
    const { actions } = fakeActions([claim(OTHER_DRAW), claim('c'.repeat(64)), claim('d'.repeat(64))]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(d).toEqual({
      granted: false,
      reason: 'introductory_access_exhausted',
      claimsUsed: 3,
      claimsRemaining: 0,
      consumesCredit: false,
    });
  });

  it('serves an already-claimed draw free, even once both credits are gone', async () => {
    const { actions } = fakeActions([claim(DRAW), claim(OTHER_DRAW)]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({
      granted: true, reason: 'existing_claim', claimsUsed: 2, consumesCredit: false,
    });
  });

  it('never reports negative remaining credits', async () => {
    const { actions } = fakeActions([
      claim('x'.repeat(64)), claim('y'.repeat(64)), claim(DRAW),
    ]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(d.claimsRemaining).toBe(0);
  });

  it('scopes claims to the user', async () => {
    const { actions } = fakeActions([
      { ...claim(DRAW), user_id: 'user-2' },
      { ...claim(OTHER_DRAW), user_id: 'user-2' },
    ]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({ granted: true, reason: 'credit_available', claimsUsed: 0 });
  });
});

describe('commitDeepAccess — the interpretation and the credit land together', () => {
  it('commits both and reports the credit spent', async () => {
    const { actions, rows, stored } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    const outcome = await commitDeepAccess(actions, decision, GENERATED, REQUEST);
    expect(outcome).toEqual({ committed: true, creditConsumed: true });
    expect(rows).toHaveLength(1);
    expect(stored).toHaveLength(1);
  });

  it('commits a Plus interpretation without touching the ledger', async () => {
    const { actions, rows, stored } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'plus', userId: USER, bloodDrawId: DRAW,
    });
    const outcome = await commitDeepAccess(actions, decision, GENERATED, REQUEST);
    expect(outcome).toEqual({ committed: true, creditConsumed: false });
    expect(rows).toHaveLength(0);
    expect(stored).toHaveLength(1);
  });

  it('commits a regeneration of an already-claimed draw without a second credit', async () => {
    const { actions, rows } = fakeActions([claim(DRAW)]);
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    const outcome = await commitDeepAccess(actions, decision, GENERATED, REQUEST);
    expect(outcome).toEqual({ committed: true, creditConsumed: false });
    expect(rows).toHaveLength(1);
  });

  it('is idempotent when the same commit is retried', async () => {
    const { actions, rows } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(await commitDeepAccess(actions, decision, GENERATED, REQUEST))
      .toEqual({ committed: true, creditConsumed: true });
    // The response died after COMMIT; the client retried.
    expect(await commitDeepAccess(actions, decision, GENERATED, REQUEST))
      .toEqual({ committed: true, creditConsumed: false });
    expect(rows).toHaveLength(1);
  });
});

describe('commitDeepAccess — nothing commits on failed work', () => {
  it('commits nothing when the parse was not confident', async () => {
    const { actions, rows, stored, calls } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    const outcome = await commitDeepAccess(
      actions, decision, { ...GENERATED, parseConfident: false }, REQUEST,
    );
    expect(outcome).toEqual({ committed: false, reason: 'generation_incomplete' });
    expect(rows).toHaveLength(0);
    expect(stored).toHaveLength(0);
    expect(calls.commit).toBe(0);
  });

  it('commits nothing when the model failed', async () => {
    const { actions, rows, calls } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    const outcome = await commitDeepAccess(
      actions, decision, { ...GENERATED, interpretationGenerated: false }, REQUEST,
    );
    expect(outcome).toEqual({ committed: false, reason: 'generation_incomplete' });
    expect(rows).toHaveLength(0);
    expect(calls.commit).toBe(0);
  });

  it('commits nothing when access was already denied', async () => {
    const { actions, rows, calls } = fakeActions([
      claim('x'.repeat(64)), claim('y'.repeat(64)), claim('z'.repeat(64)),
    ]);
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(decision.granted).toBe(false);
    const outcome = await commitDeepAccess(actions, decision, GENERATED, REQUEST);
    expect(outcome).toEqual({ committed: false, reason: 'introductory_access_exhausted' });
    expect(rows).toHaveLength(3);
    expect(calls.commit).toBe(0);
  });

  it('fails closed when the request loses the race for the last credit', async () => {
    /*
      Two uploads of two different draws both read count = 2 and both believe
      they hold the last credit. The database settles it. The loser must be
      served the Free result, NOT the premium one it thought it had earned.
    */
    const { actions, stored } = fakeActions([claim('x'.repeat(64)), claim('y'.repeat(64)), claim('z'.repeat(64))]);
    const staleDecision = {
      granted: true as const,
      reason: 'credit_available' as const,
      claimsUsed: 1,
      claimsRemaining: 1,
      consumesCredit: true,
    };
    const outcome = await commitDeepAccess(actions, staleDecision, GENERATED, REQUEST);
    expect(outcome).toEqual({ committed: false, reason: 'introductory_access_exhausted' });
    expect(stored).toHaveLength(0);
  });
});

describe('a broken ledger must not become unlimited Plus', () => {
  it('propagates an infrastructure failure instead of downgrading it', async () => {
    /*
      The regression this contract exists to prevent. The earlier design caught
      this failure and returned the interpretation anyway, so an hour of failing
      claim writes would have handed every Free user unlimited deep access.
    */
    const { actions } = fakeActions([], { failCommit: true });
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    await expect(commitDeepAccess(actions, decision, GENERATED, REQUEST))
      .rejects.toThrow('deadlock detected');
  });

  it('never reports committed unless the ledger call actually succeeded', async () => {
    /*
      The invariant, stated directly: across every combination of decision and
      completion, `committed: true` implies the transactional write ran and
      resolved. No premium result without a ledger commit.
    */
    const decisions = [
      { granted: true as const, reason: 'plus' as const, claimsUsed: 0, claimsRemaining: 2, consumesCredit: false },
      { granted: true as const, reason: 'existing_claim' as const, claimsUsed: 1, claimsRemaining: 1, consumesCredit: false },
      { granted: true as const, reason: 'credit_available' as const, claimsUsed: 0, claimsRemaining: 2, consumesCredit: true },
      { granted: false as const, reason: 'introductory_access_exhausted' as const, claimsUsed: 2, claimsRemaining: 0 as const, consumesCredit: false as const },
    ];
    const completions: DeepAccessCompletion[] = [
      { parseConfident: true, interpretationGenerated: true },
      { parseConfident: false, interpretationGenerated: true },
      { parseConfident: true, interpretationGenerated: false },
      { parseConfident: false, interpretationGenerated: false },
    ];

    let checked = 0;
    for (const decision of decisions) {
      for (const completion of completions) {
        const { actions, calls } = fakeActions();
        const outcome = await commitDeepAccess(actions, decision, completion, REQUEST);
        checked++;
        if (outcome.committed) expect(calls.commit).toBe(1);
        else expect(calls.commit).toBe(0);
      }
    }
    expect(checked).toBe(16);
  });
});

describe('generation persistence wiring', () => {
  const decision = { granted: true as const, reason: 'credit_available' as const,
    claimsUsed: 2, claimsRemaining: 1, consumesCredit: true };
  const input = { freemiumActive: true, tier: 'free' as const, decision,
    completion: GENERATED, request: REQUEST };

  it.each(['committed', 'already_claimed'] as const)('%s saves Plus without a second upsert', async outcome => {
    const commit = vi.fn(async () => outcome);
    expect(await commitGeneratedInterpretation({ commitDeepAccess: commit }, input))
      .toEqual({ committed: true, tier: 'plus' });
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith({ ...REQUEST, consumeCredit: true });
  });
  it('a last-slot loser must use the existing Free upsert, retaining the generated payload', async () => {
    const commit = vi.fn(async () => 'limit_reached' as const);
    expect(await commitGeneratedInterpretation({ commitDeepAccess: commit }, input))
      .toEqual({ committed: false, tier: 'free' });
    expect(commit.mock.calls[0]).toEqual([{ ...REQUEST, consumeCredit: true }]);
  });
  it.each([false, true])('Premium bypasses the RPC with flag %s (paid and complimentary)', async freemiumActive => {
    const commit = vi.fn();
    expect(await commitGeneratedInterpretation({ commitDeepAccess: commit }, {
      ...input, freemiumActive, tier: 'plus', decision: null, request: null,
    })).toEqual({ committed: false, tier: 'plus' });
    expect(commit).not.toHaveBeenCalled();
  });
  it('flag off bypasses the RPC even for a Free input', async () => {
    const commit = vi.fn();
    expect(await commitGeneratedInterpretation({ commitDeepAccess: commit }, { ...input, freemiumActive: false }))
      .toEqual({ committed: false, tier: 'free' });
    expect(commit).not.toHaveBeenCalled();
  });
  it.each([
    { parseConfident: false, interpretationGenerated: true },
    { parseConfident: true, interpretationGenerated: false },
  ])('failed generation/parse consumes nothing: %j', async completion => {
    const commit = vi.fn();
    expect(await commitGeneratedInterpretation({ commitDeepAccess: commit }, { ...input, completion }))
      .toEqual({ committed: false, tier: 'free' });
    expect(commit).not.toHaveBeenCalled();
  });
  it('a broken transaction propagates and cannot fall through to an upsert', async () => {
    const commit = vi.fn(async () => { throw new Error('database offline'); });
    await expect(commitGeneratedInterpretation({ commitDeepAccess: commit }, input))
      .rejects.toThrow('database offline');
  });
  it('two stale decisions for the third slot yield one Plus and one Free', async () => {
    const fake = fakeActions([claim('b'.repeat(64)), claim('c'.repeat(64))]);
    const results = await Promise.all([
      commitGeneratedInterpretation(fake.actions, input),
      commitGeneratedInterpretation(fake.actions, { ...input,
        request: { ...REQUEST, reportId: 'report-other', bloodDrawId: 'd'.repeat(64) } }),
    ]);
    expect(results).toEqual([{ committed: true, tier: 'plus' }, { committed: false, tier: 'free' }]);
    expect(fake.rows).toHaveLength(3);
    expect(fake.stored).toHaveLength(1);
  });
});


describe('post-limit generation and persistence', () => {
  it.each(['always', 'on_demand'])('%s never consumes an exhausted claim', async postLimitGeneration => {
    const decision = { granted: false as const, reason: 'introductory_access_exhausted' as const,
      claimsUsed: 3, claimsRemaining: 0 as const, consumesCredit: false as const };
    const deep = shouldGenerateDeepInterpretation({ freemiumActive: true, tier: 'free',
      deepAccessGranted: decision.granted, decision, postLimitGeneration });
    const ai = { headline: 'Full model output', pattern_signals: [{ explanation: 'Full detail' }] };
    const fallback = { headline: 'Deterministic output' };
    const shaped = shapeInterpretation({ tier: 'free', deepAccessGranted: deep,
      aiInterpretation: deep ? ai : null, deterministicInterpretation: () => fallback });
    const commit = vi.fn();
    const outcome = await commitGeneratedInterpretation({ commitDeepAccess: commit }, {
      freemiumActive: true, tier: 'free', decision,
      completion: { parseConfident: true, interpretationGenerated: deep },
      request: { ...REQUEST, interpretation: shaped.payload },
    });
    expect(outcome).toEqual({ committed: false, tier: 'free' });
    expect(commit).not.toHaveBeenCalled();
    expect(shaped.payload).toBe(postLimitGeneration === 'always' ? ai : fallback);
  });
});

/*
  RV-GI2 (F042): draw keys are bound to the report's analytes, so a claim found
  through the report alone covers only under that report's pre-binding key. A
  report whose values changed after its claim is a mismatch: no deep access, no
  post-limit deep generation, nothing claimed.
*/
describe('RV-GI2 claim coverage', () => {
  const BOUND = '0b'.repeat(32);
  const LEGACY = '1c'.repeat(32);
  const ELSEWHERE = '2d'.repeat(32);
  const request = { bloodDrawId: BOUND, reportId: 'report-9', legacyBloodDrawId: LEGACY };
  const row = (blood_draw_id: string, report_id: string | null) => ({ blood_draw_id, report_id });

  it.each([
    ['the draw\'s own claim, made from this report', 'covered', row(BOUND, 'report-9')],
    ['the draw\'s own claim, made from another report', 'covered', row(BOUND, 'report-1')],
    ['the draw\'s own claim, its report since deleted', 'covered', row(BOUND, null)],
    ['this report\'s claim under its legacy key', 'covered', row(LEGACY, 'report-9')],
    ['this report\'s claim for another draw', 'mismatch', row(ELSEWHERE, 'report-9')],
    ['the legacy key, claimed from another report', 'none', row(LEGACY, 'report-1')],
    ['a claim for neither this draw nor this report', 'none', row(ELSEWHERE, 'report-1')],
    ['no claim', 'none', null],
  ] as const)('%s: %s', (_label, expected, claimRow) => {
    expect(claimCoverage(claimRow, request)).toBe(expected);
  });

  /** The handler's lookup: the draw's own claim first, else this report's. */
  function boundActions(seed: ClaimRecord[], reportId: string) {
    const fake = fakeActions(seed);
    const actions: IntroductoryAccessActions = {
      ...fake.actions,
      async findClaim(userId, bloodDrawId) {
        const mine = fake.rows.filter((r) => r.user_id === userId);
        return mine.find((r) => r.blood_draw_id === bloodDrawId) ?? mine.find((r) => r.report_id === reportId) ?? null;
      },
    };
    return { ...fake, actions };
  }
  const onReport = (bloodDrawId: string, reportId: string): ClaimRecord => ({ ...claim(bloodDrawId), report_id: reportId });
  const decide = (actions: IntroductoryAccessActions) => decideIntroductoryAccess(actions, {
    tier: 'free', userId: USER, bloodDrawId: BOUND, reportId: 'report-9', legacyBloodDrawId: LEGACY,
  });

  it('serves the draw\'s own claim free, and prefers it to a mismatched report claim', async () => {
    for (const seed of [[onReport(BOUND, 'report-1')], [onReport(ELSEWHERE, 'report-9'), onReport(BOUND, 'report-1')]]) {
      const d = await decide(boundActions(seed, 'report-9').actions);
      expect(d).toMatchObject({ granted: true, reason: 'existing_claim', consumesCredit: false });
    }
  });

  it('serves this report\'s pre-binding claim free (claims made before the binding)', async () => {
    const d = await decide(boundActions([onReport(LEGACY, 'report-9')], 'report-9').actions);
    expect(d).toMatchObject({ granted: true, reason: 'existing_claim', claimsUsed: 1, consumesCredit: false });
  });

  it('refuses this report\'s claim for another draw, whatever credits are left', async () => {
    const one = await decide(boundActions([onReport(ELSEWHERE, 'report-9')], 'report-9').actions);
    expect(one).toEqual({ granted: false, reason: 'claim_mismatch', claimsUsed: 1, claimsRemaining: 2, consumesCredit: false });
    const spent = await decide(boundActions([onReport(ELSEWHERE, 'report-9'), claim('x'.repeat(64)), claim('y'.repeat(64))],
      'report-9').actions);
    expect(spent).toEqual({ granted: false, reason: 'claim_mismatch', claimsUsed: 3, claimsRemaining: 0, consumesCredit: false });
  });

  it('counts a pre-binding claim from another report as a new draw', async () => {
    const fresh = await decide(boundActions([onReport(LEGACY, 'report-1')], 'report-9').actions);
    expect(fresh).toMatchObject({ granted: true, reason: 'credit_available', consumesCredit: true });
    const spent = await decide(boundActions([onReport(LEGACY, 'report-1'), claim('x'.repeat(64)), claim('y'.repeat(64))],
      'report-9').actions);
    expect(spent).toMatchObject({ granted: false, reason: 'introductory_access_exhausted' });
  });

  it('without the new inputs any claim found counts, exactly as before', async () => {
    const { actions } = boundActions([onReport(ELSEWHERE, 'report-9')], 'report-9');
    const d = await decideIntroductoryAccess(actions, { tier: 'free', userId: USER, bloodDrawId: BOUND });
    expect(d).toMatchObject({ granted: true, reason: 'existing_claim', consumesCredit: false });
  });

  it.each([undefined, 'always', 'on_demand'])('a mismatch never generates deeply (post-limit %s); exhaustion still follows it', async postLimitGeneration => {
    const mismatch = await decide(boundActions([onReport(ELSEWHERE, 'report-9')], 'report-9').actions);
    expect(decideDeepGeneration({ freemiumActive: true, tier: 'free', decision: mismatch, postLimitGeneration })).toBe(false);
    const exhausted = await decide(boundActions([claim('x'.repeat(64)), claim('y'.repeat(64)), claim('z'.repeat(64))],
      'report-9').actions);
    expect(exhausted.reason).toBe('introductory_access_exhausted');
    expect(decideDeepGeneration({ freemiumActive: true, tier: 'free', decision: exhausted, postLimitGeneration }))
      .toBe(postLimitGeneration !== 'on_demand');
  });

  it('a mismatch commits nothing and is persisted as Free', async () => {
    const { actions, rows, calls } = boundActions([onReport(ELSEWHERE, 'report-9')], 'report-9');
    const decision = await decide(actions);
    expect(await commitDeepAccess(actions, decision, GENERATED, REQUEST))
      .toEqual({ committed: false, reason: 'introductory_access_exhausted' });
    expect(await commitGeneratedInterpretation(actions, { freemiumActive: true, tier: 'free', decision,
      completion: GENERATED, request: REQUEST })).toEqual({ committed: false, tier: 'free' });
    expect(calls.commit).toBe(0);
    expect(rows).toHaveLength(1);
  });
});
