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

type Step = () => Promise<void>;
async function upload({ onPreview, onReview }: { onPreview?: Step; onReview?: Step } = {}) {
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
  await onPreview?.();
  const reportDate = app.querySelector<HTMLInputElement>('input[type="date"]')!;
  await act(async () => {
    setValue.call(reportDate, '2026-09-01');
    reportDate.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  await click('Next');
  await onReview?.();
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

/*
  Fix wave 4. The upload review showed the placeholder as her value: the
  "View detected markers" preview read '4 ng/mL' for a printed '<8', and the
  Value input held 4. An edit she made kept the stale '<8', which then
  overrode her number in the saved flag.
*/
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
/** The Value input of the confirm-step card named `name`, expanded. */
async function reviewValueInput(name: string) {
  const card = Array.from(app.querySelectorAll<HTMLElement>('div.cursor-pointer'))
    .find(c => c.querySelector('span.truncate')?.textContent === name);
  expect(card, name).toBeDefined();
  await act(async () => { card!.click(); });
  return card!.parentElement!.querySelector<HTMLInputElement>('input[type="number"]')!;
}

it('previews a result printed as a limit by its printed text, never its placeholder', async () => {
  let preview: string[][] = [];
  await upload({ onPreview: async () => {
    const toggle = Array.from(app.querySelectorAll('button')).find(b => b.textContent?.startsWith('View detected markers'));
    expect(toggle).toBeDefined();
    await act(async () => { toggle!.click(); });
    await settle();
    preview = Array.from(app.querySelectorAll('.divide-y > div'))
      .map(row => [row.children[0]?.textContent?.trim() ?? '', row.children[1]?.textContent?.trim() ?? '']);
  } });
  expect(preview).toContainEqual(['Vitamin D', '<8 ng/mL']);
  expect(preview).toContainEqual(['eGFR', '> OR = 60 mL/min/1.73m2']);
  expect(preview.map(([, value]) => value)).not.toContain('4 ng/mL');
  // Control: a measured value is previewed by its number.
  expect(preview).toContainEqual(['Ferritin', '8 ng/mL']);
});

it('leaves the review Value input empty for "<8"; untouched, the row saves its printed text', async () => {
  let shown: string | undefined;
  const rows = await upload({ onReview: async () => { shown = (await reviewValueInput('Vitamin D')).value; } });
  expect(shown).toBe('');
  expect(rows.find(b => b['name'] === 'vitamin_d_25_oh')).toMatchObject({ raw_value_text: '<8', flagged: 'out_of_range' });
});

it('an edited value replaces the printed "<8" and is flagged from her number', async () => {
  const rows = await upload({ onReview: async () => {
    const input = await reviewValueInput('Vitamin D');
    await act(async () => {
      setValue.call(input, '60');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
  } });
  expect(rows.find(b => b['name'] === 'vitamin_d_25_oh')).toMatchObject({ value: 60, raw_value_text: null, flagged: 'in_range' });
  const analytes = fixture.inserts.find(i => i.table === 'report_analytes')?.values as Record<string, unknown>[];
  expect(analytes.find(a => a['raw_name'] === 'Vitamin D')).toMatchObject({ value_numeric: 60, raw_value_text: null });
});
