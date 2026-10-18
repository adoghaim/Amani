import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeSupabase } from './fake-supabase';
import { ServerModel, MODEL_CANARY } from './server-model';
import { USER_DATA_REGISTRY } from '../../supabase/functions/_shared/user-data-registry';

function subset(actual: unknown, expected: Record<string, unknown>) {
  assert.ok(actual && typeof actual === 'object');
  for (const [key, value] of Object.entries(expected)) {
    const found: unknown = (actual as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) subset(found, value as Record<string, unknown>);
    else assert.deepEqual(found, value);
  }
}

const uid = '00000000-0000-4000-a000-000000000001';
function fixture() {
  const db = new FakeSupabase();
  const server = new ServerModel(db);
  db.tables.users.push({ id: uid, onboarding_completed: true, trial_start_date: null });
  const report = (id: string) => {
    db.tables.lab_reports.push({ id, user_id: uid, report_date: '2026-01-05', regeneration_count: 0, status: 'processing' });
    db.tables.report_analytes.push({ lab_report_id: id, canonical_slug: 'tsh', raw_name: 'TSH', value_numeric: 6, unit: 'uIU/mL', normalized_min: 0, normalized_max: 100 });
  };
  return { db, server, report, generate: (id: string, request_id?: string) => db.functions['generate-interpretation'](uid, { reportId: id, ...(request_id ? { request_id } : {}) }),
    read: (id: string) => db.functions['get-interpretation'](uid, { reportId: id }) };
}

test('production default: fourth Free generation is deep, Free metadata, Basic read with regeneration', async () => {
  const f = fixture();
  for (const id of ['a', 'b', 'c', 'd']) { f.report(id); assert.equal((await f.generate(id)).status, 200); }
  assert.equal(f.db.tables.introductory_deep_access_claims.length, 3);
  assert.equal(f.server.threads.get('d')!.anchor.depth, 'deep');
  assert.equal(f.server.threads.get('d')!.anchor.tier, 'free');
  assert.ok(JSON.stringify(f.server.threads.get('d')!.anchor.full).includes(MODEL_CANARY));
  subset((await f.read('d')).body, { access: 'basic', stored_depth: 'deep', regeneration: { available: true, reason: null } });
  assert.deepEqual(f.db.tables.app_events.map(r => r.props), [{ tier: 'plus' }, { tier: 'plus' }, { tier: 'plus' }, { tier: 'free' }]);
});

test('Premium fallback, required request id, append, reuse, failed regeneration preserves anchor and selection', async () => {
  const f = fixture(); f.server.grantStripeSubscription(uid); f.report('a'); f.server.failNextModelCall();
  assert.equal((await f.generate('a')).status, 200);
  const anchor = structuredClone(f.server.threads.get('a')!.anchor);
  assert.equal(anchor.depth, 'standard');
  subset((await f.read('a')).body, { access: 'generation_needed', plan: 'premium' });
  assert.deepEqual(await f.generate('a'), { status: 400, body: { error: 'request_id_required' } });
  const request = '00000000-0000-4000-a000-000000000002';
  subset((await f.generate('a', request)).body, { success: true, reused: false });
  f.server.failNextModelCall();
  subset((await f.generate('a', request)).body, { success: true, reused: true });
  assert.equal((await f.generate('a', '00000000-0000-4000-a000-000000000003')).status, 503);
  assert.deepEqual(f.server.threads.get('a')!.anchor, anchor);
  assert.equal(f.server.threads.get('a')!.versions.length, 1);
  assert.equal(f.db.tables.lab_reports[0].status, 'ready');
  assert.equal(f.db.tables.introductory_deep_access_claims.length, 0);
  assert.equal(f.db.tables.app_events.length, 2);
});

test('switch off fails explicitly, onboarding tier gate blocks, daily generation limit is real', async () => {
  const f = fixture(); f.report('a'); f.server.visibilityEnabled = false;
  await assert.rejects(f.generate('a'), /unmodelled: visibility switch off/);
  f.server.visibilityEnabled = true; f.db.tables.users[0].onboarding_completed = false;
  subset(await f.generate('a'), { status: 402, body: { error: 'subscription_required' } });
  f.db.tables.users[0].onboarding_completed = true;
  for (let n = 2; n < 20; n++) await f.generate('missing');
  assert.equal((await f.generate('a')).status, 429);
});

test('deletion preflight fails before mutation; registry, Stripe and report graph erase before anonymous event', async () => {
  const f = fixture(); f.server.grantStripeSubscription(uid); f.report('a');
  await f.generate('a'); await f.generate('a', '00000000-0000-4000-a000-000000000002');
  const missing = f.db.tables.reminders;
  const tables: Record<string, unknown> = f.db.tables;
  delete tables.reminders;
  assert.equal((await f.db.functions['delete-user-data'](uid, {})).status, 503);
  assert.equal(f.db.tables.stripe_customers.length, 1);
  assert.equal(f.server.threads.size, 1);
  f.db.tables.reminders = missing;
  f.db.storage.set(`${uid}/synthetic.png`, { owner: uid, bytes: 1 });
  assert.equal((await f.db.functions['delete-user-data'](uid, {})).status, 200);
  assert.equal(f.server.threads.size, 0);
  assert.equal(f.db.storage.size, 0);
  assert.equal(f.db.tables.stripe_customers.length, 0);
  assert.equal(f.db.tables.stripe_subscriptions.length, 0);
  assert.deepEqual(f.server.deletionSteps.filter(s => s.startsWith('delete:')), USER_DATA_REGISTRY.filter(e => e.mechanism === 'ordered_delete').map(e => `delete:${e.table}`));
  assert.deepEqual(f.db.tables.app_events, [{ event: 'account_deleted', user_id: null, anon_id: null, props: {} }]);
  assert.equal(f.server.deletionSteps.at(-1), 'account_deleted');
});
