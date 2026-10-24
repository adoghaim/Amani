// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/*
  Review F021, wave 3, on the real upload page. A result printed as a limit is
  stored with a placeholder number, and the flag saved with its biomarkers row
  was computed from that number: eGFR '> OR = 60' (stored 60) was saved as
  out_of_range. The printed limit decides the flag, or it is 'unknown'.
  NewReport in jsdom against a mocked Supabase client; synthetic values only.
*/

const fixture = vi.hoisted(() => ({
  user: { id: '00000000-0000-4000-8000-0000000f0021' },
  inserts: [] as { table: string; values: unknown }[],
}));

vi.mock('../lib/supabase', () => {
  const query = (table: string) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, in: () => builder,
      update: () => builder, lte: () => builder,
      insert: (values: unknown) => { fixture.inserts.push({ table, values }); return builder; },
      single: async () => ({ data: table === 'lab_reports' ? { id: 'report-f021' } : null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };
  const item = (raw_name: string, canonical_slug: string, value: number, text: string, unit: string, min: number, max: number) => ({
    raw_name, canonical_slug, category: null, value_numeric: value, value_text: text, unit,
    raw_reference_range: `${min}-${max}`, normalized_reference_min: min, normalized_reference_max: max,
    reference_operator: null, reference_operator_value: null, confidence_score: 'high', is_core_biomarker: true,
    needs_review: false, source_snippet: `${raw_name} ${text} ${unit} ${min}-${max}`, source_format: 'ocr', review_status: 'pending',
  });
  const ocrItems = [
    item('eGFR', 'egfr', 60, '> OR = 60', 'mL/min/1.73m2', 60, 200),
    item('Vitamin D', 'vitamin_d_25_oh', 4, '<8', 'ng/mL', 30, 100),
    item('Ferritin', 'ferritin', 8, '8', 'ng/mL', 13, 150),
  ];
  return { supabase: {
    from: query,
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    functions: { invoke: async (name: string) => (name === 'parse-lab-report-ocr'
      ? { data: { items: ocrItems }, error: null } : { data: null, error: null }) },
  } };
});
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: fixture.user, userProfile: { pregnancy_status: null } }) }));
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
  fixture.inserts = [];
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
async function click(label: string) {
  const el = Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === label);
  expect(el, label).toBeDefined();
  await act(async () => { el!.click(); });
  await settle();
}

async function upload() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/new']}>
      <Routes>
        <Route path="/app/new" element={<NewReport />} />
        <Route path="/app/reports/:id" element={null} />
      </Routes>
    </MemoryRouter>,
  ));
  await settle();
  const fileInput = app.querySelector<HTMLInputElement>('#file-upload')!;
  Object.defineProperty(fileInput, 'files', {
    configurable: true, value: [new File(['synthetic'], 'synthetic-lab.png', { type: 'image/png' })],
  });
  await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('Next');
  await settle(20);
  const reportDate = app.querySelector<HTMLInputElement>('input[type="date"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(reportDate, '2026-09-01');
    reportDate.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  await click('Next');
  await click('Save and analyze');
  await settle(20);
  return fixture.inserts.find(i => i.table === 'biomarkers')?.values as Record<string, unknown>[];
}

it('saves the flag the printed limit decides: eGFR "> OR = 60" unknown, vitamin D "<8" out of range', async () => {
  const rows = await upload();
  expect(rows.map(b => [b['name'], b['raw_value_text'], b['flagged']])).toEqual([
    ['egfr', '> OR = 60', 'unknown'],
    ['vitamin_d_25_oh', '<8', 'out_of_range'],
    // Control: a measured value is flagged by its number.
    ['ferritin', '8', 'out_of_range'],
  ]);
});
