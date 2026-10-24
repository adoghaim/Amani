import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import {
  egfrHigherIsBetterReport, ferritinDecreased, higherIsBetterReport, modelCanaries, modelProseCurrentReport,
  smokePanelReport, stage2CurrentReport, stage2ModelNextSteps, stage2PriorReport, tshIncreased,
} from './synthetic-reports';

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
    for (const heading of ['Your trajectory', 'Focus areas', 'Health systems', 'Derived metrics', 'About these body systems',
      'Related markers not on this report', 'Your health story', 'Questions you could bring to a clinician']) {
      await expect(page.getByRole('heading', { name: heading, exact: true }), heading).toBeVisible();
    }
    await expect(page.getByTestId('primary-movement-observation')).toBeVisible();
    const movementClaims = page.locator('[data-language-claim="measured_movement"]');
    expect(await movementClaims.count()).toBeGreaterThan(0);
    for (const claim of await movementClaims.all()) {
      await expect(claim).toHaveAttribute('data-language-source', 'lab_data');
      await expect(claim).toHaveAttribute('data-language-category', 'factual_observation');
      await expect(claim).toHaveAttribute('data-language-cue', 'neutral');
      expect(hits(await claim.innerText())).toEqual([]);
    }
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

  // Owner R2: preparation, not escalation. Premises are her values and her lab interval only.
  test('R2: discussion-prep questions are neutral, rest on admissible premises and agree with the page', async ({ page }) => {
    await openEverything(page);
    const card = page.getByTestId('prep-questions');
    await expect(card).toContainText('They are preparation only, not a judgment about your results.');
    const items = card.locator('[data-language-category]');
    await expect(items).toHaveCount(4);
    for (const item of await items.all()) {
      await expect(item).toHaveAttribute('data-language-category', 'discussion_prep');
      await expect(item).toHaveAttribute('data-language-cue', 'neutral');
      expect(await item.getAttribute('data-premises')).toMatch(/^(?:(?:measured_change|patient_lab_interval)(?: |$))*$/);
      expect(await item.innerText()).not.toMatch(PREP_FORBIDDEN);
    }
    // The card itself and everything in it.
    await expect(page.locator(['[role="alert"]', '[data-language-cue="warning"]', '[data-language-cue="critical"]']
      .flatMap(s => [`[data-testid="prep-questions"]${s}`, `[data-testid="prep-questions"] ${s}`]).join(', '))).toHaveCount(0);
    expect(await card.evaluate(el => el.outerHTML)).not.toMatch(/flag-(?:ok|watch|low)/);
    // Standing rule 5: the same facts, stated the same way elsewhere on the page.
    await expect(items.nth(0)).toHaveText('My TSH changed from 6 to 9 uIU/mL. What could explain this change, and is it clinically meaningful?');
    // PK-FIX-02: a title-case display name reads in sentence case mid-sentence; acronyms keep their capitals.
    await expect(items.nth(1)).toHaveText('My ferritin changed from 25 to 20 ng/mL. What could explain this change, and is it clinically meaningful?');
    await expect(page.getByTestId('primary-movement-observation')).toContainText('from 6 to 9 uIU/mL');
    await expect(items.nth(2)).toContainText("above my lab's reference interval of 4–5.6 %");
    const hba1c = page.getByRole('article', { name: 'HbA1c result', exact: true });
    await expect(hba1c.locator('[data-language-source="patient_lab_interval"]')).toHaveText("Above your lab's range");
    await expect(hba1c).toContainText("Your lab's range:4–5.6 %");
  });

  // Owner R4: no personalized food, nutrient, supplement or lifestyle recommendation without a Clinical Truth rule.
  test('R4: model next steps and food or nutrient lists never render; education is labelled and policy-authored', async ({ page }) => {
    await openEverything(page);
    for (const step of stage2ModelNextSteps) await expect(page.getByText(step, { exact: false })).toHaveCount(0);
    expect(nutritionHits(await pageText(page))).toEqual([]);
    await expect(page.getByText('General information about the systems on this report. It is not advice about your results.')).toBeVisible();
    const education = page.locator('[data-language-category="educational_content"]');
    await expect(education).toHaveCount(2);
    for (const el of await education.all()) await expect(el).toHaveAttribute('data-language-source', 'general_education');
  });
});

/*
  Owner R1, turn 13. The same pair with model-shaped prose in every model
  field, none of it carrying a forbidden word, so the page-wide prohibition
  cannot be the proof. The proof is positive: no canary on the page, every
  model-derived element is exactly one neutral lab-data claim with an issued
  phrase, and every text node inside a model surface sits inside a policy
  element. Logic twin: "owner R1" in src/pages/ReportView.language.test.tsx.
*/
test.describe('R1: model prose renders only as the report\'s own measured-change claims', () => {
  test.use({ authenticated: true, syntheticReports: [[modelProseCurrentReport, stage2PriorReport], { scope: 'test' }] });

  test('no canary renders; each model-derived sentence is a resolvable claim on its own marker', async ({ page }) => {
    await page.goto(`/app/reports/${modelProseCurrentReport.report.id}`);
    await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();
    await clickAll(page, 'button[aria-expanded="false"]:not(article button)');
    await clickAll(page, 'article button[aria-expanded="false"]');
    await page.getByRole('button', { name: /^Patterns & Insights/ }).click();
    await expect(page.getByText('Cycle context', { exact: true })).toBeVisible();

    const text = await page.evaluate(() => document.body.textContent ?? '');
    for (const canary of modelCanaries) expect(text, canary).not.toContain(canary);
    expect(text).not.toContain('Your thyroid health has worsened');

    const fields = await page.locator('[data-model-field]').evaluateAll(nodes => nodes.map(n => [
      n.getAttribute('data-model-field'), n.textContent, n.closest('[data-model-surface]')?.getAttribute('data-model-surface') ?? null,
    ]));
    expect(fields).toEqual([
      ['interpretation.summary_bullets', tshIncreased, 'summary_bullets'],
      ['interpretation.pattern_signals.explanation', ferritinDecreased, 'pattern_signals'],
      ['interpretation.biomarkers.common_non_alarm_reasons', tshIncreased, 'marker'],
    ]);
    for (const field of await page.locator('[data-model-field]').all()) {
      const claim = field.locator('[data-language-claim="measured_movement"]');
      await expect(claim).toHaveCount(1);
      await expect(claim).toHaveAttribute('data-language-category', 'factual_observation');
      await expect(claim).toHaveAttribute('data-language-source', 'lab_data');
      await expect(claim).toHaveAttribute('data-language-cue', 'neutral');
      expect(await claim.innerText()).toBe(await field.innerText());
    }
    const tsh = page.getByRole('article', { name: 'TSH result', exact: true });
    await expect(tsh).toContainText(tshIncreased);
    await expect(tsh).not.toContainText(ferritinDecreased);

    // Positive provenance: every text node in a model surface is inside a policy element.
    const unprovenanced = await page.evaluate(() => {
      const out: string[] = [];
      for (const surface of Array.from(document.querySelectorAll('[data-model-surface]'))) {
        const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const t = (node.textContent ?? '').trim();
          if (!t || t === 'Measured changes') continue;
          const owner = node.parentElement?.closest('[data-language-category]');
          if (!owner || !surface.contains(owner)) out.push(t);
        }
      }
      return out;
    });
    expect(unprovenanced).toEqual([]);
    expect(await page.locator('[data-model-surface="pattern_signals"]').evaluate(el => el.outerHTML)).not.toMatch(/flag-(?:ok|watch|low)|confidence/i);
    await expect(page.locator('[data-language-source="product_disclaimer"]', { hasText: 'This report is for educational purposes only' })).toHaveCount(1);
  });
});

const PREP_FORBIDDEN = /worse|worsen|getting (?:better|worse)|treat|medication|danger|urgent|emergency|seek|need(?:s)? (?:medical )?care|should|improv|better|optimal|normal|abnormal|concern|elevated|Amani|band/i;
const NUTRITION_ADVICE = /foods? to focus|topics to discuss|track next|next best steps|iron-rich|eat more|\bsupplement|\bdose\b|\b\d+\s?(?:IU|mg|mcg|µg)\b(?!\/)|daily|per day|sunlight|walk for|exercise|retest/i;
function nutritionHits(text: string): string[] {
  return [...text.matchAll(new RegExp(NUTRITION_ADVICE.source, 'gi'))].map(m => text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40));
}

// Owner R3: marketing has no clinical-language exemption.
const MARKETING_FORBIDDEN = new RegExp(`${FORBIDDEN.source}|worr\\w*|sits where it should|\\b(?:is|are) (?:low|high)\\b|what each marker means|worth (?:raising|asking)`, 'i');

test.describe('R3: the landing page says nothing Amani may not say to a real user', () => {
  test('page-wide prohibition, context not judgement, and specimen statements that agree with their rows', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Your labs, read in context.' })).toBeVisible();
    const legal = 'Amani is educational. It does not diagnose, prescribe, or replace your clinician — it helps you walk into the appointment knowing what to ask. Anything that concerns you belongs in front of a licensed provider.';
    const text = await page.evaluate(legalText => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      for (const el of clone.querySelectorAll('p')) if ((el.textContent ?? '').replace(/\s+/g, ' ').trim() === legalText) el.remove();
      return clone.textContent ?? '';
    }, legal);
    expect([...text.matchAll(new RegExp(MARKETING_FORBIDDEN.source, 'gi'))].map(m => text.slice(Math.max(0, m.index - 40), m.index + 40))).toEqual([]);
    await expect(page.getByText('Hormone results can mean different things at different points in the menstrual cycle. Amani asks for the missing context instead of guessing.')).toBeVisible();
    // Standing rule 5: the row prints 18 within 15–150 ng/mL, and the statements say exactly that.
    const ferritin = page.locator('[data-specimen-row="ferritin"]');
    await expect(ferritin.locator('[data-specimen-value]')).toHaveText('18');
    await expect(ferritin.locator('[data-specimen-interval]')).toHaveText('15–150 ng/mL');
    await expect(ferritin.locator('[data-language-cue]')).toHaveAttribute('data-language-cue', 'neutral');
    const statements = page.getByTestId('specimen-statements');
    await expect(statements).toHaveText("Your ferritin is within your laboratory's reference interval. Ferritin has dropped from 41 to 18 ng/mL.");
    for (const row of await page.locator('[data-specimen-row]').all()) {
      expect(await row.innerHTML()).not.toMatch(/flag-(?:ok|watch|low)/);
    }
  });
});


for (const { report, name, min, max, unit } of [
  { report: higherIsBetterReport, name: 'HDL', min: 60, max: 90, unit: 'mg/dL' },
  { report: egfrHigherIsBetterReport, name: 'eGFR', min: 90, max: 200, unit: 'mL/min/1.73m²' },
]) test.describe(`${name} higher-is-better placement agreement`, () => {
  test.use({ authenticated: true, syntheticReports: [[report], { scope: 'test' }] });

  test('every page placement agrees while its lab interval remains independent', async ({ page }) => {
    await page.goto(`/app/reports/${report.report.id}`);
    await expect(page.getByRole('heading', { name: 'Health systems', exact: true })).toBeVisible();
    await clickAll(page, 'button[aria-expanded="false"]:not(article button)');
    await clickAll(page, 'article button[aria-expanded="false"]');
    const card = page.getByRole('article', { name: `${name} result`, exact: true });
    await expect(card).toBeVisible();
    await expect(card).toContainText(`Amani context band:≥ ${min} ${unit}`);
    await expect(card).toContainText(`Amani ≥ ${min}`);
    await expect(card).not.toContainText(`${min}–${max}`);
    const geometry = await card.evaluate(element => {
      const region = element.querySelector<HTMLElement>('[data-testid="comparison-region"]')!;
      const dot = element.querySelector<HTMLElement>('[data-testid="measurement-dot"]')!;
      const left = parseFloat(region.style.left);
      return { left, right: left + parseFloat(region.style.width), position: Number(dot.style.left.match(/([\d.]+)%/)![1]) };
    });
    expect(geometry.right).toBeCloseTo(100);
    expect(geometry.position).toBeGreaterThanOrEqual(geometry.left);
    expect(geometry.position).toBeLessThanOrEqual(geometry.right);

    const bandPills = card.getByText('Within Amani band', { exact: true });
    await expect(bandPills).toHaveCount(2);
    await expect(bandPills.nth(0)).toBeVisible();
    await expect(bandPills.nth(1)).toBeVisible();
    await expect(card.locator('[data-language-source="patient_lab_interval"]')).toHaveText("Above your lab's range");
    await expect(page.locator('h2 [data-language-source="patient_lab_interval"]')).toContainText("above your lab's reference range");
    await expect(page.getByText('Scored markers within Amani bands', { exact: true })).toBeVisible();
    await expect(page.getByText("No scored marker on this report is outside Amani's comparison bands.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Focus areas', exact: true })).toBeVisible();
    await expect(page.getByText('Outside Amani band', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-language-category="comparison_band"][data-language-cue="attention"], [data-language-cue="warning"], [data-language-cue="critical"]')).toHaveCount(0);
    expect(hits(await pageText(page))).toEqual([]);
  });
});


test.describe('October smoke panel consistency', () => {
  test.use({ authenticated: true, syntheticReports: [[smokePanelReport], { scope: 'test' }] });
  test('lab facts, primary finding, story and comparison bands agree', async ({ page }, testInfo) => {
    await page.goto(`/app/reports/${smokePanelReport.report.id}`);
    await expect(page.getByTestId('primary-finding')).toContainText("Vitamin D is below your lab's reference range at 24 ng/mL.");
    await expect(page.getByText(/^Vitamin D is the primary finding shown above\./)).toBeVisible();
    await expect(page.locator('h2 [data-language-source="patient_lab_interval"]')).toHaveText([
      "Vitamin D is below your lab's reference range at 24 ng/mL. ",
      "LDL is above your lab's reference range at 112 mg/dL. ",
    ]);
    await expect(page.getByText(/mainly about iron/)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('summary.png') });
    for (const label of [/^Thyroid\b/, /^Lipids & Cardiovascular\b/]) {
      await page.getByRole('button', { name: label }).and(page.locator('[aria-expanded="false"]')).click();
    }
    for (const name of ['Ferritin', 'TSH']) {
      const card = page.getByRole('article', { name: `${name} result`, exact: true });
      await expect(card).toContainText("Within your lab's range");
      await expect(card).toContainText("Amani's comparison band is separate from your lab's range and is still under clinical review.");
    }
    await page.screenshot({ path: testInfo.outputPath('smoke-panel-consistency.png'), fullPage: true });
  });
});
