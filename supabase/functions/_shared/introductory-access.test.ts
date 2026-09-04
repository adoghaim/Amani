import { describe, expect, it } from 'vitest';
import {
  commitDeepAccess,
  decideIntroductoryAccess,
  type ClaimRecord,
  type CommitDeepAccessInput,
  type CommitRequest,
  type DeepAccessCompletion,
  type IntroductoryAccessActions,
} from './introductory-access';

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
        if (rows.filter((r) => r.user_id === input.userId).length >= 2) {
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
      granted: true, reason: 'credit_available', claimsUsed: 0, claimsRemaining: 2,
      consumesCredit: true,
    });
  });

  it('grants a second draw', async () => {
    const { actions } = fakeActions([claim(OTHER_DRAW)]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({ granted: true, reason: 'credit_available', claimsRemaining: 1 });
  });

  it('denies a third distinct draw', async () => {
    const { actions } = fakeActions([claim(OTHER_DRAW), claim('c'.repeat(64))]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(d).toEqual({
      granted: false,
      reason: 'introductory_access_exhausted',
      claimsUsed: 2,
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
    const { actions, rows, calls } = fakeActions([claim('x'.repeat(64)), claim('y'.repeat(64))]);
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(decision.granted).toBe(false);
    const outcome = await commitDeepAccess(actions, decision, GENERATED, REQUEST);
    expect(outcome).toEqual({ committed: false, reason: 'introductory_access_exhausted' });
    expect(rows).toHaveLength(2);
    expect(calls.commit).toBe(0);
  });

  it('fails closed when the request loses the race for the last credit', async () => {
    /*
      Two uploads of two different draws both read count = 1 and both believe
      they hold the last credit. The database settles it. The loser must be
      served the Free result, NOT the premium one it thought it had earned.
    */
    const { actions, stored } = fakeActions([claim('x'.repeat(64)), claim('y'.repeat(64))]);
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
