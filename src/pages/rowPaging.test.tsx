// @vitest-environment jsdom
/**
 * R27 / PK-FIX-07: the three all-reports value reads page past PostgREST's
 * silent 1,000-row cap. Each page is rendered against a fake table that
 * truncates every request at 1,000 rows, seeded with 1,001+ value rows whose
 * last rows (by id) are the ones a single request would drop.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFakeDb, seedBiomarkers, type FakeDb } from '../lib/fetchAllRows.fake';

const fixture = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  // Stable identities: the pages refetch whenever these change.
  auth: { user: { id: 'user-1' }, userProfile: null },
  subscription: {
    entitled: true, source: 'trial', loading: false, plan: 'premium',
    complimentary: { used: 0, total: 3, remaining: 3 }, refetch: () => {},
  },
  compareViewProps: [] as Array<Record<string, unknown[]>>,
  baselineCalls: [] as Array<{ entries: unknown[] }>,
}));

vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const query = fixture.db.from(table) as unknown as Record<string, unknown>;
    // Writes are not part of this proof; keep them inert and chainable.
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
vi.mock('../components/CompareView', () => ({
  CompareView: ({ biomarkersByReport }: { biomarkersByReport: Record<string, unknown[]> }) => {
    fixture.compareViewProps.push(biomarkersByReport);
    return null;
  },
}));
vi.mock('../lib/personalization/baseline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/personalization/baseline')>();
  return {
    ...actual,
    computeBaseline: ((entries: unknown[], ...rest: unknown[]) => {
      fixture.baselineCalls.push({ entries });
      return (actual.computeBaseline as (...a: unknown[]) => unknown)(entries, ...rest);
    }) as typeof actual.computeBaseline,
  };
});

import { Dashboard } from './Dashboard';
import { Tracker } from './Tracker';
import { ReportView } from './ReportView';

const report = (id: string, report_date: string) => ({
  id, user_id: 'user-1', report_date, status: 'complete', estimated_cycle_phase: 'unknown',
  lab_name: 'Test lab', created_at: `${report_date}T00:00:00Z`, regeneration_count: 0,
});

// Three reports, 350 values each = 1,050 rows. Report r3's ids sort last and
// it is seeded last, so a single capped request loses 50 of its rows.
function threeReportAccount() {
  return createFakeDb({
    lab_reports: [report('r1', '2026-03-01'), report('r2', '2026-06-01'), report('r3', '2026-09-01')],
    biomarkers: [
      ...seedBiomarkers('r1', 350, 'a'),
      ...seedBiomarkers('r2', 350, 'b'),
      ...seedBiomarkers('r3', 350, 'c'),
    ],
  });
}

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', '');
  fixture.compareViewProps = [];
  fixture.baselineCalls = [];
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

const biomarkerRequests = () => fixture.db.requests.filter((r) => r.table === 'biomarkers');

it('every one of 1,050 values reaches the dashboard', async () => {
  fixture.db = threeReportAccount();
  await act(async () => root.render(<MemoryRouter><Dashboard /></MemoryRouter>));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  const counts = (app.textContent ?? '').match(/\d+ biomarkers/g);
  expect(counts).toEqual(['350 biomarkers', '350 biomarkers', '350 biomarkers']);
  expect(biomarkerRequests().map((r) => r.range)).toEqual([[0, 999], [1000, 1999]]);
});

it('every one of 1,050 values reaches the tracker labs view', async () => {
  fixture.db = threeReportAccount();
  await act(async () => root.render(<MemoryRouter><Tracker /></MemoryRouter>));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const labsTab = Array.from(app.querySelectorAll('button')).find((b) => b.textContent === 'labs');
  expect(labsTab).toBeTruthy();
  await act(async () => { labsTab!.click(); });

  const latest = fixture.compareViewProps[fixture.compareViewProps.length - 1] ?? {};
  expect(Object.fromEntries(Object.entries(latest).map(([id, rows]) => [id, rows.length])))
    .toEqual({ r1: 350, r2: 350, r3: 350 });
  const allIds = Object.values(latest).flat().map((b) => (b as { id: string }).id);
  expect(new Set(allIds).size).toBe(1050);
});

it('a value whose history rows sit past row 1,000 still reaches the trend baseline', async () => {
  // Two prior reports with 600 filler values each, then Ferritin in each, ids
  // sorting last: 1,202 prior rows, and Ferritin is in rows 1,201 and 1,202.
  fixture.db = createFakeDb({
    lab_reports: [report('p1', '2026-01-01'), report('p2', '2026-03-01'), report('current', '2026-09-01')],
    biomarkers: [
      ...seedBiomarkers('p1', 600, 'a'),
      ...seedBiomarkers('p2', 600, 'b'),
      ...seedBiomarkers('p1', 1, 'z1', () => 'Ferritin'),
      ...seedBiomarkers('p2', 1, 'z2', () => 'Ferritin'),
      ...seedBiomarkers('current', 1, 'cur', () => 'Ferritin'),
    ],
    report_analytes: [],
    interpretations: [],
  });
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/reports/current']}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  const historyReads = biomarkerRequests().filter((r) => r.range !== null);
  expect(historyReads.map((r) => r.returned)).toEqual([1000, 202]);
  // Ferritin's baseline sees both prior readings, dated, oldest first.
  const ferritin = fixture.baselineCalls[fixture.baselineCalls.length - 1];
  expect(ferritin?.entries).toEqual([
    { date: '2026-01-01', value: 0 },
    { date: '2026-03-01', value: 0 },
  ]);
});
