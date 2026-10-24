// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as policy from '../lib/scoring/insightCopy';
import { compareReports } from '../lib/scoring/compareReports';
import { MODEL_CANARIES, unprovenancedText, unresolvedModelProse } from '../lib/scoring/modelProse.testkit';
import { CATEGORY_DISPLAY, type BiomarkerCategory, type BiomarkerName } from '../types';

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
  /** generate-interpretation's error (null: the call is accepted). */
  invokeError: null as unknown,
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
  return { supabase: { from: query, functions: { invoke: async () => ({ data: null, error: fixture.invokeError }) } } };
});
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({
  entitled: true, plan: 'premium', complimentary: { used: 0, total: 0, remaining: 0 }, refetch: vi.fn(),
}) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ userProfile: null }) }));
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
  fixture.invokeError = null;
  fixture.tables = {
    lab_reports: [
      { id: CURRENT, user_id: USER, report_date: '2026-01-02', status: 'ready', estimated_cycle_phase: 'unknown', regeneration_count: 0, lab_name: 'Synthetic Lab' },
      { id: PRIOR, user_id: USER, report_date: '2025-12-01', status: 'ready', estimated_cycle_phase: 'unknown', regeneration_count: 0, lab_name: 'Synthetic Lab' },
    ],
    biomarkers: [
      ...rows(CURRENT, [
        ['tsh', currentTsh, 'mIU/L', 0.45, 4.5], ['ferritin', 20, 'ng/mL', 15, 150], ['hemoglobin_a1c', 6, '%', 4, 5.6],
        ['fasting_glucose', 95, 'mg/dL', 70, 99], ['fasting_insulin', 12, 'uIU/mL', 2, 20],
      ]),
      ...rows(PRIOR, [['tsh', priorTsh, 'mIU/L', 0.45, 4.5], ['ferritin', 25, 'ng/mL', 15, 150]]),
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
    summary_bullets: [], pattern_signals: [],
    // Owner R4: personalized food, supplement, dose and lifestyle advice from the model, in every bucket.
    what_you_can_do_now: MODEL_NEXT_STEPS.slice(0, 3), what_to_do_next: MODEL_NEXT_STEPS.slice(3),
    disclaimer: 'Synthetic fixture. Not medical advice.',
  } };
}

const MODEL_NEXT_STEPS = [
  'Eat more iron-rich foods such as spinach because your ferritin is low.',
  'Take 2000 IU of vitamin D daily with breakfast.',
  'Walk for 30 minutes after meals to lower your HbA1c.',
  'Ask your doctor whether an iron supplement makes sense.',
  'Retest TSH in 6 weeks.',
];

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
      'Full lab panel', policy.DISCUSSION_PREP_HEADING, 'Your health story', policy.EDUCATION_HEADING, 'Related markers not on this report']) {
      expect(text, surface).toContain(surface);
    }
    expect(app.querySelectorAll('article[aria-label$=" result"]').length).toBe(5);
    expect(app.querySelector('[data-testid="primary-movement-observation"]')).not.toBeNull();
    // Every biomarker card is expanded, so its lab-interval statement is on the page.
    expect(app.querySelectorAll('article [data-language-source="patient_lab_interval"]').length).toBe(5);
  }, 30_000);

  it.each([
    ...[59, 60, 90, 95].map(value => ({ key: 'hdl_cholesterol', name: 'HDL', value, min: 60, max: 90, unit: 'mg/dL' })),
    ...[89, 90, 200, 205].map(value => ({ key: 'egfr', name: 'eGFR', value, min: 90, max: 200, unit: 'mL/min/1.73m²' })),
  ])('$name $value: every statement and plotted region agree on placement', async ({ key, name, value, min, max, unit }) => {
    seed(9, 6);
    fixture.tables.lab_reports = fixture.tables.lab_reports!.filter(r => r['id'] === CURRENT);
    fixture.tables.biomarkers = rows(CURRENT, [[key, value, unit, 40, 60]]);
    fixture.tables.report_analytes = [];
    await renderAndOpenAll();
    const outside = value < min;
    const card = app.querySelector(`article[aria-label="${name} result"]`);
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain(outside ? 'Outside Amani band' : 'Within Amani band');
    expect(card?.textContent).toContain(`Amani context band:≥ ${min} ${unit}`);
    expect(card?.textContent).toContain(`Amani ≥ ${min}`);
    expect(card?.textContent).not.toContain(`${min}–${max}`);
    const region = card?.querySelector<HTMLElement>('[data-testid="comparison-region"]');
    const dot = card?.querySelector<HTMLElement>('[data-testid="measurement-dot"]');
    expect(region).toBeTruthy();
    expect(dot).toBeTruthy();
    const left = parseFloat(region!.style.left);
    const right = left + parseFloat(region!.style.width);
    const position = Number(dot!.style.left.match(/([\d.]+)%/)![1]);
    expect(right).toBeCloseTo(100);
    expect(position >= left && position <= right).toBe(!outside);

    expect(card?.querySelector('[data-language-source="patient_lab_interval"]')?.textContent)
      .toBe(value > 60 ? "Above your lab's range" : "Within your lab's range");
    if (value > 60) {
      expect(app.querySelector('h2 [data-language-source="patient_lab_interval"]')?.textContent).toContain("above your lab's reference range");
      expect(app.textContent).toContain('Focus areas');
    } else {
      expect(app.querySelector('h2 [data-language-category="comparison_band"]')?.textContent)
        .toContain(outside ? "outside Amani's current comparison band" : "All scored values are within Amani's context bands");
      if (!outside) expect(app.textContent).not.toContain('Focus areas');
    }
    expect(app.textContent).toContain(outside ? '1 outside Amani band' : 'Scored markers within Amani bands');
    if (!outside) {
      expect(app.textContent).not.toContain('Outside Amani band');
      expect(app.querySelectorAll('[data-language-category="comparison_band"][data-language-cue="attention"]').length).toBe(0);
    }
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);

  it('a first report renders the deterministic primary finding and headline, page-wide clean', async () => {
    seed(9, 6);
    fixture.tables.lab_reports = fixture.tables.lab_reports!.filter(r => r['id'] === CURRENT);
    fixture.tables.biomarkers = fixture.tables.biomarkers!.filter(r => r['lab_report_id'] === CURRENT);
    await renderAndOpenAll();
    const primary = app.querySelector('[data-testid="primary-finding"]');
    expect(primary?.textContent).toContain('Primary finding');
    expect(primary?.textContent).toContain("TSH is above your lab's reference range at 9 mIU/L.");
    expect(app.querySelector('h2 [data-language-source="patient_lab_interval"]')?.textContent)
      .toContain("TSH is above your lab's reference range");
    // No movement may be claimed without a prior report (a first-recorded placeholder is not a prior value).
    expect(app.textContent).not.toMatch(/since your prior report/);
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);

  // Owner ruling 2026-10-23: Ruling 7 is a true floor. A lab-only flag stays a
  // visible neutral lab fact but never takes the Primary slot from an
  // Amani-flagged result, so the Amani-band and DISPUTED sentences stay reachable.
  const firstReport = (phase: string, markers: Marker[]) => {
    seed(9, 6);
    fixture.tables.lab_reports = fixture.tables.lab_reports!.filter(r => r['id'] === CURRENT)
      .map(r => ({ ...r, estimated_cycle_phase: phase }));
    fixture.tables.biomarkers = rows(CURRENT, markers);
    fixture.tables.report_analytes = [];
  };

  it('a lab-only HDL flag stays visible but the Amani-flagged ferritin keeps the Primary finding, in its Amani-band sentence', async () => {
    firstReport('unknown', [['ferritin', 17, 'ng/mL', 15, 150], ['hdl_cholesterol', 61, 'mg/dL', 40, 60]]);
    await renderAndOpenAll();
    const primary = app.querySelector('[data-testid="primary-finding"]');
    expect(primary?.textContent).toContain('Primary finding');
    expect(primary?.textContent).toContain("Ferritin is below the Amani band at 17 ng/mL. Amani's context bands are still under review.");
    expect(primary?.textContent).not.toContain('HDL');
    // The lab-only flag is still on the page as a neutral lab fact: headline and focus areas.
    expect(app.querySelector('h2 [data-language-source="patient_lab_interval"]')?.textContent)
      .toContain("HDL is above your lab's reference range at 61 mg/dL.");
    expect(app.textContent).toContain('Ferritin is the primary finding shown above.');
    // Focus areas: Amani's area first, the lab-only HDL appended after it, titled as printed.
    const focusHeading = Array.from(app.querySelectorAll('h2')).find(h => h.textContent === 'Focus areas')!;
    const areas = Array.from(focusHeading.parentElement!.parentElement!.querySelectorAll('article'));
    const titles = areas.map(a => a.querySelector('h3')!.textContent);
    expect(titles).toHaveLength(2);
    expect(titles[titles.length - 1]).toBe('HDL');
    expect(areas[0]!.textContent).toContain('Ferritin');
    expect(areas[areas.length - 1]!.textContent).toContain("HDL is above your lab's reference range at 61 mg/dL.");
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);

  it('the DISPUTED luteal progesterone keeps the Primary finding over the lab-flagged LH, withholding placement', async () => {
    firstReport('luteal', [
      ['progesterone', 2, 'ng/mL', 0.2, 25], ['tsh', 2, 'uIU/mL', 0.45, 4.5], ['estradiol', 120, 'pg/mL', null, null],
      ['lh', 30, 'mIU/mL', 2.4, 12.6], ['fsh', 6, 'mIU/mL', 3.5, 12.5],
    ]);
    await renderAndOpenAll();
    const primary = app.querySelector('[data-testid="primary-finding"]');
    expect(primary?.textContent).toContain('Primary finding');
    expect(primary?.textContent).toContain('Progesterone was measured at 2 ng/mL. Interpretation unavailable pending clinical review.');
    expect(primary?.textContent).not.toMatch(/below|above|outside|LH/);
    expect(app.querySelector('h2 [data-language-source="patient_lab_interval"]')?.textContent)
      .toContain("LH is above your lab's reference range at 30 mIU/mL.");
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
    // Discussion preparation does not change because a safety warning exists:
    // urgency is the safety channel's alone, never the question card's.
    expect(prepQuestions()).toEqual(PREP_FOR_TSH_400);
  }, 30_000);
});

/* ── Owner rulings R2 and R4 on the real page ──────────────────────────── */

const prepQuestions = () => Array.from(app.querySelectorAll('[data-testid="prep-questions"] [data-language-category]'))
  .map(el => el.textContent ?? '');
// Measured change 6 -> 400, HbA1c above its lab interval, then the context question.
const PREP_FOR_TSH_400 = [
  'My TSH changed from 6 to 400 mIU/L. What could explain this change, and is it clinically meaningful?',
  // PK-FIX-02: the marker name reads in sentence case mid-sentence ("my ferritin", not "my Ferritin").
  'My ferritin changed from 25 to 20 ng/mL. What could explain this change, and is it clinically meaningful?',
  "My HbA1c is 6 %, above my lab's reference interval of 4–5.6 %. What does this mean in the context of my overall labs?",
  'Is there anything about my routine or history that matters for reading these results?',
];
// The owner's forbidden premises and the concepts behind them.
const PREP_FORBIDDEN = /worse|worsen|getting (?:better|worse)|treat|medication|danger|urgent|emergency|seek|need(?:s)? (?:medical )?care|should|improv|better|optimal|normal|abnormal|concern|elevated|Amani|band/i;
// Owner R4: personalized food, nutrient, supplement, dose and lifestyle advice.
const NUTRITION_ADVICE = /foods? to focus|topics to discuss|track next|next best steps|iron-rich|eat more|\bsupplement|\bdose\b|\b\d+\s?(?:IU|mg|mcg|µg)\b(?!\/)|daily|per day|sunlight|walk for|exercise|retest/i;

describe('owner R2 — discussion preparation on the page: admissible premises, agreement, no escalation', () => {
  it('the card renders policy prompts only, each neutral, each resting on her values or her lab interval', async () => {
    seed(9, 6);
    await renderAndOpenAll();
    const card = app.querySelector('[data-testid="prep-questions"]');
    expect(card?.textContent).toContain(policy.DISCUSSION_PREP_HEADING);
    expect(card?.textContent).toContain(policy.DISCUSSION_PREP_INTRO);
    const items = Array.from(card!.querySelectorAll('[data-language-category]'));
    expect(items.length).toBe(4);
    for (const el of items) {
      expect(el.getAttribute('data-language-category')).toBe('discussion_prep');
      expect(el.getAttribute('data-language-cue')).toBe('neutral');
      for (const kind of (el.getAttribute('data-premises') ?? '').split(' ').filter(Boolean)) {
        expect(['measured_change', 'patient_lab_interval']).toContain(kind);
      }
      expect(el.textContent, el.textContent ?? '').not.toMatch(PREP_FORBIDDEN);
    }
    // The card itself and everything in it: no alert role, warning cue or danger colour.
    const escalation = '[role="alert"], [data-language-cue="warning"], [data-language-cue="critical"]';
    expect([card!, ...Array.from(card!.querySelectorAll('*'))].filter(el => el.matches(escalation))).toEqual([]);
    expect(card!.outerHTML).not.toMatch(/flag-(?:ok|watch|low)/);
  }, 30_000);

  it('standing rule 5: each question states its fact exactly as the card, trajectory and lab row state it', async () => {
    seed(9, 6);
    await renderAndOpenAll();
    const [tshChange, ferritinChange, hba1cInterval] = prepQuestions();
    // TSH 6 -> 9: the primary movement and the trajectory state the same two values.
    expect(tshChange).toContain('from 6 to 9 mIU/L');
    expect(app.querySelector('[data-testid="primary-movement-observation"]')?.textContent).toContain('from 6 to 9 mIU/L');
    expect(app.textContent).toContain('TSH has risen from 6 to 9 mIU/L.');
    expect(ferritinChange).toContain('from 25 to 20 ng/mL');
    expect(app.textContent).toContain('Ferritin has dropped from 25 to 20 ng/mL.');
    // HbA1c: the question's placement and interval are the HbA1c card's own.
    const hba1c = app.querySelector('article[aria-label="HbA1c result"]');
    expect(hba1c?.querySelector('[data-language-source="patient_lab_interval"]')?.textContent).toBe("Above your lab's range");
    expect(hba1cInterval).toContain("above my lab's reference interval");
    const printed = Array.from(hba1c!.querySelectorAll('dt')).find(dt => dt.textContent === policy.LAB_INTERVAL_TERM)?.nextElementSibling?.textContent;
    expect(printed).toBe('4–5.6 %');
    expect(hba1cInterval).toContain(`of ${printed}.`);
    // Ferritin 20 is outside its Amani band but within her lab interval: no
    // question may say it is outside anything.
    expect(prepQuestions().join(' ')).not.toMatch(/Ferritin is|ferritin is .*(?:above|below)/i);
    expect(app.querySelector('article[aria-label="Ferritin result"] [data-language-source="patient_lab_interval"]')?.textContent)
      .toBe("Within your lab's range");
  }, 30_000);

  it('safety separation: a band change of any size leaves the card neutral and adds no urgency', async () => {
    seed(400, 6);
    await renderAndOpenAll();
    expect(prepQuestions()).toEqual(PREP_FOR_TSH_400);
    expect(app.querySelectorAll('[data-testid="prep-questions"][role="alert"], [data-testid="prep-questions"] [role="alert"]').length).toBe(0);
  }, 30_000);

  it('negative control: the prohibitions see the owner\'s examples and the old band premise', () => {
    for (const q of ['Why is my thyroid getting worse?', 'Should I start treatment?', 'Why is this dangerous?',
      "My TSH is 9 uIU/mL, outside Amani's comparison band, which has not yet completed clinical review."]) {
      expect(q).toMatch(PREP_FORBIDDEN);
    }
  });
});

describe('owner R4 — no personalized nutrition, supplement or lifestyle recommendation renders', () => {
  it('model next steps never render; education is labelled, unpersonalized and authored by the policy', async () => {
    seed(9, 6);
    await renderAndOpenAll();
    for (const step of MODEL_NEXT_STEPS) expect(app.textContent).not.toContain(step);
    expect(forbiddenNutrition(pageText())).toEqual([]);
    expect(app.textContent).toContain(policy.EDUCATION_INTRO);
    const education = Array.from(app.querySelectorAll('[data-language-category="educational_content"]'));
    expect(education.length).toBe(2);
    const authored = new Set(Object.values(policy.EDUCATION).map(e => e.text));
    for (const el of education) {
      expect(el.getAttribute('data-language-source')).toBe('general_education');
      expect(authored.has(el.textContent ?? '')).toBe(true);
    }
  }, 30_000);

  it('negative control: the page check sees each suppressed recommendation if it rendered', () => {
    for (const text of [...MODEL_NEXT_STEPS, 'Foods to focus on', 'Topics to discuss', 'Track next', 'Next best steps']) {
      expect(forbiddenNutrition(text), text).not.toEqual([]);
    }
  });
});

function forbiddenNutrition(text: string): string[] {
  return [...text.matchAll(new RegExp(NUTRITION_ADVICE.source, 'gi'))].map(m => text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40));
}

/*
  Owner R1, turn 13. Every model field the page reads, filled with model-shaped
  prose that carries no forbidden word (so the page-wide prohibition above
  cannot see it), plus three sentences that ARE authorized phrases of the
  report's own measured-change claims, one deliberately on the wrong marker's
  card. The proof is positive: no canary on the page, every model-derived
  element resolves to a claim, and nothing inside a model surface is outside a
  policy element.
*/
const C = MODEL_CANARIES;
const TSH_UP = 'Your TSH increased from your previous result.';
const FERRITIN_DOWN = 'Your Ferritin decreased from your previous result.';
function seedModelProse(cycleExplanation: string = C[4]) {
  seed(9, 6);
  const current = fixture.tables.lab_reports!.find(r => r['id'] === CURRENT)!;
  Object.assign(current, { estimated_cycle_phase: 'luteal', estimated_cycle_day: 21 });
  fixture.interpretation = { json_output: {
    ...(fixture.interpretation!['json_output'] as Record<string, unknown>),
    headline: C[0],
    primary_concern: undefined,
    summary_bullets: [C[1], TSH_UP, 'Your thyroid health has worsened.', `${TSH_UP} ${C[2]}`],
    pattern_signals: [
      { title: C[2], confidence: 'high', explanation: C[3], related_biomarkers: ['tsh'] },
      { title: C[5], confidence: 'medium', explanation: FERRITIN_DOWN, related_biomarkers: ['ferritin'] },
    ],
    cycle_context: { estimated_cycle_day: 3, estimated_cycle_phase: 'menstrual', confidence: 'high', explanation: cycleExplanation },
    biomarkers: [{
      name: 'tsh', user_value: '9', unit: 'uIU/mL', reference_range: '0.45-4.5', status_label: 'out_of_range',
      plain_english_meaning: C[5], timing_notes: C[6],
      common_non_alarm_reasons: [C[7], TSH_UP],
      // Another marker's fact on this card: it must not render here.
      when_clinicians_follow_up: [FERRITIN_DOWN],
    }],
    disclaimer: C[0],
  } };
}
/** The report's claims, computed here from the fixture rather than read from the page. */
function fixtureClaims() {
  const snapshot = (id: string) => fixture.tables.biomarkers!.filter(b => b['lab_report_id'] === id)
    .map(b => ({ key: b['name'] as BiomarkerName, value: b['value'] as number, unit: b['unit'] as string }));
  return [...policy.movementClaimsByKey(compareReports(snapshot(PRIOR), snapshot(CURRENT), 'luteal')
    .map(d => [d.key, d] as const)).values()];
}
const modelFields = () => Array.from(app.querySelectorAll('[data-model-field]'))
  .map(el => [el.getAttribute('data-model-field'), el.textContent, el.closest('[data-model-surface]')?.getAttribute('data-model-surface')]);

describe('owner R1 — model prose renders only as the report\'s own claims', () => {
  it('no model sentence reaches the page unless it is an issued claim phrase, on its own marker', async () => {
    seedModelProse();
    await renderAndOpenAll();
    const text = app.textContent ?? '';
    for (const canary of C) expect(text, canary).not.toContain(canary);
    expect(text).not.toContain('Your thyroid health has worsened');
    expect(modelFields()).toEqual([
      ['interpretation.summary_bullets', TSH_UP, 'summary_bullets'],
      ['interpretation.pattern_signals.explanation', FERRITIN_DOWN, 'pattern_signals'],
      ['interpretation.biomarkers.common_non_alarm_reasons', TSH_UP, 'marker'],
    ]);
    // Claim scoping: the TSH card states only TSH's change.
    const tshCard = app.querySelector('article[aria-label="TSH result"]');
    expect(tshCard?.textContent).toContain(TSH_UP);
    expect(tshCard?.textContent).not.toContain(FERRITIN_DOWN);
    // The model's confidence badge, pattern title and red/amber styling are gone with it.
    expect(app.querySelector('[data-model-surface="pattern_signals"]')?.outerHTML).not.toMatch(/flag-(?:ok|watch|low)|confidence/i);
  }, 30_000);

  it('positively: every model-derived element resolves to a claim, and every model surface is policy text', async () => {
    seedModelProse();
    await renderAndOpenAll();
    expect(app.querySelectorAll('[data-model-surface]').length).toBe(3);
    expect(unresolvedModelProse(app, fixtureClaims())).toEqual([]);
    expect(unprovenancedText(app, ['Measured changes'])).toEqual([]);
    // The disclaimer is the policy's, not the model's.
    const disclaimers = Array.from(app.querySelectorAll('[data-language-source="product_disclaimer"]')).map(el => el.textContent);
    expect(disclaimers).toContain(policy.PRODUCT_DISCLAIMERS.report.text);
  }, 30_000);

  it('standing rule 5: a model sentence agrees with every other statement of the same change on the page', async () => {
    seedModelProse();
    await renderAndOpenAll();
    for (const [subject, sentence] of [['TSH', TSH_UP], ['Ferritin', FERRITIN_DOWN]] as const) {
      const rises = /increased/.test(sentence);
      const statements = Array.from(app.querySelectorAll('[data-language-claim="measured_movement"]'))
        .map(el => el.textContent ?? '')
        .filter(t => new RegExp(`^${subject} .*from (\\d+(?:\\.\\d+)?) to (\\d+(?:\\.\\d+)?)`).test(t));
      expect(statements.length, subject).toBeGreaterThan(0);
      for (const t of statements) {
        const [, from, to] = t.match(/from (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?)/)!;
        expect(Number(to) > Number(from), `${subject}: ${t}`).toBe(rises);
      }
    }
  }, 30_000);

  it('the cycle explanation renders only as a claim; a canary explanation takes the confidence badge with it', async () => {
    seedModelProse();
    await renderAndOpenAll();
    expect(app.textContent).toContain('Cycle context');
    expect(app.querySelector('[data-model-surface="cycle_context"]')).toBeNull();
    expect(app.textContent).not.toMatch(/high confidence/i);
    await act(async () => root.unmount());
    root = createRoot(app);
    seedModelProse(TSH_UP);
    await renderAndOpenAll();
    expect(app.querySelector('[data-model-surface="cycle_context"] [data-model-field="interpretation.cycle_context.explanation"]')?.textContent).toBe(TSH_UP);
    expect(unprovenancedText(app, ['Measured changes'])).toEqual([]);
  }, 30_000);

  it('a first report has no claim, so no model sentence renders at all', async () => {
    seedModelProse();
    fixture.tables.lab_reports = fixture.tables.lab_reports!.filter(r => r['id'] === CURRENT);
    fixture.tables.biomarkers = fixture.tables.biomarkers!.filter(r => r['lab_report_id'] === CURRENT);
    await renderAndOpenAll();
    expect(app.querySelectorAll('[data-model-field], [data-model-surface]')).toHaveLength(0);
    for (const canary of C) expect(app.textContent).not.toContain(canary);
  }, 30_000);

  it('safety, both ways: the gate never suppresses an approved warning, and model text cannot mint or copy one', async () => {
    const original = policy.evaluateSafetyRules;
    const warning = 'Synthetic safety warning: this is urgent, talk to your doctor and seek care today.';
    const rule: policy.SafetyRule = {
      ruleId: 'synthetic-tsh-critical', version: '1', analyte: 'tsh',
      approval: { approvedBy: 'synthetic test fixture', approvedAt: '2026-10-07', evidenceId: 'SYNTHETIC-ONLY' },
      evaluate: value => value > 100 ? { cue: 'critical', text: warning } : null,
    };
    vi.spyOn(policy, 'evaluateSafetyRules').mockImplementation(measured => original(measured, [rule]));
    seedModelProse();
    fixture.tables.biomarkers!.find(b => b['lab_report_id'] === CURRENT && b['name'] === 'tsh')!['value'] = 400;
    // The model repeats the warning's words in every field it has: a copy is not the rule.
    const output = fixture.interpretation!['json_output'] as Record<string, unknown>;
    output['summary_bullets'] = [warning, 'Your TSH increased from your previous result.'];
    output['pattern_signals'] = [{ title: warning, confidence: 'high', explanation: warning, related_biomarkers: ['tsh'] }];
    await renderAndOpenAll();
    // Direction 1: the approved warning renders verbatim, critical, as the safety channel's alone.
    const alerts = app.querySelectorAll('[data-language-category="safety_warning"]');
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.textContent).toBe(warning);
    expect(alerts[0]!.getAttribute('data-safety-rule')).toBe('synthetic-tsh-critical');
    // Direction 2: the model's copies render nowhere, and its surviving sentence is a neutral fact.
    expect((app.textContent ?? '').split(warning).length - 1).toBe(1);
    for (const el of Array.from(app.querySelectorAll('[data-model-field] [data-language-cue]'))) {
      expect(el.getAttribute('data-language-cue')).toBe('neutral');
      expect(el.closest('[role="alert"], [data-language-category="safety_warning"]')).toBeNull();
    }
    expect(app.querySelectorAll('[data-model-field]').length).toBeGreaterThan(0);
  }, 30_000);

  it('negative control: the positive checks see raw model text in a surface, and an unresolvable sentence', async () => {
    seedModelProse();
    await renderAndOpenAll();
    app.querySelector('[data-model-surface="summary_bullets"] ul')!.insertAdjacentHTML('beforeend', `<li><p>${C[1]}</p></li>`);
    expect(unprovenancedText(app, ['Measured changes'])).toEqual([`summary_bullets: ${C[1]}`]);
    expect(unresolvedModelProse(app, [])).toHaveLength(3);
  }, 30_000);
});

/*
  PK-FIX-06 (owner decision D13). A report with a cycle day but no phase used
  to hide the day. The real page now shows the day, with a neutral note, when
  no phase was estimated for it: a draw after day 35, or a known typical length
  other than 28 days.

  Nothing else changes:
  - no phase label anywhere and no model text on the card;
  - V2 still withholds the cycle-dependent hormone;
  - page-wide policy language holds;
  - a day the map labels, with no phase and no known length, still shows no
    card. An example is a lab-printed day with no last period date.

  Synthetic rows.
*/
describe('PK-FIX-06: the cycle day renders without a phase, in neutral language', () => {
  function seedCycle(facts: Record<string, unknown>) {
    seed(9, 6);
    // The model claims a phase and a confident day; neither may reach the card.
    fixture.interpretation = { json_output: {
      ...(fixture.interpretation!['json_output'] as Record<string, unknown>),
      cycle_context: { estimated_cycle_day: 3, estimated_cycle_phase: 'luteal', confidence: 'high', explanation: C[4] },
    } };
    Object.assign(fixture.tables.lab_reports!.find(r => r['id'] === CURRENT)!, facts);
    // A cycle-dependent hormone, so the page shows whether V2 scores or withholds it.
    fixture.tables.biomarkers!.push(...rows(CURRENT, [['estradiol', 150, 'pg/mL', 30, 400]]));
  }
  const cycleCard = () => Array.from(app.querySelectorAll('h3'))
    .find(h => h.textContent === 'Cycle context')?.parentElement?.parentElement ?? null;
  const estradiolCard = () => app.querySelector('article[aria-label="Estradiol (E2) result"]');
  const WITHHELD = 'Amani context score unavailable';

  it.each([
    ['(a) day 36, unknown length', { estimated_cycle_day: 36, average_cycle_length: null }, '36', 'Phase not estimated after cycle day 35.'],
    ['(a) day 36, 28 stored (as every report saved since 2026-04-14)', { estimated_cycle_day: 36, average_cycle_length: 28 }, '36',
      'Phase not estimated after cycle day 35.'],
    ['(b) day 21 of a 35-day cycle', { estimated_cycle_day: 21, average_cycle_length: 35 }, '21', 'Phase not estimated for a 35-day cycle.'],
    ['(b) day 10 of a 24-day cycle', { estimated_cycle_day: 10, average_cycle_length: 24 }, '10', 'Phase not estimated for a 24-day cycle.'],
  ])('%s: the card shows the cycle day and the note, no phase; estradiol withheld', async (_name, facts, day, note) => {
    seedCycle({ estimated_cycle_phase: 'unknown', ...facts });
    await renderAndOpenAll();
    const card = cycleCard();
    expect(card).not.toBeNull();
    expect(Array.from(card!.querySelectorAll('p')).map(p => p.textContent)).toEqual(['Cycle day', day, note]);
    expect(card!.querySelector('[data-cycle-phase-note]')?.textContent).toBe(note);
    expect(card!.querySelector('[data-model-surface], [data-model-field]')).toBeNull();
    expect(card!.textContent).not.toMatch(/confidence/i);
    // No phase anywhere on the page: no header pill, no phase-specific band.
    expect(app.textContent).not.toMatch(/luteal|follicular|ovulatory|menstrual phase/i);
    expect(estradiolCard()?.textContent).toContain(WITHHELD);
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);

  it('PRESERVE: a day-map phase renders, with no note, and estradiol is scored', async () => {
    seedCycle({ estimated_cycle_phase: 'luteal', estimated_cycle_day: 21, average_cycle_length: null });
    await renderAndOpenAll();
    // PK-FIX-06-EXT (D10) changes only the order and the label: the cycle day
    // first, then the same phase, labelled as an estimate. Before D10:
    // ['Phase', 'luteal', 'Cycle day', '21'].
    expect(Array.from(cycleCard()!.querySelectorAll('p')).map(p => p.textContent))
      .toEqual(['Cycle day', '21', 'Phase', 'luteal', 'estimate for a 28-day cycle']);
    expect(app.querySelector('[data-cycle-phase-note]')).toBeNull();
    expect(estradiolCard()).not.toBeNull();
    expect(estradiolCard()?.textContent).not.toContain(WITHHELD);
  }, 30_000);

  it('PRESERVE: a day the map labels, with no phase and no known length, shows no card, as before', async () => {
    seedCycle({ estimated_cycle_phase: 'unknown', estimated_cycle_day: 14, average_cycle_length: null, last_period_start_date: null });
    await renderAndOpenAll();
    expect(cycleCard()).toBeNull();
    expect(app.querySelector('[data-cycle-phase-note]')).toBeNull();
    expect(estradiolCard()?.textContent).toContain(WITHHELD);
  }, 30_000);

  /*
    PK-FIX-06-EXT (D10 and DESIGN.md): the header leads with the cycle day and
    labels any phase as an estimate, and the cycle rule sits under the header.
  */
  it('D10: the header shows the cycle day first, the phase as an estimate, and the cycle rule under it', async () => {
    seedCycle({ estimated_cycle_phase: 'luteal', estimated_cycle_day: 21, average_cycle_length: null });
    await renderAndOpenAll();
    expect(app.querySelector('[data-report-cycle-line]')?.textContent)
      .toBe('Cycle day 21 · luteal phase, estimate for a 28-day cycle'); // capitalised by CSS
    const rule = app.querySelector('section[data-cycle-rule]');
    expect(rule?.getAttribute('data-cycle-rule')).toBe('placed');
    expect(rule?.querySelector('line[data-tick-day]')?.getAttribute('data-tick-day')).toBe('21');
    expect(rule?.querySelectorAll('[data-band]')).toHaveLength(4);
    // The rule follows the header and comes before the cycle context card.
    const h1 = app.querySelector('h1')!;
    expect(h1.compareDocumentPosition(rule!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rule!.compareDocumentPosition(cycleCard()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 30_000);

  it('D10: day 36 in the header has no phase; the rule carries the tick and the neutral note', async () => {
    seedCycle({ estimated_cycle_phase: 'unknown', estimated_cycle_day: 36, average_cycle_length: null });
    await renderAndOpenAll();
    expect(app.querySelector('[data-report-cycle-line]')?.textContent).toBe('Cycle day 36');
    expect(app.querySelector('section[data-cycle-rule] line[data-tick-day]')?.getAttribute('data-tick-day')).toBe('36');
    expect(app.querySelector('[data-cycle-rule-note]')?.textContent).toBe('Phase not estimated after cycle day 35.');
  }, 30_000);

  it('D10: no cycle day on the report: an empty rule with one line saying why, and no cycle line in the header', async () => {
    seedCycle({ estimated_cycle_phase: 'unknown', estimated_cycle_day: null, average_cycle_length: null, last_period_start_date: null });
    await renderAndOpenAll();
    expect(app.querySelector('[data-report-cycle-line]')).toBeNull();
    expect(app.querySelector('section[data-cycle-rule]')?.getAttribute('data-cycle-rule')).toBe('empty');
    expect(app.querySelector('section[data-cycle-rule] line[data-tick-day]')).toBeNull();
    expect(app.querySelector('[data-cycle-rule-why]')).not.toBeNull();
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);

  /*
    PK-FIX-06-EXT review blocker (D10): the card's phase follows the cycle rule,
    like the header line. A stored phase the rule does not draw is shown apart,
    as recorded with the report, and never with the 28-day estimate label.
  */
  it.each([
    ['a lab-printed phase the day map would not give', { estimated_cycle_phase: 'luteal', estimated_cycle_day: 10, average_cycle_length: null },
      '10', 'luteal', null],
    ['a pregnancy value', { estimated_cycle_phase: 'pregnancy_t1', estimated_cycle_day: 10, average_cycle_length: null },
      '10', 'pregnancy t1', null],
    ['a phase on a known 35-day cycle', { estimated_cycle_phase: 'luteal', estimated_cycle_day: 20, average_cycle_length: 35 },
      '20', 'luteal', 'Phase not estimated for a 35-day cycle.'],
  ])('D10: %s is shown as recorded, never as an estimate; the header and the rule agree', async (_name, facts, day, recorded, note) => {
    seedCycle(facts);
    await renderAndOpenAll();
    const card = cycleCard();
    expect(card).not.toBeNull();
    expect(Array.from(card!.querySelectorAll('p')).map(p => p.textContent))
      .toEqual(['Cycle day', day, 'Phase recorded with this report', recorded, ...(note ? [note] : [])]);
    expect(app.querySelector('[data-cycle-phase-estimate]')).toBeNull();
    expect(app.textContent).not.toContain('estimate for a 28-day cycle');
    expect(app.querySelector('[data-report-cycle-line]')?.textContent).toBe(`Cycle day ${day}`);
    const rule = app.querySelector('section[data-cycle-rule]');
    expect(rule?.querySelector('line[data-tick-day]')?.getAttribute('data-tick-day')).toBe(day);
    expect(rule?.querySelectorAll('[data-band]')).toHaveLength(0);
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);

  it('missing last-period date (no cycle day): no cycle card', async () => {
    seedCycle({ estimated_cycle_phase: 'unknown', estimated_cycle_day: null, average_cycle_length: 35, last_period_start_date: null });
    await renderAndOpenAll();
    expect(cycleCard()).toBeNull();
    expect(app.querySelector('[data-cycle-phase-note]')).toBeNull();
  }, 30_000);
});

/*
  RS2 (review F024, F069). The report disclaimer renders whenever clinical
  content is on screen, not only beside a loaded interpretation; and the page
  does not count results outside Amani's bands in its system headers (DESIGN.md,
  Result row and Don'ts: no counts, no scores), nor tint the lab-brand chip in a
  status or info colour. Synthetic rows.
*/
describe('RS2: disclaimer with every clinical state; no outside-band counts', () => {
  const reportDisclaimers = () => Array.from(app.querySelectorAll('[data-language-source="product_disclaimer"]'))
    .filter(el => el.textContent === policy.PRODUCT_DISCLAIMERS.report.text);
  const current = () => fixture.tables.lab_reports!.find(r => r['id'] === CURRENT)!;

  it('F024: a failed generation still shows the headline and primary finding, and the report disclaimer with them', async () => {
    seed(9, 6);
    current()['status'] = 'error';
    fixture.interpretation = null;
    fixture.invokeError = new Error('synthetic generation failure');
    await renderAndOpenAll();
    expect(app.textContent).toContain('AI summary failed');
    // Two reports: the primary finding renders as its measured movement.
    expect(app.querySelector('[data-testid="primary-movement-observation"]')).not.toBeNull();
    expect(app.textContent).toContain('Your trajectory');
    const disclaimers = reportDisclaimers();
    expect(disclaimers).toHaveLength(1);
    expect(disclaimers[0]!.getAttribute('data-language-category')).toBe(policy.PRODUCT_DISCLAIMERS.report.category);
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);

  it('F024: while the summary is still being generated, the report disclaimer is on screen', async () => {
    seed(9, 6);
    fixture.interpretation = null;
    await renderAndOpenAll();
    expect(app.textContent).toContain('AI summary is being generated');
    expect(reportDisclaimers()).toHaveLength(1);
  }, 30_000);

  it('F024 PRESERVE: with an interpretation loaded the report disclaimer renders once', async () => {
    seed(9, 6);
    await renderAndOpenAll();
    expect(reportDisclaimers()).toHaveLength(1);
  }, 30_000);

  it('F069: system headers carry no outside-band count and no info tint; each row keeps its status words', async () => {
    seed(9, 6);
    await renderAndOpenAll();
    const labels = new Set((Object.keys(CATEGORY_DISPLAY) as BiomarkerCategory[]).map(policy.systemDisplayLabel));
    const headers = buttons(b => b.hasAttribute('aria-expanded') && [...labels].some(l => b.querySelector('span')?.textContent === l));
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.textContent, header.textContent ?? '').not.toMatch(/outside Amani band/i);
      expect(header.innerHTML, header.textContent ?? '').not.toMatch(/info-(?:bg|border)|text-theme-info/);
    }
    // The per-row status word stays: TSH 9 is outside its Amani band.
    expect(app.querySelector('article[aria-label="TSH result"]')?.textContent).toContain('Outside Amani band');
  }, 30_000);

  it.each([['quest', 'Quest'], ['labcorp', 'Labcorp']])('F069: the %s chip is not drawn in a status or info colour', async (source, name) => {
    seed(9, 6);
    current()['lab_source'] = source;
    await renderAndOpenAll();
    const chip = Array.from(app.querySelectorAll('span')).find(el => el.textContent === `Imported from ${name}`);
    expect(chip).toBeTruthy();
    expect(chip!.className).not.toMatch(/flag-(?:ok|watch|low)|theme-info/);
  }, 30_000);
});

// Review F011: an Amani band is in the catalog unit and no conversion is
// approved, so a value saved in another unit is placed only against her lab's
// own interval, on every surface of the page.
describe('F011 — a value in another unit is never placed against an Amani band', () => {
  it('LDL 4.9 mmol/L, above her lab interval: lab range only, no band placement anywhere', async () => {
    seed(9, 6);
    fixture.tables.lab_reports = fixture.tables.lab_reports!.filter(r => r['id'] === CURRENT);
    fixture.tables.biomarkers = rows(CURRENT, [['ldl_cholesterol', 4.9, 'mmol/L', 0, 3]]);
    fixture.tables.report_analytes = [];
    await renderAndOpenAll();
    const card = app.querySelector('article[aria-label="LDL result"]');
    expect(card?.textContent).toContain('No Amani band');
    expect(card?.textContent).toContain("Your lab's range:0–3 mmol/L");
    expect(card?.querySelector('[data-language-source="patient_lab_interval"]')?.textContent).toBe("Above your lab's range");
    expect(card?.querySelector('[data-testid="comparison-region"]')).toBeNull();
    // Pill, system card, headline and primary-finding wording of a band placement.
    expect(app.textContent).not.toMatch(/outside Amani bands?|within Amani bands?|outside Amani's current comparison band|the Amani band at|All scored values are within/i);
    expect(app.querySelectorAll('[data-language-category="comparison_band"][data-language-cue="attention"]').length).toBe(0);
  }, 30_000);

  it('glucose 5.2 mmol/L and insulin 36 pmol/L: no derived metric, so no HOMA-IR against its band', async () => {
    seed(9, 6);
    fixture.tables.lab_reports = fixture.tables.lab_reports!.filter(r => r['id'] === CURRENT);
    fixture.tables.biomarkers = rows(CURRENT, [['fasting_glucose', 5.2, 'mmol/L', 3.9, 5.5], ['fasting_insulin', 36, 'pmol/L', 13, 139]]);
    fixture.tables.report_analytes = [];
    await renderAndOpenAll();
    expect(app.querySelectorAll('article[aria-label$=" result"]').length).toBe(2);
    expect(app.textContent).not.toMatch(/Derived metrics|HOMA-IR/);
    expect(app.textContent).not.toMatch(/outside Amani bands?|within Amani bands?|outside Amani's current comparison band|the Amani band at/i);
  }, 30_000);
});

/*
  RV-NZ1 (REPORT-2026-10-24 §2.2). A prior TSH of 0.2 is under the near-zero
  threshold, so the relative change is undefined and Amani cannot size it. The
  page used to say "TSH has not changed significantly: 0.2 to 9 mIU/L." in the
  headline and the primary observation. It now states the values, on every
  surface, and asks about the change. Synthetic rows.
*/
describe('RV-NZ1: a change from a near-zero prior is stated by value, never as "not changed significantly"', () => {
  const heading = (text: string) => Array.from(app.querySelectorAll('h2')).find(h => h.textContent === text) ?? null;

  it('TSH 0.2 -> 9 mIU/L as the primary: values on every surface, no size or stability word', async () => {
    seed(9, 0.2);
    await renderAndOpenAll();
    expect(app.textContent).not.toMatch(/not changed significantly/i);
    const surfaces = {
      trajectory: heading('Your trajectory')?.closest('div.rounded-2xl'),
      focus: heading('Focus areas')?.parentElement?.parentElement,
      story: heading('Your health story')?.closest('section'),
      primary: app.querySelector('[data-testid="primary-finding"], [data-testid="primary-movement-observation"]'),
      questions: app.querySelector('[data-testid="prep-questions"]'),
    };
    for (const [name, el] of Object.entries(surfaces)) {
      expect(el, name).toBeTruthy();
      expect(el!.textContent, name).not.toMatch(/unchanged|\bstable\b/i);
    }
    expect(surfaces.primary?.textContent).toContain('TSH');
    expect(surfaces.trajectory?.textContent).toContain('TSH changed from 0.2 to 9 mIU/L.');
    expect(surfaces.focus?.textContent).toContain('TSH has changed since your prior report.');
    // Her measured changes first, largest assessed one first; the near-zero change replaces TSH's lab-interval question.
    expect(prepQuestions()).toEqual([
      'My ferritin changed from 25 to 20 ng/mL. What could explain this change, and is it clinically meaningful?',
      'My TSH changed from 0.2 to 9 mIU/L. What could explain this change, and is it clinically meaningful?',
      "My HbA1c is 6 %, above my lab's reference interval of 4–5.6 %. What does this mean in the context of my overall labs?",
      'Is there anything about my routine or history that matters for reading these results?',
    ]);
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);

  it('TSH 0.3 -> 0.1 mIU/L: the headline and the primary observation state the decrease', async () => {
    seed(0.1, 0.3);
    fixture.tables.biomarkers = fixture.tables.biomarkers!.filter(r => r['name'] === 'tsh');
    await renderAndOpenAll();
    expect(app.querySelector('h2 [data-language-claim="measured_movement"]')?.textContent).toBe('TSH decreased from 0.3 to 0.1 mIU/L.');
    expect(app.querySelector('[data-testid="primary-movement-observation"]')?.textContent).toContain('TSH decreased from 0.3 to 0.1 mIU/L.');
    expect(app.textContent).not.toMatch(/not changed significantly/i);
    expect(forbiddenHits(pageText())).toEqual([]);
  }, 30_000);
});
