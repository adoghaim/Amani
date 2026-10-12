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
  await expect(page.locator('body'), 'unauthorized model prose must never reach the DOM').not.toContainText(MODEL_CANARY);
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
  test.setTimeout(170_000);
  const email = `pk03ei-${testInfo.project.name}-${Date.now()}@example.invalid`;
  const reportIds: string[] = [];
  let uid = '';

  await test.step('1. new user: signup through /signup and the onboarding flow', async () => {
    await signUpFreshUser(page, email);
    if (backend) {
      expect(backend.db.authUsers.size).toBe(1);
      uid = [...backend.db.authUsers.keys()][0];
      const profile = backend.db.tables.users.filter(r => r.id === uid);
      // One row: the trigger's; the form's own insert is refused as a duplicate.
      expect(profile).toHaveLength(1);
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
    reportIds.push(await uploadLab(page, UPLOADS[2]));
    await expect(page.getByText('Premium Analysis 3 of 3 included')).toBeVisible();
    const body = await readAfter(page, async () => { reportIds.push(await uploadLab(page, UPLOADS[3])); });
    expect(body).toMatchObject({ access: 'basic', plan: 'free', stored_depth: 'standard',
      complimentary: { used: 3, total: 3, remaining: 0 } });
    await expect(page.getByText(/You've used your 3 complimentary Premium analyses/)).toBeVisible();
    await expect(page.getByText('Cross-report relationship available', { exact: true })).toBeVisible();
    await expect(page.getByText('PREMIUM PREVIEW', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('A fuller analysis is available for this report')).toHaveCount(0);
    await expectNoModelProse(page);
    if (backend) {
      const thread = backend.server.threads.get(reportIds[3])!;
      expect(thread.anchor).toMatchObject({ source: 'fallback', depth: 'standard' });
      expect(backend.db.tables.introductory_deep_access_claims.filter(c => c.user_id === uid)).toHaveLength(3);
    }
  });

  const current = reportIds[3];
  await test.step('Premium projection: the same report, read by a Premium reader', async () => {
    if (pending(testInfo, 'granting Premium needs a service-role write (stripe-webhook)')) return;
    only(backend).server.grantStripeSubscription(uid);
    const body = await readAfter(page, () => page.reload());
    // Full reader of a standard-depth body: the server offers the deep generation.
    expect(body).toMatchObject({ access: 'generation_needed', plan: 'premium', stored_depth: 'standard', version: null });
    await expect(page.getByText('A fuller analysis is available for this report')).toBeVisible();
    await expect(page.getByText(/You've used your 3 complimentary Premium analyses/)).toHaveCount(0);
    await expect(page.getByText('Unlock Premium')).toHaveCount(0);
    await expectNoModelProse(page);
  });

  await test.step('regeneration: appends a version; the reader serves the new current version', async () => {
    if (pending(testInfo, 'regeneration depends on the Premium step')) return;
    const b = only(backend);
    const generated = page.waitForResponse(r => r.url().endsWith('/functions/v1/generate-interpretation'));
    // The header action (handleRegenerate: per-tap request_id). The panel's own
    // "Generate full Amani analysis" sends none and is refused for an anchored
    // report: see the fixme below and the PR's [Pending] item.
    const body = await readAfter(page, () => page.getByRole('button', { name: 'Regenerate (3 left)' }).click());
    const answer = await (await generated).json();
    const request = b.server.generateRequests.at(-1)!;
    expect(request).toMatchObject({ reportId: current });
    expect(request.request_id).toMatch(UUID);
    const thread = b.server.threads.get(current)!;
    expect(thread.versions).toHaveLength(1);
    const [version] = thread.versions;
    // Save version: the anchor is untouched; the version is a new row with its own identity.
    expect(thread.anchor).toMatchObject({ source: 'fallback', depth: 'standard' });
    expect(answer).toMatchObject({ success: true, access: 'full', reused: false,
      historical_interpretation_id: thread.anchor.id, version: { id: version.versionId } });
    // Read: the selected version, under its own identity, never the historical row's.
    expect(body).toMatchObject({ access: 'full', plan: 'premium', stored_depth: 'deep',
      historical_interpretation_id: thread.anchor.id, version: { id: version.versionId, generated_at: version.generatedAt } });
    expect(version.versionId).not.toBe(thread.anchor.id);
    expect(b.db.tables.lab_reports.find(r => r.id === current)).toMatchObject({ regeneration_count: 1, status: 'ready' });
    await expect(page.getByText('A fuller analysis is available for this report')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generate full Amani analysis' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Regenerate/ })).toHaveCount(0);
    await expect(page.getByText('TSH has risen from 6 to 9 uIU/mL.', { exact: false })).toBeVisible();
    // The new version's model prose is stored but, like every body, never rendered.
    expect(JSON.stringify(version.full)).toContain(MODEL_CANARY);
    await expectNoModelProse(page);
  });

  await test.step('deletion: delete-user-data erases everything and signs the user out', async () => {
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

/*
  Defect found by this journey (not fixed here: the packet adds tests only, no
  product change). Flag on, a Premium reader of an anchored standard-depth
  report is offered the panel action "Generate full Amani analysis"
  (FreemiumReportPanel onGenerate -> ReportView handleGenerate), which calls
  generate-interpretation WITHOUT a request_id. Since TASK-048 the handler
  answers 400 request_id_required for any report that already holds its anchor
  (generate-interpretation/index.ts, appendsVersion && requestId === null), so
  that button can never produce the fuller analysis; the header "Regenerate"
  (handleRegenerate) can. Marked test.fail: it runs, proves the defect in every
  browser, and turns red the day the defect is fixed so the marker is removed.
*/
test('known defect: the panel "Generate full Amani analysis" action appends a version', async ({ page, backend }, testInfo) => {
  test.skip(REAL_SUPABASE, 'PENDING real stack: needs a Premium grant');
  test.fail(true, 'handleGenerate sends no request_id for an anchored report ([Pending], PR body)');
  test.setTimeout(170_000);
  const b = only(backend);
  await signUpFreshUser(page, `pk03ei-defect-${testInfo.project.name}-${Date.now()}@example.invalid`);
  for (const upload of UPLOADS.slice(0, 3)) await uploadLab(page, upload);
  let reportId = '';
  // Settled as Basic before Premium is granted (generation is fired on save).
  expect(await readAfter(page, async () => { reportId = await uploadLab(page, UPLOADS[3]); })).toMatchObject({ access: 'basic' });
  b.server.grantStripeSubscription([...b.db.authUsers.keys()][0]);
  await readAfter(page, () => page.reload());
  const generated = page.waitForResponse(r => r.url().endsWith('/functions/v1/generate-interpretation'));
  await page.getByRole('button', { name: 'Generate full Amani analysis' }).click();
  const response = await generated;
  expect.soft(b.server.generateRequests.at(-1)).toMatchObject({ reportId });
  expect(response.status(), JSON.stringify(await response.json())).toBe(200);
  expect(b.server.threads.get(reportId)!.versions).toHaveLength(1);
});
