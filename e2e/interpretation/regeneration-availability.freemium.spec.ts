import { test, expect } from '../fixtures';
import { readInterpretation } from '../../supabase/functions/_shared/interpretation-read';
import { stage2CurrentReport, stage2PriorReport, type SyntheticReport } from '../reports/synthetic-reports';

/*
  PK-PL-A, Adell's pre-launch ruling (c), flag on: a Free reader who has used
  her three complimentary analyses, on a report whose stored body is the
  deterministic Basic one. Whether Regenerate is offered is the server's
  answer, never the client's guess: the get-interpretation body is computed
  here by the real edge read policy (readInterpretation) with
  FREEMIUM_POST_LIMIT_GENERATION as generate-interpretation reads it. With
  post-limit generation on demand a regeneration cannot succeed (it would end in
  503 regeneration_failed, retryable:false), so the action is hidden; with the
  default it can, so it is offered. The browser renders that answer.
*/

const current: SyntheticReport = { ...stage2CurrentReport, analytes: [] };
const stored = {
  headline: 'Synthetic deterministic analysis', cycle_context: {}, questions_for_doctor: [],
  disclaimer: 'Synthetic fixture. Not medical advice.', top_findings: [], summary_bullets: [],
};

function serve(postLimitGeneration: string | undefined) {
  return readInterpretation({
    ownsReport: async () => true,
    resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
    readSelected: async () => ({ json_output: stored, stored_depth: 'standard', has_claim: false, tier: 'free',
      interpretation_source: 'fallback' }),
    countClaims: async () => 3,
    postLimitGeneration,
  }, true);
}

test.describe('PK-PL-A: Free after the complimentary analyses, a stored Basic report', () => {
  test.use({
    authenticated: true,
    syntheticReports: [[current, stage2PriorReport], { scope: 'test' }],
    // Enables the fixture's claim-count route; the answer itself is routed in the test.
    syntheticBasicResponse: { reportId: current.report.id, body: null },
  });

  for (const { setting, offered } of [
    { setting: 'on_demand', offered: false },
    { setting: undefined, offered: true },
  ]) {
    test(`post-limit generation ${setting ?? 'default (always)'}: Regenerate ${offered ? 'offered' : 'hidden'}`, async ({ page }) => {
      const served = await serve(setting);
      expect(served.status).toBe(200);
      expect(served.body).toMatchObject({ access: 'basic', plan: 'free', stored_depth: 'standard',
        regeneration: offered ? { available: true, reason: null } : { available: false, reason: 'introductory_access_exhausted' } });
      const generated: unknown[] = [];
      await page.route('https://amani-e2e.invalid/functions/v1/get-interpretation', async route => {
        if (route.request().method() !== 'POST' || route.request().postDataJSON()?.reportId !== current.report.id) return route.fallback();
        await route.fulfill({ json: served.body });
      });
      await page.route('https://amani-e2e.invalid/functions/v1/generate-interpretation', async route => {
        generated.push(route.request().postDataJSON());
        await route.abort('blockedbyclient');
      });

      const response = page.waitForResponse(r => r.url().endsWith('/functions/v1/get-interpretation'));
      await page.goto(`/app/reports/${current.report.id}`);
      expect(await (await response).json()).toEqual(JSON.parse(JSON.stringify(served.body)));
      // Positive readiness: the Basic answer rendered.
      await expect(page.getByText('See the full Premium analysis', { exact: true })).toBeVisible();
      // Regenerate lives in the header More menu (D19), whose list is hidden until
      // opened. A closed list cannot prove an absent item, so open it and control on
      // Delete report, which is always listed, before asserting on Regenerate.
      const header = page.locator('[data-report-header-actions]');
      await header.getByRole('button', { name: 'More', exact: true }).click();
      const list = header.getByRole('list', { name: 'More report actions' });
      await expect(list.getByRole('button', { name: 'Delete report', exact: true })).toBeVisible();
      await expect(list.getByRole('button', { name: /^Regenerate \(3 left\)$/ })).toHaveCount(offered ? 1 : 0);
      // Nothing was generated either way: the page never asks on its own.
      expect(generated).toEqual([]);
    });
  }
});
