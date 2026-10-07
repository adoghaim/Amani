import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import {
  lutealPhaseReport, missingPhaseReport, movedCurrentReport, movedPriorReport,
  patternFollicularReport, patternMissingPhaseReport, trajectoryCurrentReport, trajectoryPriorReport, vitaminDReport,
} from './synthetic-reports';

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

// V2-03 amendment 2 (B1). The PCOS and luteal-insufficiency rules are
// unchanged; the page drops any pattern built from an input it withholds.
async function openInsightFlags(page: Page) {
  await page.getByRole('button', { name: /^Patterns & Insights/ }).click();
  await expect(page.getByRole('heading', { name: 'Clinical insight flags' })).toBeVisible();
}

// Amendment 4 (R2): a flag card is a button carrying its title; expanding it
// shows the description, which is where the frozen copy said "optimal".
async function expandFlag(page: Page, title: string) {
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
}

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
    // Amendment 3: the expanded card's "Why this matters" copy comes from
    // src/lib/insights and said "outside the optimal range" until qualified.
    await expect(tsh.getByText('Why this matters', { exact: true })).toBeVisible();
    await expect(tsh.getByText(/^TSH is produced by the pituitary gland/)).toBeVisible();
    // Any casing, any position, anywhere on the page.
    await expect(page.getByText(/optimal/i)).toHaveCount(0);
  });

  test('3. a cycle-dependent hormone with missing phase receives no Amani context score', async ({ page }) => {
    for (const name of ['Progesterone', 'Estradiol (E2)', 'LH', 'FSH']) {
      const marker = card(page, name);
      const note = marker.getByRole('note');
      await expect(note).toContainText('Amani context score unavailable');
      await expect(note).toContainText('Add or confirm your cycle phase for a more specific interpretation.');
      await expect(marker.getByText('Context needed', { exact: true })).toBeVisible();
      await expect(marker.getByRole('term').filter({ hasText: 'Amani context band' })).toHaveCount(0);
      await expect(marker.getByText(/Within Amani band|Outside Amani band|Borderline|Normal/)).toHaveCount(0);
      await expect(marker.getByText(/optimal/i)).toHaveCount(0);
    }
    // A system whose markers are all withheld is not summarised as reassuring.
    await expect(page.getByRole('button', { name: /^Hormones Not scored 4 markers · 0 scored by Amani$/ })).toBeVisible();
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
    // The same phase makes LH scorable against its phase band too.
    const lh = card(page, 'LH');
    await expect(lh.getByRole('note')).toHaveCount(0);
    await expect(lh.getByRole('term').filter({ hasText: 'Amani context band (luteal phase):' })).toBeVisible();
    // Amendment 3. The fixture has no AI primary_concern, so Top Priority takes
    // its deterministic fallback, which used to echo TopFinding.fact verbatim:
    // "Progesterone is below the optimal range at 2 ng/mL".
    await expect(page.getByText(
      "Progesterone is below the Amani band at 2 ng/mL. Amani's context bands are still under review.",
      { exact: true },
    )).toBeVisible();
    // The persistent half: the cycle_hormones focus area said "Reproductive-hormone
    // markers are outside the optimal range" for the life of the report.
    const focus = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Cycle hormones', exact: true }) });
    await expect(focus.getByText(/^One or more of these markers is borderline or outside its Amani band\./)).toBeVisible();
    // Any casing, any position, anywhere on the page.
    await expect(page.getByText(/optimal/i)).toHaveCount(0);
    // Amendment 4 (R2). The luteal-insufficiency card is legitimately shown
    // here, and its frozen copy said "(optimal: 5–25 ng/mL)" about a DISPUTED
    // band. With the panel open and the card expanded, it must not.
    await openInsightFlags(page);
    await expandFlag(page, 'Possible Luteal Phase Insufficiency');
    await expect(page.getByText(/^Interpretation unavailable pending clinical review\. /)).toBeVisible();
    await expect(page.getByText(/optimal/i)).toHaveCount(0);
  });
});

test.describe('pattern cards from withheld inputs', () => {
  test.use({ authenticated: true, syntheticReports: [patternMissingPhaseReport] });

  test('7. no pattern is asserted from hormones Amani withholds for a missing phase', async ({ page }) => {
    await openReport(page, patternMissingPhaseReport.report.id);
    await openInsightFlags(page);
    // A rule on an analyte that needs no context still renders: the panel is live.
    await expect(page.getByText('Elevated HbA1c', { exact: true })).toBeVisible();
    await expect(page.getByText('Possible PCOS-Related Pattern', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Possible Luteal Phase Insufficiency', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/PCOS|Progesterone is very low/)).toHaveCount(0);
  });
});

test.describe('pattern cards once context is recorded', () => {
  test.use({ authenticated: true, syntheticReports: [patternFollicularReport] });

  test('8. the same values with a recorded phase let the unchanged rule speak', async ({ page }) => {
    await openReport(page, patternFollicularReport.report.id);
    await openInsightFlags(page);
    await expect(page.getByText('Possible PCOS-Related Pattern', { exact: true })).toBeVisible();
    await expect(page.getByText('Elevated HbA1c', { exact: true })).toBeVisible();
    // Amendment 4 (R2). The card speaks, but only within what its bands
    // authorize: its frozen "outside the optimal range" sentence is replaced.
    await expandFlag(page, 'Possible PCOS-Related Pattern');
    await expect(page.getByText(/Elevated testosterone or DHEA-S with low SHBG/)).toBeVisible();
    await expect(page.getByText(/optimal/i)).toHaveCount(0);
  });
});

// Amendment 4 (R2). The vitamin D rule's frozen title is "Vitamin D Below
// Optimal"; its band is NEEDS_CONTEXT.
test.describe('an insight flag against a NEEDS_CONTEXT band', () => {
  test.use({ authenticated: true, syntheticReports: [vitaminDReport] });

  test('10. "Vitamin D Below Optimal" never renders; the card says it needs review', async ({ page }) => {
    await openReport(page, vitaminDReport.report.id);
    await openInsightFlags(page);
    await expect(page.getByText('Vitamin D needs review', { exact: true })).toBeVisible();
    await expect(page.getByText('Vitamin D Below Optimal', { exact: true })).toHaveCount(0);
    await expandFlag(page, 'Vitamin D needs review');
    await expect(page.getByText(/^More context needed\. Amani's comparison band for this result has not yet completed clinical review\. /)).toBeVisible();
    await expect(page.getByText(/optimal/i)).toHaveCount(0);
  });
});

// V2-03 amendment 2 (B2). Two reports, so "Your trajectory" actually renders.
test.describe('trajectory across two reports', () => {
  // Wrapped: Playwright reads a bare two-element array as a [value, options] tuple.
  test.use({ authenticated: true, syntheticReports: [[trajectoryCurrentReport, trajectoryPriorReport], { scope: 'test' }] });

  test('9. a crossing into an unreviewed band never reads "optimal" or "improved", and gets no green check', async ({ page }) => {
    await openReport(page, trajectoryCurrentReport.report.id);
    // The innermost element holding both the card heading and its bullet list.
    const trajectory = page.locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Your trajectory', exact: true }) })
      .filter({ has: page.getByRole('list') })
      .last();
    // Amendment 4 (R1): this read "TSH improved from borderline to within the
    // Amani band." with a green check. The TSH band is UNKNOWN.
    await expect(trajectory.getByText(
      "TSH changed from its previous range classification. Amani's comparison band for this result has not yet completed clinical review.",
      { exact: true },
    )).toBeVisible();
    await expect(trajectory.locator('[data-bullet-kind="changed"]')).toHaveCount(1);
    await expect(trajectory.locator('[data-bullet-kind="improved"]')).toHaveCount(0);
    await expect(trajectory.locator('[class*="flag-ok"]')).toHaveCount(0);
    // Factual placement in her own lab's range is still stated.
    await expandSystem(page, 'Thyroid', false);
    await card(page, 'TSH').getByRole('button').click();
    await expect(card(page, 'TSH').getByText("Within your lab's range", { exact: true })).toBeVisible();
    // Any casing, any position, anywhere on the page.
    await expect(page.getByText(/optimal/i)).toHaveCount(0);
    await expect(page.getByText(/improv|right direction/i)).toHaveCount(0);
  });
});

// Amendment 5. TSH 9 -> 6 is out of band at both reports, so there is an
// abnormal primary finding and "Your health story" renders its theme sentence.
// The fixture in test 9 ends inside the band and cannot reach this surface.
test.describe('health story for an out-of-band marker that moved', () => {
  test.use({ authenticated: true, syntheticReports: [[movedCurrentReport, movedPriorReport], { scope: 'test' }] });

  test('11. a movement toward the band reads neither "unchanged" nor "improved"', async ({ page }) => {
    await openReport(page, movedCurrentReport.report.id);
    const story = page.locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Your health story', exact: true }) })
      .locator('p')
      .filter({ hasText: /^This report is mainly about/ });
    await expect(story).toHaveCount(1);
    await expect(story).toContainText('which has changed since your prior report.');
    await expect(story).toContainText("Amani's comparison band for this result has not yet completed clinical review.");
    await expect(story).not.toContainText(/unchanged/i);
    await expect(story).not.toContainText(/improv|right direction/i);
  });
});

// V2-03b: both reports are out of band, so headline, primary observation,
// trajectory and health-story theme all render. No server safety fixture here.
for (const [label, previous, current, sentence] of [
  ['away', 6, 9, 'TSH increased from 6 to 9 uIU/mL.'],
  ['minor', 6, 6.1, 'TSH has not changed significantly: 6 to 6.1 uIU/mL.'],
] as const) {
  const prior = { ...movedPriorReport, biomarkers: movedPriorReport.biomarkers.map(b => ({ ...b, value: previous, raw_value_text: String(previous) })) };
  const latest = { ...movedCurrentReport, biomarkers: movedCurrentReport.biomarkers.map(b => ({ ...b, value: current, raw_value_text: String(current) })) };
  test.describe(`V2-03b ${label} movement`, () => {
    test.use({ authenticated: true, syntheticReports: [[latest, prior], { scope: 'test' }] });
    test('observation surfaces preserve movement without clinical meaning', async ({ page }) => {
      await openReport(page, latest.report.id);
      // Page-wide by default: no card may silently sit outside this invariant.
      await expect(page.getByText(/wrong direction|worsen|deteriorat|improv|healthier|worth discussing|talk to your doctor|seek care/i)).toHaveCount(0);
      const focus = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Thyroid function', exact: true }) });
      await expect(focus).toBeVisible();
      await expect(focus).toContainText(label === 'away'
        ? 'TSH has changed since your prior report.' : 'TSH has not changed significantly.');
      const primary = page.getByTestId('primary-movement-observation');
      await expect(primary).toBeVisible();
      await expect(primary).toContainText(sentence);
      await expect(primary.locator('[data-language-source="lab_data"]')).toHaveCount(1);
      await expect(primary.locator('[data-language-source="amani_comparison_band"]')).toHaveCount(1);
      const trajectory = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Your trajectory', exact: true }) })
        .filter({ has: page.getByRole('list') }).last();
      await expect(trajectory).toBeVisible();
      await expect(trajectory).toContainText(label === 'away'
        ? 'TSH has risen from 6 to 9 uIU/mL.' : 'TSH has not changed significantly.');
      for (const surface of [primary, trajectory]) {
        await expect(surface).not.toContainText(/worsen|deteriorat|improv|better|worse|healthy|wrong direction|worth discussing|talk to your doctor|seek care|optimal|reassur/i);
        await expect(surface.locator('[class*="flag-watch"], [class*="flag-ok"], [class*="flag-low"]')).toHaveCount(0);
        for (const label of await surface.locator('[aria-label]').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') ?? ''))) {
          expect(label).not.toMatch(/danger|worsen|improv|better|worse/i);
        }
      }
      const story = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Your health story', exact: true }) })
        .locator('p').filter({ hasText: /^This report is mainly about/ });
      await expect(story).toHaveCount(1);
      await expect(story).not.toContainText(/unchanged|wrong direction|worsen|improv/i);
      await expect(page.getByRole('heading', { name: sentence, exact: true })).toBeVisible();
    });
  });
}
