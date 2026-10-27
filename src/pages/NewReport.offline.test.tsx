// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  Review F065 on the real upload page. Offline, only step 1's Next was
  disabled: Save and analyze still ran, failed part-way and showed raw strings
  such as "File upload failed: Failed to fetch". When the server refused the
  report row after the file was stored, the file stayed in lab-files with
  nothing pointing at it. Synthetic user, file and values only.
*/

type Reply = { data: unknown; error: unknown; status?: number };
const fixture = vi.hoisted(() => ({
  user: { id: '00000000-0000-4000-8000-0000000f0650' },
  uploads: [] as string[],
  removed: [] as string[][],
  inserts: [] as string[],
  uploadReply: { error: null } as { error: unknown },
  reportReply: null as Reply | null,
  network: [] as ((status: { connected: boolean; connectionType: string }) => void)[],
}));

vi.mock('../lib/supabase', () => {
  const query = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'in', 'lte', 'update']) builder[method] = () => builder;
    builder.insert = () => { fixture.inserts.push(table); return builder; };
    builder.single = async () => (table === 'lab_reports' && fixture.reportReply
      ? fixture.reportReply : { data: { id: 'report-f065' }, error: null, status: 201 });
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
      upload: async (path: string) => { fixture.uploads.push(path); return fixture.uploadReply; },
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
  onNetworkChange: (callback: (typeof fixture.network)[number]) => {
    fixture.network.push(callback);
    return () => { fixture.network = fixture.network.filter(c => c !== callback); };
  },
}));
vi.mock('../utils/pdfExtractor', () => ({ extractTextFromPDF: vi.fn(), convertPDFToImages: vi.fn() }));
vi.mock('../utils/subscription', () => ({ checkSubscriptionLive: vi.fn(), handle402: async () => null }));
vi.mock('../lib/freemium/gates', () => ({ uploadRequiresSubscription: () => false }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { NewReport } from './NewReport';

const SAVE_FAILED = "We couldn't save your report. Check your connection, then try again.";

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.uploads = [];
  fixture.removed = [];
  fixture.inserts = [];
  fixture.uploadReply = { error: null };
  fixture.reportReply = null;
  fixture.network = [];
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

/** Renders the page, chooses a synthetic photo and continues to Save and analyze. */
async function openSaveStep() {
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
  Object.defineProperty(fileInput, 'files', {
    configurable: true, value: [new File(['synthetic'], 'synthetic-lab.png', { type: 'image/png' })],
  });
  await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('Next');
  expect(app.textContent).toContain('Cycle context');
  await click('Next');
  expect(button('Save and analyze')).not.toBeNull();
}

describe('Save and analyze offline', () => {
  it('sends nothing and says so in plain words', async () => {
    await openSaveStep();
    await act(async () => { for (const listener of fixture.network) listener({ connected: false, connectionType: 'none' }); });
    await click('Save and analyze');
    expect(fixture.uploads).toEqual([]);
    expect(fixture.inserts).toEqual([]);
    expect(app.textContent).toContain("You're offline, so your report hasn't been saved yet. Connect to the internet, then try again.");
    expect(button('Save and analyze')).not.toBeNull();
  });

  it('back online, it saves as before', async () => {
    await openSaveStep();
    await act(async () => { for (const listener of fixture.network) listener({ connected: false, connectionType: 'none' }); });
    await click('Save and analyze');
    await act(async () => { for (const listener of fixture.network) listener({ connected: true, connectionType: 'wifi' }); });
    await click('Save and analyze');
    expect(fixture.uploads).toHaveLength(1);
    expect(fixture.inserts).toContain('lab_reports');
    expect(app.textContent).toContain('Report page');
  });
});

describe('a save that fails part-way', () => {
  it('says what happened in plain words, never the raw error', async () => {
    fixture.uploadReply = { error: { message: 'Failed to fetch' } };
    await openSaveStep();
    await click('Save and analyze');
    expect(app.textContent).toContain(SAVE_FAILED);
    expect(app.textContent).not.toMatch(/File upload failed|Failed to fetch/);
    expect(button('Save and analyze')).not.toBeNull();
  });

  it('the server refused the report row: the file just stored is removed, since nothing will point at it', async () => {
    fixture.reportReply = { data: null, error: { message: 'new row violates row-level security policy', code: '42501' }, status: 403 };
    await openSaveStep();
    await click('Save and analyze');
    expect(fixture.uploads).toHaveLength(1);
    expect(fixture.removed).toEqual([[fixture.uploads[0]]]);
    expect(app.textContent).toContain(SAVE_FAILED);
    expect(app.textContent).not.toMatch(/Failed to create report record|row-level security/);
  });

  it.each([
    ['no answer at all (the row may exist)', 0],
    ['a gateway error (the row may exist)', 504],
  ])('%s: the file stays with whatever row there is', async (_label, status) => {
    fixture.reportReply = { data: null, error: { message: 'TypeError: Failed to fetch' }, status };
    await openSaveStep();
    await click('Save and analyze');
    expect(fixture.uploads).toHaveLength(1);
    expect(fixture.removed).toEqual([]);
    expect(app.textContent).toContain(SAVE_FAILED);
  });
});
