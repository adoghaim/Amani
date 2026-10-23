// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedAnalyte } from '../../supabase/functions/_shared/lab-extraction';

/*
  Review F093 and F114 (IB1) on the real upload page. A photo goes to
  parse-lab-report-ocr, which answers with rows named like report_analytes
  (ExtractedAnalyte, supabase/functions/_shared/lab-extraction.ts), not with
  the app's ReportItem names. Passed through unmapped, the save found no
  value_text or normalized_reference_* on them and stored the lab's printed
  value text, range and comparator as null: the confirm step showed 0.25 for
  a printed '<0.5' and the report said the lab printed no range. Jsdom, a
  mocked Supabase client, synthetic user and values only.
*/
const fixture = vi.hoisted(() => ({
  user: { id: '00000000-0000-4000-8000-0000000001b1' },
  inserts: [] as { table: string; values: unknown }[],
  ocrItems: [] as unknown[],
}));

vi.mock('../lib/supabase', () => {
  const query = (table: string) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, in: () => builder,
      lte: () => builder, update: () => builder,
      insert: (values: unknown) => { fixture.inserts.push({ table, values }); return builder; },
      single: async () => ({ data: table === 'lab_reports' ? { id: 'report-ib1' } : null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };
  return { supabase: {
    from: query,
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    // The body parse-lab-report-ocr/index.ts returns.
    functions: { invoke: async (name: string) => (name === 'parse-lab-report-ocr'
      ? { data: { items: fixture.ocrItems, metadata: { cycle_day: null, cycle_phase: null }, _source_format: 'ocr', _parser_version: 'v2_vision_fallback' }, error: null }
      : { data: null, error: null }) },
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

/*
  Two rows as the function builds them. The censored TSH carries the
  function's own value_numeric for '<0.5' (threshold / 2); the LDL range is a
  comparator. Synthetic intervals; nothing here is a clinical reference.
*/
const TSH: ExtractedAnalyte = {
  raw_name: 'TSH', raw_value_text: '<0.5', value_numeric: 0.25, unit: 'uIU/mL',
  raw_reference_range: '0.45-4.5', normalized_min: 0.45, normalized_max: 4.5,
  normalized_operator: null, normalized_operator_value: null, source_snippet: 'TSH <0.5 uIU/mL 0.45-4.5',
  confidence_score: 'high', canonical_analyte_id: null, canonical_slug: 'tsh', parse_status: 'mapped',
  needs_review: false, is_core: true, category: 'thyroid',
};
const LDL: ExtractedAnalyte = {
  raw_name: 'LDL Cholesterol', raw_value_text: '112', value_numeric: 112, unit: 'mg/dL',
  raw_reference_range: '<100', normalized_min: null, normalized_max: null,
  normalized_operator: '<', normalized_operator_value: 100, source_snippet: 'LDL Cholesterol 112 mg/dL <100',
  confidence_score: 'high', canonical_analyte_id: null, canonical_slug: 'ldl_cholesterol', parse_status: 'mapped',
  needs_review: false, is_core: true, category: 'lipids',
};

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.inserts = [];
  fixture.ocrItems = [TSH, LDL];
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
const button = (label: string) => Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === label) ?? null;
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}

/** Choose a synthetic photo, let the OCR answer arrive, and stop on "Confirm your markers". */
async function uploadPhoto() {
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
  await click(button('Next'));
  await settle(20);
  await click(button('Next'));
  expect(app.textContent).toContain('Confirm your markers');
}

/** The value each confirm card shows, by the name it shows. */
function confirmValues() {
  return Object.fromEntries(Array.from(app.querySelectorAll('div.cursor-pointer')).map(card => [
    card.querySelector('span.truncate')?.textContent, card.querySelector('.tabular-nums')?.firstChild?.textContent,
  ]));
}

/** Save, and return the rows the page wrote, by raw name (report_analytes) and slug (biomarkers). */
async function save() {
  await click(button('Save and analyze'));
  await settle(20);
  const rows = (table: string) => (fixture.inserts.find(i => i.table === table)?.values ?? []) as Record<string, unknown>[];
  return {
    analytes: Object.fromEntries(rows('report_analytes').map(r => [r['raw_name'], r])),
    biomarkers: Object.fromEntries(rows('biomarkers').map(r => [r['name'], r])),
  };
}

describe('NewReport: an OCR upload keeps the lab\'s printed value text and range (F093, F114)', () => {
  it('the confirm step shows the value as printed, not the stored number', async () => {
    await uploadPhoto();
    expect(confirmValues()).toEqual({ TSH: '<0.5', LDL: '112' });
  });

  it('a censored result is saved with its printed text and the lab\'s interval', async () => {
    await uploadPhoto();
    const { analytes, biomarkers } = await save();
    expect(analytes['TSH']).toMatchObject({
      raw_value_text: '<0.5', value_numeric: 0.25, unit: 'uIU/mL', unit_original: 'uIU/mL',
      raw_reference_range: '0.45-4.5', normalized_min: 0.45, normalized_max: 4.5,
      normalized_operator: null, normalized_operator_value: null,
      source_snippet: 'TSH <0.5 uIU/mL 0.45-4.5', canonical_slug: 'tsh', is_core: true, confidence_score: 'high',
    });
    expect(biomarkers['tsh']).toMatchObject({
      value: 0.25, raw_value_text: '<0.5', unit: 'uIU/mL', reference_min: 0.45, reference_max: 4.5,
    });
  });

  it('a comparator range is saved with its operator and bound', async () => {
    await uploadPhoto();
    const { analytes, biomarkers } = await save();
    expect(analytes['LDL Cholesterol']).toMatchObject({
      raw_value_text: '112', value_numeric: 112, raw_reference_range: '<100',
      normalized_min: null, normalized_max: null, normalized_operator: '<', normalized_operator_value: 100,
    });
    expect(biomarkers['ldl_cholesterol']).toMatchObject({ value: 112, raw_value_text: '112', reference_min: null, reference_max: null });
  });
});
