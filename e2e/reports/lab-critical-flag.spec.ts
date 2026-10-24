import { test, expect, RUNTIME_CONFIG_SEED_REPLY } from '../fixtures';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { stage2CurrentReport, type SyntheticReport } from './synthetic-reports';

/*
  Review F014 interim on the real ReportView, in a real browser, against the
  synthetic network. One lab-panel row carries the lab's own printed panic
  flag ("HH"); the model's headline claims urgency on its own. With
  features.lab_critical_flag_notice on, the safety channel shows one fixed
  notice, and axe (colour contrast on) finds nothing on it. With the flag off
  (the seed) nothing shows: the notice ships dark until clinical GO.
  Synthetic values only.
*/

const NOTICE = 'Your lab marked your Potassium result as critical. Contact your clinician promptly. If you feel unwell, call your local emergency number.';

const criticalReport: SyntheticReport = {
  ...stage2CurrentReport,
  analytes: [{
    id: '00000000-0000-4000-c000-0000000f0141', lab_report_id: stage2CurrentReport.report.id,
    raw_name: 'Potassium', display_name: 'Potassium', value_numeric: 6.8, raw_value_text: '6.8', unit: 'mmol/L',
    normalized_min: 3.5, normalized_max: 5.3, normalized_operator: null, normalized_operator_value: null,
    raw_reference_range: '3.5-5.3', source_snippet: 'Potassium 6.8 HH 3.5-5.3 mmol/L', parse_status: 'mapped',
    canonical_slug: 'potassium', is_core: false, confidence_score: 'high', normalization_status: 'mapped', source_format: 'text',
  }],
};

const notice = (page: Page) => page.locator('[data-safety-rule="lab-printed-critical-flag"]');

async function openReport(page: Page) {
  await page.goto(`/app/reports/${criticalReport.report.id}`);
  await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();
}

test.describe('lab-printed critical flag, flag on', () => {
  test.use({
    authenticated: true,
    syntheticReports: [[criticalReport], { scope: 'test' }],
    runtimeConfigReply: {
      status: 200,
      body: (RUNTIME_CONFIG_SEED_REPLY.body as { key: string; value: unknown }[])
        .map(row => (row.key === 'features' ? { key: 'features', value: { lab_critical_flag_notice: true } } : row)),
    },
  });

  test('one fixed notice in the safety channel, an alert axe finds clean', async ({ page }) => {
    await openReport(page);
    await expect(notice(page)).toHaveCount(1);
    await expect(notice(page)).toHaveText(NOTICE);
    await expect(notice(page)).toHaveAttribute('role', 'alert');
    await expect(notice(page)).toHaveAttribute('data-language-cue', 'critical');
    await expect(page.getByRole('alert').filter({ hasText: 'Your lab marked your Potassium result as critical.' })).toBeVisible();
    const result = await new AxeBuilder({ page }).include('[data-safety-rule="lab-printed-critical-flag"]').analyze();
    expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

test.describe('lab-printed critical flag, flag off (the seed)', () => {
  test.use({ authenticated: true, syntheticReports: [[criticalReport], { scope: 'test' }] });

  test('dark: the same report shows no notice', async ({ page }) => {
    await openReport(page);
    await expect(page.getByText('1 total analytes')).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByText('Your lab marked your', { exact: false })).toHaveCount(0);
  });
});
