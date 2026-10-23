import { test, expect } from '../fixtures';
import { readInterpretation } from '../../supabase/functions/_shared/interpretation-read';
import { sanitizeBasicProjection } from '../../supabase/functions/_shared/interpretation-visibility';
import { projectedPreviewFixture, projectionCanary } from '../../supabase/functions/_shared/claim-authority.testkit';
import { stage2CurrentReport, stage2PriorReport, type SyntheticReport } from '../reports/synthetic-reports';

/*
  TASK-048 turn 10, closeout 9: a Free reader with no claim on a report whose
  selected interpretation is a regenerated version is served Basic, never the
  version's Full body. The version is a real claim-authorized deep body
  (projectedPreviewFixture: withClaimAuthority + projectBasic); its Full carries
  a canary in overall_interpretation. The get-interpretation answer is computed
  by the real edge read policy (readInterpretation) over the row the SQL reader
  returns for this case: the version's sanitized Basic, with the version's
  identity columns (proven by execution in interpretation-versions.read.sql,
  H048V-BASIC-FROM-VERSION). The browser then renders that answer.
*/

const VERSION_ID = '00000000-0000-4000-d000-000000000049';
const HISTORY_ID = '00000000-0000-4000-b000-000000000049';
const VERSION_AT = '2026-10-11T12:00:00.000Z';
const fixture = projectedPreviewFixture();

function reportWithFacts(base: SyntheticReport, facts: typeof fixture.current | typeof fixture.previous): SyntheticReport {
  return { ...base, analytes: [], biomarkers: facts.map((fact, i) => ({
    ...base.biomarkers[i], name: fact.slug, value: fact.value, raw_value_text: String(fact.value), unit: fact.unit,
    reference_min: 0, reference_max: 100,
  })) };
}
const current = reportWithFacts(stage2CurrentReport, fixture.current);
const prior = reportWithFacts(stage2PriorReport, fixture.previous);

function serve() {
  return readInterpretation({
    ownsReport: async () => true,
    resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
    readSelected: async premium => ({
      // premium=false and no claim: the SQL reader returns the version's sanitized Basic.
      json_output: premium ? fixture.full : sanitizeBasicProjection(fixture.basic, 'ai'),
      stored_depth: 'deep', has_claim: false, tier: 'plus', interpretation_source: 'ai',
      historical_interpretation_id: HISTORY_ID, selected_version_id: VERSION_ID, selected_generated_at: VERSION_AT,
    }),
    countClaims: async () => 3,
  }, true);
}

test.describe('Free reader of a regenerated report', () => {
  test.use({
    authenticated: true,
    syntheticReports: [[current, prior], { scope: 'test' }],
    // Enables the fixture's claim-count route; the answer itself is routed in the test.
    syntheticBasicResponse: { reportId: current.report.id, body: null },
  });

  test('is served Basic under the version identity, and the version Full never renders', async ({ page }) => {
    const served = await serve();
    // Page routes take precedence over the fixture's context route.
    await page.route('https://amani-e2e.invalid/functions/v1/get-interpretation', async route => {
      if (route.request().method() !== 'POST' || route.request().postDataJSON()?.reportId !== current.report.id) return route.fallback();
      await route.fulfill({ json: served.body });
    });
    // Non-vacuous: the version's Full carries the canary; the served answer does not.
    expect(JSON.stringify(fixture.full)).toContain(projectionCanary);
    expect(served.status).toBe(200);
    expect(served.body).toMatchObject({ access: 'basic', plan: 'free', historical_interpretation_id: HISTORY_ID,
      version: { id: VERSION_ID, generated_at: VERSION_AT } });
    expect(JSON.stringify(served.body.interpretation)).not.toContain(projectionCanary);

    const response = page.waitForResponse(r => r.url().endsWith('/functions/v1/get-interpretation'));
    await page.goto(`/app/reports/${current.report.id}`);
    expect(await (await response).json()).toEqual(JSON.parse(JSON.stringify(served.body)));
    // Positive readiness: the Basic answer rendered (its locked cross-report count).
    await expect(page.getByText('Cross-report relationship available', { exact: true })).toBeVisible();
    await expect(page.getByTestId('primary-movement-observation')).toContainText('from 6 to 9 mIU/L');
    await expect(page.locator('body')).not.toContainText(projectionCanary);
  });
});
