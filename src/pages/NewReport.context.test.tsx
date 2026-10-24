// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEW_REPORT_CONTEXTS } from './NewReport.context.testkit';

/*
  Review F018, the page half of the contract. The real upload page saves a
  synthetic photo report and this pins the exact context literal it writes to
  lab_reports. The server half, supabase/functions/_shared/schemas/context.test.ts,
  feeds the same literals through the edge function's own schema: that file
  runs in Vitest's node mode, which can load the schema's Deno npm: import,
  and this jsdom page cannot. Synthetic user and values only.
*/

const fixture = vi.hoisted(() => ({
  // One object for every render: the page's effects depend on its identity.
  user: { id: '00000000-0000-4000-8000-0000000f0180' },
  inserts: [] as { table: string; values: unknown }[],
  updates: [] as { table: string; values: unknown }[],
  // Compatibility mode: the first report_analytes insert reports a missing column.
  failFirstAnalyteInsert: false,
}));

vi.mock('../lib/supabase', () => {
  type Row = Record<string, unknown>;
  const query = (table: string) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, in: () => builder,
      lte: () => builder,
      update: (values: unknown) => { fixture.updates.push({ table, values }); return builder; },
      insert: (values: unknown) => {
        fixture.inserts.push({ table, values });
        if (table === 'report_analytes' && fixture.failFirstAnalyteInsert) {
          fixture.failFirstAnalyteInsert = false;
          const failed = { data: null, error: { code: '42703', message: 'column "unit_original" does not exist' } };
          return { then: (resolve: (value: typeof failed) => unknown) => Promise.resolve(failed).then(resolve) };
        }
        return builder;
      },
      single: async () => ({ data: table === 'lab_reports' ? { id: 'report-f018' } : null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };
  // parse-lab-report-ocr's own row shape (its index.ts builds report_analytes-named rows; review F093), not ReportItem.
  const ocrItems = [{
    raw_name: 'TSH', raw_value_text: '2.1', value_numeric: 2.1, unit: 'uIU/mL',
    raw_reference_range: '0.45-4.5', normalized_min: 0.45, normalized_max: 4.5,
    normalized_operator: null, normalized_operator_value: null, source_snippet: 'TSH 2.1 uIU/mL 0.45-4.5',
    confidence_score: 'high', canonical_analyte_id: null, canonical_slug: 'tsh', parse_status: 'mapped',
    needs_review: false, is_core: true, category: 'thyroid',
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
  fixture.inserts = [];
  fixture.updates = [];
  fixture.failFirstAnalyteInsert = false;
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
async function click(label: string) {
  const el = button(label);
  expect(el, label).not.toBeNull();
  await act(async () => { el!.click(); });
  await settle();
}

/** Uploads a synthetic photo, picks `symptoms` on the context step, saves; returns every context the page wrote. */
async function saveWithSymptoms(symptoms: string[]) {
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
  expect(app.textContent).toContain('Any symptoms?');
  for (const label of symptoms) await click(label);
  await click('Next');
  await click('Save and analyze');
  await settle(20);
  const inserted = fixture.inserts.find(i => i.table === 'lab_reports')?.values as { context?: unknown } | undefined;
  expect(inserted?.context, 'the lab_reports insert carries a context').toBeDefined();
  const rewritten = fixture.updates
    .filter(u => u.table === 'lab_reports' && (u.values as { context?: unknown }).context !== undefined)
    .map(u => (u.values as { context: unknown }).context);
  return [inserted!.context, ...rewritten];
}

describe('F018: the context literal NewReport writes is the one the server schema is tested with', () => {
  it('two symptoms chosen', async () => {
    expect(await saveWithSymptoms(['Fatigue', 'Hot flashes'])).toEqual([NEW_REPORT_CONTEXTS.twoSymptoms]);
  }, 30_000);

  it('no symptoms chosen', async () => {
    expect(await saveWithSymptoms([])).toEqual([NEW_REPORT_CONTEXTS.noSymptoms]);
  }, 30_000);

  it('compatibility mode: the insert, then the rewrite after the missing-column error', async () => {
    fixture.failFirstAnalyteInsert = true;
    expect(await saveWithSymptoms(['Cramps'])).toEqual([
      { ...NEW_REPORT_CONTEXTS.compatibility, submission_mode: 'standard' },
      NEW_REPORT_CONTEXTS.compatibility,
    ]);
  }, 30_000);
});
