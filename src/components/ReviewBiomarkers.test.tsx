// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportItem } from '../utils/parser/types';
import { parseAllReportItemsWithDebug } from '../utils/parser/pipeline';
import { edgeCasesFixture } from '../utils/parser/__fixtures__/edgeCases';

// The catalogue hook is the only Supabase reader here; the select's options do not matter.
vi.mock('../hooks/useBiomarkerCatalog', () => ({
  useBiomarkerCatalog: () => ({ catalog: [], loading: false, error: null, getBySlug: () => undefined, getByCategory: () => [] }),
}));
import { ReviewBiomarkers } from './ReviewBiomarkers';

// Synthetic fixture rows only.
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(items: ReportItem[]) {
  act(() => root.render(<ReviewBiomarkers items={items} onUpdate={vi.fn()} onRemove={vi.fn()} onAddNew={vi.fn()} />));
  return Array.from(host.querySelectorAll('div.cursor-pointer'));
}
const names = (cards: Element[]) => cards.map(card => card.querySelector('span.truncate')?.textContent);

/** An extended row as the parser emits one, unmapped unless a slug is given. */
function row(raw_name: string, over: Partial<ReportItem> = {}): ReportItem {
  return {
    raw_name, canonical_slug: null, category: null, value_numeric: 42, value_text: null, unit: 'pmol/L',
    raw_reference_range: null, normalized_reference_min: null, normalized_reference_max: null,
    reference_operator: null, reference_operator_value: null, confidence_score: 'medium', is_core_biomarker: false,
    needs_review: false, source_snippet: null, ...over,
  };
}

describe('ReviewBiomarkers card names', () => {
  it('names a parse-error row and its notice by display name, never by slug', () => {
    const cards = render(parseAllReportItemsWithDebug(edgeCasesFixture).items);
    // F098: Holotranscobalamin is its own unmapped row, by its printed label; it was dropped as a second Vitamin B12.
    expect(names(cards)).toEqual(['TSH', 'Vitamin B12', 'Holotranscobalamin']);
    expect(host.textContent).toContain('below physiological minimum 0.001 for TSH — likely a parse error — please correct the value below.');
    expect(host.textContent).not.toMatch(/\btsh\b|vitamin_b12/);
  });

  it('keeps the printed label of a row the catalogue does not know', () => {
    expect(names(render([row('Holotranscobalamin')]))).toEqual(['Holotranscobalamin']);
  });

  it('reads "Unnamed" for a row added by hand with no name yet', () => {
    expect(names(render([row('', { needs_review: true, confidence_score: 'low', source_format: 'manual' })]))).toEqual(['Unnamed']);
  });
});

// F022: a parse-error row is saved only once she has confirmed it.
describe('ReviewBiomarkers confirming a flagged value', () => {
  const parseError = (over: Partial<ReportItem> = {}) => row('TSH', {
    canonical_slug: 'tsh', is_core_biomarker: true, value_numeric: 0.0008, needs_review: true, confidence_score: 'low',
    parse_error: 'Value 0.0008 is below physiological minimum 0.001 for TSH — likely a parse error', ...over,
  });
  const markCorrect = () => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Mark as Correct');

  it('typing her value records it as confirmed by her', async () => {
    const onUpdate = vi.fn();
    act(() => root.render(<ReviewBiomarkers items={[parseError()]} onUpdate={onUpdate} onRemove={vi.fn()} onAddNew={vi.fn()} />));
    const input = host.querySelector<HTMLInputElement>('input[type="number"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, '0.8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(0, 'value_numeric', 0.8);
    expect(onUpdate).toHaveBeenCalledWith(0, 'reviewed_by_user', true);
  });

  it('still offers "Mark as Correct" after she maps the row to another marker', () => {
    render([parseError({ review_status: 'edited_by_user', reviewed_by_user: false })]);
    expect(markCorrect()).toBeDefined();
  });

  it('no longer offers it once she has confirmed the value', () => {
    render([parseError({ review_status: 'edited_by_user', reviewed_by_user: true })]);
    expect(markCorrect()).toBeUndefined();
  });
});

/*
  Review F021, fix wave 4. A result printed as a limit ('<8') is stored with a
  placeholder number (4). The Value input offered that placeholder as her
  value; it now stays empty, with the printed result as its hint.
*/
describe('ReviewBiomarkers Value input for a result printed as a limit', () => {
  function valueInput(items: ReportItem[]) {
    const [card] = render(items);
    act(() => (card as HTMLElement).click());
    return host.querySelector<HTMLInputElement>('input[type="number"]')!;
  }

  it('never shows the placeholder 4 for a printed "<8": the input is empty and its hint states the printed result', () => {
    const input = valueInput([row('Vitamin D', { value_numeric: 4, value_text: '<8', unit: 'ng/mL' })]);
    expect(input.value).toBe('');
    expect(input.value).not.toBe('4');
    const hintId = input.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(host.querySelector(`[id="${hintId}"]`)?.textContent).toContain('<8 ng/mL');
  });

  it('control: a measured value stays in the input, with no limit hint', () => {
    const input = valueInput([row('Vitamin D', { value_numeric: 24, value_text: '24', unit: 'ng/mL' })]);
    expect(input.value).toBe('24');
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});
