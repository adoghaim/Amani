import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { lutealPhaseReport, missingPhaseReport } from './synthetic-reports';

// V2-03 release invariants in a real browser, against the real ReportView,
// with synthetic report rows behind the network guard. CONTRACT section 5.

async function openReport(page: Page, id: string) {
  await page.goto(`/app/reports/${id}`);
  await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();
}

// The list toggle, not the summary card of the same name. Systems start
// collapsed unless they hold the primary finding, which each fixture fixes.
async function expandSystem(page: Page, label: string, initiallyExpanded: boolean) {
  const toggle = page.getByRole('button', { name: new RegExp(`^${label}\\b`) }).and(page.locator('[aria-expanded]'));
  await expect(toggle).toHaveAttribute('aria-expanded', String(initiallyExpanded));
  if (!initiallyExpanded) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

const card = (page: Page, name: string) => page.getByRole('article', { name: `${name} result` });

test.describe('cycle phase missing from the report', () => {
  test.use({ authenticated: true, syntheticReports: [missingPhaseReport] });

  test.beforeEach(async ({ page }) => {
    await openReport(page, missingPhaseReport.report.id);
    // Nothing is scored outside the Amani band here, so there is no primary finding.
    await expandSystem(page, 'Hormones & Reproductive', false);
    await expandSystem(page, 'Thyroid', false);
  });

  test('1. lab range and Amani context band render as separate concepts', async ({ page }) => {
    const tsh = card(page, 'TSH');
    await expect(tsh.getByRole('term').filter({ hasText: "Your lab's range:" })).toBeVisible();
    await expect(tsh.getByRole('definition').filter({ hasText: '0.45–4.5 uIU/mL' })).toBeVisible();
    await expect(tsh.getByRole('term').filter({ hasText: /^Amani context band:$/ })).toBeVisible();
    await expect(tsh.getByRole('definition').filter({ hasText: '1–2.5 uIU/mL' })).toBeVisible();
    // The catalog lab_reference row (0.4–4) is never shown as her lab's range.
    await expect(tsh.getByText('0.4–4', { exact: false })).toHaveCount(0);
  });

  test('2. an unapproved range cannot render as unqualified "Optimal"', async ({ page }) => {
    const tsh = card(page, 'TSH');
    await expect(tsh.getByText('Within Amani band', { exact: true })).toBeVisible();
    await expect(tsh.getByText('Not yet reviewed', { exact: true })).toBeVisible();
    await tsh.getByRole('button').click();
    await expect(tsh.getByText("Within your lab's range", { exact: true })).toBeVisible();
    await expect(page.getByText(/\bOptimal\b/)).toHaveCount(0);
  });

  test('3. a cycle-dependent hormone with missing phase receives no Amani context score', async ({ page }) => {
    for (const name of ['Progesterone', 'Estradiol (E2)']) {
      const marker = card(page, name);
      const note = marker.getByRole('note');
      await expect(note).toContainText('Amani context score unavailable');
      await expect(note).toContainText('Add or confirm your cycle phase for a more specific interpretation.');
      await expect(marker.getByText('Context needed', { exact: true })).toBeVisible();
      await expect(marker.getByRole('term').filter({ hasText: 'Amani context band' })).toHaveCount(0);
      await expect(marker.getByText(/Within Amani band|Outside Amani band|Borderline|Normal|Optimal/)).toHaveCount(0);
    }
    // A system whose markers are all withheld is not summarised as reassuring.
    await expect(page.getByRole('button', { name: /^Hormones Not scored 2 markers · 0 scored by Amani$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Hormones Within Amani bands/ })).toHaveCount(0);
  });

  test('4. its raw laboratory value remains visible', async ({ page }) => {
    await expect(card(page, 'Progesterone').getByText('2.0', { exact: true })).toBeVisible();
    await expect(card(page, 'Progesterone').getByText('ng/mL', { exact: true })).toBeVisible();
    await expect(card(page, 'Estradiol (E2)').getByText('120', { exact: true })).toBeVisible();
  });

  test('5. its laboratory range remains visible when supplied', async ({ page }) => {
    const progesterone = card(page, 'Progesterone');
    await expect(progesterone.getByRole('term').filter({ hasText: "Your lab's range:" })).toBeVisible();
    await expect(progesterone.getByRole('definition').filter({ hasText: '0.2–25 ng/mL' })).toBeVisible();
    // Not supplied: said plainly, never back-filled from the catalog.
    await expect(card(page, 'Estradiol (E2)').getByRole('definition').filter({ hasText: 'Not provided on your report' })).toBeVisible();
  });
});

test.describe('cycle phase recorded on the report', () => {
  test.use({ authenticated: true, syntheticReports: [lutealPhaseReport] });

  test('6. valid context enables the context path, qualified by review state', async ({ page }) => {
    await openReport(page, lutealPhaseReport.report.id);
    // With the phase known, the low luteal progesterone becomes the primary finding.
    await expandSystem(page, 'Hormones & Reproductive', true);
    const progesterone = card(page, 'Progesterone');
    await expect(progesterone.getByRole('note')).toHaveCount(0);
    await expect(progesterone.getByRole('term').filter({ hasText: 'Amani context band (luteal phase):' })).toBeVisible();
    await expect(progesterone.getByRole('definition').filter({ hasText: '5–25 ng/mL · Disputed range, under review' })).toBeVisible();
    await expect(progesterone.getByText('Outside Amani band', { exact: true })).toBeVisible();
    await expect(progesterone.getByRole('definition').filter({ hasText: '0.2–25 ng/mL' })).toBeVisible();
    await expect(progesterone.getByText('2.0', { exact: true })).toBeVisible();
    await expect(page.getByText(/\bOptimal\b/)).toHaveCount(0);
  });
});
