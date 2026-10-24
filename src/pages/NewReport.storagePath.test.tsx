// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  RV-DB4 (DB4-1, review F032 follow-up) on the real upload page. The storage
  key took its extension from the file name, so a name with no dot put the
  whole name into the key, and a '?' in it uploaded and then had the report
  row refused by DB3's file_url guard. The key now comes from the validated
  type. Synthetic user, file names and bytes only.
*/

type Reply = { data: unknown; error: unknown; status?: number };
const fixture = vi.hoisted(() => ({
  user: { id: '00000000-0000-4000-8000-0000000db400' },
  uploads: [] as string[],
  removed: [] as string[][],
  inserts: [] as { table: string; payload: unknown }[],
  reportReply: null as Reply | null,
}));

vi.mock('../lib/supabase', () => {
  const query = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'in', 'lte', 'update']) builder[method] = () => builder;
    builder.insert = (payload: unknown) => { fixture.inserts.push({ table, payload }); return builder; };
    builder.single = async () => (table === 'lab_reports' && fixture.reportReply
      ? fixture.reportReply : { data: { id: 'report-db4' }, error: null, status: 201 });
    builder.maybeSingle = async () => ({ data: null, error: null });
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return builder;
  };
  const ocrItems = [{
    raw_name: 'TSH', canonical_slug: 'tsh', category: 'thyroid', value_numeric: 2, value_text: '2.0',
    unit: 'uIU/mL', raw_reference_range: '0.45-4.5', normalized_reference_min: 0.45, normalized_reference_max: 4.5,
    reference_operator: null, reference_operator_value: null, confidence_score: 'high', is_core_biomarker: true,
    needs_review: false, source_snippet: 'TSH 2.0 uIU/mL', source_format: 'ocr', review_status: 'pending',
  }];
  return { supabase: {
    from: query,
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) },
    storage: { from: () => ({
      upload: async (path: string) => { fixture.uploads.push(path); return { error: null }; },
      remove: async (paths: string[]) => { fixture.removed.push(paths); return { data: [], error: null }; },
    }) },
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

// Her folder, then digits, then one of the three extensions: DB3's guard
// accepts it (no '%', '?', '#', backslash or control character, no '.' or
// '..' segment) and no part of the file name is in it.
const UPLOAD_PATH = new RegExp(`^${fixture.user.id}/\\d+\\.(pdf|jpg|png)$`);

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.uploads = [];
  fixture.removed = [];
  fixture.inserts = [];
  fixture.reportReply = null;
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
  await settle(20);
}

/** Chooses a synthetic photo with this name and type, continues, and taps Save and analyze. */
async function saveFile(name: string, type: string) {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/new']}>
      <Routes>
        <Route path="/app/new" element={<NewReport />} />
        <Route path="/app/reports/:id" element={<p>Report page</p>} />
      </Routes>
    </MemoryRouter>,
  ));
  await settle();
  const fileInput = app.querySelector<HTMLInputElement>('#file-upload')!;
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['synthetic'], name, { type })] });
  await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('Next');
  expect(app.textContent).toContain('Cycle context');
  await click('Next');
  await click('Save and analyze');
}

const reportRow = () => fixture.inserts.find(insert => insert.table === 'lab_reports')?.payload as { file_url?: unknown } | undefined;

describe('the storage key of an upload comes from its type, never its name', () => {
  it.each([
    ['a PNG whose name holds ? and # in the extension', 'synthetic lab?.p#ng', 'image/png', 'png'],
    ['a JPEG whose name has no dot', 'Synthetic results', 'image/jpeg', 'jpg'],
  ])('%s', async (_label, name, type, ext) => {
    await saveFile(name, type);
    expect(fixture.uploads).toHaveLength(1);
    const [path] = fixture.uploads;
    expect(path).toMatch(UPLOAD_PATH);
    expect(path!.endsWith(`.${ext}`), path).toBe(true);
    expect(path).not.toMatch(/synthetic|results|[?#\s]/i);
    expect(reportRow()?.file_url).toBe(path);
    expect(app.textContent).toContain('Report page');
  });

  it('a refused report row removes that same key', async () => {
    fixture.reportReply = { data: null, error: { message: 'file_url_not_owned', code: '42501' }, status: 403 };
    await saveFile('synthetic lab?.p#ng', 'image/png');
    expect(fixture.uploads).toHaveLength(1);
    expect(fixture.uploads[0]).toMatch(UPLOAD_PATH);
    expect(reportRow()?.file_url).toBe(fixture.uploads[0]);
    expect(fixture.removed).toEqual([[fixture.uploads[0]]]);
  });
});
