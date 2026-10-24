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

/*
  RV-CR1: the marker her lab printed beside a value shows beside that value,
  exactly as printed, in a core result's card (Potassium, "Critical") and in a
  lab-panel row (Ionized Calcium, "HH" after the unit), while
  features.lab_critical_flag_notice is on; the notice names the same two
  results. With the flag off (the seed) neither badge nor notice shows.
  Synthetic values; the intervals are placeholders, not clinical ranges.
*/
const markerReportId = stage2CurrentReport.report.id;
const markerReport: SyntheticReport = {
  ...stage2CurrentReport,
  biomarkers: [{
    id: '00000000-0000-4000-9000-0000000c0151', lab_report_id: markerReportId, name: 'potassium', value: 6.8,
    raw_value_text: '6.8', unit: 'mmol/L', reference_min: 3.5, reference_max: 5.3, flagged: 'in_range',
    created_at: '2026-02-02T00:00:00.000Z',
  }],
  analytes: [{
    id: '00000000-0000-4000-c000-0000000c0152', lab_report_id: markerReportId,
    raw_name: 'Potassium', display_name: 'Potassium', value_numeric: 6.8, raw_value_text: '6.8', unit: 'mmol/L',
    normalized_min: 3.5, normalized_max: 5.3, normalized_operator: null, normalized_operator_value: null,
    raw_reference_range: '3.5-5.3', source_snippet: 'Potassium 6.8 mmol/L Critical 3.5-5.3', parse_status: 'mapped',
    canonical_slug: 'potassium', is_core: true, confidence_score: 'high', normalization_status: 'mapped', source_format: 'text',
  }, {
    id: '00000000-0000-4000-c000-0000000c0153', lab_report_id: markerReportId,
    raw_name: 'Ionized Calcium', display_name: 'Ionized Calcium', value_numeric: 1.85, raw_value_text: '1.85', unit: 'mmol/L',
    normalized_min: 1.12, normalized_max: 1.32, normalized_operator: null, normalized_operator_value: null,
    raw_reference_range: '1.12-1.32', source_snippet: 'Ionized Calcium 1.85 mmol/L HH 1.12-1.32', parse_status: 'mapped',
    canonical_slug: 'ionized_calcium', is_core: false, confidence_score: 'high', normalization_status: 'mapped', source_format: 'text',
  }],
};
const MARKER_NOTICE = 'Your lab marked your Potassium and Ionized Calcium results as critical. Contact your clinician promptly. If you feel unwell, call your local emergency number.';
const potassiumCard = (page: Page) => page.locator('article[aria-label="Potassium result"]');
const calciumRow = (page: Page) => page.getByTestId('result-row').filter({ hasText: 'Ionized Calcium' });

/** Opens the body system that holds the card and the full lab panel that holds the row. */
async function openResults(page: Page) {
  await page.goto(`/app/reports/${markerReportId}`);
  await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();
  const system = page.getByRole('button', { name: /^Metabolic & Glucose/ });
  if (await system.getAttribute('aria-expanded') === 'false') await system.click();
  await expect(system).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: /^Full lab panel/ }).click();
  await expect(potassiumCard(page)).toBeVisible();
  await expect(calciumRow(page)).toBeVisible();
}

test.describe('lab-printed critical marker beside the value, flag on (RV-CR1)', () => {
  test.use({
    authenticated: true,
    syntheticReports: [[markerReport], { scope: 'test' }],
    runtimeConfigReply: {
      status: 200,
      body: (RUNTIME_CONFIG_SEED_REPLY.body as { key: string; value: unknown }[])
        .map(row => (row.key === 'features' ? { key: 'features', value: { lab_critical_flag_notice: true } } : row)),
    },
  });

  test('the card and the row show the marker as printed, the notice names both, and axe finds them clean', async ({ page }) => {
    await openResults(page);
    await expect(page.getByTestId('lab-flag')).toHaveCount(2);
    await expect(potassiumCard(page).getByTestId('lab-flag')).toBeVisible();
    await expect(potassiumCard(page).getByTestId('lab-flag')).toHaveText('Flag printed by your lab: Critical');
    await expect(calciumRow(page).getByTestId('lab-flag')).toBeVisible();
    await expect(calciumRow(page).getByTestId('lab-flag')).toHaveText('Flag printed by your lab: HH');
    await expect(notice(page)).toHaveCount(1);
    await expect(notice(page)).toHaveText(MARKER_NOTICE);
    await expect(page.getByRole('alert')).toHaveCount(1);
    // Colour contrast is on in a real browser.
    const result = await new AxeBuilder({ page })
      .include('article[aria-label="Potassium result"]')
      .include('[data-testid="result-row"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

test.describe('lab-printed critical marker beside the value, flag off (the seed)', () => {
  test.use({ authenticated: true, syntheticReports: [[markerReport], { scope: 'test' }] });

  test('dark: neither the card nor the row shows a badge, and no notice', async ({ page }) => {
    await openResults(page);
    await expect(page.getByTestId('lab-flag')).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByText('Your lab marked your', { exact: false })).toHaveCount(0);
  });
});
