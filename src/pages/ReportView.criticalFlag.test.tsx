// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  Review F014 interim on the real report page, in jsdom, behind a mocked
  Supabase client. A result her lab printed a critical flag beside gets one
  fixed notice in the safety channel: only while
  features.lab_critical_flag_notice is on, in every tier, while the analysis
  is still being generated, and whatever the model wrote. Synthetic rows.
*/

const FLAG = 'lab_critical_flag_notice';
const NOTICE = 'Your lab marked your Potassium result as critical. Contact your clinician promptly. If you feel unwell, call your local emergency number.';

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

const REPORT = '00000000-0000-4000-a000-0000000f0140';
const USER = '00000000-0000-4000-8000-0000000f0140';

function analyte(id: string, name: string, value: string, unit: string, snippet: string) {
  return {
    id, lab_report_id: REPORT, raw_name: name.toLowerCase(), display_name: name, value_numeric: Number(value),
    raw_value_text: value, unit, normalized_min: null, normalized_max: null, normalized_operator: null,
    normalized_operator_value: null, raw_reference_range: null, source_snippet: snippet, parse_status: 'mapped',
    canonical_slug: name.toLowerCase(), is_core: false, confidence_score: 'high', normalization_status: 'mapped',
    source_format: 'text',
  };
}

function seed({ status = 'ready', potassium = 'Potassium 6.8 HH 3.5-5.3 mmol/L' } = {}) {
  fixture.tables = {
    lab_reports: [{
      id: REPORT, user_id: USER, report_date: '2026-03-02', status, estimated_cycle_phase: 'unknown',
      regeneration_count: 0, lab_name: 'Synthetic Lab', context: {},
    }],
    biomarkers: [{
      id: 'b-1', lab_report_id: REPORT, name: 'tsh', value: 2.1, raw_value_text: '2.1', unit: 'uIU/mL',
      reference_min: 0.45, reference_max: 4.5, flagged: 'in_range', created_at: '2026-03-02T00:00:00.000Z',
    }],
    report_analytes: [
      analyte('a-1', 'Potassium', '6.8', 'mmol/L', potassium),
      analyte('a-2', 'Ferritin', '18', 'ng/mL', 'Ferritin 18 L 16-154 ng/mL'),
    ],
  };
  // The model says everything is fine and carries no safety note: none of that may matter.
  fixture.interpretation = { json_output: {
    headline: 'Everything looks normal.', summary_bullets: ['Nothing here needs attention.'], pattern_signals: [],
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

async function render() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/app/reports/${REPORT}`]}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const notices = () => Array.from(app.querySelectorAll('[data-safety-rule="lab-printed-critical-flag"]'));

function expectOneNotice() {
  const found = notices();
  expect(found).toHaveLength(1);
  expect(found[0]!.getAttribute('role')).toBe('alert');
  expect(found[0]!.getAttribute('data-language-category')).toBe('safety_warning');
  expect(found[0]!.getAttribute('data-language-cue')).toBe('critical');
  expect(found[0]!.textContent).toBe(NOTICE);
}

describe('F014: the lab-printed critical flag notice on the report page', () => {
  it('dark by default: with the flag off nothing renders, even for a critical flag', async () => {
    fixture.features = [];
    await render();
    // The page loaded both lab rows, the critical one included.
    expect(app.textContent).toContain('2 total analytes');
    expect(notices()).toHaveLength(0);
    expect(app.querySelectorAll('[role="alert"]')).toHaveLength(0);
  }, 30_000);

  it('flag on: one critical notice in the safety channel, in fixed words', async () => {
    await render();
    expectOneNotice();
  }, 30_000);

  it('the flag can arrive after the page: the notice appears once this launch\'s config has loaded', async () => {
    fixture.features = [];
    let finishLoad!: () => void;
    fixture.configLoad = new Promise<void>(resolve => { finishLoad = () => { fixture.features = [FLAG]; resolve(); }; });
    await render();
    expect(notices()).toHaveLength(0);
    await act(async () => { finishLoad(); await fixture.configLoad; });
    expectOneNotice();
  }, 30_000);

  it('an ordinary lab flag is not critical: no notice', async () => {
    seed({ potassium: 'Potassium 6.8 H 3.5-5.3 mmol/L' });
    await render();
    expect(notices()).toHaveLength(0);
  }, 30_000);

  it.each([
    { tier: 'Plus, flag off for freemium', freemium: false, entitled: true, access: null },
    { tier: 'Free, flag off for freemium', freemium: false, entitled: false, access: null },
    { tier: 'freemium Full', freemium: true, entitled: true, access: 'full' },
    { tier: 'freemium Basic', freemium: true, entitled: false, access: 'basic' },
    { tier: 'freemium generation needed', freemium: true, entitled: false, access: 'generation_needed' },
    { tier: 'freemium access error', freemium: true, entitled: false, access: 'error' },
  ])('every tier sees it: $tier', async ({ freemium, entitled, access }) => {
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', String(freemium));
    fixture.subscription = { ...fixture.subscription, entitled, plan: entitled ? 'premium' : 'free' };
    if (access) {
      const body = fixture.interpretation!['json_output'] as Record<string, unknown>;
      fixture.access = { access, interpretation: access === 'full' || access === 'basic' ? body : null };
    }
    await render();
    expectOneNotice();
  }, 30_000);

  it('shown while the analysis is still being generated', async () => {
    seed({ status: 'processing' });
    fixture.interpretation = null;
    await render();
    expect(app.textContent).toContain('Generating your analysis');
    expectOneNotice();
  }, 30_000);

  it('model text can neither remove the notice nor mint one', async () => {
    // The model echoes the notice's words with no critical flag on the report.
    seed({ potassium: 'Potassium 4.1 3.5-5.3 mmol/L' });
    const output = fixture.interpretation!['json_output'] as Record<string, unknown>;
    output['headline'] = NOTICE;
    output['summary_bullets'] = [NOTICE];
    await render();
    expect(notices()).toHaveLength(0);
    expect(app.querySelectorAll('[role="alert"]')).toHaveLength(0);
  }, 30_000);
});
