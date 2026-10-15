import { describe, it, expect, vi } from 'vitest';
import {
  AccountDeletionNotReadyError,
  checkUserDataTablesReady,
  deleteUserAccount,
  deleteUserDataTables,
  isMissingTableError,
  MissingTableError,
  selectBillingStoreSubscriptions,
  selectPlaySubscriptionsToCancel,
  StoreSubscriptionAcknowledgementRequiredError,
  type AccountDeletionActions,
  type StoreSubscriptionRecord,
  type UserDataTablesPort,
} from './account-deletion.ts';
import { orderedDeletes, type UserDataRegistryEntry } from './user-data-registry.ts';

const storeRecord = (
  overrides: Partial<StoreSubscriptionRecord> = {},
): StoreSubscriptionRecord => ({
  platform: 'ios',
  product_id: 'com.amani.health.premium.monthly',
  store_subscription_id: '2000000000000001',
  status: 'active',
  expires_at: '2026-09-23T00:00:00.000Z',
  environment: 'production',
  ...overrides,
});

// A Play row as RevenueCat reports it: keyed on the Google order id.
const playRecord = (overrides: Partial<StoreSubscriptionRecord> = {}) =>
  storeRecord({
    platform: 'android',
    product_id: 'amani_premium:monthly',
    store_subscription_id: 'GPA.1234-5678-9012-34567',
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
    checkDataTablesReady: vi.fn(track('checkDataTablesReady')),
    listStoreSubscriptions: vi.fn(async (_userId: string) => {
      calls.push('listStoreSubscriptions');
      return [] as StoreSubscriptionRecord[];
    }),
    cancelPlaySubscriptions: vi.fn(track('cancelPlaySubscriptions')),
    getStripeCustomerId: vi.fn(async (_userId: string) => {
      calls.push('getStripeCustomerId');
      return 'cus_test_123';
    }),
    cancelStripeSubscriptions: vi.fn(track('cancelStripeSubscriptions')),
    deleteStripeCustomer: vi.fn(track('deleteStripeCustomer')),
    deleteLocalStripeRecords: vi.fn(track('deleteLocalStripeRecords')),
    deleteStorageFiles: vi.fn(track('deleteStorageFiles')),
    deleteDataTables: vi.fn(track('deleteDataTables')),
    deleteRevenueCatSubscriber: vi.fn(track('deleteRevenueCatSubscriber')),
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
      'checkDataTablesReady',
      'listStoreSubscriptions',
      'getStripeCustomerId',
      'cancelStripeSubscriptions',
      'deleteStripeCustomer',
      'deleteLocalStripeRecords',
      'deleteStorageFiles',
      'deleteDataTables',
      'deleteRevenueCatSubscriber',
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
      'checkDataTablesReady',
      'listStoreSubscriptions',
      'getStripeCustomerId',
      'deleteStorageFiles',
      'deleteDataTables',
      'deleteRevenueCatSubscriber',
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
      'checkDataTablesReady',
      'listStoreSubscriptions',
      'getStripeCustomerId',
      'deleteStorageFiles',
      'deleteDataTables',
      'deleteRevenueCatSubscriber',
      'deleteAuthUser',
    ]);
    expect(actions.deleteAuthUser).toHaveBeenCalledOnce();
  });
});

describe('deleteUserAccount — store teardown (PK-STORE-01)', () => {
  const withStoreSubs = (records: StoreSubscriptionRecord[], overrides: Partial<AccountDeletionActions> = {}) => {
    const made = makeActions(overrides);
    made.actions.listStoreSubscriptions = vi.fn(async () => {
      made.calls.push('listStoreSubscriptions');
      return records;
    });
    return made;
  };

  it('cancels Play after the acknowledgement and before anything else; RevenueCat goes last before auth', async () => {
    const { actions, calls } = withStoreSubs([playRecord()]);

    await deleteUserAccount(actions, 'user-20', { acknowledgedStoreSubscriptions: true });

    expect(calls).toEqual([
      'listStoreSubscriptions',
      'cancelPlaySubscriptions',
      'getStripeCustomerId',
      'cancelStripeSubscriptions',
      'deleteStripeCustomer',
      'deleteLocalStripeRecords',
      'deleteStorageFiles',
      'deleteDataTables',
      'deleteRevenueCatSubscriber',
      'deleteAuthUser',
    ]);
    expect(actions.cancelPlaySubscriptions).toHaveBeenCalledWith('user-20', [
      { productId: 'amani_premium:monthly', storeSubscriptionId: 'GPA.1234-5678-9012-34567' },
    ]);
    expect(actions.deleteRevenueCatSubscriber).toHaveBeenCalledWith('user-20');
  });

  it('tears nothing down while the acknowledgement is missing — the Apple and Google gate is unchanged', async () => {
    const { actions } = withStoreSubs([playRecord(), storeRecord({ platform: 'ios' })]);

    await expect(deleteUserAccount(actions, 'user-21')).rejects.toBeInstanceOf(
      StoreSubscriptionAcknowledgementRequiredError,
    );

    expect(actions.cancelPlaySubscriptions).not.toHaveBeenCalled();
    expect(actions.deleteRevenueCatSubscriber).not.toHaveBeenCalled();
    expect(actions.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('a failed Play cancellation stops deletion before Stripe, storage, data, RevenueCat or auth', async () => {
    const { actions } = withStoreSubs([playRecord()], {
      cancelPlaySubscriptions: vi.fn(async () => {
        throw new Error('Google Play cancellation failed (HTTP 503).');
      }),
    });

    await expect(
      deleteUserAccount(actions, 'user-22', { acknowledgedStoreSubscriptions: true }),
    ).rejects.toThrow('Google Play cancellation failed (HTTP 503).');

    expect(actions.getStripeCustomerId).not.toHaveBeenCalled();
    expect(actions.deleteStorageFiles).not.toHaveBeenCalled();
    expect(actions.deleteDataTables).not.toHaveBeenCalled();
    expect(actions.deleteRevenueCatSubscriber).not.toHaveBeenCalled();
    expect(actions.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('a failed RevenueCat deletion surfaces and leaves the auth identity in place for a retry', async () => {
    const { actions } = makeActions({
      deleteRevenueCatSubscriber: vi.fn(async () => {
        throw new Error('RevenueCat customer deletion failed (HTTP 500).');
      }),
    });

    await expect(deleteUserAccount(actions, 'user-23')).rejects.toThrow(
      'RevenueCat customer deletion failed (HTTP 500).',
    );
    expect(actions.deleteDataTables).toHaveBeenCalledOnce();
    expect(actions.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('an App Store subscription is never sent to the Play cancel — Apple has no server cancel', async () => {
    const { actions, calls } = withStoreSubs([storeRecord({ platform: 'ios' })]);

    await deleteUserAccount(actions, 'user-24', { acknowledgedStoreSubscriptions: true });

    expect(actions.cancelPlaySubscriptions).not.toHaveBeenCalled();
    expect(calls).toContain('deleteRevenueCatSubscriber');
    expect(actions.deleteAuthUser).toHaveBeenCalledOnce();
  });

  it('does not ask Google to cancel Play rows that never bill or already stopped billing', async () => {
    const { actions } = withStoreSubs([
      playRecord({ environment: 'sandbox' }),
      playRecord({ status: 'expired', store_subscription_id: 'GPA.0000-0000-0000-00001' }),
      playRecord({ status: 'revoked', store_subscription_id: 'GPA.0000-0000-0000-00002' }),
    ]);

    await deleteUserAccount(actions, 'user-25');

    expect(actions.cancelPlaySubscriptions).not.toHaveBeenCalled();
    expect(actions.deleteAuthUser).toHaveBeenCalledOnce();
  });

  it('a retry after a partial deletion runs the store steps again (each is idempotent) and finishes', async () => {
    // Everything but auth already ran once: Stripe is gone, the Play row is still
    // there (it rides the auth cascade), and the user re-acknowledges.
    const { actions, calls } = withStoreSubs([playRecord()], {
      getStripeCustomerId: vi.fn(async () => {
        calls.push('getStripeCustomerId');
        return null;
      }),
    });

    await deleteUserAccount(actions, 'user-26', { acknowledgedStoreSubscriptions: true });

    expect(calls).toEqual([
      'listStoreSubscriptions',
      'cancelPlaySubscriptions',
      'getStripeCustomerId',
      'deleteStorageFiles',
      'deleteDataTables',
      'deleteRevenueCatSubscriber',
      'deleteAuthUser',
    ]);
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

  it('never exposes the store subscription id in what the 409 carries', () => {
    expect(selectBillingStoreSubscriptions([playRecord()])).toEqual([
      { platform: 'android', productId: 'amani_premium:monthly', expiresAt: '2026-09-23T00:00:00.000Z' },
    ]);
  });
});

describe('selectPlaySubscriptionsToCancel', () => {
  it('selects exactly the Play rows the acknowledgement treats as still billing', () => {
    const records = [
      playRecord({ status: 'active', store_subscription_id: 'GPA.1111-1111-1111-11111' }),
      playRecord({ status: 'in_grace_period', store_subscription_id: 'GPA.2222-2222-2222-22222' }),
      playRecord({ status: 'billing_retry', store_subscription_id: 'GPA.3333-3333-3333-33333' }),
      // Paused Play subscriptions resume and bill on their own.
      playRecord({ status: 'paused', store_subscription_id: 'GPA.4444-4444-4444-44444' }),
      playRecord({ status: 'expired', store_subscription_id: 'GPA.5555-5555-5555-55555' }),
      playRecord({ status: 'revoked', store_subscription_id: 'GPA.6666-6666-6666-66666' }),
      playRecord({ environment: 'sandbox', store_subscription_id: 'GPA.7777-7777-7777-77777' }),
      storeRecord({ platform: 'ios', store_subscription_id: '2000000000000009' }),
    ];

    expect(selectPlaySubscriptionsToCancel(records).map((s) => s.storeSubscriptionId)).toEqual([
      'GPA.1111-1111-1111-11111',
      'GPA.2222-2222-2222-22222',
      'GPA.3333-3333-3333-33333',
      'GPA.4444-4444-4444-44444',
    ]);
    const androidBilling = selectBillingStoreSubscriptions(records).filter((s) => s.platform === 'android');
    expect(selectPlaySubscriptionsToCancel(records)).toHaveLength(androidBilling.length);
  });

  it('carries the product and store id Google needs', () => {
    expect(selectPlaySubscriptionsToCancel([playRecord()])).toEqual([
      { productId: 'amani_premium:monthly', storeSubscriptionId: 'GPA.1234-5678-9012-34567' },
    ]);
  });

  it('asks once per store subscription even if two rows share an id', () => {
    expect(selectPlaySubscriptionsToCancel([playRecord(), playRecord()])).toHaveLength(1);
  });

  it('handles an empty list', () => {
    expect(selectPlaySubscriptionsToCancel([])).toEqual([]);
  });
});

describe('deleteUserDataTables — driven by user-data-registry.ts (PK-INT-01)', () => {
  function makePort(reportIds: string[], failOn?: string) {
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const step = async (name: string, fail: boolean) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push(name);
      await new Promise(resolve => setTimeout(resolve, 0));
      inFlight -= 1;
      if (fail) throw new Error(`${name} failed`);
    };
    const port: UserDataTablesPort = {
      listReportIds: vi.fn(async () => {
        await step('listReportIds', failOn === 'listReportIds');
        return reportIds;
      }),
      eraseReports: vi.fn(async (ids: readonly string[]) => {
        await step(`eraseReports:${ids.join(',')}`, failOn === 'eraseReports');
      }),
      deleteOwnedRows: vi.fn(async (table: string, column: string) => {
        await step(`delete:${table}.${column}`, failOn === table);
      }),
    };
    return { port, calls, maxInFlight: () => maxInFlight };
  }
  const sweep = orderedDeletes().map(e => `delete:${e.table}.${e.ownerColumn}`);

  it('erases the report graphs in one call first, then every ordered delete in registry order, the profile row last', async () => {
    const { port, calls } = makePort(['r2', 'r1']);
    await deleteUserDataTables(port, 'user-1');
    expect(calls).toEqual(['listReportIds', 'eraseReports:r2,r1', ...sweep]);
    expect(calls.at(-1)).toBe('delete:users.id');
    expect(port.eraseReports).toHaveBeenCalledOnce();
  });

  it('runs one call at a time, never two at once', async () => {
    const { port, maxInFlight } = makePort(['r1']);
    await deleteUserDataTables(port, 'user-1');
    expect(maxInFlight()).toBe(1);
  });

  it('makes no erase_reports call for a user with no reports', async () => {
    const { port, calls } = makePort([]);
    await deleteUserDataTables(port, 'user-1');
    expect(port.eraseReports).not.toHaveBeenCalled();
    expect(calls).toEqual(['listReportIds', ...sweep]);
  });

  it('deletes nothing when the report listing fails', async () => {
    const { port } = makePort(['r1'], 'listReportIds');
    await expect(deleteUserDataTables(port, 'user-1')).rejects.toThrow('listReportIds failed');
    expect(port.eraseReports).not.toHaveBeenCalled();
    expect(port.deleteOwnedRows).not.toHaveBeenCalled();
  });

  it('touches no user-keyed table when the report erasure fails', async () => {
    const { port } = makePort(['r1'], 'eraseReports');
    await expect(deleteUserDataTables(port, 'user-1')).rejects.toThrow('failed');
    expect(port.deleteOwnedRows).not.toHaveBeenCalled();
  });

  it('stops at the first table that fails, so the profile row survives for a retry', async () => {
    const { port, calls } = makePort([], 'rate_limits');
    await expect(deleteUserDataTables(port, 'user-1')).rejects.toThrow('delete:rate_limits.user_id failed');
    expect(calls.at(-1)).toBe('delete:rate_limits.user_id');
    expect(calls).not.toContain('delete:users.id');
  });

  describe('a table whose migration is not applied yet (deploy-order safety)', () => {
    function portWithMissing(missing: string[], otherFailure?: string) {
      const calls: string[] = [];
      const port: UserDataTablesPort = {
        listReportIds: vi.fn(async () => []),
        eraseReports: vi.fn(async () => {}),
        deleteOwnedRows: vi.fn(async (table: string, column: string) => {
          calls.push(`delete:${table}.${column}`);
          if (missing.includes(table)) throw new MissingTableError(table, 'PGRST205');
          if (table === otherFailure) throw new Error(`Deleting ${table} failed: permission denied`);
        }),
      };
      return { port, calls };
    }

    it('erases everything else, profile row included, when app_events and user_attribution do not exist yet', async () => {
      const { port, calls } = portWithMissing(['app_events', 'user_attribution']);
      await expect(deleteUserDataTables(port, 'user-1')).resolves.toBeUndefined();
      expect(calls).toEqual(sweep);
      expect(calls.at(-1)).toBe('delete:users.id');
    });

    it('still fails on any other error from those two tables', async () => {
      const { port, calls } = portWithMissing([], 'app_events');
      await expect(deleteUserDataTables(port, 'user-1')).rejects.toThrow('Deleting app_events failed: permission denied');
      expect(calls).not.toContain('delete:users.id');
    });

    it('still fails when a table not marked mayBeUndeployed is missing', async () => {
      const { port, calls } = portWithMissing(['period_logs']);
      await expect(deleteUserDataTables(port, 'user-1')).rejects.toBeInstanceOf(MissingTableError);
      expect(calls.at(-1)).toBe('delete:period_logs.user_id');
      expect(calls).not.toContain('delete:users.id');
    });

    it('recognises PostgREST and Postgres "no such table" codes, and nothing else', () => {
      expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
      expect(isMissingTableError({ code: '42P01' })).toBe(true);
      for (const code of ['42501', 'PGRST116', '23503', '', undefined, null]) {
        expect(isMissingTableError({ code }), String(code)).toBe(false);
      }
      expect(isMissingTableError(null)).toBe(false);
    });

    it('the delete-user-data wiring maps a missing-table error to MissingTableError', async () => {
      const { readFileSync } = await import('node:fs');
      const src = readFileSync(new URL('../delete-user-data/index.ts', import.meta.url), 'utf8');
      expect(src).toContain('if (isMissingTableError(error)) throw new MissingTableError(table, error.message);');
    });
  });

  it('sweeps whatever the registry marks ordered_delete, and nothing it leaves to another mechanism', async () => {
    const registry: UserDataRegistryEntry[] = [
      { table: 'new_feature_rows', ownerColumn: 'user_id', mechanism: 'ordered_delete' },
      { table: 'new_report_child', ownerColumn: 'lab_report_id', mechanism: 'erase_reports_cascade' },
      { table: 'new_entitlement', ownerColumn: 'user_id', mechanism: 'auth_cascade', reason: 'fixture' },
      { table: 'new_ledger', ownerColumn: 'customer_id', mechanism: 'exception', reason: 'fixture' },
      { table: 'users', ownerColumn: 'id', mechanism: 'ordered_delete' },
    ];
    const { port, calls } = makePort([]);
    await deleteUserDataTables(port, 'user-1', registry);
    expect(calls).toEqual(['listReportIds', 'delete:new_feature_rows.user_id', 'delete:users.id']);
  });
});

describe('deploy order: a table delete-user-data deletes from is missing (PK-HARM-01 review)', () => {
  // The hazard: delete-user-data deployed from a commit whose registry names
  // interpretation_feedback before migration 20261015020000 is pushed. The
  // readiness check must refuse before a single destructive call, and never
  // swallow the missing table.
  const missing = (absent: string[]) => vi.fn(async (table: string, _ownerColumn: string) => {
    if (absent.includes(table)) throw new Error(`Could not find the table 'public.${table}' in the schema cache`);
  });

  it('probes every ordered_delete table, and only those', async () => {
    const probe = missing([]);
    await checkUserDataTablesReady(probe);
    expect(probe.mock.calls.map(([t, c]) => `${t}.${c}`))
      .toEqual(orderedDeletes().map(e => `${e.table}.${e.ownerColumn}`));
    expect(probe.mock.calls.map(([t]) => t)).toContain('interpretation_feedback');
  });

  it('names the missing table and the migration to push, with every unready table', async () => {
    const error = await checkUserDataTablesReady(missing(['interpretation_feedback', 'reminders'])).catch(e => e);
    expect(error).toBeInstanceOf(AccountDeletionNotReadyError);
    expect(error.code).toBe('account_deletion_not_ready');
    expect(error.tables).toEqual([
      expect.objectContaining({ table: 'interpretation_feedback', requiresMigration: '20261015020000' }),
      expect.objectContaining({ table: 'reminders', requiresMigration: null }),
    ]);
    expect(error.message).toContain('interpretation_feedback (push migration 20261015020000)');
    expect(error.message).toContain('Nothing was deleted');
  });

  it('a refused deletion touches nothing: no store read, no Stripe, no storage, no data, no auth', async () => {
    const { actions, calls } = makeActions({
      checkDataTablesReady: vi.fn(async () => {
        calls.push('checkDataTablesReady');
        await checkUserDataTablesReady(missing(['interpretation_feedback']));
      }),
    });
    await expect(deleteUserAccount(actions, 'user-15')).rejects.toBeInstanceOf(AccountDeletionNotReadyError);
    expect(calls).toEqual(['checkDataTablesReady']);
    expect(actions.listStoreSubscriptions).not.toHaveBeenCalled();
    expect(actions.getStripeCustomerId).not.toHaveBeenCalled();
    expect(actions.cancelStripeSubscriptions).not.toHaveBeenCalled();
    expect(actions.deleteStorageFiles).not.toHaveBeenCalled();
    expect(actions.deleteDataTables).not.toHaveBeenCalled();
    expect(actions.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('any probe failure fails closed, not only a missing table', async () => {
    const probe = vi.fn(async (table: string) => { if (table === 'users') throw 'network down'; });
    const error = await checkUserDataTablesReady(probe).catch(e => e);
    expect(error).toBeInstanceOf(AccountDeletionNotReadyError);
    expect(error.tables).toEqual([{ table: 'users', requiresMigration: null, detail: 'network down' }]);
  });
});
