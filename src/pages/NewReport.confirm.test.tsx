// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedAnalyte } from '../../supabase/functions/_shared/lab-extraction';

/*
  F022 on the real upload page: a value Amani has probably misread (outside
  physiological bounds) cannot be saved until she marks it correct, corrects
  it or removes it, and what she confirmed is what report_analytes records.
  Jsdom and a mocked Supabase client; synthetic text and values only.
*/
const fixture = vi.hoisted(() => ({
  user: { id: '00000000-0000-4000-8000-0000000f0022' },
  inserts: [] as { table: string; values: unknown }[],
  pdfText: '',
  ocrItems: [] as ExtractedAnalyte[],
}));

vi.mock('../lib/supabase', () => {
  type Row = Record<string, unknown>;
  const query = (table: string) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, in: () => builder,
      lte: () => builder, update: () => builder,
      insert: (values: unknown) => { fixture.inserts.push({ table, values }); return builder; },
      single: async () => ({ data: table === 'lab_reports' ? { id: 'report-f022' } : null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };
  return { supabase: {
    from: query,
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    functions: { invoke: async (name: string) => (name === 'parse-lab-report-ocr'
      ? { data: { items: fixture.ocrItems }, error: null } : { data: null, error: null }) },
  } };
});
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock('../lib/native', () => ({
  isNative: () => false,
  captureLabPhoto: vi.fn(),
  getNetworkStatus: async () => ({ connected: true, connectionType: 'wifi' }),
  onNetworkChange: () => () => {},
}));
vi.mock('../utils/pdfExtractor', () => ({
  extractTextFromPDF: vi.fn(async () => fixture.pdfText),
  convertPDFToImages: vi.fn(async () => []),
}));
vi.mock('../utils/subscription', () => ({ checkSubscriptionLive: vi.fn(), handle402: async () => null }));
vi.mock('../lib/freemium/gates', () => ({ uploadRequiresSubscription: () => false }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { NewReport } from './NewReport';
import { edgeCasesFixture } from '../utils/parser/__fixtures__/edgeCases';
import { isUnconfirmedReading, type ReadingReview } from '../lib/biomarkers/confirmation';

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.inserts = [];
  fixture.pdfText = '';
  fixture.ocrItems = [];
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
const button = (label: string, within: ParentNode = app) =>
  Array.from(within.querySelectorAll('button')).find(b => b.textContent?.trim() === label) ?? null;
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
/** The confirm step's card for one marker, by the name it shows. */
function card(name: string): HTMLElement {
  const header = Array.from(app.querySelectorAll('div.cursor-pointer'))
    .find(h => h.querySelector('span.truncate')?.textContent === name);
  expect(header, name).toBeDefined();
  return header!.parentElement!;
}
async function typeValue(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

/** Upload `file`, read it, and stop on step 2 ("Review your report"). */
async function upload(file: File) {
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
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
  await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(button('Next'));
  await settle(20);
  expect(app.textContent).toContain('Review your report');
}
const pdf = () => new File(['%PDF-1.3 synthetic'], 'synthetic-edge-cases.pdf', { type: 'application/pdf' });
const photo = () => new File(['synthetic'], 'synthetic-lab.png', { type: 'image/png' });
/** A row as parse-lab-report-ocr builds it (ExtractedAnalyte, review F093); synthetic intervals. */
const ocrRow = (
  slug: string, name: string, value: number, unit: string, min: number, max: number, category: string,
): ExtractedAnalyte => ({
  raw_name: name, raw_value_text: String(value), value_numeric: value, unit,
  raw_reference_range: `${min}-${max}`, normalized_min: min, normalized_max: max,
  normalized_operator: null, normalized_operator_value: null, source_snippet: `${name} ${value}`,
  confidence_score: 'high', canonical_analyte_id: null, canonical_slug: slug, parse_status: 'mapped',
  needs_review: false, is_core: true, category,
});

const saveButton = () => button('Save and analyze') as HTMLButtonElement | null;
const savedAnalytes = () => (fixture.inserts.find(i => i.table === 'report_analytes')?.values ?? []) as Record<string, unknown>[];

describe('NewReport confirm step: a probably misread value needs her confirmation (F022)', () => {
  it('step 2 no longer says Amani will use what it could not read', async () => {
    fixture.pdfText = edgeCasesFixture;
    await upload(pdf());
    expect(app.textContent).not.toContain('Amani will use what it understood');
    expect(app.textContent).toContain('Check them on the next step.');
  });

  /*
    IA2 review, finding 1: the step-2 copy promises only what the web app does
    today. Her report page and Tracker charts leave the value out; the server's
    AI summary and the Tracker's AI insights (lab-insights) read every saved
    value until their handoffs ship, so the copy says they may still include it.
  */
  it('step 2 promises only what holds today: report and Tracker charts leave it out; AI summaries may not', async () => {
    fixture.pdfText = edgeCasesFixture;
    await upload(pdf());
    expect(app.textContent).toContain(
      'Until you confirm a value we may have misread, it is left out of your report\'s main finding, focus areas and changes, '
      + 'and out of your Tracker charts. AI summaries and insights may still include it.',
    );
    expect(app.textContent).not.toContain('isn\'t used for your main finding or trends');
  });

  it('the parser\'s parse-error row keeps Save closed until she marks it correct', async () => {
    fixture.pdfText = edgeCasesFixture;
    await upload(pdf());
    await click(button('Next'));
    expect(app.textContent).toContain('Confirm your markers');

    expect(saveButton()?.disabled).toBe(true);
    expect(app.querySelector('[data-testid="confirm-misread"]')?.textContent)
      .toBe('Amani may have misread 1 value. Mark it as correct, fix it, or remove it to save.');
    await click(saveButton());
    expect(fixture.inserts.find(i => i.table === 'lab_reports')).toBeUndefined();

    await click(button('Mark as Correct', card('TSH')));
    expect(saveButton()?.disabled).toBe(false);
    expect(app.querySelector('[data-testid="confirm-misread"]')).toBeNull();

    await click(saveButton());
    await settle(20);
    const byName = Object.fromEntries(savedAnalytes().map(a => [a['raw_name'], a]));
    // What she confirmed is recorded as confirmed; the "<150" she left is saved as unconfirmed (F098).
    expect(byName['tsh']).toMatchObject({ needs_review: false, reviewed_by_user: true, review_status: 'reviewed' });
    expect(byName['vitamin_b12']).toMatchObject({ raw_value_text: '<150', needs_review: true, reviewed_by_user: false });
  });

  it('a photo read by OCR is held to the same bounds; typing her value releases Save', async () => {
    fixture.ocrItems = [
      ocrRow('tsh', 'TSH', 0.0008, 'mIU/L', 0.4, 4.5, 'thyroid'),
      ocrRow('ferritin', 'Ferritin', 18, 'ng/mL', 16, 154, 'nutrients'),
    ];
    await upload(photo());
    await click(button('Next'));

    expect(saveButton()?.disabled).toBe(true);
    expect(card('TSH').textContent).toContain('below physiological minimum 0.001 for TSH');
    await typeValue(card('TSH').querySelector<HTMLInputElement>('input[type="number"]')!, '0.8');
    expect(saveButton()?.disabled).toBe(false);

    await click(saveButton());
    await settle(20);
    const tsh = savedAnalytes().find(a => a['canonical_slug'] === 'tsh');
    // Her typed value replaces the printed '0.0008' (IB1's applyReviewEdit).
    expect(tsh).toMatchObject({
      value_numeric: 0.8, raw_value_text: null, needs_review: false, reviewed_by_user: true, review_status: 'edited_by_user',
    });
    const biomarkers = (fixture.inserts.find(i => i.table === 'biomarkers')?.values ?? []) as Record<string, unknown>[];
    expect(biomarkers.find(b => b['name'] === 'tsh')).toMatchObject({ value: 0.8 });
  });

  /*
    IA2 review wave 2, findings 1-2: a value printed in another unit outside the
    bounds (an SI glucose) is no parse error, so Save stays open, but it is not
    accepted silently: she is asked to check it, and until she confirms it the
    saved row is unconfirmed, so it stays out of her primary finding and trends.
  */
  it('a value in another unit outside the bounds does not block Save but is saved unconfirmed until she checks it', async () => {
    fixture.ocrItems = [
      ocrRow('fasting_glucose', 'Glucose', 5.2, 'mmol/L', 3.9, 5.5, 'metabolic'),
      ocrRow('ferritin', 'Ferritin', 18, 'ng/mL', 16, 154, 'nutrients'),
    ];
    await upload(photo());
    await click(button('Next'));

    expect(saveButton()?.disabled).toBe(false);
    expect(app.querySelector('[data-testid="confirm-misread"]')).toBeNull();
    expect(app.querySelector('[data-testid="check-unit"]')?.textContent)
      .toBe("Amani can't check 1 value in the unit printed. Check it against your report, then mark it as correct or fix it.");
    expect(card('Fasting Glucose').textContent).not.toContain('likely a parse error');

    await click(saveButton());
    await settle(20);
    const glucose = savedAnalytes().find(a => a['canonical_slug'] === 'fasting_glucose');
    expect(glucose).toMatchObject({
      value_numeric: 5.2, raw_value_text: '5.2', normalized_min: 3.9, normalized_max: 5.5,
      needs_review: true, confidence_score: 'low', reviewed_by_user: false,
    });
    expect(isUnconfirmedReading(glucose as unknown as ReadingReview)).toBe(true);
    const ferritin = savedAnalytes().find(a => a['canonical_slug'] === 'ferritin');
    expect(isUnconfirmedReading(ferritin as unknown as ReadingReview)).toBe(false);
  });

  it('control: once she marks that value correct, the check line goes and it is saved confirmed', async () => {
    fixture.ocrItems = [ocrRow('fasting_glucose', 'Glucose', 5.2, 'mmol/L', 3.9, 5.5, 'metabolic')];
    await upload(photo());
    await click(button('Next'));
    await click(button('Mark as Correct', card('Fasting Glucose')));
    expect(app.querySelector('[data-testid="check-unit"]')).toBeNull();
    await click(saveButton());
    await settle(20);
    const glucose = savedAnalytes().find(a => a['canonical_slug'] === 'fasting_glucose');
    expect(isUnconfirmedReading(glucose as unknown as ReadingReview)).toBe(false);
  });

  it('removing the row also releases Save', async () => {
    fixture.pdfText = edgeCasesFixture;
    await upload(pdf());
    await click(button('Next'));
    expect(saveButton()?.disabled).toBe(true);
    await click(button('Remove Item', card('TSH')));
    expect(saveButton()?.disabled).toBe(false);
  });
});
