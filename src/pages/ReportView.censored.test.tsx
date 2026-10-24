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

/* ── Wave 3: placement, panel rows and changes through report_analytes ── */

type Row = Record<string, unknown>;
const PRIOR = id(1);
const biomarker = (name: string, value: number, text: string, unit: string, min: number | null = null, max: number | null = null): Row => ({
  name, value, raw_value_text: text, unit, reference_min: min, reference_max: max, flagged: 'out_of_range',
  created_at: '2026-01-01T00:00:00.000Z',
});
const analyte = (raw_name: string, slug: string | null, value: number, text: string, unit: string, min: number | null = null, max: number | null = null): Row => ({
  raw_name, display_name: raw_name, canonical_slug: slug, value_numeric: value, raw_value_text: text, unit,
  raw_reference_range: min !== null && max !== null ? `${min}-${max}` : null, normalized_min: min, normalized_max: max,
  normalized_operator: null, normalized_operator_value: null, source_snippet: `${raw_name} ${text} ${unit}`,
  parse_status: slug ? 'partial' : 'unmapped', normalization_status: slug ? 'partial' : 'unmapped',
  is_core: false, confidence_score: 'high',
});
/** The report on screen, and optionally one prior report, with these rows. */
function seedPanel(current: { biomarkers?: Row[]; analytes?: Row[] }, prior?: { biomarkers?: Row[]; analytes?: Row[] }) {
  const reports = [...(prior ? [[PRIOR, '2026-03-01'] as const] : []), [CURRENT, '2026-06-01'] as const];
  const rows = (key: 'biomarkers' | 'analytes') => reports.flatMap(([reportId]) =>
    ((reportId === CURRENT ? current : prior)?.[key] ?? []).map((r, i) => ({ ...r, id: `${reportId}-${key}-${i}`, lab_report_id: reportId })));
  fixture.tables = {
    lab_reports: reports.map(([reportId, date]) => ({
      id: reportId, user_id: USER, report_date: date, status: 'ready', estimated_cycle_phase: 'luteal',
      regeneration_count: 0, lab_name: 'Synthetic Lab',
    })),
    biomarkers: rows('biomarkers'),
    report_analytes: rows('analytes'),
  };
  fixture.interpretation = null;
  fixture.profile.pregnancy_status = null;
  fixture.access = null;
}
const EGFR_UNIT = 'mL/min/1.73m2';

/*
  The wave-3 BLOCKER, observed on this page: eGFR printed '> OR = 60' is
  stored as 60, and the page said "eGFR is below the Amani band at > OR = 60
  mL/min/1.73m2", with an "Outside Amani band" pill, a focus area and a count.
  '> OR = 60' allows anything from 60 up, below the band (90–200) or within it.
*/
describe('Review F021 — a censored result is never placed, flagged or computed from its placeholder', () => {
  it('eGFR "> OR = 60" (stored 60): no placement, flag or plotted value anywhere on the page', async () => {
    seedPanel({ biomarkers: [biomarker('egfr', 60, '> OR = 60', EGFR_UNIT)] });
    const text = await renderAndOpenAll();
    // A sentence placing eGFR, a band pill, an outside count or a focus area. (The empty
    // state, "No scored marker on this report is outside Amani's comparison bands.", is true here.)
    const placed = /.{0,60}(?:eGFR[^.]{0,40}\b(?:below|above|outside|within)\b|(?:Outside|Within) Amani band|\d+ outside Amani band|outside its Amani band).{0,40}/i;
    expect(placed.exec(text)?.[0]).toBeUndefined();
    expect(text).toContain('Amani did not score any marker on this report');
    // Nor is it a flagged marker: a flag would rank its kidney neighbour (BUN) into the related markers.
    expect(text).not.toContain('Adds kidney function context');
    expect(card()).toContain('> OR = 60');
    expect(card()).toContain('Context needed');
    expect(app.querySelector('article [role="note"]')?.textContent).toContain('> OR = 60');
    expect(app.querySelector('[data-testid="measurement-dot"]')).toBeNull();
  }, 30_000);

  it('beside a measured result outside its band, only the measured one is placed', async () => {
    seedPanel({ biomarkers: [
      biomarker('egfr', 60, '> OR = 60', EGFR_UNIT),
      biomarker('ferritin', 8, '8', 'ng/mL', 13, 150),
    ] });
    const text = await renderAndOpenAll();
    expect(text).toContain("Ferritin is outside Amani's current comparison band.");
    expect(/.{0,60}eGFR[^.]{0,40}\b(?:below|above|outside|within)\b.{0,40}/i.exec(text)?.[0]).toBeUndefined();
  }, 30_000);

  it('a measured eGFR of 60 is still placed, flagged and plotted (control)', async () => {
    seedPanel({ biomarkers: [biomarker('egfr', 60, '60', EGFR_UNIT)] });
    const text = await renderAndOpenAll();
    expect(text).toContain('eGFR is below the Amani band at 60 mL/min/1.73m2');
    expect(card()).toContain('Outside Amani band');
    expect(text).toContain('Adds kidney function context');
    expect(app.querySelector('[data-testid="measurement-dot"]')).not.toBeNull();
  }, 30_000);

  it('a censored result its limit does place is still stated as printed (control)', async () => {
    // No lab interval: under owner Ruling 7 (#152) a primary her lab also flags is
    // worded in her lab's terms ('current <8 (stored 4), prior 20' above).
    seedPanel({ biomarkers: [biomarker('vitamin_d_25_oh', 4, '<8', 'ng/mL')] });
    const text = await renderAndOpenAll();
    expect(text).toContain('Vitamin D is below the Amani band at <8 ng/mL');
    expect(card()).toContain('Outside Amani band');
  }, 30_000);

  it('no derived metric is calculated from a censored input', async () => {
    seedPanel({ biomarkers: [biomarker('fasting_glucose', 90, '90', 'mg/dL'), biomarker('fasting_insulin', 1, '<2', 'uIU/mL')] });
    expect(await renderAndOpenAll()).not.toMatch(/HOMA-IR/);
  }, 30_000);

  it('a derived metric from measured inputs is still shown (control)', async () => {
    seedPanel({ biomarkers: [biomarker('fasting_glucose', 90, '90', 'mg/dL'), biomarker('fasting_insulin', 9, '9', 'uIU/mL')] });
    expect(await renderAndOpenAll()).toMatch(/HOMA-IR/);
  }, 30_000);

  it('no pattern card states a censored placeholder as measured', async () => {
    seedPanel({ biomarkers: [biomarker('vitamin_d_25_oh', 4, '<8', 'ng/mL', 30, 100)] });
    const text = await renderAndOpenAll();
    expect(text).not.toMatch(/pattern-rule match|Measured: Vitamin D 4\b/);
  }, 30_000);

  it('the full lab panel places a printed limit against her lab range only where the limit decides it', async () => {
    seedPanel({ analytes: [
      analyte('Vitamin B1', null, 4, '<8', 'nmol/L', 5, 20),
      analyte('Vitamin B6', null, 4, '<8', 'nmol/L', 30, 100),
    ] });
    await renderAndOpenAll();
    const status = (label: string) => Array.from(app.querySelectorAll('[data-testid="result-row"]'))
      .find(r => r.textContent?.startsWith(label))?.querySelector('[data-testid="result-status"]')?.textContent ?? '';
    // '<8' against 5–20: below the range or inside it.
    expect(status('Vitamin B1')).not.toMatch(/Below|Within|Above|No lab range/);
    expect(status('Vitamin B1')).toContain('Reported as a limit');
    expect(status('Vitamin B6')).toContain("Below your lab's range");
  }, 30_000);
});

/*
  Finding 3. Generation pairs each report's report_analytes rows by
  canonical_slug, or by raw_name for an unmapped one, so a stored Basic line can
  run through a censored result that the biomarkers table never held: a
  non-core, unit-mismatch or unmapped analyte.
*/
describe('Review F021 — Basic changes through a censored report_analytes result never render', () => {
  const basic = (slug: string, marker: string, previous: number, current: number, unit: string) => ({
    access: 'basic',
    interpretation: { headline: 'Your panel', flagged_trends: [{
      biomarker_slug: slug, marker, previous_value: previous, current_value: current, unit,
      previous_date: '2026-03-01', direction: current > previous ? 'increased' : 'decreased', status: 'attention', summary: '',
    }] },
    preview: null, locked: { patterns: 0, cross_report: 0, lifestyle: 0 },
    plan: 'free', complimentary: null, stored_depth: 'standard',
  });
  async function renderBasic(access: ReturnType<typeof basic>) {
    fixture.access = access;
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true');
    return renderAndOpenAll();
  }

  it('a prior unmapped analyte printed "<10" (stored 5): the stored "5 → 30" line does not render', async () => {
    seedPanel({ analytes: [analyte('Lipoprotein (a)', null, 30, '30', 'nmol/L')] },
      { analytes: [analyte('Lipoprotein (a)', null, 5, '<10', 'nmol/L')] });
    expect(await renderBasic(basic('lipoprotein_(a)', 'Lipoprotein (a)', 5, 30, 'nmol/L'))).not.toMatch(/\b5 → 30\b/);
  }, 30_000);

  it('a prior vitamin D in another unit, held only in report_analytes: the line does not render', async () => {
    seedPanel({ analytes: [analyte('Vitamin D', 'vitamin_d_25_oh', 50, '50', 'nmol/L')] },
      { analytes: [analyte('Vitamin D', 'vitamin_d_25_oh', 10, '<20', 'nmol/L')] });
    expect(await renderBasic(basic('vitamin_d_25_oh', 'Vitamin D', 10, 50, 'nmol/L'))).not.toMatch(/\b10 → 50\b/);
  }, 30_000);

  it('a current unmapped analyte printed "<10" (stored 5): the stored "30 → 5" line does not render', async () => {
    seedPanel({ analytes: [analyte('Lipoprotein (a)', null, 5, '<10', 'nmol/L')] },
      { analytes: [analyte('Lipoprotein (a)', null, 30, '30', 'nmol/L')] });
    expect(await renderBasic(basic('lipoprotein_(a)', 'Lipoprotein (a)', 30, 5, 'nmol/L'))).not.toMatch(/\b30 → 5\b/);
  }, 30_000);

  it('measured on both reports: the line renders (control)', async () => {
    seedPanel({ analytes: [analyte('Lipoprotein (a)', null, 30, '30', 'nmol/L')] },
      { analytes: [analyte('Lipoprotein (a)', null, 5, '5', 'nmol/L')] });
    expect(await renderBasic(basic('lipoprotein_(a)', 'Lipoprotein (a)', 5, 30, 'nmol/L'))).toMatch(/Lipoprotein \(a\): 5 → 30 nmol\/L/);
  }, 30_000);
});
