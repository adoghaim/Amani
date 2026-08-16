import { describe, it, expect, vi } from 'vitest';
import { deleteUserAccount, type AccountDeletionActions } from './account-deletion.ts';

function makeActions(overrides: Partial<AccountDeletionActions> = {}): {
  actions: AccountDeletionActions;
  calls: string[];
} {
  const calls: string[] = [];
  const track = (name: string) => async (..._args: unknown[]) => {
    calls.push(name);
  };

  const actions: AccountDeletionActions = {
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
      'getStripeCustomerId',
      'deleteStorageFiles',
      'deleteDataTables',
      'deleteAuthUser',
    ]);
    expect(actions.deleteAuthUser).toHaveBeenCalledOnce();
  });
});
