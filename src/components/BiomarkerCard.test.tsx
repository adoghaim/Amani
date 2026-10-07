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
    const text = render({ name: 'tsh', value: 2.1, unit: 'uIU/mL', labRefMin: 0.45, labRefMax: 4.5, cyclePhase: null });
    expect(labRow()).toBe('0.45–4.5 uIU/mL');
    expect(amaniRow()?.textContent).toBe('Amani context band:');
    expect(amaniRow()?.nextElementSibling?.textContent).toBe('1–2.5 uIU/mL · Not yet reviewed');
    expect(text).toContain('2.1');
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
    const text = render({ name: 'tsh', value: 2, unit: 'uIU/mL', labRefMin: 0.45, labRefMax: 4.5, cyclePhase: null });
    expect(text).toContain('Within Amani band');
    expect(text).not.toMatch(/\bOptimal\b/);
    act(() => host.querySelector('button')!.click());
    expect(host.textContent).not.toMatch(/\bOptimal\b/);
    expect(host.textContent).toContain('Within your lab\'s range');
  });
});
