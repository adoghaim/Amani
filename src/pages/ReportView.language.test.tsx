// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as policy from '../lib/scoring/insightCopy';

/*
  V2-03b Stage 2. The real ReportView, rendered in jsdom against synthetic rows
  behind a mocked Supabase client, with every collapsible surface opened. This
  is the page-wide logic proof that pairs with e2e/reports/clinical-language-
  policy.spec.ts: it runs in `npm test`, so it guards every surface on every
  commit, including the ones the browser suite cannot open cheaply.

  Fixture values are invented. They are chosen so every migrated surface
  renders: two reports (trajectory, focus movement), markers outside unreviewed
  Amani bands (pill, systems, headline, primary finding, focus areas, doctor
  questions), pattern-rule matches (HbA1c, ferritin), a derived metric
  (HOMA-IR), and a lab-panel row 0.5 above its lab's upper bound, inside the
  8% margin the page used to call "Borderline".
*/

const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  interpretation: null as Record<string, unknown> | null,
}));

vi.mock('../lib/supabase', () => {
  type Row = Record<string, unknown>;
  const query = (table: string) => {
    const filters: [string, string, unknown][] = [];
    const rows = () => (fixture.tables[table] ?? []).filter(r => filters.every(([op, col, v]) =>
      op === 'eq' ? r[col] === v : op === 'lt' ? String(r[col]) < String(v) : op === 'in' ? (v as unknown[]).includes(r[col]) : true));
    const builder = {
      select: () => builder, order: () => builder, limit: () => builder,
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
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { ReportView } from './ReportView';

const USER = '00000000-0000-4000-8000-000000000045';
const CURRENT = '00000000-0000-4000-a000-000000000451';
const PRIOR = '00000000-0000-4000-a000-000000000452';

type Marker = [name: string, value: number, unit: string, min: number | null, max: number | null];
const rows = (reportId: string, markers: Marker[]) => markers.map(([name, value, unit, min, max], i) => ({
  id: `${reportId}-${i}`, lab_report_id: reportId, name, value, raw_value_text: String(value), unit,
  reference_min: min, reference_max: max, flagged: 'in_range', created_at: '2026-01-01T00:00:00.000Z',
}));

function seed(currentTsh: number, priorTsh: number) {
  fixture.tables = {
    lab_reports: [
      { id: CURRENT, user_id: USER, report_date: '2026-01-02', status: 'ready', estimated_cycle_phase: 'unknown', regeneration_count: 0, lab_name: 'Synthetic Lab' },
      { id: PRIOR, user_id: USER, report_date: '2025-12-01', status: 'ready', estimated_cycle_phase: 'unknown', regeneration_count: 0, lab_name: 'Synthetic Lab' },
    ],
    biomarkers: [
      ...rows(CURRENT, [
        ['tsh', currentTsh, 'uIU/mL', 0.45, 4.5], ['ferritin', 20, 'ng/mL', 15, 150], ['hemoglobin_a1c', 6, '%', 4, 5.6],
        ['fasting_glucose', 95, 'mg/dL', 70, 99], ['fasting_insulin', 12, 'uIU/mL', 2, 20],
      ]),
      ...rows(PRIOR, [['tsh', priorTsh, 'uIU/mL', 0.45, 4.5], ['ferritin', 25, 'ng/mL', 15, 150]]),
    ],
    report_analytes: [{
      id: 'analyte-1', lab_report_id: CURRENT, raw_name: 'Sodium', display_name: 'Sodium', value_numeric: 145.5,
      raw_value_text: '145.5', unit: 'mmol/L', normalized_min: 136, normalized_max: 145, normalized_operator: null,
      normalized_operator_value: null, raw_reference_range: '136-145', parse_status: 'mapped', canonical_slug: 'sodium',
      is_core: false, confidence_score: 'high', normalization_status: 'mapped', source_format: 'text',
    }],
  };
  // Model output with every claim class in it: none of it may reach the page.
  fixture.interpretation = { json_output: {
    headline: 'Your thyroid has worsened and is worth discussing with your doctor urgently.',
    primary_concern: { title: 'Thyroid is the top priority', summary: 'This is abnormal and concerning.', why_it_matters: 'You should seek care.', canonical_slug: 'tsh' },
    summary_bullets: [], what_you_can_do_now: [], what_to_do_next: [], pattern_signals: [],
    disclaimer: 'Synthetic fixture. Not medical advice.',
  } };
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

/** Visible page text, minus the policy's own product disclaimers (CLINICAL_ACTION, result-independent). */
function pageText(): string {
  const clone = app.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('[data-language-source="product_disclaimer"]')) el.remove();
  return clone.textContent ?? '';
}

// Concepts, not strings: judgement, advice, urgency, reassurance, conditions,
// app-made lab margins and Amani-derived high/low labels.
const FORBIDDEN = /borderline|optimal|optimi[sz]|\bnormal\b|abnormal|worsen|deteriorat|improv|better|worse|healthy|reassur|concern|worth (?:discussing|monitoring|tracking|reviewing|focusing)|talk to your doctor|seek care|urgent|priorit|needs attention|mild attention|elevated|deficien|insufficien|resistance|pcos|autoimmun|\brisk\b|should|recommend|keep an eye|right direction|wrong direction|stable overall/i;
/** Each forbidden match with 40 characters either side, so a failure names the surface. */
function forbiddenHits(text: string): string[] {
  const global = new RegExp(FORBIDDEN.source, 'gi');
  return [...text.matchAll(global)].map(m => text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40));
}

describe('V2-03b Stage 2 — the whole report page speaks only policy language', () => {
  it('fixture renders every migrated surface', async () => {
    seed(9, 6);
    await renderAndOpenAll();
    const text = app.textContent ?? '';
    for (const surface of ['Your trajectory', 'Focus areas', 'Health systems', 'Pattern-rule matches', 'Derived metrics',
      'Full lab panel', 'Questions for Your Doctor', 'Your health story', 'Support plan', 'Related markers not on this report']) {
      expect(text, surface).toContain(surface);
    }
    expect(app.querySelectorAll('article[aria-label$=" result"]').length).toBe(5);
    expect(app.querySelector('[data-testid="primary-movement-observation"]')).not.toBeNull();
    // Every biomarker card is expanded, so its lab-interval statement is on the page.
    expect(app.querySelectorAll('article [data-language-source="patient_lab_interval"]').length).toBe(5);
  }, 30_000);

  it('a first report renders the deterministic primary finding and headline, page-wide clean', async () => {
    seed(9, 6);
    fixture.tables.lab_reports = fixture.tables.lab_reports!.filter(r => r['id'] === CURRENT);
    fixture.tables.biomarkers = fixture.tables.biomarkers!.filter(r => r['lab_report_id'] === CURRENT);
    await renderAndOpenAll();
    const primary = app.querySelector('[data-testid="primary-finding"]');
    expect(primary?.textContent).toContain('Primary finding');
    expect(primary?.textContent).toContain("TSH is above the Amani band at 9 uIU/mL. Amani's context bands are still under review.");
    expect(app.querySelector('h2 [data-language-category="comparison_band"]')?.textContent)
      .toMatch(/is outside Amani's current comparison band|are outside Amani's current comparison bands/);
    // No movement may be claimed without a prior report (a first-recorded placeholder is not a prior value).
    expect(app.textContent).not.toMatch(/since your prior report/);
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);

  it('page-wide: no judgement, advice, condition, urgency or reassurance anywhere on the page', async () => {
    seed(9, 6);
    await renderAndOpenAll();
    expect(forbiddenHits(pageText())).toEqual([]);
    // The model's headline and primary concern carried every claim class; none renders.
    expect(app.textContent).not.toContain('Your thyroid has worsened');
    expect(app.textContent).not.toContain('Thyroid is the top priority');
  }, 30_000);

  it('negative control: the page-wide check sees each claim class if it were rendered', () => {
    for (const claim of ['Borderline', 'Normal', 'Within Amani bands. Mild Attention', 'Needs Attention', 'is borderline-high',
      'Worth monitoring but no urgent flags.', 'the main area to optimize', 'Your standard lab ranges look stable overall',
      'This trend is worth discussing with your provider.', 'May suggest early insulin resistance', 'Possible PCOS-Related Pattern',
      'Elevated HbA1c', 'Iron Deficiency Pattern', 'These are your top priorities.', 'Reassuring']) {
      expect(claim).toMatch(FORBIDDEN);
    }
  });

  it('release invariant 1: the lab-interval row states placement exactly as her lab printed it', async () => {
    seed(9, 6);
    await renderAndOpenAll();
    const row = Array.from(app.querySelectorAll('[data-language-source="patient_lab_interval"]'))
      .find(el => el.closest('div.flex')?.parentElement?.textContent?.includes('Sodium'));
    expect(row?.textContent).toBe("Above your lab's range");
    expect(row?.getAttribute('data-language-category')).toBe('factual_observation');
    // Every lab-interval statement on the page is one of three factual placements.
    for (const el of app.querySelectorAll('[data-language-source="patient_lab_interval"]')) {
      expect(el.textContent).toMatch(/^(?:Above|Below|Within) your lab's range$/);
    }
  }, 30_000);

  it('R3: no band-derived element carries a success, warning or danger colour', async () => {
    seed(9, 6);
    await renderAndOpenAll();
    for (const el of app.querySelectorAll('[data-language-category="comparison_band"], [data-language-category="factual_observation"]')) {
      const styled = [el, ...Array.from(el.querySelectorAll('*')), el.parentElement, el.parentElement?.parentElement].filter(Boolean) as Element[];
      for (const node of styled) expect(node.className.toString(), el.textContent ?? '').not.toMatch(/flag-(?:ok|watch|low)/);
      expect(['neutral', 'attention', null]).toContain(el.getAttribute('data-language-cue'));
    }
  }, 30_000);

  it('safety direction 2: a band change, however large, never produces or resembles a safety warning', async () => {
    seed(400, 6);
    await renderAndOpenAll();
    expect(app.querySelectorAll('[data-language-category="safety_warning"]').length).toBe(0);
    expect(app.querySelectorAll('[data-language-cue="warning"], [data-language-cue="critical"], [role="alert"]').length).toBe(0);
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);

  it('safety direction 1: an approved deterministic rule renders verbatim beside neutralized band language', async () => {
    const original = policy.evaluateSafetyRules;
    const rule: policy.SafetyRule = {
      ruleId: 'synthetic-tsh-critical', version: '1', analyte: 'tsh',
      approval: { approvedBy: 'synthetic test fixture', approvedAt: '2026-10-07', evidenceId: 'SYNTHETIC-ONLY' },
      evaluate: value => value > 100 ? { cue: 'critical', text: 'Synthetic safety warning: this is urgent, talk to your doctor and seek care today.' } : null,
    };
    vi.spyOn(policy, 'evaluateSafetyRules').mockImplementation(measured => original(measured, [rule]));
    seed(400, 6);
    await renderAndOpenAll();
    const alerts = app.querySelectorAll('[data-language-category="safety_warning"]');
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.getAttribute('role')).toBe('alert');
    expect(alerts[0]!.getAttribute('data-language-cue')).toBe('critical');
    expect(alerts[0]!.getAttribute('data-safety-rule')).toBe('synthetic-tsh-critical');
    expect(alerts[0]!.textContent).toBe('Synthetic safety warning: this is urgent, talk to your doctor and seek care today.');
    expect(alerts[0]!.className).toMatch(/flag-low/);
    // The band channel on the same page is still neutral: the separation holds both ways.
    const rest = app.cloneNode(true) as HTMLElement;
    for (const el of rest.querySelectorAll('[data-language-category="safety_warning"], [data-language-source="product_disclaimer"]')) el.remove();
    expect(forbiddenHits(rest.textContent ?? '')).toEqual([]);
    // The same words are forbidden to the band channel, yet render here: the
    // restriction on comparison-band language did not neutralize the warning.
    expect(alerts[0]!.textContent).toMatch(FORBIDDEN);
  }, 30_000);
});
