// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedAnalyte } from '../../supabase/functions/_shared/lab-extraction';
import { axeViolations } from '../components/axe.testkit';

/*
  F064 on the real upload page: a keyboard or screen-reader user can choose a
  file, hear an error, set the cycle dates and symptoms, and find out why a
  save failed. NewReport is rendered in jsdom against a mocked Supabase
  client. jsdom has no layout, so the focusable-control and name checks here
  are structural; e2e/upload-keyboard.spec.ts repeats the key paths with a
  real keyboard in the browsers. Synthetic user, file and values only.
*/

const fixture = vi.hoisted(() => ({
  user: { id: '00000000-0000-4000-8000-0000000f0064' },
  failReportInsert: false,
}));

vi.mock('../lib/supabase', () => {
  const query = (table: string) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, in: () => builder,
      update: () => builder, lte: () => builder, insert: () => builder,
      single: async () => (table === 'lab_reports' && fixture.failReportInsert
        ? { data: null, error: { message: 'synthetic failure' } }
        : { data: table === 'lab_reports' ? { id: 'report-f064' } : null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };
  const ocrItems: ExtractedAnalyte[] = [{
    raw_name: 'Ferritin', raw_value_text: '40', value_numeric: 40, unit: 'ng/mL',
    raw_reference_range: null, normalized_min: null, normalized_max: null,
    normalized_operator: null, normalized_operator_value: null, source_snippet: 'Ferritin 40 ng/mL',
    confidence_score: 'high', canonical_analyte_id: null, canonical_slug: 'ferritin', parse_status: 'mapped',
    needs_review: false, is_core: true, category: 'iron',
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
  fixture.failReportInsert = false;
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const buttons = () => Array.from(app.querySelectorAll('button'));
const buttonByName = (match: RegExp) => buttons().find(b => match.test(b.textContent?.trim() ?? '')) ?? null;
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
async function render() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/new']}>
      <Routes><Route path="/app/new" element={<NewReport />} /></Routes>
    </MemoryRouter>,
  ));
  await settle();
}
async function choose(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle();
}
const photo = () => new File(['synthetic'], 'synthetic-lab.png', { type: 'image/png' });

/** The first element whose own text is exactly `text`, then the control its label points at. */
function labelledControl(text: string): Element | null {
  const label = Array.from(app.querySelectorAll('label')).find(l => l.textContent?.trim() === text);
  if (!label) return null;
  if (label.control) return label.control;
  return null;
}

describe('NewReport: choosing a file without a pointer', () => {
  it('offers the drop zone as a focusable button that opens the file chooser', async () => {
    await render();
    const input = app.querySelector<HTMLInputElement>('#file-upload')!;
    const open = vi.spyOn(input, 'click');
    const dropZone = buttonByName(/choose a file/i);
    expect(dropZone, 'a button named "Choose a file"').not.toBeNull();
    expect(dropZone!.tabIndex).toBeGreaterThanOrEqual(0);
    await click(dropZone);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('names the chosen file on the drop zone button', async () => {
    await render();
    await choose(app.querySelector<HTMLInputElement>('#file-upload')!, photo());
    const dropZone = buttonByName(/synthetic-lab\.png/);
    expect(dropZone, 'the drop zone button still carries the file name').not.toBeNull();
    expect(dropZone!.textContent).toContain('choose a different file');
  });

  it('opens the chooser from the Quest and Labcorp upload buttons', async () => {
    await render();
    await click(buttonByName(/Import from Quest/));
    const questInput = app.querySelector<HTMLInputElement>('input[type="file"]')!;
    const questOpen = vi.spyOn(questInput, 'click');
    const quest = buttonByName(/^Upload Quest PDF$/);
    expect(quest, 'a button named "Upload Quest PDF"').not.toBeNull();
    await click(quest);
    expect(questOpen).toHaveBeenCalledTimes(1);

    await click(buttonByName(/Back/));
    await click(buttonByName(/Import from Labcorp/));
    const labcorpInput = app.querySelector<HTMLInputElement>('input[type="file"]')!;
    const labcorpOpen = vi.spyOn(labcorpInput, 'click');
    const labcorp = buttonByName(/^Upload Labcorp PDF$/);
    expect(labcorp, 'a button named "Upload Labcorp PDF"').not.toBeNull();
    await click(labcorp);
    expect(labcorpOpen).toHaveBeenCalledTimes(1);
  });

  it('passes axe on the upload step', async () => {
    await render();
    expect(await axeViolations(app)).toEqual([]);
  });
});

describe('NewReport: errors are announced', () => {
  it('announces a wrong file type in an alert', async () => {
    await render();
    await choose(app.querySelector<HTMLInputElement>('#file-upload')!, new File(['x'], 'notes.txt', { type: 'text/plain' }));
    const alert = app.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Please upload a PDF or image file');
  });

  it('moves focus to the alert when the save fails, and shows the reason', async () => {
    fixture.failReportInsert = true;
    await render();
    await choose(app.querySelector<HTMLInputElement>('#file-upload')!, photo());
    await click(buttonByName(/^Next$/));
    await settle(20);
    await click(buttonByName(/^Next$/));
    await click(buttonByName(/^Save and analyze$/));
    await settle(20);
    const alert = app.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain('Failed to create report record');
    expect(document.activeElement).toBe(alert);
  });
});

describe('NewReport: the cycle step is labelled and operable', () => {
  async function openCycleStep() {
    await render();
    await choose(app.querySelector<HTMLInputElement>('#file-upload')!, photo());
    await click(buttonByName(/^Next$/));
    await settle(20);
    expect(app.textContent).toContain('Cycle context');
  }

  it('ties "Last period start" to its date input', async () => {
    await openCycleStep();
    const control = labelledControl('Last period start');
    expect(control).not.toBeNull();
    expect((control as HTMLInputElement).type).toBe('date');
  });

  it('marks each symptom chip pressed or not, with a 44px target', async () => {
    await openCycleStep();
    const chip = buttons().find(b => b.textContent?.trim() === 'Fatigue')!;
    expect(chip, 'a symptom chip').toBeDefined();
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.className).toContain('min-h-[44px]');
    await click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('passes axe on the cycle step', async () => {
    await openCycleStep();
    expect(await axeViolations(app)).toEqual([]);
  });
});
