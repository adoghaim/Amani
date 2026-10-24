// @vitest-environment jsdom
/**
 * RV-LF2, Owner Ruling 7 on the report page. A range her lab printed on one
 * side ("<100", "> OR = 50") binds no bounds: NewReport saves its biomarkers
 * row null/null, and only the report_analytes row written from the same item
 * keeps the comparator (comparatorBaseline FX:questSmoke). The page reads it
 * from there for the lab-flag floor, the headline, the questions, the focus
 * areas and the card, and fails closed on anything else. Synthetic rows only:
 * the Quest values are the 2026-10-17 synthetic smoke report, and every other
 * printed bound is invented and marked synthetic where it is used.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultRow } from '../components/ResultRow';
import { createFakeDb, type FakeDb, type Row } from '../lib/fetchAllRows.fake';
import type { InsightSummary } from '../lib/insights/buildInsightSummary';

const fixture = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  auth: { user: { id: 'user-1' }, userProfile: null },
  subscription: {
    entitled: true, source: 'trial', loading: false, plan: 'premium',
    complimentary: { used: 0, total: 3, remaining: 3 }, refetch: () => {},
  },
  summaries: [] as InsightSummary[],
}));

vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const query = fixture.db.from(table) as unknown as Record<string, unknown>;
    const inert = () => ({ eq: async () => ({ data: null, error: null }) });
    return Object.assign(query, { update: inert, delete: inert, insert: async () => ({ data: null, error: null }) });
  },
  functions: { invoke: async () => ({ data: null, error: new Error('offline') }) },
  auth: { getSession: async () => ({ data: { session: null } }) },
} }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => fixture.auth }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => fixture.subscription }));
vi.mock('../components/SubscriptionStatus', () => ({ SubscriptionStatus: () => null }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/freemium/PremiumPaywall', () => ({ PremiumPaywall: () => null }));
// The summary the page builds: its lab findings and top findings are not one list on the page.
vi.mock('../lib/insights/buildInsightSummary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/insights/buildInsightSummary')>();
  return {
    ...actual,
    buildInsightSummary: ((...args: Parameters<typeof actual.buildInsightSummary>) => {
      const summary = actual.buildInsightSummary(...args);
      fixture.summaries.push(summary);
      return summary;
    }) as typeof actual.buildInsightSummary,
  };
});

import { ReportView } from './ReportView';

const REPORT = 'report-lf2';
const report = {
  id: REPORT, user_id: 'user-1', report_date: '2026-10-10', status: 'complete', estimated_cycle_phase: 'unknown',
  lab_name: 'Synthetic lab', created_at: '2026-10-10T00:00:00Z', regeneration_count: 0,
};

/** One printed result: its value as printed, its range as printed, and what the save binds from it. */
type Printed = [slug: string, value: number, text: string, unit: string, range: string | null,
  min: number | null, max: number | null, operator: string | null, bound: number | null];

/** NewReport writes both rows from the same item: biomarkers keeps the bounds, report_analytes keeps the comparator too. */
function saved([slug, value, text, unit, range, min, max, operator, bound]: Printed, i: number) {
  return {
    biomarker: {
      id: `b-${i}`, lab_report_id: REPORT, name: slug, value, raw_value_text: text, unit,
      reference_min: min, reference_max: max, flagged: 'in_range',
    } as Row,
    analyte: {
      id: `a-${i}`, lab_report_id: REPORT, raw_name: slug, raw_value_text: text, value_numeric: value, unit,
      raw_reference_range: range, normalized_min: min, normalized_max: max, normalized_operator: operator,
      normalized_operator_value: bound, source_snippet: null, canonical_analyte_id: null, canonical_slug: slug,
      parse_status: 'mapped', is_core: true, normalization_status: 'mapped', source_format: 'text',
      confidence_score: 'high', needs_review: false, reviewed_by_user: false, review_status: 'pending',
    } as Row,
  };
}
/** `analytes` edits the report_analytes rows the save would have written, for the fail-closed cases. */
function account(values: Printed[], analytes: (rows: Row[]) => Row[] = rows => rows) {
  const rows = values.map(saved);
  return createFakeDb({
    lab_reports: [report],
    biomarkers: rows.map(r => r.biomarker),
    report_analytes: analytes(rows.map(r => r.analyte)),
    interpretations: [],
  });
}

// comparatorBaseline FX:questSmoke: the synthetic Quest smoke report as the parser binds it.
const QUEST_SMOKE: Printed[] = [
  ['ferritin', 18, '18', 'ng/mL', '16-154', 16, 154, null, null],
  ['tsh', 2.85, '2.85', 'mIU/L', '0.40-4.50', 0.4, 4.5, null, null],
  ['vitamin_d_25_oh', 24, '24', 'ng/mL', '30-100', 30, 100, null, null],
  ['ldl_cholesterol', 112, '112', 'mg/dL', '<100', null, null, '<', 100],
  ['hdl_cholesterol', 61, '61', 'mg/dL', '> OR = 50', null, null, '> OR =', 50],
  ['total_cholesterol', 192, '192', 'mg/dL', '<200', null, null, '<', 200],
  ['triglycerides', 95, '95', 'mg/dL', '<150', null, null, '<', 150],
  ['hemoglobin_a1c', 5.4, '5.4', '%', '<5.7', null, null, '<', 5.7],
];
const LDL_112 = QUEST_SMOKE[3]!;
// Synthetic: "<90" is an invented printed range, so LDL 95 is outside it but inside its Amani band.
const LDL_95: Printed = ['ldl_cholesterol', 95, '95', 'mg/dL', '<90', null, null, '<', 90];

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', '');
  fixture.summaries = [];
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
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
/** Renders the report and opens every collapsed surface, as ReportView.language.test.tsx does. */
async function open() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/app/reports/${REPORT}`]}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
  await settle();
  const closed = (inCard: boolean) => Array.from(app.querySelectorAll('button'))
    .filter(b => b.getAttribute('aria-expanded') === 'false' && !!b.closest('article') === inCard);
  for (const inCard of [false, true]) {
    for (const b of closed(inCard)) {
      await act(async () => { b.click(); });
      await settle();
    }
  }
}

const card = (name: string) => app.querySelector(`article[aria-label="${name} result"]`);
const labRange = (name: string) => Array.from(card(name)?.querySelectorAll('dt') ?? [])
  .find(dt => dt.textContent === "Your lab's range:")?.nextElementSibling?.textContent;
const labObservation = (name: string) => card(name)?.querySelector('[data-language-source="patient_lab_interval"]')?.textContent ?? null;
const headline = () => app.querySelector('h2.text-lg')?.textContent ?? '';
const headlineLabStatements = () => Array.from(app.querySelectorAll('h2 [data-language-source="patient_lab_interval"]')).map(e => e.textContent);
const primary = () => app.querySelector('[data-testid="primary-finding"]')?.textContent ?? '';
const labQuestions = () => Array.from(app.querySelectorAll('[data-testid="prep-questions"] [data-premises]'))
  .filter(q => (q.getAttribute('data-premises') ?? '').split(' ').includes('patient_lab_interval'))
  .map(q => q.textContent ?? '');
function focusAreas() {
  const heading = Array.from(app.querySelectorAll('h2')).find(h => h.textContent === 'Focus areas');
  return Array.from(heading?.parentElement?.parentElement?.querySelectorAll('article') ?? []).map(a => ({
    why: a.querySelector('p')?.textContent ?? '',
    markers: Array.from(a.querySelectorAll('[data-language-cue]')).map(chip => chip.textContent),
  }));
}
const pageSummary = () => fixture.summaries[fixture.summaries.length - 1];
const keys = (findings: readonly { key: string }[] | undefined) => (findings ?? []).map(f => f.key);

// Concepts, not strings: the page-wide prohibition of ReportView.language.test.tsx.
const FORBIDDEN = /borderline|optimal|optimi[sz]|\bnormal\b|abnormal|worsen|deteriorat|improv|better|worse|healthy|reassur|concern|worth (?:discussing|monitoring|tracking|reviewing|focusing)|talk to your doctor|seek care|urgent|priorit|needs attention|mild attention|elevated|deficien|insufficien|resistance|pcos|autoimmun|\brisk\b|should|recommend|keep an eye|right direction|wrong direction|stable overall/i;
function forbiddenHits(): string[] {
  const clone = app.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('[data-language-source="product_disclaimer"]')) el.remove();
  const text = clone.textContent ?? '';
  return [...text.matchAll(new RegExp(FORBIDDEN.source, 'gi'))].map(m => text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40));
}

describe('AC1: the Quest smoke report in the shape the save writes', () => {
  beforeEach(() => { fixture.db = account(QUEST_SMOKE); });

  it("(a) the headline states both lab flags in order, and Vitamin D stays the primary finding", async () => {
    await open();
    expect(headlineLabStatements()).toEqual([
      "Vitamin D is below your lab's reference range at 24 ng/mL. ",
      "LDL is above your lab's reference range at 112 mg/dL. ",
    ]);
    expect(pageSummary()?.primaryFinding?.key).toBe('vitamin_d_25_oh');
    expect(primary()).toContain("Vitamin D is below your lab's reference range at 24 ng/mL.");
  }, 30_000);

  it("(b) the LDL card shows her lab's printed bound and places 112 above it", async () => {
    await open();
    expect(labRange('LDL')).toBe('≤ 100 mg/dL');
    expect(labObservation('LDL')).toBe("Above your lab's range");
  }, 30_000);

  it('(c) HDL, total cholesterol, triglycerides and HbA1c show their printed bounds, each within', async () => {
    await open();
    for (const [name, range] of [
      ['HDL', '≥ 50 mg/dL'], ['Total Cholesterol', '≤ 200 mg/dL'], ['Triglycerides', '≤ 150 mg/dL'], ['HbA1c', '≤ 5.7 %'],
    ] as const) {
      expect(labRange(name), name).toBe(range);
      expect(labObservation(name), name).toBe("Within your lab's range");
    }
  }, 30_000);

  it('(d) the doctor questions ask about LDL against its printed bound, and about no value within its bound', async () => {
    await open();
    expect(labQuestions()).toEqual([
      "My vitamin D is 24 ng/mL, below my lab's reference interval of 30–100 ng/mL. What does this mean in the context of my overall labs?",
      "My LDL is 112 mg/dL, above my lab's reference interval of ≤ 100 mg/dL. What does this mean in the context of my overall labs?",
    ]);
  }, 30_000);

  it("(e) LDL's focus area starts with its lab fact", async () => {
    await open();
    const ldl = focusAreas().find(a => a.markers.includes('LDL'));
    expect(ldl?.why).toMatch(/^LDL is above your lab's reference range at 112 mg\/dL\. /);
  }, 30_000);

  it('(f) control: the result row for the saved LDL row still says above, and the page speaks only policy language', async () => {
    await open();
    expect(forbiddenHits()).toEqual([]);
    // The full lab panel lists only rows saved as non-core (ReportView analytesForDisplay), and a
    // catalog-unit LDL is saved as core, so its result row is rendered here from the same saved row.
    const host = document.createElement('div');
    document.body.append(host);
    const rowRoot = createRoot(host);
    const row = saved(LDL_112, 3).analyte;
    await act(async () => rowRoot.render(<ResultRow analyte={row as never} cyclePhase="unknown" />));
    expect(host.querySelector('[data-language-source="patient_lab_interval"]')?.textContent).toBe("Above your lab's range");
    await act(async () => rowRoot.unmount());
    host.remove();
  }, 30_000);
});

describe("AC2: the card fails closed: no lab range, no lab observation, no lab finding, no lab question", () => {
  // Each report below holds that one value, so nothing on it may come from a lab range.
  async function expectNoLabRange(name: string) {
    await open();
    expect(labRange(name), name).toBe('Not provided on your report');
    expect(labObservation(name), name).toBeNull();
    expect(keys(pageSummary()?.labFindings), name).toEqual([]);
    expect(headlineLabStatements(), name).toEqual([]);
    expect(labQuestions(), name).toEqual([]);
  }
  const ldlRow = (edit: Row) => (rows: Row[]) => rows.map(r => ({ ...r, ...edit }));

  it.each(['≤', '~', 'less than', ''])('(a) the operator %j is not one her lab range is read by', async operator => {
    fixture.db = account([LDL_112], ldlRow({ normalized_operator: operator }));
    await expectNoLabRange('LDL');
  }, 30_000);

  it.each([-1, Number.NaN, null])('(a) the bound %s is not usable', async bound => {
    fixture.db = account([LDL_112], ldlRow({ normalized_operator_value: bound }));
    await expectNoLabRange('LDL');
  }, 30_000);

  it.each([{ normalized_min: 0 }, { normalized_max: 130 }])('(b) the analyte row also has a bound: %j', async bound => {
    fixture.db = account([LDL_112], ldlRow(bound));
    await expectNoLabRange('LDL');
  }, 30_000);

  it('(c) the matching rows disagree (synthetic "<130" beside "<100")', async () => {
    fixture.db = account([LDL_112], ([row]) => [row!, { ...row!, id: 'a-second', raw_reference_range: '<130', normalized_operator_value: 130 }]);
    await expectNoLabRange('LDL');
  }, 30_000);

  it('(c) one matching row has no valid comparator', async () => {
    fixture.db = account([LDL_112], ([row]) => [row!, {
      ...row!, id: 'a-second', raw_reference_range: null, normalized_operator: null, normalized_operator_value: null,
    }]);
    await expectNoLabRange('LDL');
  }, 30_000);

  it.each([{ value_numeric: 113 }, { canonical_slug: 'hdl_cholesterol' }])('(d) no row matches: %j', async edit => {
    fixture.db = account([LDL_112], ldlRow(edit));
    await expectNoLabRange('LDL');
  }, 30_000);

  // OCR prompt rule 2 saves a censored result's own limit as its comparator.
  it("(e) hs-CRP '<0.2' saved as '<' 0.2 with no printed range", async () => {
    fixture.db = account([['hs_crp', 0.1, '<0.2', 'mg/L', null, null, null, '<', 0.2]]);
    await expectNoLabRange('hs-CRP');
  }, 30_000);

  it("(e) hs-CRP '>10' saved as '>' 10 beside a printed '<3.0'", async () => {
    fixture.db = account([['hs_crp', 10, '>10', 'mg/L', '<3.0', null, null, '>', 10]]);
    await expectNoLabRange('hs-CRP');
  }, 30_000);

  it("control for (e): eGFR '> OR = 60' with '> OR = 60' printed as its range", async () => {
    fixture.db = account([['egfr', 60, '> OR = 60', 'mL/min/1.73m2', '> OR = 60', null, null, '> OR =', 60]]);
    await open();
    expect(labRange('eGFR')).toBe('≥ 60 mL/min/1.73m2');
    expect(labObservation('eGFR')).toBe("Within your lab's range");
  }, 30_000);
});

describe("AC3: a biomarkers row with a bound keeps its own bounds, whatever the operator", () => {
  it('the row bounds win over the analyte comparator', async () => {
    // Synthetic: biomarkers bounds (LDL max 130, HDL min 40) that differ from the analyte rows' comparators.
    fixture.db = account(
      [['ldl_cholesterol', 112, '112', 'mg/dL', '<100', null, 130, '<', 100], ['hdl_cholesterol', 61, '61', 'mg/dL', '<50', 40, null, '<', 50]],
      rows => rows.map(r => ({ ...r, normalized_min: null, normalized_max: null })),
    );
    await open();
    expect(labRange('LDL')).toBe('≤ 130 mg/dL');
    expect(labObservation('LDL')).toBe("Within your lab's range");
    expect(labRange('HDL')).toBe('≥ 40 mg/dL');
    expect(labObservation('HDL')).toBe("Within your lab's range");
  }, 30_000);
});

describe('AC5: the true floor holds for a one-sided lab flag', () => {
  it('an Amani-flagged ferritin keeps the primary finding; the lab-only LDL follows it everywhere', async () => {
    fixture.db = account([['ferritin', 17, '17', 'ng/mL', '15-150', 15, 150, null, null], LDL_95]);
    await open();
    const summary = pageSummary();
    expect(summary?.primaryFinding?.key).toBe('ferritin');
    expect(keys(summary?.labFindings)).toEqual(['ldl_cholesterol']);
    expect(keys(summary?.topFindings)).toEqual(['ldl_cholesterol']);
    expect(primary()).toContain('Ferritin');
    expect(primary()).not.toContain('LDL');
    const areas = focusAreas();
    expect(areas.map(a => a.markers)).toEqual([['Ferritin'], ['LDL']]);
    expect(areas[1]?.why).toBe("LDL is above your lab's reference range at 95 mg/dL.");
  }, 30_000);

  it('alone, the lab-only LDL takes the primary finding in its lab wording', async () => {
    fixture.db = account([LDL_95]);
    await open();
    expect(pageSummary()?.primaryFinding?.key).toBe('ldl_cholesterol');
    expect(primary()).toContain("LDL is above your lab's reference range at 95 mg/dL.");
  }, 30_000);
});

describe('AC8: her unconfirmed value outside its one-sided lab range', () => {
  const values: Printed[] = [LDL_95, ['ferritin', 40, '40', 'ng/mL', '16-154', 16, 154, null, null]];

  it('the headline names nothing and claims no all-clear', async () => {
    fixture.db = account(values, rows => rows.map(r => r['canonical_slug'] === 'ldl_cholesterol'
      ? { ...r, needs_review: true, confidence_score: 'low' } : r));
    await open();
    expect(headline()).not.toContain('All scored values');
    expect(headline()).not.toContain('LDL');
  }, 30_000);

  it("control: once she has confirmed it, the headline names it in her lab's words", async () => {
    fixture.db = account(values);
    await open();
    expect(headline()).toContain("LDL is above your lab's reference range at 95 mg/dL.");
  }, 30_000);
});

/*
  RES1 I4-4 (F021 x F022): the headline guard for her unconfirmed value reads
  a censored result by its printed limit, never by its stored placeholder.
  Synthetic: hs-CRP printed '<0.8' or '<0.3' (stored as half the limit) beside
  an invented printed range of 0.5-3.0; both limits sit inside its Amani band.
*/
describe('RES1 I4-4: her unconfirmed censored value is lab-flagged only where its printed limit places it', () => {
  const unconfirmedCrp = (limit: number) => account(
    [['hs_crp', limit / 2, `<${limit}`, 'mg/L', '0.5-3.0', 0.5, 3, null, null], ['ferritin', 40, '40', 'ng/mL', '16-154', 16, 154, null, null]],
    rows => rows.map(r => r['canonical_slug'] === 'hs_crp' ? { ...r, needs_review: true, confidence_score: 'low' } : r),
  );

  it("'<0.8' may be below or within 0.5-3.0, so it is not read as outside it: the band headline stands", async () => {
    fixture.db = unconfirmedCrp(0.8);
    await open();
    expect(headline()).toBe("All scored values are within Amani's context bands, which are still under review.");
  }, 30_000);

  it("control: '<0.3' is below 0.5-3.0 at both ends, so the headline names nothing and claims no all-clear", async () => {
    fixture.db = unconfirmedCrp(0.3);
    await open();
    expect(headline()).not.toContain('All scored values');
    expect(headline()).not.toContain('hs-CRP');
  }, 30_000);
});
