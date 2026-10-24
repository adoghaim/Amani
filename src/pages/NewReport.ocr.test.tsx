// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedAnalyte } from '../../supabase/functions/_shared/lab-extraction';
import { ResultRow } from '../components/ResultRow';

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

/** Type into one of the confirm step's real inputs, as she would. */
async function type(input: HTMLInputElement | null | undefined, value: string) {
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input!.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle();
}
const valueInput = () => app.querySelector<HTMLInputElement>('input[type="number"]');
const rangeInput = () => app.querySelector<HTMLInputElement>('input[placeholder=\'e.g. "65-99"\']');

/** What the report's ResultRow shows for one saved report_analytes row. */
async function renderResult(saved: Record<string, unknown>) {
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  await act(async () => r.render(<ResultRow analyte={{ ...saved, display_name: 'TSH' } as never} cyclePhase={null} />));
  const out = {
    value: host.querySelector('[data-testid="result-value"]')?.textContent,
    status: host.querySelector('[data-testid="result-status"]')?.textContent,
  };
  await act(async () => r.unmount());
  host.remove();
  return out;
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

/*
  IB1 review (correctness): the confirm step's corrections must replace what
  was read off the page. A low-confidence OCR card opens for editing; she
  fixes a misread value or a misread range. The printed value text and the
  interval read with it must not survive her correction, or the report shows
  the misread value and places her value against an interval she corrected.
*/
const MISREAD: ExtractedAnalyte = {
  ...TSH, raw_value_text: '21', value_numeric: 21, source_snippet: 'TSH 21 uIU/mL 0.45-4.5',
  confidence_score: 'low', needs_review: true,
};

describe('NewReport: her confirm-step corrections to an OCR row reach the report', () => {
  it('a corrected value replaces the printed value text (21 -> 2.1)', async () => {
    fixture.ocrItems = [MISREAD];
    await uploadPhoto();
    await type(valueInput(), '2.1');
    expect(confirmValues()).toEqual({ TSH: '2.1' });
    const { analytes, biomarkers } = await save();
    expect(analytes['TSH']).toMatchObject({ raw_value_text: null, value_numeric: 2.1, normalized_min: 0.45, normalized_max: 4.5 });
    expect(biomarkers['tsh']).toMatchObject({ raw_value_text: null, value: 2.1 });
    expect((await renderResult(analytes['TSH'])).value).toBe('2.1');
  });

  it('a corrected range replaces the interval read with it (0.45-45 -> 0.45-4.5, value 10)', async () => {
    fixture.ocrItems = [{
      ...MISREAD, raw_value_text: '10', value_numeric: 10, raw_reference_range: '0.45-45', normalized_max: 45,
      source_snippet: 'TSH 10 uIU/mL 0.45-45',
    }];
    await uploadPhoto();
    await type(rangeInput(), '0.45-4.5');
    const { analytes, biomarkers } = await save();
    expect(analytes['TSH']).toMatchObject({
      raw_reference_range: '0.45-4.5', normalized_min: 0.45, normalized_max: 4.5,
      normalized_operator: null, normalized_operator_value: null,
    });
    expect(biomarkers['tsh']).toMatchObject({ reference_min: 0.45, reference_max: 4.5 });
    expect((await renderResult(analytes['TSH'])).status).not.toBe("Within your lab's range");
  });

  it('a range corrected to a comparator saves the operator and bound, not the old interval', async () => {
    fixture.ocrItems = [MISREAD];
    await uploadPhoto();
    await type(rangeInput(), '<4.5');
    const { analytes, biomarkers } = await save();
    expect(analytes['TSH']).toMatchObject({
      raw_reference_range: '<4.5', normalized_min: null, normalized_max: null,
      normalized_operator: '<', normalized_operator_value: 4.5,
    });
    expect(biomarkers['tsh']).toMatchObject({ reference_min: null, reference_max: null });
  });

  it('a range she types that does not parse, or clears, leaves no interval behind', async () => {
    fixture.ocrItems = [MISREAD, { ...LDL, confidence_score: 'low', needs_review: true }];
    await uploadPhoto();
    const ranges = app.querySelectorAll<HTMLInputElement>('input[placeholder=\'e.g. "65-99"\']');
    expect(ranges).toHaveLength(2);
    await type(ranges[0], 'see note');
    await type(ranges[1], '');
    const { analytes } = await save();
    expect(analytes['TSH']).toMatchObject({
      raw_reference_range: 'see note', normalized_min: null, normalized_max: null,
      normalized_operator: null, normalized_operator_value: null,
    });
    expect(analytes['LDL Cholesterol']).toMatchObject({
      raw_reference_range: null, normalized_min: null, normalized_max: null,
      normalized_operator: null, normalized_operator_value: null,
    });
  });

  /*
    IB1 review fix wave 1 (BLOCKER): a range she edits is read the way the
    parser binds one (PK-FIX-05). The printed estradiol text below is the
    parser's own ambiguous row (parser.test.ts.snap, "estradiol"): several
    cycle-phase intervals, nothing bound. Correcting one number in it must not
    bind the first (follicular) interval; neither may one interval tied to a
    phase. Synthetic values; nothing here is a clinical reference.
  */
  const PHASES = 'Follicular phase 21.1 – 121.1; Ovulation phase 61.1 – 361.1; Luteal phase 51.1 – 251.1; Postmenopausal <31.1';
  const ESTRADIOL: ExtractedAnalyte = {
    raw_name: 'Estradiol', raw_value_text: '145', value_numeric: 145, unit: 'pg/mL',
    raw_reference_range: PHASES, normalized_min: null, normalized_max: null,
    normalized_operator: null, normalized_operator_value: null, source_snippet: `Estradiol 145 pg/mL ${PHASES}`,
    confidence_score: 'low', canonical_analyte_id: null, canonical_slug: 'estradiol', parse_status: 'partial',
    needs_review: true, is_core: true, category: 'hormones',
  };

  it.each([
    ['one number of the ovulation interval corrected', PHASES.replace('361.1', '361')],
    ['one interval tied to a cycle phase', 'Follicular phase 21.1 – 121.1'],
  ])('an edited range that prints no single interval for her binds none (%s)', async (_case, typed) => {
    fixture.ocrItems = [ESTRADIOL];
    await uploadPhoto();
    await type(rangeInput(), typed);
    const { analytes, biomarkers } = await save();
    expect(analytes['Estradiol']).toMatchObject({
      raw_reference_range: typed, normalized_min: null, normalized_max: null,
      normalized_operator: null, normalized_operator_value: null,
    });
    expect(biomarkers['estradiol']).toMatchObject({ reference_min: null, reference_max: null });
    expect((await renderResult(analytes['Estradiol'])).status).not.toBe("Above your lab's range");
  });

  it('an edited range that prints one interval with a non-phase label still binds it', async () => {
    fixture.ocrItems = [MISREAD];
    await uploadPhoto();
    await type(rangeInput(), 'Adult 0.45-4.5; fasting');
    const { analytes } = await save();
    expect(analytes['TSH']).toMatchObject({ normalized_min: 0.45, normalized_max: 4.5, normalized_operator: null });
  });

  it('a row whose value text the model sent as a JSON number still saves', async () => {
    // Model output is untrusted: the deployed function passes value_text through as the model typed it.
    fixture.ocrItems = [{ ...TSH, raw_value_text: 5.2 as unknown as string, value_numeric: 5.2 }];
    await uploadPhoto();
    const { analytes } = await save();
    expect(analytes['TSH']).toMatchObject({ raw_value_text: '5.2', value_numeric: 5.2, normalized_min: 0.45, normalized_max: 4.5 });
  });
});
