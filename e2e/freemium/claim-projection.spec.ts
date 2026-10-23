import { test, expect } from '../fixtures';
import { quarantineCustomerRead } from '../../supabase/functions/_shared/claim-authority';
import { modelProseCurrentReport, modelCanaries } from '../reports/synthetic-reports';
import type { InterpretationPayload } from '../../supabase/functions/_shared/response-shaping';
import { stage2CurrentReport, stage2PriorReport, type SyntheticReport } from '../reports/synthetic-reports';
import { projectedPreviewFixture, projectionCanary } from '../../supabase/functions/_shared/claim-authority.testkit';
import { contaminatedMovement, legitimateMovement } from './client-prose-input';

test('M10 client phrase authorization: valid claim with contaminated prose', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/e2e/freemium/client-prose-fixture.html');
  // All readiness/positive controls precede the clinical assertion and remain
  // identical under M10-phrase-membership (see turn-7-client-proof.md).
  await expect(page.getByRole('heading', { name: 'Client prose authorization fixture', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Measured observation' })
    .locator('[data-language-claim="measured_movement"]')).toHaveText(legitimateMovement);
  const summary = page.getByRole('region', { name: 'Model summary' });
  await expect(summary).toBeVisible();
  await expect(summary.getByText(legitimateMovement, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.locator('body'), 'M10 canary: contaminated model prose must not reach the DOM')
    .not.toContainText(contaminatedMovement);
});

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
    // Deliberately contaminate the *served* preview after server projection.
    // Its measured facts still agree; only the client render gate can strip this prose.
    if (!issued.response.preview) throw new Error('Expected an issued preview');
    issued.response.preview.content = {
      ...issued.response.preview.content as Record<string, unknown>,
      summary: projectionCanary, explanation: projectionCanary,
    };
    test.use({
      authenticated: true,
      syntheticReports: [[current, prior], { scope: 'test' }],
      syntheticBasicResponse: { reportId: current.report.id, body: issued.response },
    });
    test('the real ReportView gates the server preview against its measured facts', async ({ page }) => {
      expect(issued.response.preview?.content).toMatchObject({ summary: projectionCanary, explanation: projectionCanary });
      expect(issued.response.preview?.claim).toHaveProperty('policy_version');
      expect(issued.response.locked).toEqual({ patterns: 0, cross_report: 1, lifestyle: 0 });
      expect(issued.response.locked).not.toHaveProperty('claim_policy_version');
      await page.goto(`/app/reports/${current.report.id}`);
      // Positive readiness independent of preview: the endpoint response has rendered.
      await expect(page.getByText('Cross-report relationship available', { exact: true })).toBeVisible();
      await expect(page.getByTestId('primary-movement-observation')).toContainText('from 6 to 9 mIU/L');
      const card = page.locator('[data-model-surface="preview"]');
      if (disagree) {
        await expect(card).toHaveCount(0);
      } else {
        await expect(card).toBeVisible();
        await expect(card.locator('[data-language-claim="measured_movement"]'))
          .toHaveText('TSH increased from 6 to 9 mIU/L.');
      }
      await expect(page.locator('body')).not.toContainText(projectionCanary);
      await expect(page.getByText(/additional patterns? found/)).toHaveCount(0);
    });
  });
}

// TASK-047 M10: separate server and client controls. The bypass fixture is
// fulfilled verbatim by the network guard; it never calls the quarantine.
const rawLegacy: InterpretationPayload = {
  ...modelProseCurrentReport.interpretation.json_output as InterpretationPayload,
  critical_findings: { critical: true, status: 'out_of_range', title: 'Copper paper boats' },
};
for (const bypass of [false, true]) {
  test.describe(`M10 ${bypass ? 'client alone with raw server fixture' : 'server quarantine then client'}`, () => {
    const body = {
      access: 'full', interpretation: bypass ? rawLegacy : quarantineCustomerRead(rawLegacy, true, 'ai'),
      preview: null, locked: { patterns: 0, cross_report: 0, lifestyle: 0 },
      plan: 'premium', complimentary: null, stored_depth: 'deep',
    };
    const report = { ...modelProseCurrentReport,
      interpretation: { ...modelProseCurrentReport.interpretation, json_output: body.interpretation } };
    test.use({ authenticated: true, syntheticReports: [[report, stage2PriorReport], { scope: 'test' }],
      syntheticBasicResponse: { reportId: report.report.id, body } });
    test('unauthorized prose and lone-object safety never render', async ({ page }) => {
      // This assertion proves the server layer without relying on the browser gate.
      for (const canary of [...modelCanaries, 'Copper paper boats']) {
        if (bypass) expect(JSON.stringify(body.interpretation)).toContain(canary);
        else expect(JSON.stringify(body.interpretation)).not.toContain(canary);
      }
      const response = page.waitForResponse(r => r.url().endsWith('/functions/v1/get-interpretation'));
      await page.goto(`/app/reports/${report.report.id}`);
      expect(await (await response).json()).toEqual(body);
      await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();
      await expect(page.getByTestId('primary-movement-observation')).toBeVisible();
      for (let i = 0; i < 40; i++) {
        const closed = page.locator('button[aria-expanded="false"]').first();
        if (await closed.count() === 0) break;
        await closed.click();
      }
      await page.getByRole('button', { name: /^Patterns & Insights/ }).click();
      for (const canary of [...modelCanaries, 'Copper paper boats']) {
        await expect(page.locator('body')).not.toContainText(canary);
      }
      await expect(page.locator('[data-language-category="safety_warning"], [data-language-cue="critical"], [role="alert"]')).toHaveCount(0);
      if (bypass) {
        // Positive control: admissible measured movement survives the client gate.
        await expect(page.locator('[data-model-field="interpretation.summary_bullets"]')).toContainText('TSH increased');
      } else {
        await expect(page.locator('[data-model-field]')).toHaveCount(0);
      }
    });
  });
}
