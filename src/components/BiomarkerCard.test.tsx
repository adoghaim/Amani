// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEntry } from '../lib/biomarkers/dictionary';
import { BiomarkerCard } from './BiomarkerCard';

// Synthetic values only; no patient data.
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

function render(props: Parameters<typeof BiomarkerCard>[0]) {
  act(() => root.render(<BiomarkerCard {...props} />));
  return host.textContent ?? '';
}
const labRow = () => [...host.querySelectorAll('dt')].find(dt => dt.textContent === "Your lab's range:")?.nextElementSibling?.textContent;
const amaniRow = () => [...host.querySelectorAll('dt')].find(dt => dt.textContent?.startsWith('Amani context band'));

describe('BiomarkerCard — lab range and Amani context band are separate (invariants 1, 2, 5)', () => {
  it('shows the report interval under its own label and the Amani band with its review state', () => {
    const text = render({ name: 'tsh', value: 2.1, unit: 'mIU/L', labRefMin: 0.45, labRefMax: 4.5, cyclePhase: null });
    expect(labRow()).toBe('0.45–4.5 mIU/L');
    expect(amaniRow()?.textContent).toBe('Amani context band:');
    expect(amaniRow()?.nextElementSibling?.textContent).toBe('1–2.5 mIU/L · Not yet reviewed');
    expect(text).toContain('2.1');
  });

  // Review F011: the band is in the catalog unit and no conversion is approved,
  // so a value in another unit shows only her lab's interval, never a band.
  it.each([
    ['ldl_cholesterol', 4.9, 'mmol/L', 0, 3, '0–3 mmol/L'],
    ['fasting_glucose', 5.2, 'mmol/L', 3.9, 5.5, '3.9–5.5 mmol/L'],
    ['calcium', 4.8, 'mEq/L', 4.3, 5.3, '4.3–5.3 mEq/L'],
  ] as const)('%s %s %s: no Amani band, only the lab range', (name, value, unit, labRefMin, labRefMax, interval) => {
    const text = render({ name, value, unit, labRefMin, labRefMax, cyclePhase: null });
    expect(labRow()).toBe(interval);
    expect(amaniRow()).toBeUndefined();
    expect(host.querySelector('[role="note"]')).toBeNull();
    expect(text).toContain('No Amani band');
    expect(text).not.toMatch(/Within Amani band|Outside Amani band/);
  });

  // Review-2 (owner, 2026-10-23): uIU/mL is a catalog-recorded 1:1 equivalent of
  // TSH's catalog unit mIU/L, so the card shows the same band numbers as for
  // mIU/L, written in the unit her lab printed.
  it('TSH printed in uIU/mL shows the Amani band, as in mIU/L', () => {
    render({ name: 'tsh', value: 2.1, unit: 'uIU/mL', labRefMin: 0.45, labRefMax: 4.5, cyclePhase: null });
    expect(labRow()).toBe('0.45–4.5 uIU/mL');
    expect(amaniRow()?.textContent).toBe('Amani context band:');
    expect(amaniRow()?.nextElementSibling?.textContent).toBe('1–2.5 uIU/mL · Not yet reviewed');
  });

  it('never presents the catalog lab_reference row as the patient\'s lab range', () => {
    const catalogClinical = getEntry('tsh')!.clinical;
    const text = render({ name: 'tsh', value: 2.1, unit: 'uIU/mL', labRefMin: null, labRefMax: null, cyclePhase: null });
    expect(labRow()).toBe('Not provided on your report');
    expect(text).not.toContain(`${catalogClinical.min}–${catalogClinical.max}`);
    expect(text).not.toMatch(/Lab \d/);
  });

  it('shows a one-sided report interval', () => {
    render({ name: 'ldl_cholesterol', value: 130, unit: 'mg/dL', labRefMin: null, labRefMax: 100, cyclePhase: null });
    expect(labRow()).toBe('≤ 100 mg/dL');
  });
});

describe('BiomarkerCard — withheld context (invariants 3, 4, 5)', () => {
  it('a cycle-dependent hormone without a phase gets no Amani score, but keeps value and lab range', () => {
    const text = render({ name: 'progesterone', value: 2, rawValueText: '2.0', unit: 'ng/mL', labRefMin: 0.2, labRefMax: 25, cyclePhase: null });
    expect(text).toContain('2.0');
    expect(labRow()).toBe('0.2–25 ng/mL');
    expect(amaniRow()).toBeUndefined();
    const note = host.querySelector('[role="note"]');
    expect(note?.textContent).toContain('Amani context score unavailable');
    expect(note?.textContent).toContain('Add or confirm your cycle phase for a more specific interpretation.');
    expect(text).toContain('Context needed');
    expect(text).not.toMatch(/optimal|Within Amani band|Outside Amani band|Borderline|Normal/i);
    // The unphased fallback band (0.1–25) must not appear as an Amani band.
    expect(text).not.toContain('Amani 0.1');
  });

  it('withholds on the "unknown" phase string the database stores', () => {
    render({ name: 'estradiol', value: 120, unit: 'pg/mL', labRefMin: null, labRefMax: null, cyclePhase: 'unknown' });
    expect(host.querySelector('[role="note"]')?.textContent).toContain('Amani context score unavailable');
    expect(labRow()).toBe('Not provided on your report');
  });

  // Review F012: her declared pregnancy withholds even when the report carries a menstrual phase.
  it.each([
    ['pregnancy', 'during pregnancy'],
    ['postpartum', 'postpartum'],
  ] as const)('withholds a phased TSH when she declared %s', (state, copy) => {
    const text = render({ name: 'tsh', value: 2.1, unit: 'mIU/L', labRefMin: 0.45, labRefMax: 4.5, cyclePhase: 'luteal', state });
    expect(labRow()).toBe('0.45–4.5 mIU/L');
    expect(amaniRow()).toBeUndefined();
    const note = host.querySelector('[role="note"]')?.textContent ?? '';
    expect(note).toContain('Amani context score unavailable');
    expect(note).toContain(copy);
    expect(text).not.toMatch(/Within Amani band|Outside Amani band/);
  });

  it('withholds in pregnancy with state-specific copy', () => {
    render({ name: 'progesterone', value: 30, unit: 'ng/mL', labRefMin: null, labRefMax: null, cyclePhase: 'pregnancy_t2' });
    const note = host.querySelector('[role="note"]')?.textContent ?? '';
    expect(note).toContain('during pregnancy');
    expect(note).not.toContain('Add or confirm your cycle phase');
  });

  it('a recorded phase enables the phase-specific band, still qualified by review state', () => {
    const text = render({ name: 'progesterone', value: 2, unit: 'ng/mL', labRefMin: 0.2, labRefMax: 25, cyclePhase: 'luteal' });
    expect(host.querySelector('[role="note"]')).toBeNull();
    expect(amaniRow()?.textContent).toBe('Amani context band (luteal phase):');
    expect(amaniRow()?.nextElementSibling?.textContent).toBe('5–25 ng/mL · Disputed range, under review');
    expect(labRow()).toBe('0.2–25 ng/mL');
    expect(text).toContain('Outside Amani band');
  });

  it('an in-band value on an unreviewed band never reads "Optimal"', () => {
    const text = render({ name: 'tsh', value: 2, unit: 'mIU/L', labRefMin: 0.45, labRefMax: 4.5, cyclePhase: null });
    expect(text).toContain('Within Amani band');
    expect(text).not.toMatch(/\bOptimal\b/);
    act(() => host.querySelector('button')!.click());
    expect(host.textContent).not.toMatch(/\bOptimal\b/);
    expect(host.textContent).toContain('Within your lab\'s range');
  });
});

/*
  Review F021. A result printed as a limit is stored with a placeholder number
  (eGFR '> OR = 60' as 60, vitamin D '<8' as 4). The card placed, plotted and
  classified that number: "Outside Amani band" and a dot at 60 for a result that
  may sit anywhere from 60 up. Synthetic values only.
*/
describe('BiomarkerCard — a censored result is never placed or plotted by its placeholder (F021)', () => {
  const dot = () => host.querySelector('[data-testid="measurement-dot"]');
  const expand = () => act(() => host.querySelector('button')!.click());

  it('eGFR "> OR = 60": no placement, no plotted value, and the note states the printed result', () => {
    const text = render({ name: 'egfr', value: 60, rawValueText: '> OR = 60', unit: 'mL/min/1.73m2', labRefMin: null, labRefMax: null, cyclePhase: null });
    expect(text).toContain('> OR = 60');
    expect(text).toContain('Context needed');
    expect(text).not.toMatch(/Within Amani band|Outside Amani band/);
    expect(dot()).toBeNull();
    const note = host.querySelector('[role="note"]')?.textContent ?? '';
    expect(note).toContain('Amani context score unavailable');
    expect(note).toContain('> OR = 60');
    expect(note).not.toMatch(/band|below|above|within|outside|cycle/i);
  });

  it('vitamin D "<8" below a band starting at 50: placed outside, but no dot at the placeholder', () => {
    const text = render({ name: 'vitamin_d_25_oh', value: 4, rawValueText: '<8', unit: 'ng/mL', labRefMin: 30, labRefMax: 100, cyclePhase: null });
    expect(text).toContain('Outside Amani band');
    expect(amaniRow()?.nextElementSibling?.textContent).toContain('50–80 ng/mL');
    expect(dot()).toBeNull();
    expect(text).not.toMatch(/\b3\.6\b/);
    expand();
    // '<8' is below her lab's 30–100 wherever it lies.
    expect(host.textContent).toContain("Below your lab's range");
  });

  it('"<8" against a lab interval of 5–20 is not placed against that interval', () => {
    render({ name: 'vitamin_d_25_oh', value: 4, rawValueText: '<8', unit: 'ng/mL', labRefMin: 5, labRefMax: 20, cyclePhase: null });
    expand();
    expect(host.textContent).not.toMatch(/Below your lab's range|Within your lab's range|Above your lab's range/);
    expect(host.textContent).toContain('Reported as a limit');
  });

  it('a measured value keeps its dot and its lab placement (control)', () => {
    const text = render({ name: 'vitamin_d_25_oh', value: 4, rawValueText: '4', unit: 'ng/mL', labRefMin: 5, labRefMax: 20, cyclePhase: null });
    expect(text).toContain('Outside Amani band');
    expect(dot()).not.toBeNull();
    expand();
    expect(host.textContent).toContain("Below your lab's range");
  });
});
