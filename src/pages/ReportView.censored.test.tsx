// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  Review F021 on the real report page. 'VITAMIN D, 25-OH, TOTAL <8 ng/mL' is
  stored as value 4 with raw_value_text '<8'. The page compared the 4: "Vitamin
  D increased from 4 to 20 ng/mL", +400%, and a personal trend through it. A
  censored result is a printed limit, so no surface compares, trends or states
  its placeholder. ReportView in jsdom against a mocked Supabase client, every
  collapsible surface opened. Synthetic values only.
*/

const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  interpretation: null as Record<string, unknown> | null,
  profile: { pregnancy_status: null as string | null },
  /** get-interpretation's answer, flag on. */
  access: null as Record<string, unknown> | null,
}));

vi.mock('../lib/supabase', () => {
  type Row = Record<string, unknown>;
  const query = (table: string) => {
    const filters: [string, string, unknown][] = [];
    // Selected columns are honoured, so a read that omits raw_value_text sees none.
    let columns: string[] | null = null;
    const project = (r: Row): Row => columns ? Object.fromEntries(columns.map(c => [c, r[c]])) : r;
    const rows = () => (fixture.tables[table] ?? []).filter(r => filters.every(([op, col, v]) =>
      op === 'eq' ? r[col] === v : op === 'lt' ? String(r[col]) < String(v) : op === 'in' ? (v as unknown[]).includes(r[col]) : true));
    const builder = {
      select: (cols = '*') => { columns = cols === '*' ? null : cols.split(',').map(c => c.trim()); return builder; },
      order: () => builder, limit: () => builder,
      // PK-FIX-07: the all-history read pages with .range(); the fixture is far under one page.
      range: () => builder,
      eq: (col: string, v: unknown) => { filters.push(['eq', col, v]); return builder; },
      lt: (col: string, v: unknown) => { filters.push(['lt', col, v]); return builder; },
      in: (col: string, v: unknown[]) => { filters.push(['in', col, v]); return builder; },
      update: () => builder, delete: () => builder,
      maybeSingle: async () => {
        if (table === 'interpretations') return { data: fixture.interpretation, error: null };
        const found = rows().sort((a, b) => String(b['report_date'] ?? '').localeCompare(String(a['report_date'] ?? '')));
        return { data: found[0] ? project(found[0]) : null, error: null };
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows().map(project), error: null }).then(resolve),
    };
    return builder;
  };
  return { supabase: { from: query, functions: { invoke: async (name: string) =>
    ({ data: name === 'get-interpretation' ? fixture.access : null, error: null }) } } };
});
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({
  entitled: true, plan: 'premium', complimentary: { used: 0, total: 0, remaining: 0 }, refetch: vi.fn(),
}) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ userProfile: fixture.profile }) }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { ReportView } from './ReportView';

const USER = '00000000-0000-4000-8000-000000000f21';
const CURRENT = '00000000-0000-4000-a000-000000000f21';
const id = (n: number) => `00000000-0000-4000-a000-00000000${String(n).padStart(4, '0')}`;

/** Oldest first; the last entry is the report on screen. Each: [vitamin D value, printed text]. */
function seed(vitaminD: [number, string][]) {
  const dates = ['2025-06-01', '2025-09-01', '2025-12-01', '2026-03-01', '2026-06-01'].slice(-vitaminD.length);
  const reportIds = vitaminD.map((_, i) => (i === vitaminD.length - 1 ? CURRENT : id(i + 1)));
  fixture.tables = {
    lab_reports: reportIds.map((reportId, i) => ({
      id: reportId, user_id: USER, report_date: dates[i], status: 'ready', estimated_cycle_phase: 'luteal',
      regeneration_count: 0, lab_name: 'Synthetic Lab',
    })),
    biomarkers: vitaminD.map(([value, text], i) => ({
      id: `${reportIds[i]}-vd`, lab_report_id: reportIds[i], name: 'vitamin_d_25_oh', value, raw_value_text: text,
      unit: 'ng/mL', reference_min: 30, reference_max: 100, flagged: 'out_of_range', created_at: '2026-01-01T00:00:00.000Z',
    })),
    report_analytes: [],
  };
  fixture.interpretation = null;
  fixture.profile.pregnancy_status = null;
  fixture.access = null;
}

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'false');
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
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
async function click(el: Element) {
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const buttons = (match: (b: HTMLButtonElement) => boolean) => Array.from(app.querySelectorAll('button')).filter(match);

async function renderAndOpenAll(): Promise<string> {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/app/reports/${CURRENT}`]}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
  await settle();
  for (const b of buttons(b => b.getAttribute('aria-expanded') === 'false' && !b.closest('article'))) await click(b);
  for (const b of buttons(b => b.getAttribute('aria-expanded') === 'false' && !!b.closest('article'))) await click(b);
  for (const b of buttons(b => /^Patterns & Insights/.test(b.textContent ?? ''))) await click(b);
  for (const b of buttons(b => /^Full lab panel/.test(b.textContent ?? ''))) await click(b);
  return app.textContent ?? '';
}

const card = () => app.querySelector('article[aria-label$=" result"]')?.textContent ?? '';

describe('Review F021 — a censored result is never compared, trended or stated on the report page', () => {
  it('prior <8 (stored 4), current 20: no movement, percent change or trend through the 4', async () => {
    // Through the 4 the series 30, 25, 4, 20 reads "Trend: ↓ Falling"; without it
    // two measured priors are too few for a trend.
    seed([[30, '30'], [25, '25'], [4, '<8'], [20, '20']]);
    const text = await renderAndOpenAll();
    expect(card()).toContain('20');
    expect(text).not.toMatch(/\b4 (?:to|→) 20\b|from 4\b|\+?400(?:\.0)?%/);
    expect(text).not.toMatch(/measured for the first time/);
    expect(card()).not.toMatch(/Trend:/);
  }, 30_000);

  it('a censored prior leaves her measured history in place (control)', async () => {
    seed([[10, '10'], [12, '12'], [14, '14'], [4, '<8'], [20, '20']]);
    await renderAndOpenAll();
    expect(card()).toMatch(/Trend: ↑ Rising/);
  }, 30_000);

  it('current <8 (stored 4), prior 20: no movement, trend or usual-level claim for the placeholder', async () => {
    seed([[22, '22'], [21, '21'], [20, '20'], [4, '<8']]);
    const text = await renderAndOpenAll();
    expect(card()).toContain('<8');
    expect(text).not.toMatch(/\b20 (?:to|→) 4\b|to 4 ng\/mL|-80(?:\.0)?%|measured for the first time at 4\b/);
    expect(card()).not.toMatch(/Trend:|usual level|older history/);
    // The primary-finding card states the printed result, never the placeholder.
    const primary = app.querySelector('[data-testid="primary-finding"]')?.textContent ?? '';
    expect(primary).toContain('<8 ng/mL');
    expect(text).not.toMatch(/\b4 ng\/mL/);
  }, 30_000);

  it('measured values on both reports still show their movement (control)', async () => {
    seed([[10, '10'], [20, '20']]);
    const text = await renderAndOpenAll();
    expect(text).toMatch(/10 to 20 ng\/mL|10\s*20\s*ng\/mL/);
  }, 30_000);
});

/*
  Basic tier, flag on. A stored interpretation's trend_evidence was built
  through the placeholder before generation learnt to skip it, so its
  flagged_trends line reads "Vitamin D: 4 → 20 ng/mL". The page holds the
  printed text of both reports' results and drops that line.
*/
describe('Review F021 — Basic changes on the report page never state a censored placeholder', () => {
  const line = (slug: string, marker: string, previous: number, current: number, unit: string) => ({
    biomarker_slug: slug, marker, previous_value: previous, current_value: current, unit,
    previous_date: '2026-03-01', direction: current > previous ? 'increased' : 'decreased', status: 'attention', summary: '',
  });
  const basicWith = (trends: unknown[]) => ({
    access: 'basic',
    interpretation: { headline: 'Your panel', flagged_trends: trends },
    preview: null, locked: { patterns: 0, cross_report: 0, lifestyle: 0 },
    plan: 'free', complimentary: null, stored_depth: 'standard',
  });
  // A measured flagged line on a marker this fixture holds no values for.
  const control = line('ferritin', 'Ferritin', 10, 20, 'u');

  it('prior <8 (stored 4), current 20: the stored "4 → 20" line does not render', async () => {
    seed([[4, '<8'], [20, '20']]);
    fixture.access = basicWith([line('vitamin_d_25_oh', 'Vitamin D', 4, 20, 'ng/mL'), control]);
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true');
    const text = await renderAndOpenAll();
    expect(text).toContain('Ferritin: 10 → 20 u');
    expect(text).not.toMatch(/\b4 → 20\b|\b4 to 20\b/);
  }, 30_000);

  it('current <8 (stored 4), prior 20: the stored "20 → 4" line does not render', async () => {
    seed([[20, '20'], [4, '<8']]);
    fixture.access = basicWith([line('vitamin_d_25_oh', 'Vitamin D', 20, 4, 'ng/mL'), control]);
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true');
    const text = await renderAndOpenAll();
    expect(text).toContain('Ferritin: 10 → 20 u');
    expect(text).not.toMatch(/\b20 → 4\b|\b20 to 4\b/);
  }, 30_000);

  it('measured values on both reports keep their change (control)', async () => {
    seed([[4, '4'], [20, '20']]);
    fixture.access = basicWith([line('vitamin_d_25_oh', 'Vitamin D', 4, 20, 'ng/mL')]);
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true');
    const text = await renderAndOpenAll();
    expect(text).toMatch(/\b4 → 20 ng\/mL|\b4 to 20 ng\/mL/);
  }, 30_000);
});
