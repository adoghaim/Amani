// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  PK-FIX-06 on the real upload page. NewReport is rendered in jsdom against a
  mocked Supabase client; each test drives the user's path (choose a photo,
  set the dates and the typical cycle length, save) and reads what the page
  writes to lab_reports and biomarkers. Synthetic user, dates and values only.

  Before this packet the page wrote average_cycle_length 28 for every report
  and labelled phases by fixed days (days 17-35 luteal) whatever the cycle length.
*/

const fixture = vi.hoisted(() => ({
  user: { id: '00000000-0000-4000-8000-0000000f1x06' },
  periodLogs: [] as { start_date: string }[],
  inserts: [] as { table: string; values: unknown }[],
}));

vi.mock('../lib/supabase', () => {
  type Row = Record<string, unknown>;
  const query = (table: string) => {
    let upTo: string | null = null;
    const rows = (): Row[] => (table === 'period_logs'
      ? fixture.periodLogs.filter(r => upTo === null || r.start_date <= upTo) : []);
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, in: () => builder,
      update: () => builder,
      lte: (_col: string, value: string) => { upTo = value; return builder; },
      insert: (values: unknown) => { fixture.inserts.push({ table, values }); return builder; },
      single: async () => ({ data: table === 'lab_reports' ? { id: 'report-fix06' } : null, error: null }),
      maybeSingle: async () => ({
        data: [...rows()].sort((a, b) => String(b['start_date']).localeCompare(String(a['start_date'])))[0] ?? null,
        error: null,
      }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    };
    return builder;
  };
  // An estradiol result, so the biomarkers insert shows whether V2 withholds it.
  const ocrItems = [{
    raw_name: 'Estradiol', canonical_slug: 'estradiol', category: 'hormones', value_numeric: 150, value_text: '150',
    unit: 'pg/mL', raw_reference_range: null, normalized_reference_min: null, normalized_reference_max: null,
    reference_operator: null, reference_operator_value: null, confidence_score: 'high', is_core_biomarker: true,
    needs_review: false, source_snippet: 'Estradiol 150 pg/mL', source_format: 'ocr', review_status: 'pending',
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

const DRAW = '2026-04-30';
const LENGTH_HINT = 'Days from the first day of one period to the first day of the next';

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.periodLogs = [];
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
const button = (label: string) => Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === label) ?? null;
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
async function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}
const dateInputs = () => Array.from(app.querySelectorAll<HTMLInputElement>('input[type="date"]'));
const reportDateInput = () => dateInputs()[0]!;
const lastPeriodInput = () => dateInputs()[1]!;
const lengthInput = () => app.querySelector<HTMLInputElement>('#typical-cycle-length')!;
const lengthHint = () => app.querySelector('#typical-cycle-length-hint')?.textContent;

/** Renders the page, chooses a synthetic photo and continues to the cycle-context step. */
async function openCycleStep() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/new']}>
      <Routes>
        <Route path="/app/new" element={<NewReport />} />
        {/* Where the page navigates after saving. */}
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
  expect(app.textContent).toContain('Cycle context');
  await type(reportDateInput(), DRAW);
}

/** Saves and returns what the page wrote. */
async function save() {
  await click(button('Next'));
  await click(button('Save and analyze'));
  await settle(20);
  const report = fixture.inserts.find(i => i.table === 'lab_reports')?.values as Record<string, unknown> | undefined;
  const biomarkers = fixture.inserts.find(i => i.table === 'biomarkers')?.values as Record<string, unknown>[] | undefined;
  expect(report).toBeDefined();
  return {
    cycle: {
      last_period_start_date: report!['last_period_start_date'],
      average_cycle_length: report!['average_cycle_length'],
      estimated_cycle_day: report!['estimated_cycle_day'],
      estimated_cycle_phase: report!['estimated_cycle_phase'],
    },
    estradiolFlag: biomarkers?.find(b => b['name'] === 'estradiol')?.['flagged'],
  };
}

describe('PK-FIX-06 — NewReport writes the cycle day for any cycle length', () => {
  it('day 21 of a 35-day cycle: day 21, no phase (was luteal), length 35; estradiol withheld', async () => {
    await openCycleStep();
    await type(lastPeriodInput(), '2026-04-10');
    await type(lengthInput(), '35');
    expect(await save()).toEqual({
      cycle: { last_period_start_date: '2026-04-10', average_cycle_length: 35, estimated_cycle_day: 21, estimated_cycle_phase: 'unknown' },
      estradiolFlag: 'unknown',
    });
  }, 30_000);

  it('day 36+: the day is written; length and last period both auto-filled from the tracker', async () => {
    // Three logged starts 28 days apart: cyclePredictor's average is 28.
    fixture.periodLogs = [{ start_date: '2026-01-29' }, { start_date: '2026-02-26' }, { start_date: '2026-03-26' }];
    await openCycleStep();
    expect(lastPeriodInput().value).toBe('2026-03-26');
    expect(lengthInput().value).toBe('28');
    expect(app.textContent?.match(/Auto-filled from your tracker/g)).toHaveLength(2);
    expect(await save()).toEqual({
      cycle: { last_period_start_date: '2026-03-26', average_cycle_length: 28, estimated_cycle_day: 36, estimated_cycle_phase: 'unknown' },
      estradiolFlag: 'unknown',
    });
  }, 30_000);

  it('a 24-day cycle: day 10, no phase (was follicular), length 24', async () => {
    await openCycleStep();
    await type(lastPeriodInput(), '2026-04-21');
    await type(lengthInput(), '24');
    expect((await save()).cycle).toEqual({
      last_period_start_date: '2026-04-21', average_cycle_length: 24, estimated_cycle_day: 10, estimated_cycle_phase: 'unknown',
    });
  }, 30_000);

  it('missing last-period date: no cycle day, no phase; a typed length is still kept', async () => {
    await openCycleStep();
    expect(lastPeriodInput().value).toBe('');
    await type(lengthInput(), '28');
    expect(await save()).toEqual({
      cycle: { last_period_start_date: null, average_cycle_length: 28, estimated_cycle_day: null, estimated_cycle_phase: 'unknown' },
      estradiolFlag: 'unknown',
    });
  }, 30_000);

  it('no silent 28: with no length known, the length is null and no phase is estimated (was 28 and luteal)', async () => {
    await openCycleStep();
    expect(lengthInput().value).toBe('');
    expect(lengthHint()).toBe(LENGTH_HINT);
    await type(lastPeriodInput(), '2026-04-10');
    expect(await save()).toEqual({
      cycle: { last_period_start_date: '2026-04-10', average_cycle_length: null, estimated_cycle_day: 21, estimated_cycle_phase: 'unknown' },
      estradiolFlag: 'unknown',
    });
  }, 30_000);

  it('clearing an auto-filled length makes it unknown again', async () => {
    fixture.periodLogs = [{ start_date: '2026-02-12' }, { start_date: '2026-03-12' }, { start_date: '2026-04-09' }];
    await openCycleStep();
    expect(lengthInput().value).toBe('28');
    expect(app.textContent?.match(/Auto-filled from your tracker/g)).toHaveLength(2);
    await type(lengthInput(), '');
    // Only the last-period badge is left.
    expect(app.textContent?.match(/Auto-filled from your tracker/g)).toHaveLength(1);
    expect((await save()).cycle).toEqual({
      last_period_start_date: '2026-04-09', average_cycle_length: null, estimated_cycle_day: 22, estimated_cycle_phase: 'unknown',
    });
  }, 30_000);

  it('control: a known 28-day cycle keeps the legacy phase (day 21 luteal) and estradiol is scored', async () => {
    await openCycleStep();
    await type(lastPeriodInput(), '2026-04-10');
    await type(lengthInput(), '28');
    const saved = await save();
    expect(saved.cycle).toEqual({
      last_period_start_date: '2026-04-10', average_cycle_length: 28, estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
    });
    expect(saved.estradiolFlag).not.toBe('unknown');
  }, 30_000);

  it('a typed length that is not a whole number of days from 15 to 60 is flagged and blocks Next', async () => {
    await openCycleStep();
    for (const bad of ['90', '10', '28.5', 'abc']) {
      await type(lengthInput(), bad);
      expect(lengthHint()).toBe('Enter a whole number of days from 15 to 60');
      expect(lengthInput().getAttribute('aria-invalid')).toBe('true');
      expect((button('Next') as HTMLButtonElement).disabled).toBe(true);
    }
    await type(lengthInput(), '30');
    expect(lengthHint()).toBe(LENGTH_HINT);
    expect((button('Next') as HTMLButtonElement).disabled).toBe(false);
  }, 30_000);
});
