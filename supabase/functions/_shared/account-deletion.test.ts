import { describe, it, expect, vi } from 'vitest';
import {
  deleteUserAccount,
  selectBillingStoreSubscriptions,
  StoreSubscriptionAcknowledgementRequiredError,
  type AccountDeletionActions,
  type StoreSubscriptionRecord,
} from './account-deletion.ts';

const storeRecord = (
  overrides: Partial<StoreSubscriptionRecord> = {},
): StoreSubscriptionRecord => ({
  platform: 'ios',
  product_id: 'com.amani.health.premium.monthly',
  status: 'active',
  expires_at: '2026-09-23T00:00:00.000Z',
  environment: 'production',
  ...overrides,
});

function makeActions(overrides: Partial<AccountDeletionActions> = {}): {
  actions: AccountDeletionActions;
  calls: string[];
} {
  const calls: string[] = [];
  const track = (name: string) => async (..._args: unknown[]) => {
    calls.push(name);
  };

  const actions: AccountDeletionActions = {
    listStoreSubscriptions: vi.fn(async (_userId: string) => {
      calls.push('listStoreSubscriptions');
      return [] as StoreSubscriptionRecord[];
    }),
    getStripeCustomerId: vi.fn(async (_userId: string) => {
      calls.push('getStripeCustomerId');
      return 'cus_test_123';
    }),
    cancelStripeSubscriptions: vi.fn(track('cancelStripeSubscriptions')),
    deleteStripeCustomer: vi.fn(track('deleteStripeCustomer')),
    deleteLocalStripeRecords: vi.fn(track('deleteLocalStripeRecords')),
    deleteStorageFiles: vi.fn(track('deleteStorageFiles')),
    deleteDataTables: vi.fn(track('deleteDataTables')),
    deleteAuthUser: vi.fn(track('deleteAuthUser')),
    ...overrides,
  };

  return { actions, calls };
}

describe('deleteUserAccount', () => {
  it('runs every step in order when the user has a Stripe customer', async () => {
    const { actions, calls } = makeActions();

    await deleteUserAccount(actions, 'user-1');

    expect(calls).toEqual([
      'listStoreSubscriptions',
      'getStripeCustomerId',
      'cancelStripeSubscriptions',
      'deleteStripeCustomer',
      'deleteLocalStripeRecords',
      'deleteStorageFiles',
      'deleteDataTables',
      'deleteAuthUser',
    ]);
  });

  it('skips Stripe steps when the user has no Stripe customer_id', async () => {
    const { actions, calls } = makeActions({
      getStripeCustomerId: vi.fn(async () => {
        calls.push('getStripeCustomerId');
        return null;
      }),
    });

    await deleteUserAccount(actions, 'user-2');

    expect(calls).toEqual([
      'listStoreSubscriptions',
      'getStripeCustomerId',
      'deleteStorageFiles',
      'deleteDataTables',
      'deleteAuthUser',
    ]);
    expect(actions.cancelStripeSubscriptions).not.toHaveBeenCalled();
    expect(actions.deleteStripeCustomer).not.toHaveBeenCalled();
    expect(actions.deleteLocalStripeRecords).not.toHaveBeenCalled();
  });

  it('aborts and does NOT delete auth if Stripe cancellation fails', async () => {
    const cancelError = new Error('stripe api down');
    const { actions } = makeActions({
      cancelStripeSubscriptions: vi.fn(async () => {
        throw cancelError;
      }),
    });

    await expect(deleteUserAccount(actions, 'user-3')).rejects.toThrow('stripe api down');
    expect(actions.deleteStripeCustomer).not.toHaveBeenCalled();
    expect(actions.deleteStorageFiles).not.toHaveBeenCalled();
    expect(actions.deleteDataTables).not.toHaveBeenCalled();
    expect(actions.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('aborts and does NOT delete auth if data-table deletion fails', async () => {
    const dbError = new Error('rls policy blocked');
    const { actions } = makeActions({
      deleteDataTables: vi.fn(async () => {
        throw dbError;
      }),
    });

    await expect(deleteUserAccount(actions, 'user-4')).rejects.toThrow('rls policy blocked');
    expect(actions.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('surfaces auth deletion failure so the client cannot lie about success', async () => {
    const authError = new Error('admin api unreachable');
    const { actions } = makeActions({
      deleteAuthUser: vi.fn(async () => {
        throw authError;
      }),
    });

    await expect(deleteUserAccount(actions, 'user-5')).rejects.toThrow('admin api unreachable');
  });

  it('runs cleanly on retry after a partial deletion (idempotent)', async () => {
    // Simulate the "everything except auth already ran successfully" retry case:
    // customer_id is now null (local Stripe records already deleted), storage +
    // tables have no rows (deletes no-op), auth finally succeeds this time.
    const { actions, calls } = makeActions({
      getStripeCustomerId: vi.fn(async () => {
        calls.push('getStripeCustomerId');
        return null;
      }),
    });

    await deleteUserAccount(actions, 'user-6');

    expect(calls).toEqual([
      'listStoreSubscriptions',
      'getStripeCustomerId',
      'deleteStorageFiles',
      'deleteDataTables',
      'deleteAuthUser',
    ]);
    expect(actions.deleteAuthUser).toHaveBeenCalledOnce();
  });
});

describe('deleteUserAccount — live store subscriptions', () => {
  const withStoreSubs = (records: StoreSubscriptionRecord[]) =>
    makeActions({
      listStoreSubscriptions: vi.fn(async () => {
        return records;
      }),
    });

  it('refuses to delete while an unacknowledged store subscription is live', async () => {
    const { actions } = withStoreSubs([storeRecord()]);

    await expect(deleteUserAccount(actions, 'user-7')).rejects.toBeInstanceOf(
      StoreSubscriptionAcknowledgementRequiredError,
    );
  });

  it('deletes NOTHING when it refuses — not even the Stripe lookup', async () => {
    const { actions } = withStoreSubs([storeRecord()]);

    await expect(deleteUserAccount(actions, 'user-8')).rejects.toBeInstanceOf(
      StoreSubscriptionAcknowledgementRequiredError,
    );

    expect(actions.getStripeCustomerId).not.toHaveBeenCalled();
    expect(actions.cancelStripeSubscriptions).not.toHaveBeenCalled();
    expect(actions.deleteStorageFiles).not.toHaveBeenCalled();
    expect(actions.deleteDataTables).not.toHaveBeenCalled();
    expect(actions.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('carries the subscription list on the error so the client can name the store', async () => {
    const { actions } = withStoreSubs([
      storeRecord({ platform: 'android', product_id: 'com.amani.health.premium.yearly' }),
    ]);

    const error = await deleteUserAccount(actions, 'user-9').catch((e) => e);

    expect(error).toBeInstanceOf(StoreSubscriptionAcknowledgementRequiredError);
    expect(error.code).toBe('store_subscription_acknowledgement_required');
    expect(error.subscriptions).toEqual([
      {
        platform: 'android',
        productId: 'com.amani.health.premium.yearly',
        expiresAt: '2026-09-23T00:00:00.000Z',
      },
    ]);
  });

  it('names Apple in the message for an App Store subscription', async () => {
    const { actions } = withStoreSubs([storeRecord({ platform: 'ios' })]);
    const error = await deleteUserAccount(actions, 'user-10').catch((e) => e);
    expect(error.message).toContain('Apple');
    expect(error.message).toContain('does not cancel it');
  });

  it('names Google in the message for a Play subscription', async () => {
    const { actions } = withStoreSubs([storeRecord({ platform: 'android' })]);
    const error = await deleteUserAccount(actions, 'user-11').catch((e) => e);
    expect(error.message).toContain('Google');
  });

  it('proceeds once the user has acknowledged', async () => {
    const { actions, calls } = withStoreSubs([storeRecord()]);

    await deleteUserAccount(actions, 'user-12', { acknowledgedStoreSubscriptions: true });

    expect(calls).toContain('deleteAuthUser');
    expect(actions.deleteAuthUser).toHaveBeenCalledOnce();
  });

  it('does not require acknowledgement when nothing is still billing', async () => {
    const { actions } = withStoreSubs([storeRecord({ status: 'expired' })]);

    await expect(deleteUserAccount(actions, 'user-13')).resolves.toBeUndefined();
    expect(actions.deleteAuthUser).toHaveBeenCalledOnce();
  });

  it('aborts when the subscription read fails rather than assuming none exist', async () => {
    // Fail-closed: treating a read error as "no subscriptions" would delete the
    // account of someone Apple is still charging — the exact case this guards.
    const { actions } = makeActions({
      listStoreSubscriptions: vi.fn(async () => {
        throw new Error('iap read failed');
      }),
    });

    await expect(deleteUserAccount(actions, 'user-14')).rejects.toThrow('iap read failed');
    expect(actions.deleteAuthUser).not.toHaveBeenCalled();
  });
});

describe('selectBillingStoreSubscriptions', () => {
  it.each(['active', 'in_grace_period', 'billing_retry'])(
    'treats %s as still billing',
    (status) => {
      expect(selectBillingStoreSubscriptions([storeRecord({ status })])).toHaveLength(1);
    },
  );

  it('treats paused as still billing — Google resumes and charges again on its own', () => {
    // The one place this diverges from the entitlement status set in
    // entitlement.ts: no access, but a future charge.
    expect(selectBillingStoreSubscriptions([storeRecord({ status: 'paused' })])).toHaveLength(1);
  });

  it.each(['expired', 'revoked'])('treats %s as no longer billing', (status) => {
    expect(selectBillingStoreSubscriptions([storeRecord({ status })])).toHaveLength(0);
  });

  it('ignores sandbox rows, which never charge real money', () => {
    expect(
      selectBillingStoreSubscriptions([storeRecord({ environment: 'sandbox' })]),
    ).toHaveLength(0);
  });

  it('ignores a row whose platform is neither storefront', () => {
    expect(selectBillingStoreSubscriptions([storeRecord({ platform: 'web' })])).toHaveLength(0);
  });

  it('returns every billing subscription when a user holds more than one', () => {
    const result = selectBillingStoreSubscriptions([
      storeRecord({ platform: 'ios', status: 'active' }),
      storeRecord({ platform: 'android', status: 'in_grace_period' }),
      storeRecord({ platform: 'ios', status: 'expired' }),
    ]);
    expect(result.map((r) => r.platform)).toEqual(['ios', 'android']);
  });

  it('handles an empty list', () => {
    expect(selectBillingStoreSubscriptions([])).toEqual([]);
  });
});
