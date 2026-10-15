import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { ferritinDecreased, stage2CurrentReport, stage2PriorReport, type SyntheticReport } from '../reports/synthetic-reports';

/*
  PK-PL-A, Adell's pre-launch ruling (b), flag off: the real ReportView against
  the synthetic network. A regenerate that the server refuses wrote nothing
  (generate-interpretation answers a failure only when no version, claim or
  anchor change was written: supabase/functions/_shared/regeneration-failure
  .handler.test.ts and __verification__/regeneration-no-write.sql), so the page
  puts back the status and the attempt it spent optimistically, never writes
  status "error", keeps the analysis on screen and says calmly what happened.

  The network stands in for the database: lab_reports PATCH bodies are recorded
  exactly as the client sends them, and generate-interpretation answers with the
  server's own failure bodies.
*/

const reportId = stage2CurrentReport.report.id;
const current: SyntheticReport = {
  ...stage2CurrentReport,
  analytes: [],
  interpretation: { ...stage2CurrentReport.interpretation, tier: 'plus',
    json_output: { headline: 'Synthetic stored analysis', summary_bullets: [ferritinDecreased],
      disclaimer: 'Synthetic fixture. Not medical advice.' } },
};

const OUTCOMES = [
  { label: '503 regeneration_failed (retryable)', status: 503, body: { error: 'regeneration_failed', retryable: true },
    title: "We couldn't regenerate your analysis", note: 'Your current analysis is unchanged. Please try again in a moment.', retry: true },
  { label: '409 legacy_history_protected', status: 409, body: { error: 'legacy_history_protected' },
    title: 'Your saved analysis was kept', note: 'Nothing was replaced. You are seeing the analysis saved for this report.', retry: false },
  { label: '400 request_id_required', status: 400, body: { error: 'request_id_required' },
    title: "A new analysis isn't available for this report", note: 'Your current analysis is unchanged.', retry: false },
  { label: '500 Failed to save interpretation', status: 500, body: { error: 'Failed to save interpretation' },
    title: "We couldn't regenerate your analysis", note: 'Your current analysis is unchanged. Please try again in a moment.', retry: true },
];

async function routeFailure(page: Page, failure: { status: number; body: unknown }) {
  const state = { patches: [] as Record<string, unknown>[], generateBodies: [] as Record<string, unknown>[] };
  // The flag-off Regenerate action requires an entitled reader.
  await page.route('https://amani-e2e.invalid/rest/v1/stripe_user_subscriptions*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: [{ subscription_status: 'active' }] });
  });
  await page.route('https://amani-e2e.invalid/rest/v1/lab_reports*', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'PATCH' || url.searchParams.get('id') !== `eq.${reportId}`) return route.fallback();
    state.patches.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.route('https://amani-e2e.invalid/functions/v1/generate-interpretation', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    state.generateBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: failure.status, json: failure.body });
  });
  return state;
}

const summary = (page: Page) => page.locator('[data-model-surface="summary_bullets"]');

test.describe('PK-PL-A: a failed regenerate, flag off', () => {
  test.use({ authenticated: true, syntheticReports: [[current, stage2PriorReport], { scope: 'test' }] });

  for (const outcome of OUTCOMES) {
    test(`${outcome.label}: nothing spent, nothing branded, the analysis stays, a calm notice`, async ({ page }) => {
      const state = await routeFailure(page, outcome);
      await page.goto(`/app/reports/${reportId}`);
      await expect(summary(page)).toContainText(ferritinDecreased);

      // D19 (PK-INT-01): Regenerate lives in the labelled More menu; its behaviour and copy are unchanged.
      const more = page.getByRole('button', { name: 'More', exact: true });
      const generated = page.waitForResponse(r => r.url().endsWith('/functions/v1/generate-interpretation'));
      await more.click();
      await page.getByRole('button', { name: /^Regenerate \(3 left\)$/ }).click();
      expect((await generated).status()).toBe(outcome.status);

      const notice = page.getByRole('status').filter({ hasText: outcome.title });
      await expect(notice).toBeVisible();
      await expect(notice).toContainText(outcome.note);
      await expect(notice.getByRole('button', { name: 'Try again' })).toHaveCount(outcome.retry ? 1 : 0);

      // One keyed request; the optimistic spend, then exactly the values it replaced.
      expect(state.generateBodies).toHaveLength(1);
      expect(state.generateBodies[0].request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(state.patches[0]).toEqual({ status: 'processing', regeneration_count: 1 });
      expect(state.patches.at(-1)).toEqual({ status: 'ready', regeneration_count: 0 });
      expect(state.patches.filter(p => p.status === 'error')).toEqual([]);

      // The analysis on screen is intact and no failure card replaces it.
      await expect(summary(page)).toContainText(ferritinDecreased);
      await expect(page.getByText('AI summary failed')).toHaveCount(0);
      // The menu closes once an action runs; reopen it to see Regenerate still offered with 3 left.
      await more.click();
      await expect(page.getByRole('button', { name: /^Regenerate \(3 left\)$/ })).toBeVisible();
    });
  }
});
