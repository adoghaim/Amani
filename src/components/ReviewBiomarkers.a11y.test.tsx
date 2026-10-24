// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportItem } from '../utils/parser/types';
import { axeViolations } from './axe.testkit';

vi.mock('../hooks/useBiomarkerCatalog', () => ({
  useBiomarkerCatalog: () => ({
    catalog: [{ slug: 'ferritin', name: 'Ferritin', unit: 'ng/mL' }], loading: false, error: null,
    getBySlug: () => undefined, getByCategory: () => [],
  }),
}));
import { ReviewBiomarkers } from './ReviewBiomarkers';

/*
  F064, the "Confirm your markers" step: every row opens from the keyboard, its
  fields are labelled, and its remove control is named for the marker. Synthetic
  rows only. jsdom has no layout, so the 44px target is checked as a class here
  and measured in e2e/upload-keyboard.spec.ts.
*/
let root: Root;
let host: HTMLDivElement;
const onRemove = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  onRemove.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function row(raw_name: string, over: Partial<ReportItem> = {}): ReportItem {
  return {
    raw_name, canonical_slug: null, category: null, value_numeric: 42, value_text: null, unit: 'pmol/L',
    raw_reference_range: null, normalized_reference_min: null, normalized_reference_max: null,
    reference_operator: null, reference_operator_value: null, confidence_score: 'high', is_core_biomarker: false,
    needs_review: false, source_snippet: null, ...over,
  };
}
function render(items: ReportItem[]) {
  act(() => root.render(<ReviewBiomarkers items={items} onUpdate={vi.fn()} onRemove={onRemove} onAddNew={vi.fn()} />));
}
const toggles = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'));
const toggleFor = (name: string) => toggles().find(b => b.textContent?.includes(name))!;

describe('ReviewBiomarkers: keyboard and screen reader', () => {
  it('opens a collapsed row from its header button, and reports the state', () => {
    render([row('Estradiol')]);
    const header = toggleFor('Estradiol');
    expect(header, 'the row header is a button').toBeDefined();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('input[type="number"]')).toBeNull();
    act(() => header.click());
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('input[type="number"]')).not.toBeNull();
    act(() => header.click());
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('starts an uncertain row open', () => {
    render([row('Estradiol', { confidence_score: 'low', needs_review: true })]);
    expect(toggleFor('Estradiol').getAttribute('aria-expanded')).toBe('true');
  });

  it('names the remove control for its marker, with a 44px target', () => {
    render([row('Estradiol')]);
    // The name the row shows (the catalogue may print it as "Estradiol (E2)").
    const shown = toggleFor('Estradiol').textContent!.trim();
    const remove = host.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${shown}"]`);
    expect(remove, `a button named "Remove ${shown}"`).not.toBeNull();
    expect(remove!.className).toContain('min-h-[44px]');
    expect(remove!.className).toContain('min-w-[44px]');
    act(() => remove!.click());
    expect(onRemove).toHaveBeenCalledWith(0);
    expect(toggleFor('Estradiol').getAttribute('aria-expanded')).toBe('false');
  });

  it('labels every field of an open row', () => {
    render([row('Estradiol', { needs_review: true, confidence_score: 'low' })]);
    for (const text of ['Test Label (on report)', 'Map to Amani Biomarker', 'Value', 'Unit', 'Reference range (raw)']) {
      const label = Array.from(host.querySelectorAll('label')).find(l => l.textContent?.trim() === text);
      expect(label?.control, `the "${text}" label points at a control`).toBeTruthy();
    }
  });

  it('gives two open rows distinct ids', () => {
    render([row('Estradiol', { needs_review: true }), row('Ferritin', { needs_review: true, canonical_slug: 'ferritin', is_core_biomarker: true })]);
    const ids = Array.from(host.querySelectorAll('input, select')).map(el => el.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports the extended section as expanded or collapsed', () => {
    render([row('Estradiol')]);
    const section = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Extended Lab Items'))!;
    expect(section.getAttribute('aria-expanded')).toBe('true');
    act(() => section.click());
    expect(section.getAttribute('aria-expanded')).toBe('false');
  });

  it('passes axe with rows open and closed', async () => {
    render([
      row('Estradiol'),
      row('Ferritin', { needs_review: true, confidence_score: 'low', source_snippet: 'Ferritin 40 ng/mL', parse_error: 'check it' }),
    ]);
    expect(await axeViolations(host)).toEqual([]);
  });
});
