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
