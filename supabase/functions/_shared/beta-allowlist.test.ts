import { describe, expect, it, vi } from 'vitest';
import {
  hasSandboxIapRecord,
  loadBetaTester,
  type BetaAllowlistActions,
} from './beta-allowlist';
import { resolveEntitlement, type IapRecord } from './entitlement';

/**
 * The read half of the sandbox beta allowlist: when the table is consulted, and
 * what happens when the read fails.
 *
 * The decision itself lives in `entitlement.ts` and is tested there. What
 * matters here is the pair of properties the I/O layer is responsible for:
 *
 *   1. a user with no sandbox receipt never touches `iap_beta_testers` at all,
 *      so nothing about the allowlist can change what a paying customer gets;
 *   2. a failed read denies the sandbox exception and nothing else — it must
 *      not deny a real purchase, and it must not be silent.
 *
 * The port is driven with fakes, the same way `account-deletion.test.ts` and
 * `iap-verification.test.ts` drive theirs, so there is no Deno or Supabase in
 * the loop.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const MONTHLY = 'com.amani.health.premium.monthly';
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

const sandboxRow: IapRecord = {
  status: 'active',
  expires_at: FUTURE,
  environment: 'sandbox',
  platform: 'ios',
  product_id: MONTHLY,
};

const productionRow: IapRecord = { ...sandboxRow, environment: 'production' };

const validRow = {
  user_id: USER,
  platform: 'both',
  expires_at: null,
  enabled: true,
};

/** A port that returns a fixed row and counts how often it was asked. */
function fakeActions(row: unknown): BetaAllowlistActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async findBetaTesterRow(userId: string) {
      calls.push(userId);
      return row;
    },
  };
}

/** A port that fails the way a real PostgREST error does — by throwing. */
function failingActions(message = 'iap_beta_testers read failed: connection reset') {
  const calls: string[] = [];
  return {
    calls,
    async findBetaTesterRow(userId: string): Promise<unknown> {
      calls.push(userId);
      throw new Error(message);
    },
  };
}

const noop = () => {};

describe('hasSandboxIapRecord', () => {
  it('is false for an empty list', () => {
    expect(hasSandboxIapRecord([])).toBe(false);
  });

  it('is false when every record is a production purchase', () => {
    expect(hasSandboxIapRecord([productionRow, { ...productionRow, status: 'expired' }])).toBe(
      false,
    );
  });

  it('is true when any record is a sandbox purchase', () => {
    expect(hasSandboxIapRecord([productionRow, sandboxRow])).toBe(true);
  });

  it('is false when the environment is missing or unrecognised', () => {
    // `iap_subscriptions.environment` is NOT NULL with a CHECK, so neither can
    // occur from the table. Treating them as "not sandbox" keeps the allowlist
    // out of the picture rather than reading it speculatively.
    expect(hasSandboxIapRecord([{ status: 'active', expires_at: FUTURE }])).toBe(false);
    expect(hasSandboxIapRecord([{ ...sandboxRow, environment: 'SANDBOX' }])).toBe(false);
  });
});

describe('loadBetaTester', () => {
  it('does not read the allowlist at all when there is no sandbox receipt', async () => {
    const actions = fakeActions(validRow);

    await expect(loadBetaTester(actions, USER, [productionRow], noop)).resolves.toBeNull();
    await expect(loadBetaTester(actions, USER, [], noop)).resolves.toBeNull();

    expect(actions.calls).toEqual([]);
  });

  it('reads the row, once, for a user holding a sandbox receipt', async () => {
    const actions = fakeActions(validRow);

    await expect(loadBetaTester(actions, USER, [sandboxRow], noop)).resolves.toEqual({
      user_id: USER,
      platform: 'both',
      expires_at: null,
      enabled: true,
    });

    expect(actions.calls).toEqual([USER]);
  });

  it('asks for the row belonging to the user being evaluated', async () => {
    const actions = fakeActions(validRow);
    await loadBetaTester(actions, USER, [sandboxRow], noop);
    expect(actions.calls).toEqual([USER]);
  });

  it('returns null when the user simply has no row', async () => {
    const actions = fakeActions(null);
    await expect(loadBetaTester(actions, USER, [sandboxRow], noop)).resolves.toBeNull();
  });

  it('returns null for a malformed row rather than trusting it', async () => {
    const actions = fakeActions({ user_id: USER, platform: 'ios', expires_at: null, enabled: true });
    await expect(loadBetaTester(actions, USER, [sandboxRow], noop)).resolves.toBeNull();
  });

  // ── Failing closed ──────────────────────────────────────────────────────

  it('fails closed to null when the read throws', async () => {
    const actions = failingActions();
    await expect(loadBetaTester(actions, USER, [sandboxRow], noop)).resolves.toBeNull();
  });

  it('reports the failure instead of swallowing it', async () => {
    const actions = failingActions('relation "iap_beta_testers" does not exist');
    const onError = vi.fn();

    await loadBetaTester(actions, USER, [sandboxRow], onError);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toContain('iap_beta_testers');
  });

  it('turns a failed read into a denied sandbox receipt, not a denied purchase', async () => {
    /*
      The scope of the fail-closed matters. Denying outright — the way the guard
      treats a failed `iap_subscriptions` read — would mean a hiccup on a table
      that exists purely for beta testers locks out real App Store customers.
      A failed allowlist read may only ever remove the beta exception.
    */
    const actions = failingActions();
    const betaTester = await loadBetaTester(
      actions,
      USER,
      [sandboxRow, productionRow],
      noop,
    );

    expect(betaTester).toBeNull();

    // The sandbox row alone: refused.
    expect(
      resolveEntitlement({
        stripeStatus: null,
        iapRecords: [sandboxRow],
        trialStartDate: null,
        now: Date.now(),
        userId: USER,
        betaTester,
      }).allowed,
    ).toBe(false);

    // The production row alongside it: still entitles.
    expect(
      resolveEntitlement({
        stripeStatus: null,
        iapRecords: [sandboxRow, productionRow],
        trialStartDate: null,
        now: Date.now(),
        userId: USER,
        betaTester,
      }),
    ).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it('does not call the error reporter on a successful read', async () => {
    const onError = vi.fn();
    await loadBetaTester(fakeActions(validRow), USER, [sandboxRow], onError);
    await loadBetaTester(fakeActions(null), USER, [sandboxRow], onError);
    expect(onError).not.toHaveBeenCalled();
  });
});
