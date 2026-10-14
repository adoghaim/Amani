// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  PK-FIX-02 on the real upload page: the campaign's copy fixes d, f and h.
  NewReport is rendered in jsdom against a mocked Supabase client; each case
  drives the user's path. Synthetic user and values only; nothing is saved.
*/
const fixture = vi.hoisted(() => ({ user: { id: '00000000-0000-4000-8000-00000000f102' } }));

vi.mock('../lib/supabase', () => {
  const query = () => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, in: () => builder,
      lte: () => builder, update: () => builder, insert: () => builder,
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };
  const ocrItems = [{
    raw_name: 'TSH', canonical_slug: 'tsh', category: 'thyroid', value_numeric: 2.1, value_text: '2.1',
    unit: 'uIU/mL', raw_reference_range: '0.45-4.5', normalized_reference_min: 0.45, normalized_reference_max: 4.5,
    reference_operator: null, reference_operator_value: null, confidence_score: 'high', is_core_biomarker: true,
    needs_review: false, source_snippet: 'TSH 2.1 uIU/mL', source_format: 'ocr', review_status: 'pending',
  }];
  return { supabase: {
    from: query,
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    functions: { invoke: async (name: string) => (name === 'parse-lab-report-ocr'
      ? { data: { items: ocrItems }, error: null } : { data: null, error: null }) },
  } };
});
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock('../lib/native', () => ({
  isNative: () => false,
  captureLabPhoto: vi.fn(),
  getNetworkStatus: async () => ({ connected: true, connectionType: 'wifi' }),
  onNetworkChange: () => () => {},
}));
vi.mock('../utils/pdfExtractor', () => ({ extractTextFromPDF: vi.fn(), convertPDFToImages: vi.fn() }));
vi.mock('../utils/subscription', () => ({ checkSubscriptionLive: vi.fn(), handle402: async () => null }));
vi.mock('../lib/freemium/gates', () => ({ uploadRequiresSubscription: () => false }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { NewReport } from './NewReport';

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const button = (match: (text: string) => boolean) =>
  Array.from(app.querySelectorAll('button')).find(b => match(b.textContent?.trim() ?? '')) ?? null;
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
async function renderPage() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/new']}>
      <Routes><Route path="/app/new" element={<NewReport />} /></Routes>
    </MemoryRouter>,
  ));
  await settle();
}

describe('NewReport copy (PK-FIX-02)', () => {
  it('(f) the guided-import chooser spells the lab "Quest Diagnostics"', async () => {
    await renderPage();
    await click(button(t => t.startsWith('Import from Quest')));
    await click(button(t => t === 'Back'));
    expect(app.textContent).toContain('Import your lab results');
    expect(app.textContent).toContain('Quest Diagnostics');
    expect(app.textContent).not.toContain('Quest diagnostics');
  });

  it('(h) and (d) step 2 labels the blood-draw date and makes no accuracy claim', async () => {
    await renderPage();
    const fileInput = app.querySelector<HTMLInputElement>('#file-upload')!;
    Object.defineProperty(fileInput, 'files', {
      configurable: true, value: [new File(['synthetic'], 'synthetic-lab.png', { type: 'image/png' })],
    });
    await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });
    await click(button(t => t === 'Next'));
    await settle(20);
    expect(app.textContent).toContain('Cycle context');

    // (h) The date the cycle day is counted to is labelled as the draw, and the label names its input.
    const label = app.querySelector('label[for="blood-draw-date"]');
    expect(label?.textContent?.trim()).toBe('Date your blood was drawn');
    expect(app.querySelector('#blood-draw-date')?.getAttribute('type')).toBe('date');
    expect(Array.from(app.querySelectorAll('label')).map(l => l.textContent?.trim())).not.toContain('Report date');

    // (d) No accuracy claim; the subtitle says what the date is used for.
    expect(app.textContent).toContain('Amani counts the cycle day of your test from the day your last period started.');
    expect(app.textContent).toContain('Add the day your last period started, if you know it.');
    expect(app.textContent).not.toMatch(/more accurate/i);
  });
});
