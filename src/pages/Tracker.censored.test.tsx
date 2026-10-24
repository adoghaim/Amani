// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb, type Row } from '../lib/fetchAllRows.fake';

/*
  Review F021 on the Tracker's "Your health story" modal. A result printed '<8'
  is stored as value 4 with raw_value_text '<8'. The modal states the measured
  changes Tracker computes from the two reports' values, so a comparison through
  the 4 rendered "Vitamin D increased from 4 to 20 ng/mL" and authorized the
  comparison model's matching sentence. The real Tracker page, against a fake
  table read and a stubbed lab-insights response. Synthetic values only.
*/

const fixture = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  auth: { user: { id: 'user-1' }, userProfile: null },
}));

vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => fixture.db.from(table),
  functions: { invoke: async () => ({ data: null, error: new Error('offline') }) },
  auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) },
} }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => fixture.auth }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/freemium/PremiumPaywall', () => ({ PremiumPaywall: () => null }));
import { Tracker } from './Tracker';

const report = (id: string, report_date: string): Row => ({
  id, user_id: 'user-1', report_date, status: 'complete', estimated_cycle_phase: 'unknown',
  lab_name: 'Synthetic Lab', created_at: `${report_date}T00:00:00Z`,
});
const marker = (reportId: string, name: string, value: number, text: string): Row => ({
  id: `${reportId}-${name}`, lab_report_id: reportId, name, value, raw_value_text: text, unit: 'ng/mL',
  reference_min: null, reference_max: null, flagged: 'unknown',
});

// The comparison model restating the placeholder, as lab-insights' prompt invited it to.
const MODEL_SENTENCE = 'Vitamin D increased from 4 to 20 ng/mL.';
const insightsResponse = {
  insights: {
    summary: MODEL_SENTENCE,
    notable_changes: [{ biomarker: 'Vitamin D', change: MODEL_SENTENCE, possible_factors: [] }],
    questions_to_ask: [], next_steps_general: [],
  },
};

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', '');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(insightsResponse), { status: 200 })));
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

/** Opens the labs tab and the latest report's Insights modal; returns the modal's comparison text. */
async function openHealthStory(biomarkers: Row[]): Promise<string> {
  fixture.db = createFakeDb({
    lab_reports: [report('r1', '2026-03-01'), report('r2', '2026-06-01')],
    biomarkers,
  });
  await act(async () => root.render(<MemoryRouter><Tracker /></MemoryRouter>));
  await settle();
  const labsTab = Array.from(app.querySelectorAll('button')).find(b => b.textContent === 'labs');
  await act(async () => { labsTab!.click(); });
  const insights = Array.from(app.querySelectorAll('button'))
    .filter(b => b.title === 'Generate AI insights');
  // Reports render newest first; the newest one compares with its predecessor.
  await act(async () => { insights[0]!.click(); });
  await settle();
  expect(app.textContent).toContain('Your health story');
  return app.querySelector('[data-model-surface="comparison"]')?.textContent ?? '';
}

describe('Tracker health story never states a censored placeholder (F021)', () => {
  it('a censored prior: no measured change or model sentence through the 4', async () => {
    const text = await openHealthStory([
      marker('r1', 'vitamin_d_25_oh', 4, '<8'), marker('r1', 'ferritin', 20, '20'),
      marker('r2', 'vitamin_d_25_oh', 20, '20'), marker('r2', 'ferritin', 40, '40'),
    ]);
    expect(text).not.toMatch(/\b4 to 20\b|from 4\b/);
    // The measured pair still states its change.
    expect(text).toMatch(/from 20 to 40 ng\/mL/);
  }, 30_000);

  it('measured values on both reports still state their change (control)', async () => {
    const text = await openHealthStory([
      marker('r1', 'vitamin_d_25_oh', 4, '4'), marker('r2', 'vitamin_d_25_oh', 20, '20'),
    ]);
    expect(text).toMatch(/from 4 to 20 ng\/mL/);
  }, 30_000);
});
