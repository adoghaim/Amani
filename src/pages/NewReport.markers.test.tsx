// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  The 2026-10-17 smoke-test upload on the real page: the PDF's text goes
  through the local parser, which reads every row confidently, so no AI
  refinement runs and the parser's own items reach "Confirm your markers".
  They were shown as raw slugs ("vitamin_d_25_oh (vitamin_d_25_oh)") with
  Vitamin D read as 25. Jsdom, a mocked Supabase client, synthetic text only;
  nothing is saved.
*/
const fixture = vi.hoisted(() => ({ user: { id: '00000000-0000-4000-8000-00000000f17a' } }));

vi.mock('../lib/supabase', () => {
  const query = () => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, in: () => builder,
      lte: () => builder, update: () => builder, insert: () => builder,
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };
  return { supabase: {
    from: query,
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  } };
});
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock('../lib/native', () => ({
  isNative: () => false,
  captureLabPhoto: vi.fn(),
  getNetworkStatus: async () => ({ connected: true, connectionType: 'wifi' }),
  onNetworkChange: () => () => {},
}));
vi.mock('../utils/pdfExtractor', async () => {
  const { questSmokeFixture } = await import('../utils/parser/__fixtures__/questSmoke');
  return { extractTextFromPDF: vi.fn(async () => questSmokeFixture), convertPDFToImages: vi.fn() };
});
vi.mock('../utils/subscription', () => ({ checkSubscriptionLive: vi.fn(), handle402: async () => null }));
vi.mock('../lib/freemium/gates', () => ({ uploadRequiresSubscription: () => false }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { supabase } from '../lib/supabase';
import { NewReport } from './NewReport';

const DISPLAY_NAMES = [
  'Ferritin', 'Hemoglobin', 'TSH', 'Free T4', 'Vitamin D', 'HbA1c', 'Fasting Glucose',
  'Total Cholesterol', 'HDL', 'LDL', 'Triglycerides', 'Vitamin B12',
];
const SLUGS = [
  'ferritin', 'hemoglobin', 'tsh', 'free_t4', 'vitamin_d_25_oh', 'hemoglobin_a1c', 'fasting_glucose',
  'total_cholesterol', 'hdl_cholesterol', 'ldl_cholesterol', 'triglycerides', 'vitamin_b12',
];

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
const button = (match: (text: string) => boolean) =>
  Array.from(app.querySelectorAll('button')).find(b => match(b.textContent?.trim() ?? '')) ?? null;
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}

/** Upload the smoke-test PDF and stop on step 2, where it has been read. */
async function uploadSmokeReport() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/new']}>
      <Routes><Route path="/app/new" element={<NewReport />} /></Routes>
    </MemoryRouter>,
  ));
  await settle();
  const fileInput = app.querySelector<HTMLInputElement>('#file-upload')!;
  Object.defineProperty(fileInput, 'files', {
    configurable: true, value: [new File(['%PDF-1.3 synthetic'], 'synthetic-quest-labs.pdf', { type: 'application/pdf' })],
  });
  await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(button(t => t === 'Next'));
  await settle(20);
}

/** The text of each marker's name and value, in the order shown. */
function rows(elements: Element[], name: (row: Element) => Element | null | undefined, value: (row: Element) => Element | null | undefined) {
  return elements.map(row => [name(row)?.textContent?.trim(), value(row)?.textContent?.trim()]);
}

describe('NewReport: the smoke-test upload', () => {
  it('previews the detected markers by display name, with Vitamin D at 24', async () => {
    await uploadSmokeReport();
    await click(button(t => t.startsWith('View detected markers')));

    const preview = Array.from(app.querySelectorAll('.divide-y > div'));
    const shown = rows(preview, row => row.children[0], row => row.children[1]);
    expect(shown.map(([name]) => name)).toEqual(DISPLAY_NAMES);
    expect(shown).toContainEqual(['Vitamin D', '24 ng/mL']);
    for (const slug of SLUGS) expect(preview.map(row => row.textContent).join(' ')).not.toContain(slug);
  });

  it('confirms the markers by display name, never by slug, with Vitamin D at 24', async () => {
    await uploadSmokeReport();
    // The parser read every row confidently, so nothing was sent to the model.
    expect(supabase.functions.invoke).not.toHaveBeenCalledWith('extract-biomarkers', expect.anything());
    await click(button(t => t === 'Next'));
    expect(app.textContent).toContain('Confirm your markers');

    const cards = Array.from(app.querySelectorAll('div.cursor-pointer'));
    const shown = rows(cards, row => row.querySelector('span.truncate'), row => row.querySelector('.tabular-nums')?.firstChild?.parentElement);
    expect(shown.map(([name]) => name)).toEqual(DISPLAY_NAMES);
    const vitaminD = cards.find(card => card.querySelector('span.truncate')?.textContent === 'Vitamin D');
    expect(vitaminD?.querySelector('.tabular-nums')?.firstChild?.textContent).toBe('24');
    expect(vitaminD?.querySelector('.tabular-nums')?.textContent).toBe('24ng/mL');

    const confirmText = cards.map(card => card.textContent).join(' ');
    for (const slug of SLUGS) {
      expect(confirmText).not.toContain(slug);
      expect(confirmText).not.toContain(`(${slug})`);
    }
  });
});
