// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criticalMarker } from '../lib/safety/labCriticalFlags';

/*
  RV-CR1 on the real report page, in jsdom, behind the mocked Supabase client
  of ReportView.criticalFlag.test.tsx. While features.lab_critical_flag_notice
  is on, the marker her lab printed beside a value shows beside that value,
  exactly as printed: in the result card of a core result and in the result
  row of a lab-panel result, for exactly the results the notice names. Off,
  the page is today's. Synthetic rows; the intervals are placeholders, not
  clinical ranges.
*/

const FLAG = 'lab_critical_flag_notice';
const NOTICE = 'Your lab marked your Potassium, Sodium, Ionized Calcium and Lactate results as critical. Contact your clinician promptly. If you feel unwell, call your local emergency number.';

const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  interpretation: null as Record<string, unknown> | null,
  features: [] as string[],
  // This launch's runtime config read; resolved unless a test holds it back.
  configLoad: Promise.resolve() as Promise<void>,
  subscription: { entitled: true, plan: 'premium', complimentary: { used: 0, total: 0, remaining: 0 }, refetch: () => {} },
  access: null as null | { access: string; interpretation: Record<string, unknown> | null },
}));

vi.mock('../lib/supabase', () => {
  type Row = Record<string, unknown>;
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const rows = () => (fixture.tables[table] ?? []).filter(r => filters.every(([col, v]) => r[col] === v));
    const builder = {
      select: () => builder, order: () => builder, limit: () => builder, range: () => builder,
      lt: () => builder, in: () => builder, update: () => builder, delete: () => builder,
      eq: (col: string, v: unknown) => { filters.push([col, v]); return builder; },
      maybeSingle: async () => {
        if (table === 'interpretations') return { data: fixture.interpretation, error: null };
        return { data: (rows()[0] ?? null) as Row | null, error: null };
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    };
    return builder;
  };
  const invoke = async (name: string) => {
    if (name === 'get-interpretation' && fixture.access) {
      return { data: { ...fixture.access, stored_depth: fixture.access.interpretation ? 'deep' : null }, error: null };
    }
    return { data: null, error: new Error('synthetic: offline') };
  };
  return { supabase: { from: query, functions: { invoke } } };
});
vi.mock('../lib/runtimeConfig', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/runtimeConfig')>(),
  isFeatureEnabled: (name: string) => fixture.features.includes(name),
  loadRuntimeConfig: () => fixture.configLoad,
}));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => fixture.subscription }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ userProfile: null }) }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/freemium/PremiumPaywall', () => ({ PremiumPaywall: () => null }));
import { ReportView } from './ReportView';

const REPORT = '00000000-0000-4000-a000-0000000c0150';
const USER = '00000000-0000-4000-8000-0000000c0150';

function biomarker(id: string, name: string, value: number, unit: string, min: number, max: number) {
  return {
    id, lab_report_id: REPORT, name, value, raw_value_text: String(value), unit, reference_min: min, reference_max: max,
    flagged: 'in_range', created_at: '2026-03-02T00:00:00.000Z',
  };
}

function analyte(id: string, name: string, slug: string, value: string, unit: string, snippet: string, isCore: boolean) {
  return {
    id, lab_report_id: REPORT, raw_name: name.toLowerCase(), display_name: name, value_numeric: Number(value),
    raw_value_text: value, unit, normalized_min: null, normalized_max: null, normalized_operator: null,
    normalized_operator_value: null, raw_reference_range: null, source_snippet: snippet, parse_status: 'mapped',
    canonical_slug: slug, is_core: isCore, confidence_score: 'high', normalization_status: 'mapped',
    source_format: 'text',
  };
}

const TSH = biomarker('b-tsh', 'tsh', 2.1, 'uIU/mL', 0.45, 4.5);
const PANEL = {
  // Core results: each a biomarkers row (its card) and a report_analytes row (its saved line).
  biomarkers: [biomarker('b-k', 'potassium', 6.8, 'mmol/L', 3.5, 5.3), biomarker('b-na', 'sodium', 118, 'mmol/L', 135, 146), TSH],
  analytes: [
    analyte('a-k', 'Potassium', 'potassium', '6.8', 'mmol/L', 'Potassium 6.8 mmol/L Critical 3.5-5.3', true),
    analyte('a-na', 'Sodium', 'sodium', '118', 'mmol/L', 'Sodium 118 Alert 135-146 mmol/L', true),
    // Lab-panel rows: HH after the unit, "(Panic)", and an ordinary H.
    analyte('a-ica', 'Ionized Calcium', 'ionized_calcium', '1.85', 'mmol/L', 'Ionized Calcium 1.85 mmol/L HH 1.12-1.32', false),
    analyte('a-lac', 'Lactate', 'lactate', '6.1', 'mmol/L', 'Lactate 6.1 (Panic) mmol/L 0.5-2.2', false),
    analyte('a-ua', 'Uric Acid', 'uric_acid', '8.1', 'mg/dL', 'Uric Acid 8.1 H 2.5-7.0 mg/dL', false),
    analyte('a-tsh', 'TSH', 'tsh', '2.1', 'uIU/mL', 'TSH 2.1 0.45-4.50 uIU/mL', true),
  ],
};

function seed({ biomarkers, analytes }: { biomarkers: Record<string, unknown>[]; analytes: Record<string, unknown>[] } = PANEL) {
  fixture.tables = {
    lab_reports: [{
      id: REPORT, user_id: USER, report_date: '2026-03-02', status: 'ready', estimated_cycle_phase: 'unknown',
      regeneration_count: 0, lab_name: 'Synthetic Lab', context: {},
    }],
    biomarkers,
    report_analytes: analytes,
  };
  fixture.interpretation = { json_output: {
    headline: 'Synthetic fixture panel.', summary_bullets: [], pattern_signals: [],
    safety_notes: [], disclaimer: 'Synthetic fixture. Not medical advice.',
  } };
}

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'false');
  fixture.features = [FLAG];
  fixture.configLoad = Promise.resolve();
  fixture.subscription = { entitled: true, plan: 'premium', complimentary: { used: 0, total: 0, remaining: 0 }, refetch: () => {} };
  fixture.access = null;
  seed();
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
async function click(el: Element) {
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const buttons = (match: (b: HTMLButtonElement) => boolean) => Array.from(app.querySelectorAll('button')).filter(match);

/** The report page with every body system and the full lab panel open, so every card and row is on the page. */
async function renderAndOpen() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/app/reports/${REPORT}`]}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
  await settle();
  for (const b of buttons(b => b.getAttribute('aria-expanded') === 'false' && !b.closest('article'))) await click(b);
  for (const b of buttons(b => /^Full lab panel/.test(b.textContent ?? ''))) await click(b);
}

const cards = () => [...app.querySelectorAll('article[aria-label$=" result"]')].map(a => a.getAttribute('aria-label')!.replace(/ result$/, ''));
const rows = () => [...app.querySelectorAll('[data-testid="result-row"]')].map(r => r.querySelector('p')!.textContent);
/** Every lab-flag badge on the page, as [the result it sits in, the token as printed]. */
function badges(): [string, string][] {
  return [...app.querySelectorAll('[data-testid="lab-flag"]')].map(badge => {
    const token = badge.lastChild?.textContent ?? '';
    expect(badge.textContent).toBe(`Flag printed by your lab: ${token}`);
    const card = badge.closest('article[aria-label$=" result"]');
    const name = card
      ? card.getAttribute('aria-label')!.replace(/ result$/, '')
      : badge.closest('[data-testid="result-row"]')!.querySelector('p')!.textContent!;
    return [name, token];
  });
}
const notices = () => [...app.querySelectorAll('[data-safety-rule="lab-printed-critical-flag"]')];

describe('RV-CR1: the lab\'s printed critical marker beside the value, in result rows and result cards', () => {
  it('flag on: the critical badges are exactly the results the notice names, each as printed', async () => {
    await renderAndOpen();
    expect(cards().sort()).toEqual(['Potassium', 'Sodium', 'TSH']);
    expect(rows().sort()).toEqual(['Ionized Calcium', 'Lactate', 'Uric Acid']);
    expect(badges().sort()).toEqual([
      ['Ionized Calcium', 'HH'], ['Lactate', '(Panic)'], ['Potassium', 'Critical'], ['Sodium', 'Alert'], ['Uric Acid', 'H'],
    ]);
    // One notice, the only element carrying the rule and the only alert, naming exactly the critical badges' results.
    expect(notices()).toHaveLength(1);
    expect(notices()[0]!.textContent).toBe(NOTICE);
    expect(app.querySelectorAll('[role="alert"]')).toHaveLength(1);
    const critical = badges().filter(([, token]) => criticalMarker(token)).map(([name]) => name);
    expect(critical.sort()).toEqual(['Ionized Calcium', 'Lactate', 'Potassium', 'Sodium']);
    const named = /^Your lab marked your (.+) results? as critical\./.exec(notices()[0]!.textContent ?? '')?.[1]?.split(/, | and /);
    expect(named?.sort()).toEqual(critical);
  }, 30_000);

  it('flag off: cards carry no badge, rows read only the H/L flag beside the value, and no notice shows', async () => {
    fixture.features = [];
    await renderAndOpen();
    expect(cards().sort()).toEqual(['Potassium', 'Sodium', 'TSH']);
    expect(rows().sort()).toEqual(['Ionized Calcium', 'Lactate', 'Uric Acid']);
    expect(badges()).toEqual([['Uric Acid', 'H']]);
    expect(notices()).toHaveLength(0);
    expect(app.querySelectorAll('[role="alert"]')).toHaveLength(0);
  }, 30_000);

  it('the flag can arrive after the page: the badges come with the notice, from the same reading', async () => {
    fixture.features = [];
    let finishLoad!: () => void;
    fixture.configLoad = new Promise<void>(resolve => { finishLoad = () => { fixture.features = [FLAG]; resolve(); }; });
    await renderAndOpen();
    expect(badges()).toEqual([['Uric Acid', 'H']]);
    expect(notices()).toHaveLength(0);
    await act(async () => { finishLoad(); await fixture.configLoad; });
    await settle();
    expect(badges().sort()).toEqual([
      ['Ionized Calcium', 'HH'], ['Lactate', '(Panic)'], ['Potassium', 'Critical'], ['Sodium', 'Alert'], ['Uric Acid', 'H'],
    ]);
    expect(notices().map(n => n.textContent)).toEqual([NOTICE]);
  }, 30_000);

  it.each([
    ['on', [FLAG]],
    ['off', []],
  ])('HH printed straight after the value: one badge in the row, flag %s, as today', async (_, features) => {
    fixture.features = features;
    seed({ biomarkers: [TSH], analytes: [analyte('a-k', 'Potassium', 'potassium', '6.8', 'mmol/L', 'Potassium 6.8 HH 3.5-5.3 mmol/L', false)] });
    await renderAndOpen();
    expect(rows()).toEqual(['Potassium']);
    expect(badges()).toEqual([['Potassium', 'HH']]);
    expect(notices()).toHaveLength(features.length);
  }, 30_000);
});
