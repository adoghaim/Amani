// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cycleContextCard } from '../lib/cycleContextCard';
import { assessAmaniContext, contextFromReport } from '../lib/scoring/amaniContext';
import type { ExtractedAnalyte } from '../../supabase/functions/_shared/lab-extraction';

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
  // Cycle facts printed on the lab report, as the OCR function returns them.
  ocrMetadata: undefined as { cycle_day?: number | null; cycle_phase?: string | null } | undefined,
  ocrItems: null as ExtractedAnalyte[] | null,
  generationBodies: [] as Record<string, unknown>[],
  // Her declared reproductive status (review F012); none unless a case sets one.
  profile: null as { pregnancy_status: string | null } | null,
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
  // parse-lab-report-ocr's own row shape (review F093), not the app's ReportItem.
  const ocrItems: ExtractedAnalyte[] = [{
    raw_name: 'Estradiol', raw_value_text: '150', value_numeric: 150, unit: 'pg/mL',
    raw_reference_range: null, normalized_min: null, normalized_max: null,
    normalized_operator: null, normalized_operator_value: null, source_snippet: 'Estradiol 150 pg/mL',
    confidence_score: 'high', canonical_analyte_id: null, canonical_slug: 'estradiol', parse_status: 'mapped',
    needs_review: false, is_core: true, category: 'hormones',
  }];
  return { supabase: {
    from: query,
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    functions: { invoke: async (name: string, options: { body: Record<string, unknown> }) => {
      if (name === 'parse-lab-report-ocr') return { data: { items: fixture.ocrItems ?? ocrItems, metadata: fixture.ocrMetadata }, error: null };
      if (name === 'generate-interpretation') fixture.generationBodies.push(options.body);
      return { data: null, error: null };
    } },
  } };
});
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: fixture.user, userProfile: fixture.profile }) }));
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
import {
  DAYS, daysBefore, DRAW, EXPECTED, EXPECTED_STORED_LENGTH, expectedNote, LENGTHS, PHASE_SYMBOL, trackerLogs,
  type TypicalLength,
} from '../lib/cycleR10Table';
import { extractTextFromPDF } from '../utils/pdfExtractor';
import { computeAmaniStatus } from '../lib/scoring/scoreBiomarker';
import { questHormoneFixture } from '../utils/parser/__fixtures__/questHormones';
import { labcorpHormoneFixture } from '../utils/parser/__fixtures__/labcorpHormones';


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
  fixture.ocrMetadata = undefined;
  fixture.ocrItems = null;
  fixture.generationBodies = [];
  fixture.profile = null;
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
const lengthInput = () => app.querySelector<HTMLInputElement>('#typical-cycle-length')!;
const lengthHint = () => app.querySelector('#typical-cycle-length-hint')?.textContent ?? null;
const lengthError = () => app.querySelector('#typical-cycle-length-error')?.textContent ?? null;
const autoFilledBadges = () => app.textContent?.match(/Auto-filled from your tracker/g)?.length ?? 0;

/** Renders the page, chooses a synthetic photo (or `file`) and continues to the cycle-context step. */
async function openCycleStep(file = new File(['synthetic'], 'synthetic-lab.png', { type: 'image/png' })) {
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
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
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

it('October smoke: first generation pins the same Vitamin D primary as the report page', async () => {
  // parse-lab-report-ocr's own row shape (review F093), like the estradiol row above.
  const panel: [slug: string, name: string, value: number, unit: string, min: number, max: number, category: string][] = [
    ['ferritin', 'Ferritin', 18, 'ng/mL', 16, 154, 'nutrients'],
    ['tsh', 'TSH', 2.85, 'uIU/mL', 0.4, 4.5, 'thyroid'],
    ['vitamin_d_25_oh', 'Vitamin D', 24, 'ng/mL', 30, 100, 'nutrients'],
  ];
  fixture.ocrItems = panel.map(([slug, name, value, unit, min, max, category]) => ({
    raw_name: name, raw_value_text: String(value), value_numeric: value, unit,
    raw_reference_range: `${min}-${max}`, normalized_min: min, normalized_max: max,
    normalized_operator: null, normalized_operator_value: null, source_snippet: `${name} ${value}`,
    confidence_score: 'high', canonical_analyte_id: null, canonical_slug: slug, parse_status: 'mapped',
    needs_review: false, is_core: true, category,
  }));
  await openCycleStep();
  await save();
  // The pin is computed from the rows the report page reads back, each with
  // her lab's printed value text and interval.
  const saved = fixture.inserts.find(i => i.table === 'biomarkers')?.values as Record<string, unknown>[] | undefined;
  expect(saved?.map(b => [b['name'], b['raw_value_text'], b['reference_min'], b['reference_max']])).toEqual([
    ['ferritin', '18', 16, 154], ['tsh', '2.85', 0.4, 4.5], ['vitamin_d_25_oh', '24', 30, 100],
  ]);
  expect(fixture.generationBodies).toEqual([{ reportId: 'report-fix06', primary_canonical_slug: 'vitamin_d_25_oh' }]);
});

/*
  The report page builds its primary with her declared reproductive status
  (review F012) and each value's printed text (F021), so the pin is built the
  same way. Rows as parse-lab-report-ocr returns them; synthetic values.
*/
const ocrRow = (
  slug: string, name: string, value: number, text: string, unit: string,
  min: number | null, max: number | null, category: string,
): ExtractedAnalyte => ({
  raw_name: name, raw_value_text: text, value_numeric: value, unit,
  raw_reference_range: min !== null && max !== null ? `${min}-${max}` : null, normalized_min: min, normalized_max: max,
  normalized_operator: null, normalized_operator_value: null, source_snippet: `${name} ${text}`,
  confidence_score: 'high', canonical_analyte_id: null, canonical_slug: slug, parse_status: 'mapped',
  needs_review: false, is_core: true, category,
});
/** The October smoke values, with or without the ranges her lab printed. */
const octoberRows = (printedRanges = true) => [
  ocrRow('ferritin', 'Ferritin', 18, '18', 'ng/mL', printedRanges ? 16 : null, printedRanges ? 154 : null, 'nutrients'),
  ocrRow('tsh', 'TSH', 2.85, '2.85', 'uIU/mL', printedRanges ? 0.4 : null, printedRanges ? 4.5 : null, 'thyroid'),
  ocrRow('vitamin_d_25_oh', 'Vitamin D', 24, '24', 'ng/mL', printedRanges ? 30 : null, printedRanges ? 100 : null, 'nutrients'),
];

it('October smoke, Pregnant declared: every band is withheld and her lab-flagged Vitamin D is the pin (Ruling 7)', async () => {
  fixture.profile = { pregnancy_status: 'Pregnant' };
  fixture.ocrItems = octoberRows();
  await openCycleStep();
  await save();
  const saved = fixture.inserts.find(i => i.table === 'biomarkers')?.values as Record<string, unknown>[] | undefined;
  expect(saved?.map(b => [b['name'], b['flagged']])).toEqual([
    ['ferritin', 'unknown'], ['tsh', 'unknown'], ['vitamin_d_25_oh', 'unknown'],
  ]);
  expect(fixture.generationBodies).toEqual([{ reportId: 'report-fix06', primary_canonical_slug: 'vitamin_d_25_oh' }]);
});

it.each([
  [null, 'vitamin_d_25_oh'],
  ['Pregnant', null],
])('October smoke values without printed ranges, %j declared: the pin is %j', async (status, pin) => {
  fixture.profile = { pregnancy_status: status };
  fixture.ocrItems = octoberRows(false);
  await openCycleStep();
  await save();
  expect(fixture.generationBodies).toEqual([{ reportId: 'report-fix06', primary_canonical_slug: pin }]);
});

it('eGFR printed "> OR = 60" beside a ferritin inside its band: no pin, as no primary on the page', async () => {
  fixture.ocrItems = [
    ocrRow('egfr', 'eGFR', 60, '> OR = 60', 'mL/min/1.73m2', 60, 200, 'kidney'),
    ocrRow('ferritin', 'Ferritin', 40, '40', 'ng/mL', 13, 150, 'nutrients'),
  ];
  await openCycleStep();
  await save();
  const saved = fixture.inserts.find(i => i.table === 'biomarkers')?.values as Record<string, unknown>[] | undefined;
  expect(saved?.map(b => [b['name'], b['raw_value_text']])).toEqual([['egfr', '> OR = 60'], ['ferritin', '40']]);
  expect(fixture.generationBodies).toEqual([{ reportId: 'report-fix06', primary_canonical_slug: null }]);
});

/*
  RV-LF2 (Ruling 7): a range her lab printed on one side binds no bounds, so
  only the report_analytes row keeps it; the page reads it from there, and so
  does the pin. Synthetic: "<90" is an invented printed range, so LDL 95 is
  outside it but inside its Amani band, and TSH 2.0 sits inside both.
*/
const oneSidedRows = () => [
  ocrRow('tsh', 'TSH', 2, '2.0', 'mIU/L', 0.45, 4.5, 'thyroid'),
  { ...ocrRow('ldl_cholesterol', 'LDL Cholesterol', 95, '95', 'mg/dL', null, null, 'lipids'),
    raw_reference_range: '<90', normalized_operator: '<', normalized_operator_value: 90 },
];

it('a lab-only flag against a one-sided printed range is the pin, as it is the primary on the page (RV-LF2 AC6)', async () => {
  fixture.ocrItems = oneSidedRows();
  await openCycleStep();
  await save();
  expect(fixture.generationBodies).toEqual([{ reportId: 'report-fix06', primary_canonical_slug: 'ldl_cholesterol' }]);
});

it('the one-sided range stays on report_analytes: the biomarkers rows keep their columns and LDL its null bounds (RV-LF2 AC7)', async () => {
  fixture.ocrItems = oneSidedRows();
  await openCycleStep();
  await save();
  const saved = fixture.inserts.find(i => i.table === 'biomarkers')?.values as Record<string, unknown>[] | undefined;
  expect(saved?.map(b => Object.keys(b))).toEqual(Array(2).fill([
    'lab_report_id', 'name', 'value', 'raw_value_text', 'unit', 'reference_min', 'reference_max', 'flagged',
  ]));
  expect(saved?.map(b => [b['name'], b['reference_min'], b['reference_max']])).toEqual([
    ['tsh', 0.45, 4.5], ['ldl_cholesterol', null, null],
  ]);
  const analytes = fixture.inserts.find(i => i.table === 'report_analytes')?.values as Record<string, unknown>[] | undefined;
  expect(analytes?.find(a => a['canonical_slug'] === 'ldl_cholesterol')).toMatchObject({
    raw_reference_range: '<90', normalized_min: null, normalized_max: null, normalized_operator: '<', normalized_operator_value: 90,
  });
});

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
    -        no phase is stored; the Cycle context card shows the cycle day,
             with a neutral note in place of a phase; V2 withholds estradiol.

  TODAY is the output of main @ 948dc95, captured by this test before any
  PK-FIX-06 logic change. Main has no length input and never reads one, so the
  length columns cannot differ: every report stores 28.

  EXPECTED is owner decision D13:
    PRESERVE  unknown and 28, days 1-35: identical to TODAY (asserted below).
    (a)       day 36 and later: the cycle day shows, with no phase estimate,
              and estradiol stays withheld.
    (b)       a known length other than 28 (24, 35): the cycle day shows with
              neutral copy and no phase estimate on every day, because no
              approved method covers that length.
*/
/*
  PK-FIX-06-EXT (D10): LENGTHS, DAYS, EXPECTED, EXPECTED_STORED_LENGTH and the
  tracker logs moved, unchanged, to src/lib/cycleR10Table.ts, so the same
  table also drives the dashboard predictor (cyclePredictor.r10.test.ts).
  TODAY stays here: it is this page's captured output.
*/

const TODAY: Record<TypicalLength, string> = {
  //   cycle day 1   5   10   15   20   25   30   35   40
  //             |   |    |    |    |    |    |    |    |
  unknown:      'MMMMMFFFFFFFOOOOLLLLLLLLLLLLLLLLLLLxxxxx',
  28:           'MMMMMFFFFFFFOOOOLLLLLLLLLLLLLLLLLLLxxxxx',
  24:           'MMMMMFFFFFFFOOOOLLLLLLLLLLLLLLLLLLLxxxxx',
  35:           'MMMMMFFFFFFFOOOOLLLLLLLLLLLLLLLLLLLxxxxx',
};
const TODAY_STORED_LENGTH: Record<TypicalLength, number | null> = { unknown: 28, 28: 28, 24: 28, 35: 28 };


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
    // A card with a phase is as before: no note.
    expect(card, where).toEqual({ phase, day, confidence: null, explanation: null });
    expect(card, where).not.toHaveProperty('phaseNote');
    expect(estradiol.kind, where).toBe('scored');
    symbol = PHASE_SYMBOL[phase]!;
  } else {
    expect(phase, where).toBe('unknown');
    expect(estradiol, where).toMatchObject({ kind: 'withheld', reason: 'cycle_phase_missing' });
    if (card) {
      // The cycle day without a phase: the neutral note, and nothing model-authored.
      expect(card, where).toEqual({ phase: null, day, confidence: null, explanation: null, phaseNote: expectedNote(length) });
      symbol = '-';
    } else {
      symbol = 'x';
    }
  }
  return { symbol, storedLength: saved.cycle.average_cycle_length };
}

describe('PK-FIX-06 acceptance table (D13): days 1-40 x typical lengths {unknown, 28, 24, 35}', () => {
  it('the expected table preserves TODAY for unknown and 28 on days 1-35, and changes only (a) and (b)', () => {
    for (const length of ['unknown', 28] as const) {
      expect(EXPECTED[length].slice(0, 35), `${length}: PRESERVE`).toBe(TODAY[length].slice(0, 35));
    }
    for (const length of LENGTHS) {
      for (let day = 1; day <= DAYS; day++) {
        const intended = day > 35 || (length !== 'unknown' && length !== 28);
        // D13 cell by cell: (a) and (b) show her cycle day without a phase; every other cell is TODAY's.
        expect(EXPECTED[length][day - 1], `${length}/day ${day}`).toBe(intended ? '-' : TODAY[length][day - 1]);
      }
      // The stored length: 28 for everyone before; now her known length, or null.
      expect([TODAY_STORED_LENGTH[length], EXPECTED_STORED_LENGTH[length]], `${length}: stored length`)
        .toEqual([28, length === 'unknown' ? null : length]);
    }
  });

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
    expect(observed).toEqual(EXPECTED);
    expect(storedLength).toEqual(EXPECTED_STORED_LENGTH);
  }, 180_000);
});

/*
  The optional "Typical cycle length" field at upload: typed, auto-filled from
  the tracker, overridden or cleared. The table above supplies every length
  through the tracker; these cases supply it through the field.
*/
describe('PK-FIX-06: the typical cycle length field on the upload page', () => {
  const LENGTH_HINT = 'Days from the first day of one period to the first day of the next';

  it('day 21 of a typed 35-day cycle: day 21, no phase (was luteal), length 35; estradiol withheld', async () => {
    await openCycleStep();
    expect(lengthInput().value).toBe('');
    expect(lengthHint()).toBe(LENGTH_HINT);
    await type(lastPeriodInput(), '2026-04-10');
    await type(lengthInput(), '35');
    expect(await save()).toMatchObject({
      cycle: { last_period_start_date: '2026-04-10', average_cycle_length: 35, estimated_cycle_day: 21, estimated_cycle_phase: 'unknown' },
      estradiolFlag: 'unknown',
    });
  }, 30_000);

  it('a typed 24-day cycle: day 10, no phase (was follicular), length 24', async () => {
    await openCycleStep();
    await type(lastPeriodInput(), '2026-04-21');
    await type(lengthInput(), '24');
    expect((await save()).cycle).toEqual({
      last_period_start_date: '2026-04-21', average_cycle_length: 24, estimated_cycle_day: 10, estimated_cycle_phase: 'unknown',
    });
  }, 30_000);

  it('a typed 28: day 21 luteal, as before, and estradiol is scored', async () => {
    await openCycleStep();
    await type(lastPeriodInput(), '2026-04-10');
    await type(lengthInput(), '28');
    const saved = await save();
    expect(saved.cycle).toEqual({
      last_period_start_date: '2026-04-10', average_cycle_length: 28, estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
    });
    expect(saved.estradiolFlag).not.toBe('unknown');
  }, 30_000);

  it('no length known: the day map applies exactly as before, and the length is stored as null, not 28', async () => {
    await openCycleStep();
    await type(lastPeriodInput(), '2026-04-10');
    const saved = await save();
    expect(saved.cycle).toEqual({
      last_period_start_date: '2026-04-10', average_cycle_length: null, estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
    });
    expect(saved.estradiolFlag).not.toBe('unknown');
  }, 30_000);

  it('missing last-period date: no cycle day and no phase, as before; a typed length is still kept', async () => {
    await openCycleStep();
    expect(lastPeriodInput().value).toBe('');
    await type(lengthInput(), '35');
    expect(await save()).toMatchObject({
      cycle: { last_period_start_date: null, average_cycle_length: 35, estimated_cycle_day: null, estimated_cycle_phase: 'unknown' },
      estradiolFlag: 'unknown',
    });
  }, 30_000);

  it('the tracker average pre-fills the field with the badge; a typed length overrides it', async () => {
    // Three logged starts 30 days apart: cyclePredictor's average is 30.
    fixture.periodLogs = [{ start_date: '2026-02-09' }, { start_date: '2026-03-11' }, { start_date: '2026-04-10' }];
    await openCycleStep();
    expect(lastPeriodInput().value).toBe('2026-04-10');
    expect(lengthInput().value).toBe('30');
    expect(autoFilledBadges()).toBe(2);
    await type(lengthInput(), '28');
    // Only the last-period badge is left.
    expect(autoFilledBadges()).toBe(1);
    expect((await save()).cycle).toEqual({
      last_period_start_date: '2026-04-10', average_cycle_length: 28, estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
    });
  }, 30_000);

  it('clearing an auto-filled length makes it unknown again: today\'s phase, and null stored', async () => {
    fixture.periodLogs = [{ start_date: '2026-02-09' }, { start_date: '2026-03-11' }, { start_date: '2026-04-10' }];
    await openCycleStep();
    expect(lengthInput().value).toBe('30');
    await type(lengthInput(), '');
    expect(autoFilledBadges()).toBe(1);
    expect((await save()).cycle).toEqual({
      last_period_start_date: '2026-04-10', average_cycle_length: null, estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
    });
  }, 30_000);

  it('a typed length that is not a whole number of days from 15 to 60 is flagged and blocks Next', async () => {
    await openCycleStep();
    for (const bad of ['90', '10', '0', '28.5', '-28', 'abc']) {
      await type(lengthInput(), bad);
      expect(lengthError(), bad).toBe('Enter a whole number of days from 15 to 60');
      expect(lengthHint(), bad).toBeNull();
      expect(lengthInput().getAttribute('aria-invalid'), bad).toBe('true');
      expect(lengthInput().getAttribute('aria-describedby'), bad).toBe('typical-cycle-length-error');
      expect((button('Next') as HTMLButtonElement).disabled, bad).toBe(true);
    }
    await type(lengthInput(), '30');
    expect(lengthError()).toBeNull();
    expect(lengthHint()).toBe(LENGTH_HINT);
    expect(lengthInput().getAttribute('aria-invalid')).toBeNull();
    expect(lengthInput().getAttribute('aria-describedby')).toBe('typical-cycle-length-hint');
    expect((button('Next') as HTMLButtonElement).disabled).toBe(false);
  }, 30_000);

  it('the field is labelled for assistive technology', async () => {
    await openCycleStep();
    const label = app.querySelector('label[for="typical-cycle-length"]');
    expect(label?.textContent?.trim()).toBe('Typical cycle length');
    expect(lengthInput().getAttribute('inputmode')).toBe('numeric');
  }, 30_000);
});

/*
  F010 (owner decision): her dates win. A cycle day or phase printed on the lab
  report (here from the OCR function's metadata) fills in only when her last
  period start gives no cycle day, and a printed phase never overrides D13 (b).
  Until F010 the printed value won field by field, even on a known 35-day
  cycle. The first two cases pinned that precedence; they now pin the decision.
*/
describe('F010: her dates win over cycle facts printed on the lab report', () => {
  it('a printed cycle day does not replace the day from her dates (was day 3 with a luteal phase)', async () => {
    fixture.ocrMetadata = { cycle_day: 3, cycle_phase: null };
    await openCycleStep();
    await type(lastPeriodInput(), '2026-04-10');
    expect((await save()).cycle).toEqual({
      last_period_start_date: '2026-04-10', average_cycle_length: null, estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
    });
  }, 30_000);

  it('a printed phase neither replaces her phase nor overrides D13 (b) on a known 35-day cycle (was follicular)', async () => {
    fixture.ocrMetadata = { cycle_day: null, cycle_phase: 'follicular' };
    await openCycleStep();
    await type(lastPeriodInput(), '2026-04-10');
    await type(lengthInput(), '35');
    expect(await save()).toMatchObject({
      cycle: { last_period_start_date: '2026-04-10', average_cycle_length: 35, estimated_cycle_day: 21, estimated_cycle_phase: 'unknown' },
      estradiolFlag: 'unknown',
    });
  }, 30_000);

  it('without her last period start, a printed day and phase fill in, as before', async () => {
    fixture.ocrMetadata = { cycle_day: 21, cycle_phase: 'luteal' };
    await openCycleStep();
    expect((await save()).cycle).toEqual({
      last_period_start_date: null, average_cycle_length: null, estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
    });
  }, 30_000);

  it('without her dates, a printed phase still never overrides D13 (b) (was luteal)', async () => {
    fixture.ocrMetadata = { cycle_day: 21, cycle_phase: 'luteal' };
    await openCycleStep();
    await type(lengthInput(), '35');
    expect(await save()).toMatchObject({
      cycle: { last_period_start_date: null, average_cycle_length: 35, estimated_cycle_day: 21, estimated_cycle_phase: 'unknown' },
      estradiolFlag: 'unknown',
    });
  }, 30_000);
});

/*
  F010 on the PDF path. The Quest and LabCorp hormone panels print phase-labelled
  reference intervals and no line about her cycle. The page saved their first
  label, follicular, over the luteal day 21 from her dates, and flagged
  progesterone 8.2 ng/mL against the follicular band.
*/
describe("F010: phase labels on a PDF's reference intervals never set her cycle", () => {
  const pdf = () => new File(['synthetic'], 'synthetic-lab.pdf', { type: 'application/pdf' });
  const flagged = (name: string) => (fixture.inserts.find(i => i.table === 'biomarkers')?.values as
    Record<string, unknown>[] | undefined)?.find(b => b['name'] === name)?.['flagged'];
  // NewReport's status-to-flag mapping, for the flag V2 gives progesterone in a phase.
  const flagIn = (phase: string) => {
    const status = computeAmaniStatus('progesterone', 8.2, phase);
    if (status === 'unknown') return 'unknown';
    if (status === 'borderline_low' || status === 'borderline_high') return 'borderline';
    return status === 'out_of_range_low' || status === 'out_of_range_high' ? 'out_of_range' : 'in_range';
  };

  for (const [lab, text] of [['Quest', questHormoneFixture], ['LabCorp', labcorpHormoneFixture]] as const) {
    it(`${lab} hormone panel, day 21 from her dates: luteal is saved and scores progesterone (was follicular)`, async () => {
      vi.mocked(extractTextFromPDF).mockResolvedValueOnce(text);
      await openCycleStep(pdf());
      await type(lastPeriodInput(), '2026-04-10');
      expect((await save()).cycle).toEqual({
        last_period_start_date: '2026-04-10', average_cycle_length: null, estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
      });
      expect(flagged('progesterone')).toBe(flagIn('luteal'));
    }, 30_000);

    it(`${lab} hormone panel without her dates: no phase is saved and progesterone is withheld (was follicular)`, async () => {
      vi.mocked(extractTextFromPDF).mockResolvedValueOnce(text);
      await openCycleStep(pdf());
      expect((await save()).cycle).toEqual({
        last_period_start_date: null, average_cycle_length: null, estimated_cycle_day: null, estimated_cycle_phase: 'unknown',
      });
      expect(flagged('progesterone')).toBe(flagIn('unknown'));
    }, 30_000);
  }

  it('a CD4 count is never saved as cycle day 4', async () => {
    vi.mocked(extractTextFromPDF).mockResolvedValueOnce('CD4 Count 812 cells/uL\nCD8 Count 401 cells/uL');
    await openCycleStep(pdf());
    expect((await save()).cycle).toMatchObject({ estimated_cycle_day: null, estimated_cycle_phase: 'unknown' });
  }, 30_000);

  it('her own labelled line on the report still fills in without her dates', async () => {
    const header = 'Reporting Physician: Dr. Synthetic\n';
    vi.mocked(extractTextFromPDF).mockResolvedValueOnce(
      questHormoneFixture.replace(header, `${header}Cycle Day: 21\nPhase: Luteal\n`),
    );
    await openCycleStep(pdf());
    expect((await save()).cycle).toEqual({
      last_period_start_date: null, average_cycle_length: null, estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
    });
    expect(flagged('progesterone')).toBe(flagIn('luteal'));
  }, 30_000);
});
