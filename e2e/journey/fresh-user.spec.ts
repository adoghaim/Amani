import type { Page, Response, TestInfo } from '@playwright/test';
import { test, expect, signUpFreshUser, uploadLab, REAL_SUPABASE, type Backend } from './journey-fixture';
import { UPLOADS } from './lab-fixtures';
import { MODEL_CANARY } from './server-model';

/*
  PK-03e-I — the fresh-user journey, end to end in the real production build:

    new user -> upload lab -> extraction -> generation -> clinical authority ->
    save version -> read -> Basic/Premium projection -> trends -> regeneration ->
    deletion

  Default mode runs against the deterministic stand-in (fake-supabase.ts), whose
  Edge Function answers come from the real supabase/functions/_shared modules
  (server-model.ts). Every step asserts both what the browser rendered and what
  the "server" now holds, so a client that renders something the server did not
  authorize, or a server step the client never triggered, fails here. The SQL
  half of each server step is proven separately by the migration harness and
  Vitest; docs/factory/fresh-user-e2e.md maps every step to its proof.

  E2E_REAL_SUPABASE=1 runs the same journey against a local stack; the steps
  that need a privileged write the browser cannot make (granting Premium) are
  skipped there and recorded as pending.
*/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isRead = (r: Response) => r.url().endsWith('/functions/v1/get-interpretation') && r.request().method() === 'POST';

/** The get-interpretation answer that the report page renders after `action`. */
async function readAfter(page: Page, action: () => Promise<unknown>) {
  const read = page.waitForResponse(isRead);
  await action();
  const response = await read;
  expect(response.status()).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

async function expectNoModelProse(page: Page) {
  await expect(page.getByText(/^Lab Report: /).first()).toBeVisible();
  await expect(page.locator('body'), 'unauthorized model prose must never reach the DOM').not.toContainText(MODEL_CANARY);
}

/** A closed More list cannot prove an absent item. Always open and control. */
async function openMore(page: Page) {
  await expect(page.getByText(/^Lab Report: /).first()).toBeVisible();
  const header = page.locator('[data-report-header-actions]');
  await header.getByRole('button', { name: 'More', exact: true }).click();
  const list = header.getByRole('list', { name: 'More report actions' });
  await expect(list.getByRole('button', { name: 'Delete report', exact: true })).toBeVisible();
  return list;
}
async function expectRegenerate(page: Page, offered: boolean) {
  const list = await openMore(page);
  if (offered) await expect(list.getByRole('button', { name: /^Regenerate/ })).toBeVisible();
  else await expect(list.getByRole('button', { name: /^Regenerate/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
}
async function expectProjection(page: Page, body: Record<string, unknown>) {
  await expect(page.getByText(/^Lab Report: /).first()).toBeVisible();
  const locked = body.locked as { cross_report: number };
  const cross = page.getByText('Cross-report relationship available', { exact: true });
  if (body.access === 'basic' && locked.cross_report > 0) await expect(cross).toBeVisible();
  else await expect(cross).toHaveCount(0);
  const preview = page.getByText('PREMIUM PREVIEW', { exact: false }).first();
  if (body.access === 'basic' && body.preview !== null) await expect(preview).toBeVisible();
  else await expect(preview).toHaveCount(0);
}

/** Real-stack mode: record the step as pending (never as passed) and skip it,
 * without ending the journey, so deletion still runs. */
function pending(testInfo: TestInfo, why: string): boolean {
  if (!REAL_SUPABASE) return false;
  testInfo.annotations.push({ type: 'pending', description: `real stack: ${why}` });
  return true;
}

function only(backend: Backend | null): Backend {
  if (!backend) throw new Error('stand-in assertion in real-stack mode');
  return backend;
}

test('fresh user: signup -> uploads -> Basic/Premium -> trends -> regeneration -> deletion', async ({ page, backend }, testInfo) => {
  test.setTimeout(300_000);
  const email = `pk03ei-${testInfo.project.name}-${Date.now()}@example.invalid`;
  const reportIds: string[] = [];
  let uid = '';

  await test.step('1. new user: signup through /signup and the onboarding flow', async () => {
    page = await signUpFreshUser(page, email);
    if (backend) {
      expect(backend.db.authUsers.size).toBe(1);
      uid = [...backend.db.authUsers.keys()][0];
      const profile = backend.db.tables.users.filter(r => r.id === uid);
      // One server-owned profile: signup refreshes it without a duplicate insert.
      expect(profile).toHaveLength(1);
      expect(backend.db.served).toContain('POST /auth/v1/signup');
      expect(backend.db.served).not.toContain('POST /rest/v1/users');
      expect(profile[0]).toMatchObject({ email, onboarding_completed: true });
      expect(profile[0].trial_start_date).toEqual(expect.any(String));
    }
  });

  await test.step('2-5. upload -> extraction -> generation -> clinical authority -> read (introductory Premium)', async () => {
    const body = await readAfter(page, async () => { reportIds.push(await uploadLab(page, UPLOADS[0])); });
    expect(body).toMatchObject({ access: 'full', plan: 'free', stored_depth: 'deep', version: null,
      complimentary: { used: 1, total: 3, remaining: 2 } });
    await expect(page.getByText('Premium Analysis 1 of 3 included')).toBeVisible();
    await expect(page.getByText('TSH is measured for the first time at 6 uIU/mL.')).toBeVisible();
    await expectNoModelProse(page);
    if (backend) {
      const [reportId] = reportIds;
      const report = backend.db.tables.lab_reports.find(r => r.id === reportId)!;
      expect(report).toMatchObject({ user_id: uid, report_date: UPLOADS[0].reportDate, status: 'ready' });
      // Upload: the file sits under the user's own storage prefix.
      expect([...backend.db.storage.keys()].filter(p => p.startsWith(`${uid}/`))).toHaveLength(1);
      // Extraction: the OCR rows were saved as this report's analytes.
      const analytes = backend.db.tables.report_analytes.filter(r => r.lab_report_id === reportId);
      expect(analytes.map(a => [a.canonical_slug, a.value_numeric]).sort()).toEqual([['ferritin', 25], ['tsh', 6]]);
      // Generation: one first-generation request, no request_id (not a regeneration).
      expect(backend.server.generateRequests).toEqual([expect.objectContaining({ reportId })]);
      expect(backend.server.generateRequests[0]).not.toHaveProperty('request_id');
      // Clinical authority: the stored body carries the server's claim set and the
      // audit of the model's proposals; the model prose exists in storage
      // (non-vacuous) but was never rendered above.
      const thread = backend.server.threads.get(reportId)!;
      expect(thread.anchor).toMatchObject({ source: 'ai', depth: 'deep' });
      expect(thread.anchor.full).toHaveProperty('clinical_claims');
      expect(thread.anchor.full).toHaveProperty('claim_audit');
      expect(JSON.stringify(thread.anchor.full)).toContain(MODEL_CANARY);
      // Basic keeps only BASIC_KEYS: none of the model's narrative fields.
      expect(thread.anchor.basic).not.toHaveProperty('overall_interpretation');
      expect(thread.anchor.basic).not.toHaveProperty('pattern_signals');
      expect(backend.db.tables.introductory_deep_access_claims.filter(c => c.user_id === uid)).toHaveLength(1);
    }
  });

  await test.step('trends: a second report reads against the first', async () => {
    const body = await readAfter(page, async () => { reportIds.push(await uploadLab(page, UPLOADS[1])); });
    expect(body).toMatchObject({ access: 'full', complimentary: { used: 2, remaining: 1 } });
    await expect(page.getByText('Premium Analysis 2 of 3 included')).toBeVisible();
    await expect(page.getByText('TSH has risen from 6 to 9 uIU/mL.', { exact: false })).toBeVisible();
    await expectNoModelProse(page);
    if (backend) {
      // The server's trend evidence was computed from the prior report it found.
      const full = backend.server.threads.get(reportIds[1])!.anchor.full;
      expect(full.trend_evidence).toEqual(expect.arrayContaining([expect.objectContaining({
        biomarker_slug: 'tsh', previous_value: 6, current_value: 9, previous_date: UPLOADS[0].reportDate, direction: 'increased' })]));
    }
  });

  await test.step('Basic projection: introductory access exhausted, the server serves Basic', async () => {
    const third = await readAfter(page, async () => { reportIds.push(await uploadLab(page, UPLOADS[2])); });
    expect(third).toMatchObject({ access: 'full', plan: 'free', stored_depth: 'deep', complimentary: { used: 3, remaining: 0 } });
    if (backend) {
      expect(backend.server.threads.get(reportIds[2])!.anchor).toMatchObject({ source: 'ai', depth: 'deep', tier: 'plus' });
      expect(backend.db.tables.introductory_deep_access_claims.filter(c => c.user_id === uid)).toHaveLength(3);
    }
    await expect(page.getByText('Premium Analysis 3 of 3 included')).toBeVisible();
    const body = await readAfter(page, async () => { reportIds.push(await uploadLab(page, UPLOADS[3])); });
    expect(body).toMatchObject({ access: 'basic', plan: 'free', stored_depth: 'deep', regeneration: { available: true, reason: null },
      complimentary: { used: 3, total: 3, remaining: 0 } });
    await expect(page.getByText(/You've used your 3 complimentary Premium analyses/)).toBeVisible();
    await expectProjection(page, body);
    await expectRegenerate(page, false);
    await expect(page.getByText('A fuller analysis is available for this report')).toHaveCount(0);
    await expectNoModelProse(page);
    if (backend) {
      const thread = backend.server.threads.get(reportIds[3])!;
      expect(thread.anchor).toMatchObject({ source: 'ai', depth: 'deep', tier: 'free' });
      expect(JSON.stringify(thread.anchor.full)).toContain(MODEL_CANARY);
      expect(backend.db.tables.introductory_deep_access_claims.filter(c => c.user_id === uid)).toHaveLength(3);
    }
  });

  let current = reportIds[3];
  await test.step('Premium projection: the same report, read by a Premium reader', async () => {
    if (pending(testInfo, 'granting Premium needs a service-role write (stripe-webhook)')) return;
    only(backend).server.grantStripeSubscription(uid);
    const before = only(backend).server.generateRequests.length;
    const body = await readAfter(page, () => page.reload());
    expect(body).toMatchObject({ access: 'full', plan: 'premium', stored_depth: 'deep', version: null });
    await expectProjection(page, body);
    expect(only(backend).server.generateRequests).toHaveLength(before);
    await expect(page.getByText('A fuller analysis is available for this report')).toHaveCount(0);
    await expectRegenerate(page, false);
    await expect(page.getByText(/You've used your 3 complimentary Premium analyses/)).toHaveCount(0);
    await expect(page.getByText('Unlock Premium')).toHaveCount(0);
    await expectNoModelProse(page);
  });

  await test.step('7. Premium model failure saves a standard fallback without a claim', async () => {
    if (pending(testInfo, 'synthetic model failure needs the stand-in')) return;
    const b = only(backend);
    b.server.failNextModelCall();
    const body = await readAfter(page, async () => {
      current = await uploadLab(page, UPLOADS[4]); reportIds.push(current);
    });
    expect(body).toMatchObject({ access: 'generation_needed', plan: 'premium', stored_depth: 'standard', version: null });
    expect(b.server.threads.get(current)!.anchor).toMatchObject({ source: 'fallback', depth: 'standard', tier: 'plus' });
    expect(b.db.tables.introductory_deep_access_claims.filter(c => c.user_id === uid)).toHaveLength(3);
    await expect(page.getByText('A fuller analysis is available for this report')).toBeVisible();
    await expectProjection(page, body);
    await expectRegenerate(page, true);
    await expectNoModelProse(page);
  });

  await test.step('regeneration: appends a version; the reader serves the new current version', async () => {
    if (pending(testInfo, 'regeneration depends on the Premium step')) return;
    const b = only(backend);
    const generated = page.waitForResponse(r => r.url().endsWith('/functions/v1/generate-interpretation'));
    const anchorBefore = structuredClone(b.server.threads.get(current)!.anchor);
    const menu = await openMore(page);
    await expect(menu.getByRole('button', { name: 'Regenerate (3 left)', exact: true })).toBeVisible();
    const body = await readAfter(page, () => menu.getByRole('button', { name: 'Regenerate (3 left)', exact: true }).click());
    const answer = await (await generated).json();
    const request = b.server.generateRequests.at(-1)!;
    expect(request).toMatchObject({ reportId: current });
    expect(request.request_id).toMatch(UUID);
    const thread = b.server.threads.get(current)!;
    expect(thread.versions).toHaveLength(1);
    const [version] = thread.versions;
    // Save version: the anchor is untouched; the version is a new row with its own identity.
    expect(thread.anchor).toEqual(anchorBefore);
    expect(thread.anchor).toMatchObject({ source: 'fallback', depth: 'standard' });
    expect(answer).toMatchObject({ success: true, access: 'full', reused: false,
      historical_interpretation_id: thread.anchor.id, version: { id: version.versionId } });
    // Read: the selected version, under its own identity, never the historical row's.
    expect(body).toMatchObject({ access: 'full', plan: 'premium', stored_depth: 'deep',
      historical_interpretation_id: thread.anchor.id, version: { id: version.versionId, generated_at: version.generatedAt } });
    expect(version.versionId).not.toBe(thread.anchor.id);
    expect(b.db.tables.lab_reports.find(r => r.id === current)).toMatchObject({ regeneration_count: 1, status: 'ready' });
    expect(b.db.reportPatches).toContainEqual({ status: 'processing', regeneration_count: 1 });
    await expect(page.getByText(/^Lab Report: /).first()).toBeVisible();
    await expect(page.getByText('A fuller analysis is available for this report')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generate full Amani analysis' })).toHaveCount(0);
    await expectRegenerate(page, false);
    await expect(page.getByText("TSH changed from 9 to 6 uIU/mL. Amani's comparison band for this result has not yet completed clinical review.", { exact: true })).toBeVisible();
    expect(version.full.trend_evidence).toEqual(expect.arrayContaining([expect.objectContaining({
      biomarker_slug: 'tsh', previous_value: 9, current_value: 6, previous_date: UPLOADS[3].reportDate, direction: 'decreased' })]));
    // The new version's model prose is stored but, like every body, never rendered.
    expect(JSON.stringify(version.full)).toContain(MODEL_CANARY);
    await expectNoModelProse(page);
  });

  await test.step('deletion: delete-user-data erases everything and signs the user out', async () => {
    let customerId: string | undefined;
    if (backend) {
      const events = backend.db.tables.app_events.filter(r => r.event === 'interpretation_generated' && r.user_id === uid);
      expect(events).toHaveLength(6);
      expect(events.map(r => (r.props as { tier: string }).tier)).toEqual(['plus', 'plus', 'plus', 'free', 'plus', 'plus']);
      const customers = backend.db.tables.stripe_customers.filter(r => r.user_id === uid);
      expect(customers).toHaveLength(1);
      customerId = customers[0].customer_id;
      expect(backend.db.tables.stripe_subscriptions.filter(r => r.customer_id === customerId)).toHaveLength(1);
      expect([...backend.db.storage.keys()].filter(p => p.startsWith(`${uid}/`))).toHaveLength(5);
      expect(await page.evaluate(() => localStorage.getItem('sb-amani-e2e-auth-token'))).not.toBeNull();
    }
    await page.goto('/app/settings');
    await page.getByRole('button', { name: 'Delete My Data' }).click();
    await page.getByPlaceholder('DELETE').fill('DELETE');
    const erased = page.waitForResponse(r => r.url().endsWith('/functions/v1/delete-user-data'));
    await page.getByRole('button', { name: 'Yes, Delete My Data' }).click();
    expect((await erased).status()).toBe(200);
    await page.waitForURL(url => url.pathname === '/');
    // Signed out: no stored session, and the app sends the visitor to log in.
    const session = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sb-') && k.endsWith('-auth-token')));
    expect(session).toEqual([]);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?redirect=/);
    if (backend) {
      expect(backend.db.authUsers.has(uid)).toBe(false);
      expect(backend.db.tables.app_events).toEqual([{ event: 'account_deleted', user_id: null, anon_id: null, props: {} }]);
      expect(backend.server.deletionSteps.at(-1)).toBe('account_deleted');
      expect(backend.db.tables.stripe_customers.filter(r => r.user_id === uid)).toEqual([]);
      expect(backend.db.tables.stripe_subscriptions.filter(r => r.customer_id === customerId)).toEqual([]);
      expect(backend.db.tables.stripe_orders.filter(r => r.customer_id === customerId)).toEqual([]);
      for (const [table, rows] of Object.entries(backend.db.tables)) {
        expect(rows.filter(r => r.user_id === uid || r.id === uid), `${table} still holds the user's rows`).toEqual([]);
      }
      for (const id of reportIds) {
        expect(backend.server.threads.has(id)).toBe(false);
        expect(backend.db.tables.report_analytes.filter(r => r.lab_report_id === id)).toEqual([]);
        expect(backend.db.tables.biomarkers.filter(r => r.lab_report_id === id)).toEqual([]);
      }
      expect([...backend.db.storage.keys()].filter(p => p.startsWith(`${uid}/`))).toEqual([]);
    }
  });
});

// PK-PL-A (bd01008) fixed the former missing-request-id defect.
test('Premium panel: Generate full Amani analysis appends a version without spending an attempt', async ({ page, backend }, testInfo) => {
  if (REAL_SUPABASE) testInfo.annotations.push({ type: 'pending', description: 'real stack: needs Premium grant and model failure' });
  test.skip(REAL_SUPABASE, 'PENDING real stack: needs a Premium grant and model failure');
  test.setTimeout(300_000);
  const b = only(backend);
  page = await signUpFreshUser(page, `pk03ei-panel-${testInfo.project.name}-${Date.now()}@example.invalid`);
  const uid = [...b.db.authUsers.keys()][0];
  b.server.grantStripeSubscription(uid);
  b.server.failNextModelCall();
  let reportId = '';
  const initial = await readAfter(page, async () => { reportId = await uploadLab(page, UPLOADS[0]); });
  expect(initial).toMatchObject({ access: 'generation_needed', plan: 'premium', stored_depth: 'standard', version: null });
  await expect(page.getByText('A fuller analysis is available for this report')).toBeVisible();
  await expectRegenerate(page, true);
  const thread = b.server.threads.get(reportId)!;
  expect(thread.anchor).toMatchObject({ source: 'fallback', depth: 'standard', tier: 'plus' });
  const anchorBefore = structuredClone(thread.anchor);
  const generated = page.waitForResponse(r => r.url().endsWith('/functions/v1/generate-interpretation'));
  const body = await readAfter(page, () => page.getByRole('button', { name: 'Generate full Amani analysis', exact: true }).click());
  const response = await generated;
  expect(b.server.generateRequests.at(-1)).toMatchObject({ reportId, request_id: expect.stringMatching(UUID) });
  expect(response.status()).toBe(200);
  expect(thread.versions).toHaveLength(1);
  const [version] = thread.versions;
  expect(await response.json()).toMatchObject({ success: true, reused: false,
    historical_interpretation_id: thread.anchor.id, version: { id: version.versionId } });
  expect(body).toMatchObject({ access: 'full', plan: 'premium', stored_depth: 'deep',
    historical_interpretation_id: thread.anchor.id, version: { id: version.versionId, generated_at: version.generatedAt } });
  expect(version.versionId).not.toBe(thread.anchor.id);
  expect(thread.anchor).toEqual(anchorBefore);
  expect(b.db.tables.lab_reports.find(r => r.id === reportId)).toMatchObject({ regeneration_count: 0, status: 'ready' });
  for (const patch of b.db.reportPatches) expect(patch).not.toHaveProperty('regeneration_count');
  expect(b.db.tables.introductory_deep_access_claims).toHaveLength(0);
  expect(JSON.stringify(version.full)).toContain(MODEL_CANARY);
  await expect(page.getByText(/^Lab Report: /).first()).toBeVisible();
  await expect(page.getByText('A fuller analysis is available for this report')).toHaveCount(0);
  await expectRegenerate(page, false);
  await expectNoModelProse(page);
});
