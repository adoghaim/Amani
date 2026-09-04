import { describe, expect, it } from 'vitest';
import {
  SOLD_IAP_PRODUCT_IDS,
  resolveEntitlement,
  toBetaTester,
  TRIAL_DURATION_MS,
  type BetaTester,
  type IapRecord,
} from './entitlement';

const NOW = Date.parse('2026-08-21T00:00:00Z');
const base = { stripeStatus: null, iapRecords: [], trialStartDate: null, now: NOW };
const future = new Date(NOW + 86_400_000).toISOString();
const past = new Date(NOW - 86_400_000).toISOString();

const TESTER_ID = '11111111-1111-4111-8111-111111111111';
const MONTHLY = 'com.amani.health.premium.monthly';
const YEARLY = 'com.amani.health.premium.yearly';

describe('resolveEntitlement — Stripe', () => {
  it.each(['active', 'trialing', 'past_due'])('entitles on %s', (status) => {
    expect(resolveEntitlement({ ...base, stripeStatus: status })).toEqual({
      allowed: true,
      reason: 'active_subscription',
    });
  });

  it('does not entitle on canceled', () => {
    const r = resolveEntitlement({ ...base, stripeStatus: 'canceled' });
    expect(r.allowed).toBe(false);
  });
});

describe('resolveEntitlement — IAP', () => {
  it.each(['active', 'in_grace_period', 'billing_retry'])('entitles on %s', (status) => {
    expect(
      resolveEntitlement({ ...base, iapRecords: [{ status, expires_at: future }] })
    ).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it('does not entitle when expired in the past', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'active', expires_at: past }],
    });
    expect(r.allowed).toBe(false);
  });

  it('does not entitle on revoked even if the expiry is still future', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'revoked', expires_at: future }],
    });
    expect(r.allowed).toBe(false);
  });

  it('trusts status when the store gave no expiry', () => {
    expect(
      resolveEntitlement({ ...base, iapRecords: [{ status: 'active', expires_at: null }] })
    ).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it('fails closed on an unparseable expiry rather than entitling', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'active', expires_at: 'not-a-date' }],
    });
    expect(r.allowed).toBe(false);
  });

  it('ignores sandbox purchases in production', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'active', expires_at: future, environment: 'sandbox' }],
    });
    expect(r.allowed).toBe(false);
  });

  it('entitles if any one of several records is live', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [
        { status: 'expired', expires_at: past },
        { status: 'active', expires_at: future },
      ],
    });
    expect(r).toEqual({ allowed: true, reason: 'active_iap' });
  });
});

describe('resolveEntitlement — trial', () => {
  it('entitles inside the 7-day window', () => {
    expect(
      resolveEntitlement({ ...base, trialStartDate: new Date(NOW - 1000).toISOString() })
    ).toEqual({ allowed: true, reason: 'trial' });
  });

  it('expires exactly at the boundary', () => {
    const r = resolveEntitlement({
      ...base,
      trialStartDate: new Date(NOW - TRIAL_DURATION_MS).toISOString(),
    });
    expect(r).toEqual({ allowed: false, reason: 'trial_expired' });
  });

  it('reports onboarding_incomplete when the trial never started', () => {
    expect(resolveEntitlement(base)).toEqual({
      allowed: false,
      reason: 'onboarding_incomplete',
    });
  });
});

describe('resolveEntitlement — precedence and routing', () => {
  it('prefers a paid subscription over an active trial', () => {
    const r = resolveEntitlement({
      ...base,
      stripeStatus: 'active',
      trialStartDate: new Date(NOW - 1000).toISOString(),
    });
    expect(r).toEqual({ allowed: true, reason: 'active_subscription' });
  });

  it('sends a lapsed IAP customer to billing, not pricing', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'expired', expires_at: past }],
      trialStartDate: new Date(NOW - TRIAL_DURATION_MS - 1).toISOString(),
    });
    expect(r).toEqual({ allowed: false, reason: 'no_subscription' });
  });

  it('sends a never-paid user to pricing', () => {
    const r = resolveEntitlement({
      ...base,
      trialStartDate: new Date(NOW - TRIAL_DURATION_MS - 1).toISOString(),
    });
    expect(r).toEqual({ allowed: false, reason: 'trial_expired' });
  });
});

/**
 * The sandbox beta allowlist, which replaced the global `ALLOW_SANDBOX_IAP`
 * env boolean.
 *
 * The old flag was one switch for the whole project: off, no TestFlight or Play
 * internal-test purchase could exercise a paid screen; on, EVERY sandbox
 * receipt entitled EVERY user holding one. Sandbox receipts are free to mint,
 * so that flag set in production would have given the product away.
 *
 * The rule these tests pin, in full — a sandbox receipt entitles if and only if
 * ALL of:
 *
 *   1. the receipt's environment is `sandbox`, from the server-verified
 *      `iap_subscriptions.environment` column (never a client-supplied field)
 *   2. the user is on the allowlist
 *   3. the row is enabled
 *   4. the row has not expired (NULL = no expiry)
 *   5. the row's platform covers the receipt's storefront
 *   6. the product is one Amani actually sells
 *
 * Each of those is a separate test below, and each fails closed.
 */
describe('resolveEntitlement — sandbox beta allowlist', () => {
  function sandboxReceipt(over: Partial<IapRecord> = {}): IapRecord {
    return {
      status: 'active',
      expires_at: future,
      environment: 'sandbox',
      platform: 'ios',
      product_id: MONTHLY,
      ...over,
    };
  }

  function tester(over: Partial<BetaTester> = {}): BetaTester {
    return {
      user_id: TESTER_ID,
      platform: 'both',
      expires_at: null,
      enabled: true,
      ...over,
    };
  }

  function decide(records: readonly IapRecord[], betaTester: BetaTester | null) {
    return resolveEntitlement({ ...base, iapRecords: records, userId: TESTER_ID, betaTester });
  }

  const ENTITLED = { allowed: true, reason: 'active_iap' } as const;

  // ── The cases the rule names ────────────────────────────────────────────

  it('entitles an allowlisted Apple sandbox purchase', () => {
    expect(decide([sandboxReceipt({ platform: 'ios' })], tester({ platform: 'apple' }))).toEqual(
      ENTITLED,
    );
  });

  it('entitles an allowlisted Google test purchase', () => {
    expect(
      decide(
        [sandboxReceipt({ platform: 'android', product_id: YEARLY })],
        tester({ platform: 'google' }),
      ),
    ).toEqual(ENTITLED);
  });

  it('does not entitle a sandbox receipt from a user who is not on the allowlist', () => {
    expect(decide([sandboxReceipt()], null).allowed).toBe(false);
  });

  it('does not entitle an expired beta tester', () => {
    expect(decide([sandboxReceipt()], tester({ expires_at: past })).allowed).toBe(false);
  });

  it('does not entitle a disabled beta tester', () => {
    expect(decide([sandboxReceipt()], tester({ enabled: false })).allowed).toBe(false);
  });

  it('does not entitle an apple-only tester holding a Google receipt', () => {
    expect(
      decide([sandboxReceipt({ platform: 'android' })], tester({ platform: 'apple' })).allowed,
    ).toBe(false);
  });

  it('does not entitle a google-only tester holding an Apple receipt', () => {
    expect(
      decide([sandboxReceipt({ platform: 'ios' })], tester({ platform: 'google' })).allowed,
    ).toBe(false);
  });

  it.each([
    ['a product we do not sell', 'com.amani.health.premium.lifetime'],
    ['an empty product id', ''],
    ['a near-miss on the real id', 'com.amani.health.premium.monthly '],
  ])('does not entitle a sandbox receipt for %s', (_label, productId) => {
    expect(decide([sandboxReceipt({ product_id: productId })], tester()).allowed).toBe(false);
  });

  // ── Boundaries and fail-closed shapes ───────────────────────────────────

  it("treats 'both' as covering either storefront", () => {
    expect(decide([sandboxReceipt({ platform: 'ios' })], tester())).toEqual(ENTITLED);
    expect(decide([sandboxReceipt({ platform: 'android' })], tester())).toEqual(ENTITLED);
  });

  it('treats a NULL expiry as no expiry', () => {
    expect(decide([sandboxReceipt()], tester({ expires_at: null }))).toEqual(ENTITLED);
  });

  it('expires exactly at the boundary rather than one instant later', () => {
    const atNow = new Date(NOW).toISOString();
    expect(decide([sandboxReceipt()], tester({ expires_at: atNow })).allowed).toBe(false);
    expect(
      decide([sandboxReceipt()], tester({ expires_at: new Date(NOW + 1).toISOString() })),
    ).toEqual(ENTITLED);
  });

  it('fails closed on an unparseable allowlist expiry', () => {
    expect(decide([sandboxReceipt()], tester({ expires_at: 'not-a-date' })).allowed).toBe(false);
  });

  it("refuses an allowlist row belonging to a different user", () => {
    expect(
      decide([sandboxReceipt()], tester({ user_id: '22222222-2222-4222-8222-222222222222' }))
        .allowed,
    ).toBe(false);
  });

  it('refuses to entitle when no user id was supplied to check the row against', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [sandboxReceipt()],
      betaTester: tester(),
    });
    expect(r.allowed).toBe(false);
  });

  it.each(['ipados', 'web', '', null, undefined])(
    'refuses a receipt whose platform is %s',
    (platform) => {
      expect(
        decide([sandboxReceipt({ platform: platform as string | null })], tester()).allowed,
      ).toBe(false);
    },
  );

  it.each(['ios', 'android', 'BOTH', '', null, undefined])(
    'refuses an allowlist row whose platform is %s',
    (platform) => {
      expect(
        decide([sandboxReceipt()], tester({ platform: platform as unknown as string })).allowed,
      ).toBe(false);
    },
  );

  it('refuses a sandbox receipt missing platform and product_id entirely', () => {
    const bare: IapRecord = { status: 'active', expires_at: future, environment: 'sandbox' };
    expect(decide([bare], tester()).allowed).toBe(false);
  });

  it('still applies the ordinary IAP status and expiry rules to an allowlisted tester', () => {
    // The allowlist is an extra gate, never a bypass of the existing ones.
    expect(decide([sandboxReceipt({ status: 'revoked' })], tester()).allowed).toBe(false);
    expect(decide([sandboxReceipt({ status: 'expired' })], tester()).allowed).toBe(false);
    expect(decide([sandboxReceipt({ expires_at: past })], tester()).allowed).toBe(false);
    expect(decide([sandboxReceipt({ expires_at: 'garbage' })], tester()).allowed).toBe(false);
    expect(decide([sandboxReceipt({ status: 'in_grace_period' })], tester())).toEqual(ENTITLED);
  });

  it('entitles on the one permitted sandbox row among several refused ones', () => {
    const records = [
      sandboxReceipt({ status: 'expired', expires_at: past }),
      sandboxReceipt({ product_id: 'com.amani.health.premium.lifetime' }),
      sandboxReceipt({ product_id: YEARLY }),
    ];
    expect(decide(records, tester())).toEqual(ENTITLED);
  });
});

/**
 * The other half of the rule: the allowlist must be INERT for production
 * receipts. A beta pass is not allowed to buy access, and revoking one is not
 * allowed to take away access somebody paid Apple or Google for.
 */
describe('resolveEntitlement — production receipts ignore the allowlist', () => {
  const productionReceipt: IapRecord = {
    status: 'active',
    expires_at: future,
    environment: 'production',
    platform: 'ios',
    product_id: MONTHLY,
  };

  const allowlistStates: Array<[string, BetaTester | null]> = [
    ['no row', null],
    ['an enabled row', { user_id: TESTER_ID, platform: 'both', expires_at: null, enabled: true }],
    ['a disabled row', { user_id: TESTER_ID, platform: 'both', expires_at: null, enabled: false }],
    ['an expired row', { user_id: TESTER_ID, platform: 'both', expires_at: past, enabled: true }],
    [
      'a mismatched-platform row',
      { user_id: TESTER_ID, platform: 'google', expires_at: null, enabled: true },
    ],
    [
      "somebody else's row",
      {
        user_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        platform: 'both',
        expires_at: null,
        enabled: true,
      },
    ],
  ];

  it.each(allowlistStates)('entitles a live production receipt with %s', (_label, betaTester) => {
    expect(
      resolveEntitlement({
        ...base,
        iapRecords: [productionReceipt],
        userId: TESTER_ID,
        betaTester,
      }),
    ).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it.each(allowlistStates)(
    'refuses a lapsed production receipt with %s — the allowlist cannot buy access',
    (_label, betaTester) => {
      expect(
        resolveEntitlement({
          ...base,
          iapRecords: [{ ...productionReceipt, status: 'expired', expires_at: past }],
          trialStartDate: new Date(NOW - TRIAL_DURATION_MS - 1).toISOString(),
          userId: TESTER_ID,
          betaTester,
        }),
      ).toEqual({ allowed: false, reason: 'no_subscription' });
    },
  );

  it('entitles a production receipt for a product not in the sold catalog', () => {
    /*
      The product check is a sandbox-only rule on purpose. A production receipt
      for an id we no longer list is still a real purchase somebody was really
      charged for — most likely a legacy or renamed product — and refusing it
      would take away access they paid for.
    */
    expect(
      resolveEntitlement({
        ...base,
        iapRecords: [{ ...productionReceipt, product_id: 'com.amani.health.legacy.monthly' }],
        userId: TESTER_ID,
        betaTester: null,
      }),
    ).toEqual({ allowed: true, reason: 'active_iap' });
  });
});

describe('toBetaTester', () => {
  it('reads a well-formed row', () => {
    expect(
      toBetaTester({
        user_id: TESTER_ID,
        platform: 'apple',
        expires_at: future,
        enabled: true,
      }),
    ).toEqual({ user_id: TESTER_ID, platform: 'apple', expires_at: future, enabled: true });
  });

  it('keeps a NULL expiry as null', () => {
    expect(
      toBetaTester({ user_id: TESTER_ID, platform: 'both', expires_at: null, enabled: true }),
    ).toEqual({ user_id: TESTER_ID, platform: 'both', expires_at: null, enabled: true });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'apple'],
    ['a row with no user_id', { platform: 'apple', expires_at: null, enabled: true }],
    [
      'a row with an empty user_id',
      { user_id: '', platform: 'apple', expires_at: null, enabled: true },
    ],
    [
      'a row with an unknown platform',
      { user_id: TESTER_ID, platform: 'ios', expires_at: null, enabled: true },
    ],
    [
      'a row with a numeric expiry',
      { user_id: TESTER_ID, platform: 'apple', expires_at: 1, enabled: true },
    ],
  ])('returns null for %s', (_label, row) => {
    expect(toBetaTester(row)).toBeNull();
  });

  it('treats a non-boolean `enabled` as not enabled', () => {
    // Postgres cannot produce this — the column is `boolean NOT NULL` — which is
    // exactly why an unexpected value must deny rather than be coerced to true.
    expect(
      toBetaTester({ user_id: TESTER_ID, platform: 'both', expires_at: null, enabled: 'yes' }),
    ).toEqual({ user_id: TESTER_ID, platform: 'both', expires_at: null, enabled: false });
  });
});

describe('SOLD_IAP_PRODUCT_IDS', () => {
  it('lists both store products and nothing else', () => {
    expect([...SOLD_IAP_PRODUCT_IDS].sort()).toEqual([MONTHLY, YEARLY].sort());
  });
});
