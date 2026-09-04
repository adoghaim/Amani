import { describe, expect, it } from 'vitest';
import {
  decideIntroductoryAccess,
  recordIntroductoryClaim,
  type ClaimRecord,
  type DeepAccessCompletion,
  type IntroductoryAccessActions,
  type RecordClaimInput,
} from './introductory-access';

/**
 * The ledger exists to make the wrong outcomes impossible rather than unlikely:
 * a retry must not double-charge, a regeneration must not charge at all, and a
 * failed generation must not charge either. Each of those is a test here.
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

/** In-memory stand-in for the table, unique constraint and limit included. */
function fakeActions(seed: ClaimRecord[] = []) {
  const rows = [...seed];
  const calls = { insert: 0, find: 0, count: 0 };

  const actions: IntroductoryAccessActions = {
    async findClaim(userId, bloodDrawId) {
      calls.find++;
      return rows.find((r) => r.user_id === userId && r.blood_draw_id === bloodDrawId) ?? null;
    },
    async countClaims(userId) {
      calls.count++;
      return rows.filter((r) => r.user_id === userId).length;
    },
    async insertClaim(input) {
      calls.insert++;
      const exists = rows.some(
        (r) => r.user_id === input.userId && r.blood_draw_id === input.bloodDrawId,
      );
      if (exists) return 'already_claimed';
      // The database trigger, not the application, is the real limit.
      if (rows.filter((r) => r.user_id === input.userId).length >= 2) return 'limit_reached';
      rows.push({
        user_id: input.userId,
        blood_draw_id: input.bloodDrawId,
        report_id: input.reportId,
        evidence_tier: input.evidenceTier,
        claimed_at: '2026-09-03T00:00:00Z',
      });
      return 'inserted';
    },
  };

  return { actions, rows, calls };
}

const COMPLETED: DeepAccessCompletion = {
  parseConfident: true,
  interpretationGenerated: true,
  interpretationPersisted: true,
};

const CLAIM_INPUT: RecordClaimInput = {
  userId: USER,
  bloodDrawId: DRAW,
  reportId: 'report-9',
  evidenceTier: 'accession',
};

describe('decideIntroductoryAccess', () => {
  it('never meters a Plus subscriber', async () => {
    const { actions, calls } = fakeActions();
    const d = await decideIntroductoryAccess(actions, {
      tier: 'plus',
      userId: USER,
      bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({ granted: true, reason: 'plus', consumesCredit: false });
    // A subscriber must not cost a database round trip to establish.
    expect(calls.find).toBe(0);
    expect(calls.count).toBe(0);
  });

  it('grants a first draw and marks it as consuming a credit', async () => {
    const { actions } = fakeActions();
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free',
      userId: USER,
      bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({
      granted: true,
      reason: 'credit_available',
      claimsUsed: 0,
      claimsRemaining: 2,
      consumesCredit: true,
    });
  });

  it('grants a second draw', async () => {
    const { actions } = fakeActions([claim(OTHER_DRAW)]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free',
      userId: USER,
      bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({ granted: true, reason: 'credit_available', claimsRemaining: 1 });
  });

  it('denies a third distinct draw', async () => {
    const { actions } = fakeActions([claim(OTHER_DRAW), claim('c'.repeat(64))]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free',
      userId: USER,
      bloodDrawId: DRAW,
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
    // Regeneration, re-upload of the same draw, and the same-day collision the
    // date-only evidence tier can produce all land here.
    const { actions } = fakeActions([claim(DRAW), claim(OTHER_DRAW)]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free',
      userId: USER,
      bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({
      granted: true,
      reason: 'existing_claim',
      claimsUsed: 2,
      consumesCredit: false,
    });
  });

  it('never reports negative remaining credits', async () => {
    const { actions } = fakeActions([claim('x'.repeat(64)), claim('y'.repeat(64)), claim(DRAW)]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free',
      userId: USER,
      bloodDrawId: DRAW,
    });
    expect(d.claimsRemaining).toBe(0);
  });

  it('scopes claims to the user', async () => {
    const other: ClaimRecord = { ...claim(DRAW), user_id: 'user-2' };
    const { actions } = fakeActions([other, { ...claim(OTHER_DRAW), user_id: 'user-2' }]);
    const d = await decideIntroductoryAccess(actions, {
      tier: 'free',
      userId: USER,
      bloodDrawId: DRAW,
    });
    expect(d).toMatchObject({ granted: true, reason: 'credit_available', claimsUsed: 0 });
  });
});

describe('recordIntroductoryClaim — a credit is only spent on delivered work', () => {
  it('writes the claim once the interpretation is persisted', async () => {
    const { actions, rows } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free',
      userId: USER,
      bloodDrawId: DRAW,
    });
    const outcome = await recordIntroductoryClaim(actions, decision, COMPLETED, CLAIM_INPUT);
    expect(outcome).toBe('claimed');
    expect(rows).toHaveLength(1);
  });

  it('does not charge when the parse was not confident', async () => {
    const { actions, rows } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    const outcome = await recordIntroductoryClaim(
      actions, decision, { ...COMPLETED, parseConfident: false }, CLAIM_INPUT,
    );
    expect(outcome).toBe('not_completed');
    expect(rows).toHaveLength(0);
  });

  it('does not charge when the model failed', async () => {
    const { actions, rows } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    const outcome = await recordIntroductoryClaim(
      actions, decision, { ...COMPLETED, interpretationGenerated: false }, CLAIM_INPUT,
    );
    expect(outcome).toBe('not_completed');
    expect(rows).toHaveLength(0);
  });

  it('does not charge when the write never landed', async () => {
    const { actions, rows } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    const outcome = await recordIntroductoryClaim(
      actions, decision, { ...COMPLETED, interpretationPersisted: false }, CLAIM_INPUT,
    );
    expect(outcome).toBe('not_completed');
    expect(rows).toHaveLength(0);
  });

  it('never charges a Plus subscriber', async () => {
    const { actions, rows } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'plus', userId: USER, bloodDrawId: DRAW,
    });
    expect(await recordIntroductoryClaim(actions, decision, COMPLETED, CLAIM_INPUT))
      .toBe('not_consumable');
    expect(rows).toHaveLength(0);
  });

  it('never charges again for a draw that was already claimed', async () => {
    const { actions, rows } = fakeActions([claim(DRAW)]);
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(await recordIntroductoryClaim(actions, decision, COMPLETED, CLAIM_INPUT))
      .toBe('not_consumable');
    expect(rows).toHaveLength(1);
  });

  it('never charges when access was denied', async () => {
    const { actions, rows } = fakeActions([claim('x'.repeat(64)), claim('y'.repeat(64))]);
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(decision.granted).toBe(false);
    expect(await recordIntroductoryClaim(actions, decision, COMPLETED, CLAIM_INPUT))
      .toBe('not_consumable');
    expect(rows).toHaveLength(2);
  });

  it('is idempotent when the same success is recorded twice', async () => {
    // The retry case: the client resends, the interpretation is regenerated,
    // and the claim insert hits the unique constraint instead of a second row.
    const { actions, rows } = fakeActions();
    const decision = await decideIntroductoryAccess(actions, {
      tier: 'free', userId: USER, bloodDrawId: DRAW,
    });
    expect(await recordIntroductoryClaim(actions, decision, COMPLETED, CLAIM_INPUT)).toBe('claimed');
    expect(await recordIntroductoryClaim(actions, decision, COMPLETED, CLAIM_INPUT))
      .toBe('already_claimed');
    expect(rows).toHaveLength(1);
  });

  it('reports the database refusing a third row without throwing', async () => {
    /*
      The concurrency case the application cannot see: two uploads of two
      different draws both read count = 1 and both believe they hold the last
      credit. The trigger settles it, and losing the race must not 500 a report
      the user already received.
    */
    const { actions } = fakeActions([claim('x'.repeat(64)), claim('y'.repeat(64))]);
    const staleDecision = {
      granted: true as const,
      reason: 'credit_available' as const,
      claimsUsed: 1,
      claimsRemaining: 1,
      consumesCredit: true,
    };
    expect(await recordIntroductoryClaim(actions, staleDecision, COMPLETED, CLAIM_INPUT))
      .toBe('limit_reached');
  });
});
