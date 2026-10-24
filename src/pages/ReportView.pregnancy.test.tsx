// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  Review F012 on the real report page. Her declared reproductive status
  (onboarding or Settings) withholds every Amani band whose catalog entry
  requires pregnancy context, on every surface, even when the report carries a
  menstrual phase. ReportView in jsdom against a mocked Supabase client, every
  collapsible surface opened. Synthetic values only.
*/

const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  interpretation: null as Record<string, unknown> | null,
  profile: { pregnancy_status: null as string | null },
}));

vi.mock('../lib/supabase', () => {
  type Row = Record<string, unknown>;
  const query = (table: string) => {
    const filters: [string, string, unknown][] = [];
    const rows = () => (fixture.tables[table] ?? []).filter(r => filters.every(([op, col, v]) =>
      op === 'eq' ? r[col] === v : op === 'lt' ? String(r[col]) < String(v) : op === 'in' ? (v as unknown[]).includes(r[col]) : true));
    const builder = {
      select: () => builder, order: () => builder, limit: () => builder,
      // PK-FIX-07: the all-history read pages with .range(); the fixture is far under one page.
      range: () => builder,
      eq: (col: string, v: unknown) => { filters.push(['eq', col, v]); return builder; },
      lt: (col: string, v: unknown) => { filters.push(['lt', col, v]); return builder; },
      in: (col: string, v: unknown[]) => { filters.push(['in', col, v]); return builder; },
      update: () => builder, delete: () => builder,
      maybeSingle: async () => {
        if (table === 'interpretations') return { data: fixture.interpretation, error: null };
        const found = rows().sort((a, b) => String(b['report_date'] ?? '').localeCompare(String(a['report_date'] ?? '')));
        return { data: (found[0] ?? null) as Row | null, error: null };
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    };
    return builder;
  };
  return { supabase: { from: query, functions: { invoke: async () => ({ data: null, error: null }) } } };
});
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({
  entitled: true, plan: 'premium', complimentary: { used: 0, total: 0, remaining: 0 }, refetch: vi.fn(),
}) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ userProfile: fixture.profile }) }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { ReportView } from './ReportView';

const USER = '00000000-0000-4000-8000-000000000f12';
const CURRENT = '00000000-0000-4000-a000-000000000f12';

/** `labRanges: false` drops her lab's printed ranges, so no value is lab-flagged. */
function seed({ labRanges = true } = {}) {
  fixture.tables = {
    lab_reports: [
      { id: CURRENT, user_id: USER, report_date: '2026-01-02', status: 'ready', estimated_cycle_phase: 'luteal', regeneration_count: 0, lab_name: 'Synthetic Lab' },
    ],
    biomarkers: [
      ['tsh', 12, 'mIU/L', 0.4, 4], ['ferritin', 4, 'ng/mL', 13, 150], ['progesterone', 1, 'ng/mL', 1.8, 24],
      // HDL's catalog band has no pregnancy modifier, so it stays scored.
      ['hdl_cholesterol', 70, 'mg/dL', 40, null],
    ].map(([name, value, unit, min, max], i) => ({
      id: `${CURRENT}-${i}`, lab_report_id: CURRENT, name, value, raw_value_text: String(value), unit,
      reference_min: labRanges ? min : null, reference_max: labRanges ? max : null, flagged: 'out_of_range',
      created_at: '2026-01-01T00:00:00.000Z',
    })),
    report_analytes: [],
  };
  fixture.interpretation = null;
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

/** Opens every surface: systems, biomarker cards, patterns, flag cards, full lab panel. */
async function renderAndOpenAll() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/app/reports/${CURRENT}`]}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
  await settle();
  for (const b of buttons(b => b.getAttribute('aria-expanded') === 'false' && !b.closest('article'))) await click(b);
  for (const b of buttons(b => b.getAttribute('aria-expanded') === 'false' && !!b.closest('article'))) await click(b);
  for (const b of buttons(b => /^Patterns & Insights/.test(b.textContent ?? ''))) await click(b);
  for (const b of buttons(b => /pattern-rule match/.test(b.textContent ?? ''))) await click(b);
  for (const b of buttons(b => /^Full lab panel/.test(b.textContent ?? ''))) await click(b);
}

const cards = () => Array.from(app.querySelectorAll('article[aria-label$=" result"]'));
const withheldCards = () => cards().filter(c => c.getAttribute('aria-label') !== 'HDL result');

describe('Review F012 — a declared pregnancy withholds Amani bands on the report page', () => {
  it.each([
    ['Pregnant', 'during pregnancy'],
    ['Postpartum', 'during the postpartum period'],
    ['Breastfeeding', 'during the postpartum period'],
  ])('%s: every card withholds and no surface places a value against a band', async (status, copy) => {
    seed();
    fixture.profile.pregnancy_status = status;
    await renderAndOpenAll();
    expect(cards()).toHaveLength(4);
    expect(withheldCards()).toHaveLength(3);
    for (const card of withheldCards()) {
      const note = card.querySelector('[role="note"]')?.textContent ?? '';
      expect(note, card.getAttribute('aria-label') ?? '').toContain('Amani context score unavailable');
      expect(note).toContain(copy);
      expect(card.textContent).not.toMatch(/Outside Amani band|Within Amani band|Amani context band:/);
    }
    const hdl = app.querySelector('article[aria-label="HDL result"]');
    expect(hdl?.textContent).toContain('Within Amani band');
    const text = app.textContent ?? '';
    expect(text).not.toMatch(/Outside Amani band|outside Amani band/);
    expect(text).not.toContain("outside Amani's current comparison band");
    // Owner Ruling 7 (#152): her lab flagged TSH, ferritin and progesterone, so the
    // headline states her lab's own range and places nothing against a band.
    expect(app.querySelector('h2 [data-language-source="patient_lab_interval"]')?.textContent)
      .toContain("your lab's reference range");
    expect(app.querySelector('h2 [data-language-category="comparison_band"]')).toBeNull();
  }, 30_000);

  it.each([null, 'None', 'Prefer not to say'])('%j: the same report is placed against its bands (control)', async status => {
    seed();
    fixture.profile.pregnancy_status = status;
    await renderAndOpenAll();
    expect(cards()).toHaveLength(4);
    expect(app.textContent).toContain('Outside Amani band');
    // Owner Ruling 7 (#152): the same lab flags lead the headline in her lab's terms.
    expect(app.querySelector('h2 [data-language-source="patient_lab_interval"]')?.textContent)
      .toContain("your lab's reference range");
  }, 30_000);

  // Without her lab's ranges no value is lab-flagged, so the headline is the band
  // headline, and a declared status withholds the bands it names.
  it.each([
    ['Pregnant', "All scored values are within Amani's context bands"],
    ['Postpartum', "All scored values are within Amani's context bands"],
    ['Breastfeeding', "All scored values are within Amani's context bands"],
    [null, "outside Amani's current comparison band"],
    ['None', "outside Amani's current comparison band"],
    ['Prefer not to say', "outside Amani's current comparison band"],
  ])('no printed lab ranges, %j declared: the band headline reads "%s"', async (status, headline) => {
    seed({ labRanges: false });
    fixture.profile.pregnancy_status = status;
    await renderAndOpenAll();
    expect(cards()).toHaveLength(4);
    expect(app.querySelector('h2 [data-language-category="comparison_band"]')?.textContent).toContain(headline);
  }, 30_000);
});
