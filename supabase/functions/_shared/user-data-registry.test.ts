import { describe, expect, it } from 'vitest';
import {
  ERASURE_MECHANISMS,
  USER_DATA_REGISTRY,
  orderedDeletes,
  registryProblems,
  type ErasureMechanism,
  type UserDataRegistryEntry,
} from './user-data-registry.ts';

/*
  PK-INT-01 (D3): the registry's own rules. Whether each entry is true of the
  schema is account-deletion-sweep.test.ts; the order delete-user-data runs is
  delete-user-data.erasure.test.ts and account-deletion.test.ts.
*/

const users: UserDataRegistryEntry = { table: 'users', ownerColumn: 'id', mechanism: 'ordered_delete' };
const sweep = (table: string): UserDataRegistryEntry => ({ table, ownerColumn: 'user_id', mechanism: 'ordered_delete' });

describe('user-data-registry.ts', () => {
  it('is well formed: one entry per table, known mechanisms, reasons where required, profile row last', () => {
    expect(registryProblems()).toEqual([]);
  });

  it('uses exactly the four mechanisms D3 names', () => {
    expect([...ERASURE_MECHANISMS]).toEqual(['erase_reports_cascade', 'ordered_delete', 'auth_cascade', 'exception']);
    for (const entry of USER_DATA_REGISTRY) expect(ERASURE_MECHANISMS, entry.table).toContain(entry.mechanism);
  });

  it('marks only the PK-EXP5 tables mayBeUndeployed, each naming the migration that creates it', () => {
    const marked = USER_DATA_REGISTRY.filter(e => e.mayBeUndeployed);
    expect(marked.map(e => e.table)).toEqual(['app_events', 'user_attribution']);
    for (const entry of marked) expect(entry.reason, entry.table).toContain('20261015010000_first_party_events.sql');
  });

  it('every exception and auth cascade explains itself', () => {
    for (const entry of USER_DATA_REGISTRY.filter(e => e.mechanism === 'exception' || e.mechanism === 'auth_cascade')) {
      expect(entry.reason?.trim().length ?? 0, entry.table).toBeGreaterThan(40);
    }
  });

  it.each<[string, UserDataRegistryEntry[], string]>([
    ['a table registered twice', [sweep('a'), sweep('a'), users], 'a is registered more than once'],
    ['an unknown mechanism', [{ table: 'a', ownerColumn: 'user_id', mechanism: 'soft_delete' as ErasureMechanism }, users],
      'a: unknown mechanism "soft_delete"'],
    ['an exception with no reason', [{ table: 'a', ownerColumn: 'user_id', mechanism: 'exception' }, users],
      'a: an exception needs a reason saying what erases it'],
    ['an exception with a blank reason', [{ table: 'a', ownerColumn: 'user_id', mechanism: 'exception', reason: '  ' }, users],
      'a: an exception needs a reason saying what erases it'],
    ['an auth cascade with no reason', [{ table: 'a', ownerColumn: 'user_id', mechanism: 'auth_cascade' }, users],
      'a: leaving rows to the auth.users cascade needs a reason'],
    ['a sweep after the profile row', [users, sweep('a')], 'the users profile row (by id) must be the last ordered delete'],
    ['no profile row', [sweep('a')], 'the users profile row (by id) must be the last ordered delete'],
    ['the profile row by user_id', [sweep('users')], 'the users profile row (by id) must be the last ordered delete'],
    ['a schema-qualified table', [sweep('public.a'), users], '"public.a" is not a table name'],
    ['a malformed column', [{ table: 'a', ownerColumn: 'user id', mechanism: 'ordered_delete' }, users],
      'a: "user id" is not a column name'],
    ['mayBeUndeployed on a cascade', [{ table: 'a', ownerColumn: 'lab_report_id', mechanism: 'erase_reports_cascade',
      mayBeUndeployed: true, reason: 'fixture' }, users], 'a: mayBeUndeployed only applies to an ordered delete'],
    ['mayBeUndeployed on the profile row', [{ ...users, mayBeUndeployed: true, reason: 'fixture' }],
      'users: the profile row can never be treated as undeployed'],
    ['mayBeUndeployed with no reason', [{ ...sweep('a'), mayBeUndeployed: true }, users],
      'a: mayBeUndeployed needs a reason naming the migration that creates it'],
  ])('reports %s', (_label, registry, problem) => {
    expect(registryProblems(registry)).toContain(problem);
  });

  it('orderedDeletes keeps registry order and leaves every other mechanism out', () => {
    const registry: UserDataRegistryEntry[] = [
      sweep('b'),
      { table: 'c', ownerColumn: 'lab_report_id', mechanism: 'erase_reports_cascade' },
      sweep('a'),
      { table: 'd', ownerColumn: 'user_id', mechanism: 'auth_cascade', reason: 'fixture' },
      { table: 'e', ownerColumn: 'customer_id', mechanism: 'exception', reason: 'fixture' },
      users,
    ];
    expect(orderedDeletes(registry).map(e => e.table)).toEqual(['b', 'a', 'users']);
    expect(orderedDeletes().at(-1)).toEqual(expect.objectContaining({ table: 'users', ownerColumn: 'id' }));
  });
});
