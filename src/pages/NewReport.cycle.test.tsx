// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cycleContextCard } from '../lib/cycleContextCard';
import { assessAmaniContext, contextFromReport } from '../lib/scoring/amaniContext';

/*
  PK-FIX-06 on the real upload page. NewReport is rendered in jsdom against a
  mocked Supabase client; each case drives the user's path (choose a photo, set
  the dates, save) and reads what the page writes to lab_reports and
  biomarkers. Synthetic user, dates and values only.
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
const DAY_MS = 86_400_000;
/** The calendar date `days` before `iso` (both YYYY-MM-DD). */
const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

let root: Root;
let app: HTMLDivElement;
function mount() {
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
}
async function unmount() {
  await act(async () => root.unmount());
  app.remove();
  sessionStorage.clear();
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.periodLogs = [];
  fixture.inserts = [];
  mount();
});
afterEach(async () => {
  await unmount();
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
    report: report!,
    cycle: {
      last_period_start_date: report!['last_period_start_date'],
      average_cycle_length: report!['average_cycle_length'],
      estimated_cycle_day: report!['estimated_cycle_day'],
      estimated_cycle_phase: report!['estimated_cycle_phase'],
    },
    estradiolFlag: biomarkers?.find(b => b['name'] === 'estradiol')?.['flagged'],
  };
}

/*
  Acceptance table (owner decision D13): days 1-40 x typical cycle lengths
  {unknown, 28, 24, 35}, through the real page.

  Her typical length reaches the page the way the app knows it today: from her
  tracker. Three logged period starts L days apart average to L by
  cyclePredictor's rule; a single logged start establishes no length (unknown).
  The latest start is the draw date minus (day - 1), so the last-period field
  auto-fills and the draw falls on cycle day `day`.

  Each cell is one symbol for what she then sees on the saved report:
    M F O L  phase menstrual / follicular / ovulatory / luteal is stored (header
             pill); the Cycle context card shows that phase and the cycle day;
             V2 scores the cycle-dependent hormone (estradiol).
    x        no phase is stored; the cycle day is NOT shown (no card); V2
             withholds estradiol.

  TODAY is the output of main @ 948dc95, captured by this test before any
  PK-FIX-06 logic change. Main has no length input and never reads one, so the
  length columns cannot differ: every report stores 28.
*/
const LENGTHS = ['unknown', 28, 24, 35] as const;
type TypicalLength = typeof LENGTHS[number];
const DAYS = 40;

const TODAY: Record<TypicalLength, string> = {
  //   cycle day 1   5   10   15   20   25   30   35   40
  //             |   |    |    |    |    |    |    |    |
  unknown:      'MMMMMFFFFFFFOOOOLLLLLLLLLLLLLLLLLLLxxxxx',
  28:           'MMMMMFFFFFFFOOOOLLLLLLLLLLLLLLLLLLLxxxxx',
  24:           'MMMMMFFFFFFFOOOOLLLLLLLLLLLLLLLLLLLxxxxx',
  35:           'MMMMMFFFFFFFOOOOLLLLLLLLLLLLLLLLLLLxxxxx',
};
const TODAY_STORED_LENGTH: Record<TypicalLength, number | null> = { unknown: 28, 28: 28, 24: 28, 35: 28 };

const PHASE_SYMBOL: Record<string, string> = { menstrual: 'M', follicular: 'F', ovulatory: 'O', luteal: 'L' };

function trackerLogs(length: TypicalLength, lastPeriodStart: string) {
  if (length === 'unknown') return [{ start_date: lastPeriodStart }];
  return [2, 1, 0].map(cycles => ({ start_date: daysBefore(lastPeriodStart, cycles * length) }));
}

/** One cell through the real page: what she sees for this day and typical length. */
async function observeCell(length: TypicalLength, day: number) {
  const lastPeriodStart = daysBefore(DRAW, day - 1);
  fixture.periodLogs = trackerLogs(length, lastPeriodStart);
  fixture.inserts = [];
  await openCycleStep();
  expect(lastPeriodInput().value, `${length}/${day}: last period auto-filled`).toBe(lastPeriodStart);
  const saved = await save();
  await unmount();
  mount();

  const phase = saved.cycle.estimated_cycle_phase as string;
  const card = cycleContextCard(saved.report as Parameters<typeof cycleContextCard>[0], undefined);
  const estradiol = assessAmaniContext('estradiol', 150, contextFromReport(phase));
  const where = `${length}/day ${day}`;

  // Invariants of every cell, whatever its symbol.
  expect(saved.cycle.last_period_start_date, where).toBe(lastPeriodStart);
  expect(saved.cycle.estimated_cycle_day, where).toBe(day);
  if (card) expect(card.day, where).toBe(day);
  expect(saved.estradiolFlag === 'unknown', `${where}: biomarkers.flagged agrees with V2`).toBe(estradiol.kind === 'withheld');

  let symbol: string;
  if (PHASE_SYMBOL[phase]) {
    expect(card?.phase, where).toBe(phase);
    expect(estradiol.kind, where).toBe('scored');
    symbol = PHASE_SYMBOL[phase]!;
  } else {
    expect(phase, where).toBe('unknown');
    expect(estradiol, where).toMatchObject({ kind: 'withheld', reason: 'cycle_phase_missing' });
    expect(card, where).toBeNull();
    symbol = 'x';
  }
  return { symbol, storedLength: saved.cycle.average_cycle_length };
}

describe('PK-FIX-06 acceptance table (D13): days 1-40 x typical lengths {unknown, 28, 24, 35}', () => {
  it('the saved report matches the expected table in every cell', async () => {
    const observed = {} as Record<TypicalLength, string>;
    const storedLength = {} as Record<TypicalLength, unknown>;
    for (const length of LENGTHS) {
      let row = '';
      for (let day = 1; day <= DAYS; day++) {
        const cell = await observeCell(length, day);
        row += cell.symbol;
        if (day === 1) storedLength[length] = cell.storedLength;
        else expect(cell.storedLength, `${length}/day ${day}`).toBe(storedLength[length]);
      }
      observed[length] = row;
    }
    expect(observed).toEqual(TODAY);
    expect(storedLength).toEqual(TODAY_STORED_LENGTH);
  }, 180_000);
});
