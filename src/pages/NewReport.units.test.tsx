// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExtractedAnalyte } from '../../supabase/functions/_shared/lab-extraction';

/*
  Review F011 on the real upload page. The catalog approves no unit
  conversions, so an item the OCR read in another unit than its analyte's
  catalog unit is saved with her lab's interval but outside the scored set:
  never a biomarkers row, so no Amani flag, band, trend or pattern can be made
  from it. NewReport in jsdom against a mocked Supabase client; synthetic only.
*/

const fixture = vi.hoisted(() => ({
  user: { id: '00000000-0000-4000-8000-0000000f0011' },
  inserts: [] as { table: string; values: unknown }[],
}));

vi.mock('../lib/supabase', () => {
  const query = (table: string) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, in: () => builder,
      update: () => builder, lte: () => builder,
      insert: (values: unknown) => { fixture.inserts.push({ table, values }); return builder; },
      single: async () => ({ data: table === 'lab_reports' ? { id: 'report-f011' } : null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };
  // parse-lab-report-ocr's own row shape (ExtractedAnalyte, review F093), not the app's ReportItem.
  const item = (raw_name: string, canonical_slug: string, value: number, unit: string, min: number, max: number): ExtractedAnalyte => ({
    raw_name, raw_value_text: String(value), value_numeric: value, unit,
    raw_reference_range: `${min}-${max}`, normalized_min: min, normalized_max: max,
    normalized_operator: null, normalized_operator_value: null, source_snippet: `${raw_name} ${value} ${unit} ${min}-${max}`,
    confidence_score: 'high', canonical_analyte_id: null, canonical_slug, parse_status: 'mapped',
    needs_review: false, is_core: true, category: null,
  });
  const ocrItems = [item('LDL Cholesterol', 'ldl_cholesterol', 4.9, 'mmol/L', 0, 3), item('Ferritin', 'ferritin', 40, 'ng/mL', 13, 150)];
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

it('an LDL read in mmol/L is saved with her lab interval, outside the scored set', async () => {
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

  const biomarkers = fixture.inserts.find(i => i.table === 'biomarkers')?.values as Record<string, unknown>[];
  expect(biomarkers.map(b => [b['name'], b['unit'], b['flagged']])).toEqual([['ferritin', 'ng/mL', 'in_range']]);
  const analytes = fixture.inserts.find(i => i.table === 'report_analytes')?.values as Record<string, unknown>[];
  expect(analytes.find(a => a['canonical_slug'] === 'ldl_cholesterol')).toMatchObject({
    value_numeric: 4.9, unit: 'mmol/L', normalized_min: 0, normalized_max: 3, raw_reference_range: '0-3',
    is_core: false, normalization_status: 'partial', parse_status: 'partial',
  });
  expect(analytes.find(a => a['canonical_slug'] === 'ferritin')).toMatchObject({ is_core: true, normalization_status: 'mapped' });
});
