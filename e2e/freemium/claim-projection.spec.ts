import { test, expect } from '../fixtures';
import { stage2CurrentReport, stage2PriorReport, type SyntheticReport } from '../reports/synthetic-reports';
import { projectedPreviewFixture, projectionCanary } from '../../supabase/functions/_shared/claim-authority.testkit';

const fixture = projectedPreviewFixture();
function reportWithFacts(base: SyntheticReport, facts: typeof fixture.current | typeof fixture.previous): SyntheticReport {
  return { ...base, analytes: [], biomarkers: facts.map((fact, i) => ({
    ...base.biomarkers[i], name: fact.slug, value: fact.value, raw_value_text: String(fact.value), unit: fact.unit,
    // Synthetic printed intervals agree with the fixture's in-range statuses.
    reference_min: 0, reference_max: 100,
  })) };
}
const current = reportWithFacts(stage2CurrentReport, fixture.current);
const prior = reportWithFacts(stage2PriorReport, fixture.previous);

for (const disagree of [false, true]) {
  test.describe(disagree ? 'negative control: report disagrees' : 'issued server projection', () => {
    const issued = projectedPreviewFixture(disagree ? 10 : 9);
    test.use({
      authenticated: true,
      syntheticReports: [[current, prior], { scope: 'test' }],
      syntheticBasicResponse: { reportId: current.report.id, body: issued.response },
    });
    test('the real ReportView gates the server preview against its measured facts', async ({ page }) => {
      expect(issued.response.preview?.claim).toHaveProperty('policy_version');
      expect(issued.response.locked).toEqual({ patterns: 0, cross_report: 1, lifestyle: 0 });
      expect(issued.response.locked).not.toHaveProperty('claim_policy_version');
      await page.goto(`/app/reports/${current.report.id}`);
      // Positive readiness independent of preview: the endpoint response has rendered.
      await expect(page.getByText('Cross-report relationship available', { exact: true })).toBeVisible();
      await expect(page.getByTestId('primary-movement-observation')).toContainText('from 6 to 9 uIU/mL');
      const card = page.locator('[data-model-surface="preview"]');
      if (disagree) {
        await expect(card).toHaveCount(0);
      } else {
        await expect(card).toBeVisible();
        await expect(card.locator('[data-language-claim="measured_movement"]'))
          .toHaveText('TSH increased from 6 to 9 uIU/mL.');
      }
      await expect(page.locator('body')).not.toContainText(projectionCanary);
      await expect(page.getByText(/additional patterns? found/)).toHaveCount(0);
    });
  });
}
