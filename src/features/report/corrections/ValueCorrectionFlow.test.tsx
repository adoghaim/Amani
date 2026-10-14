// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

import { axeViolations } from '../../../components/axe.testkit';
import { CORRECTION_INPUT_ERROR } from '../../../lib/corrections/correctionInput';
import type { CorrectionPort, CorrectionRequest } from '../../../lib/corrections/correctAnalyte';
import { uploadFlag } from '../../../lib/scoring/uploadFlag';
import type { Biomarker, ReportAnalyte } from '../../../types';
import { ValueCorrectionFlow } from './ValueCorrectionFlow';

/*
  PK-CORRECT-01: "A value is wrong" (D20), Q1 input and R23's confirm step.
  Proof required by R23: a change of more than 10 times up or down asks once,
  10 times or less does not, and "Yes, save it" saves.
*/

const analyte = (over: Partial<ReportAnalyte>): ReportAnalyte => ({
  id: 'ra-ferritin', lab_report_id: 'report-1', raw_name: 'Ferritin', raw_value_text: '150', value_numeric: 150,
  unit: 'ng/mL', raw_reference_range: '15-150', normalized_min: 15, normalized_max: 150, normalized_operator: null,
  normalized_operator_value: null, source_snippet: null, confidence_score: 'high', canonical_analyte_id: null,
  canonical_slug: 'ferritin', parse_status: 'mapped', needs_review: false, is_core: true, created_at: '2026-09-01',
  ...over,
});
const values = [
  analyte({}),
  analyte({ id: 'ra-baso', raw_name: 'Basophils', raw_value_text: '1', value_numeric: 1, unit: '%', canonical_slug: null, is_core: false }),
  analyte({ id: 'ra-empty', raw_name: 'Comment', raw_value_text: null, value_numeric: null, unit: null, canonical_slug: null, is_core: false }),
];
const biomarkers = [{ id: 'b-1', lab_report_id: 'report-1', name: 'ferritin', value: 150, raw_value_text: '150', unit: 'ng/mL',
  reference_min: 15, reference_max: 150, flagged: 'in_range' }] as Biomarker[];

let root: Root;
let app: HTMLDivElement;
let saved: CorrectionRequest[];
let result: { ok: true; correctedAt: string | null } | { ok: false };
let onCorrected: ReturnType<typeof vi.fn>;
const port: CorrectionPort = { correctAnalyte: async request => { saved.push(request); return result; } };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom has no scrolling; the shared Modal's scroll lock restores a position.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  saved = [];
  result = { ok: true, correctedAt: '2026-10-14T10:00:00.000Z' };
  onCorrected = vi.fn();
  app = document.createElement('div');
  app.id = 'root';
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open() {
  await act(async () => root.render(
    <ValueCorrectionFlow open onClose={() => {}} values={values} biomarkers={biomarkers} cyclePhase="follicular"
      onCorrected={onCorrected} port={port} />,
  ));
}
const step = () => document.querySelector('[data-value-correction-step]')!.getAttribute('data-value-correction-step');
const button = (label: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === label);
const click = async (label: string) => { await act(async () => button(label)!.click()); };
const field = (label: string) => {
  const l = Array.from(document.querySelectorAll('label')).find(x => x.textContent === label)!;
  return document.getElementById(l.htmlFor) as HTMLInputElement;
};
async function type(label: string, text: string) {
  const input = field(label);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function pickFerritin() {
  await act(async () => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.startsWith('Ferritin'))!.click());
}

describe('"A value is wrong": pick a saved value, enter what the report says', () => {
  it('lists the saved values that hold a value, with labelled fields and no axe violations', async () => {
    await open();
    expect(step()).toBe('pick');
    const list = document.querySelector('ul[aria-label="Saved values"]')!;
    expect(Array.from(list.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Ferritin150 ng/mL', 'Basophils1 %']);
    expect(await axeViolations(document.body)).toEqual([]);
    await pickFerritin();
    expect(step()).toBe('enter');
    expect(document.activeElement?.tagName).toBe('H3');
    expect(document.body.textContent).toContain('Amani read 150 ng/mL.');
    expect(field('Value on your report')).toBeTruthy();
    expect(field('Unit').value).toBe('ng/mL');
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('a small correction saves at once, re-scored by the upload\'s code, and tells the page', async () => {
    await open();
    await pickFerritin();
    await type('Value on your report', '45,0');
    await click('Save');
    expect(saved).toEqual([{ reportAnalyteId: 'ra-ferritin', value: 45, rawText: '45.0', unit: 'ng/mL',
      flag: uploadFlag('ferritin', 45, 'follicular') }]);
    expect(step()).toBe('saved');
    expect(onCorrected).toHaveBeenCalledWith('2026-10-14T10:00:00.000Z');
    expect(document.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('a value with no biomarkers row is saved with no flag, its unit normalized', async () => {
    await open();
    await act(async () => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.startsWith('Basophils'))!.click());
    await type('Value on your report', '<2');
    await type('Unit', 'pmol/l');
    await click('Save');
    expect(saved).toEqual([{ reportAnalyteId: 'ra-baso', value: 1, rawText: '<2', unit: 'pmol/L', flag: null }]);
  });

  it('non-numeric input is an inline error, her text is kept, and nothing is saved', async () => {
    await open();
    await pickFerritin();
    await type('Value on your report', 'about forty');
    await click('Save');
    expect(saved).toEqual([]);
    expect(step()).toBe('enter');
    const input = field('Value on your report');
    expect(input.value).toBe('about forty');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = document.getElementById(input.getAttribute('aria-describedby')!)!;
    expect(error.textContent).toBe(CORRECTION_INPUT_ERROR);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('a failed save is a calm notice with Try again, and her text stays', async () => {
    result = { ok: false };
    await open();
    await pickFerritin();
    await type('Value on your report', '45');
    await click('Save');
    expect(step()).toBe('enter');
    expect(document.body.textContent).toContain("We couldn't save your correction.");
    expect(field('Value on your report').value).toBe('45');
    expect(onCorrected).not.toHaveBeenCalled();
    result = { ok: true, correctedAt: null };
    await click('Try again');
    expect(saved).toHaveLength(2);
    expect(step()).toBe('saved');
  });
});

describe('R23: a value far from what Amani read asks once', () => {
  it.each([
    ['more than 10 times higher', '1500.1'],
    ['more than 10 times lower', '14.9'],
  ])('%s asks once; "Yes, save it" saves', async (_label, text) => {
    await open();
    await pickFerritin();
    await type('Value on your report', text);
    await click('Save');
    expect(saved).toEqual([]);
    expect(step()).toBe('confirm');
    expect(document.body.textContent).toContain(
      "That's very different from what we read (150 ng/mL). Is that what your report says?");
    expect(button('Yes, save it')).toBeTruthy();
    expect(button('Let me check')).toBeTruthy();
    expect(document.activeElement?.tagName).toBe('H3');
    expect(await axeViolations(document.body)).toEqual([]);
    await click('Yes, save it');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.value).toBe(Number(text));
    expect(step()).toBe('saved');
  });

  it.each([['exactly 10 times higher', '1500'], ['exactly 10 times lower', '15'], ['a small change', '149']])(
    '%s does not ask', async (_label, text) => {
      await open();
      await pickFerritin();
      await type('Value on your report', text);
      await click('Save');
      expect(saved).toHaveLength(1);
      expect(step()).toBe('saved');
    });

  it('"Let me check" goes back with her text kept, and saves nothing', async () => {
    await open();
    await pickFerritin();
    await type('Value on your report', '1,5');
    await click('Save');
    expect(step()).toBe('confirm');
    await click('Let me check');
    expect(step()).toBe('enter');
    expect(field('Value on your report').value).toBe('1,5');
    expect(saved).toEqual([]);
  });

  it('compares with what Amani read even after an earlier correction', async () => {
    const corrected = [analyte({ raw_value_text: '15', value_numeric: 15, correction: {
      originalValue: 150, originalRawText: '150', originalUnit: 'ng/mL', correctedAt: '2026-10-01T00:00:00Z', flag: 'in_range',
    } })];
    await act(async () => root.render(
      <ValueCorrectionFlow open onClose={() => {}} values={corrected} biomarkers={biomarkers} cyclePhase="follicular"
        onCorrected={onCorrected} port={port} />,
    ));
    expect(document.querySelector('[data-correction-mark]')?.textContent).toContain('You corrected this value');
    await pickFerritin();
    expect(document.body.textContent).toContain('Amani read 150 ng/mL.');
  });
});
