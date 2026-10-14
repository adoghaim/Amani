import { test, expect } from '../fixtures';
import type { Page, Request } from '@playwright/test';
import { ferritinDecreased, stage2CurrentReport, stage2PriorReport, tshIncreased, type SyntheticReport } from '../reports/synthetic-reports';

/*
  TASK-048 turn 10 (Owner Ruling 5, closeout 4, 5, 6, 10): the real ReportView,
  flag off, against the synthetic network. A fresh report with its first
  interpretation renders; Regenerate sends a per-tap request_id; the server
  answers with the appended version's own identity; the reader then serves the
  selected version, whose body replaces the previous one on screen, and a
  canary from the previous body never reappears.

  The network stands in for the database: generate-interpretation and the
  `interpretations` view are fulfilled here exactly as the version writer and
  read_compatible_interpretations would answer (view id = the selected version's
  id, Owner Ruling 2; tier 'plus' for a version). Those SQL behaviours are proven
  by execution in supabase/migrations/__verification__/interpretation-versions
  .writer.sql and .read.sql; this spec proves the client half.
*/

const PREVIOUS_CANARY = 'H048 previous-body canary: this sentence must never render';
const HISTORY_ID = '00000000-0000-4000-b000-000000000048';
const VERSION_ID = '00000000-0000-4000-d000-000000000048';
const VERSION_AT = '2026-10-11T12:00:00.000Z';

// Model prose renders only when it is one of the report's own measured-change
// claims (TSH 6 -> 9, ferritin 25 -> 20 in the Stage-2 pair), so each body
// carries exactly one authorized sentence that identifies it on screen.
const previousBody = {
  headline: PREVIOUS_CANARY, summary_bullets: [ferritinDecreased],
  overall_interpretation: PREVIOUS_CANARY, disclaimer: 'Synthetic fixture. Not medical advice.',
};
const versionBody = {
  headline: 'Synthetic regenerated panel', summary_bullets: [tshIncreased],
  disclaimer: 'Synthetic fixture. Not medical advice.',
};

const current: SyntheticReport = {
  ...stage2CurrentReport,
  analytes: [],
  interpretation: { ...stage2CurrentReport.interpretation, id: HISTORY_ID, tier: 'plus', json_output: previousBody },
};
const reportId = current.report.id;

/** Routes the regeneration round trip. Page routes take precedence over the
 * fixture's context guard; anything not matched here falls back to it. */
async function routeRegeneration(page: Page) {
  const state = { regenerated: false, generateBodies: [] as Record<string, unknown>[], patches: [] as unknown[] };
  // The flag-off Regenerate action requires an entitled reader.
  await page.route('https://amani-e2e.invalid/rest/v1/stripe_user_subscriptions*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: [{ subscription_status: 'active' }] });
  });
  await page.route('https://amani-e2e.invalid/rest/v1/interpretations*', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || url.searchParams.get('lab_report_id') !== `eq.${reportId}`) return route.fallback();
    await route.fulfill({ json: [state.regenerated
      ? { id: VERSION_ID, lab_report_id: reportId, json_output: versionBody, generated_at: VERSION_AT,
        disclaimer_version: '1.0', interpretation_source: 'ai', tier: 'plus' }
      : current.interpretation] });
  });
  await page.route('https://amani-e2e.invalid/rest/v1/lab_reports*', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'PATCH' || url.searchParams.get('id') !== `eq.${reportId}`) return route.fallback();
    state.patches.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.route('https://amani-e2e.invalid/functions/v1/generate-interpretation', async route => {
    const request: Request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const body = request.postDataJSON() as Record<string, unknown>;
    state.generateBodies.push(body);
    if (body.reportId !== reportId || typeof body.request_id !== 'string') {
      // What the server answers for a regeneration of an existing row without one.
      await route.fulfill({ status: 400, json: { error: 'request_id_required' } });
      return;
    }
    state.regenerated = true;
    await route.fulfill({ json: { success: true, source: 'ai', reused: false,
      historical_interpretation_id: HISTORY_ID, version: { id: VERSION_ID, generated_at: VERSION_AT } } });
  });
  return state;
}

const summary = (page: Page) => page.locator('[data-model-surface="summary_bullets"]');

test.describe('V2 version regeneration, flag off', () => {
  test.use({ authenticated: true, syntheticReports: [[current, stage2PriorReport], { scope: 'test' }] });

  test('a fresh report renders its interpretation; regenerate serves the new version and never the previous body', async ({ page }) => {
    const state = await routeRegeneration(page);
    await page.goto(`/app/reports/${reportId}`);
    await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();

    // Closeout 4/10: the report's first interpretation renders (its one authorized sentence).
    await expect(summary(page)).toContainText(ferritinDecreased);
    await expect(summary(page)).not.toContainText(tshIncreased);
    // Closeout 6 before regeneration: untrusted prose of the stored body never renders.
    await expect(page.locator('body')).not.toContainText(PREVIOUS_CANARY);

    const regenerate = page.getByRole('button', { name: /^Regenerate \(3 left\)$/ });
    await expect(regenerate).toBeVisible();
    const generated = page.waitForResponse(r => r.url().endsWith('/functions/v1/generate-interpretation'));
    const reread = page.waitForResponse(r => r.url().includes('/rest/v1/interpretations') && state.regenerated);
    await regenerate.click();

    // Closeout 5: one keyed request; the answer carries the version's own identity.
    const response = await (await generated).json();
    expect(state.generateBodies).toHaveLength(1);
    expect(state.generateBodies[0]).toMatchObject({ reportId });
    expect(state.generateBodies[0].request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(response.version.id).toBe(VERSION_ID);
    expect(response.version.id).not.toBe(response.historical_interpretation_id);
    // The re-read is served under the selected version's identity (Owner Ruling 2).
    expect((await (await reread).json())[0]).toMatchObject({ id: VERSION_ID, generated_at: VERSION_AT, tier: 'plus' });

    // The new version renders; the previous body is gone from the DOM.
    await expect(summary(page)).toContainText(tshIncreased);
    await expect(summary(page)).not.toContainText(ferritinDecreased);
    await expect(page.locator('[data-model-field]').filter({ hasText: ferritinDecreased })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(PREVIOUS_CANARY);
    // The client wrote nothing but the report row's status. PK-REGEN-01: the
    // regeneration is counted by the server, never by a client write.
    expect(state.patches).toContainEqual({ status: 'processing' });
    expect(state.patches.filter(p => typeof p === 'object' && p !== null && 'regeneration_count' in p)).toEqual([]);
  });
});
