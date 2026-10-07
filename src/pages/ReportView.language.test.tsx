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
    expect(app.querySelector('h2 [data-language-category="comparison_band"]')?.textContent)
      .toContain(outside ? "outside Amani's current comparison band" : "All scored values are within Amani's context bands");
    expect(app.textContent).toContain(outside ? '1 outside Amani band' : 'Scored markers within Amani bands');
    const empty = "No scored marker on this report is outside Amani's comparison bands.";
    expect((app.textContent ?? '').split(empty).length - 1).toBe(outside ? 0 : 1);
    // ReportView intentionally does not mount FocusAreas when empty.
    if (!outside) expect(app.textContent).not.toContain('Focus areas');
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
  'My TSH changed from 6 to 400 uIU/mL. What could explain this change, and is it clinically meaningful?',
  'My Ferritin changed from 25 to 20 ng/mL. What could explain this change, and is it clinically meaningful?',
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
    expect(tshChange).toContain('from 6 to 9 uIU/mL');
    expect(app.querySelector('[data-testid="primary-movement-observation"]')?.textContent).toContain('from 6 to 9 uIU/mL');
    expect(app.textContent).toContain('TSH has risen from 6 to 9 uIU/mL.');
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
