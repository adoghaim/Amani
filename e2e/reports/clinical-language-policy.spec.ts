import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { stage2CurrentReport, stage2PriorReport } from './synthetic-reports';

/*
  V2-03b Stage 2 in a real browser, against the real ReportView, with
  synthetic rows behind the network guard. The logic twin is
  src/pages/ReportView.language.test.tsx; both are page-wide by default
  (standing rule 1) and every scoped check here is added, never substituted.
*/

// Concepts, not strings: judgement, advice, urgency, reassurance, conditions,
// app-made lab margins and Amani-derived high/low labels.
const FORBIDDEN = /borderline|optimal|optimi[sz]|\bnormal\b|abnormal|worsen|deteriorat|improv|better|worse|healthy|reassur|concern|worth (?:discussing|monitoring|tracking|reviewing|focusing)|talk to your doctor|seek care|urgent|priorit|needs attention|mild attention|elevated|deficien|insufficien|resistance|pcos|autoimmun|\brisk\b|should|recommend|keep an eye|right direction|wrong direction|stable overall/i;

function hits(text: string): string[] {
  return [...text.matchAll(new RegExp(FORBIDDEN.source, 'gi'))].map(m => text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40));
}

async function clickAll(page: Page, selector: string) {
  // Each click can re-render the list, so always take the first remaining one.
  for (let i = 0; i < 40; i++) {
    const next = page.locator(selector).first();
    if (await next.count() === 0) return;
    await next.click();
  }
  throw new Error(`more than 40 ${selector}`);
}

/** Opens every surface: systems, biomarker and guidance cards, patterns, flag cards, full lab panel. */
async function openEverything(page: Page) {
  await page.goto(`/app/reports/${stage2CurrentReport.report.id}`);
  await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();
  await clickAll(page, 'button[aria-expanded="false"]:not(article button)');
  await clickAll(page, 'article button[aria-expanded="false"]');
  await page.getByRole('button', { name: /^Patterns & Insights/ }).click();
  await expect(page.getByRole('heading', { name: 'Pattern-rule matches', exact: true })).toBeVisible();
  const flags = page.getByRole('button', { name: /pattern-rule match/ });
  await expect(flags).toHaveCount(2);
  for (let i = 0; i < 2; i++) await flags.nth(i).click();
  await page.getByRole('button', { name: /^Full lab panel/ }).click();
  await expect(page.getByText('Sodium', { exact: true })).toBeVisible();
}

/** Page text, minus the policy's own product disclaimers (CLINICAL_ACTION, result-independent). */
async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const el of clone.querySelectorAll('[data-language-source="product_disclaimer"]')) el.remove();
    return clone.textContent ?? '';
  });
}

test.describe('V2-03b Stage 2 — every surface speaks only policy language', () => {
  test.use({ authenticated: true, syntheticReports: [[stage2CurrentReport, stage2PriorReport], { scope: 'test' }] });

  test('the fixture renders every migrated surface', async ({ page }) => {
    await openEverything(page);
    for (const heading of ['Your trajectory', 'Focus areas', 'Health systems', 'Derived metrics', 'Support plan',
      'Related markers not on this report', 'Your health story']) {
      await expect(page.getByRole('heading', { name: heading, exact: true }), heading).toBeVisible();
    }
    await expect(page.getByTestId('primary-movement-observation')).toBeVisible();
    await expect(page.getByRole('article', { name: / result$/ })).toHaveCount(5);
    await expect(page.locator('article [data-language-source="patient_lab_interval"]')).toHaveCount(5);
  });

  test('page-wide: no judgement, advice, condition, urgency or reassurance anywhere', async ({ page }) => {
    await openEverything(page);
    expect(hits(await pageText(page))).toEqual([]);
    // The model's headline and primary concern carried every claim class; none renders.
    await expect(page.getByText('Your thyroid has worsened', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Thyroid is the top priority', { exact: false })).toHaveCount(0);
    // Pattern rules state a match, never a condition.
    await expect(page.getByRole('button', { name: /^HbA1c: pattern-rule match/ })).toBeVisible();
    await expect(page.getByText(/Elevated HbA1c|Iron Deficiency|insulin resistance|Discuss with provider/)).toHaveCount(0);
  });

  test('release invariant 1: the lab-panel row states placement exactly as her lab printed it', async ({ page }) => {
    await openEverything(page);
    const row = page.locator('div').filter({ has: page.getByText('Sodium', { exact: true }) })
      .filter({ has: page.locator('[data-language-source="patient_lab_interval"]') }).last();
    await expect(row.locator('[data-language-source="patient_lab_interval"]')).toHaveText("Above your lab's range");
    await expect(row.getByText(/borderline/i)).toHaveCount(0);
    for (const text of await page.locator('[data-language-source="patient_lab_interval"]').allTextContents()) {
      expect(text).toMatch(/^(?:Above|Below|Within) your lab's range$/);
    }
  });

  test('R3 and safety direction 2: no band-derived colour, cue, alert or safety warning', async ({ page }) => {
    await openEverything(page);
    await expect(page.locator('[data-language-category="safety_warning"]')).toHaveCount(0);
    await expect(page.locator('[data-language-cue="warning"], [data-language-cue="critical"], [role="alert"]')).toHaveCount(0);
    const offenders = await page.locator('[data-language-category="comparison_band"], [data-language-category="factual_observation"]')
      .evaluateAll(nodes => nodes.flatMap(n => [n, ...Array.from(n.querySelectorAll('*')), n.parentElement, n.parentElement?.parentElement])
        .filter((el): el is Element => !!el && /flag-(?:ok|watch|low)/.test(el.getAttribute('class') ?? ''))
        .map(el => `${el.tagName} ${el.getAttribute('class')}`));
    expect(offenders).toEqual([]);
    for (const label of await page.locator('[aria-label]').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') ?? ''))) {
      expect(label).not.toMatch(FORBIDDEN);
    }
  });
});
