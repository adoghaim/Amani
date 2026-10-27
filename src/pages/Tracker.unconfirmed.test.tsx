// @vitest-environment jsdom
/**
 * F022 on the tracker: Compare labs and the labs timeline measure changes
 * between reports, so a value Amani may have misread that she has not
 * confirmed is not one of their values. Synthetic rows only.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb } from '../lib/fetchAllRows.fake';

const fixture = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  auth: { user: { id: 'user-1' }, userProfile: null },
  subscription: {
    entitled: true, source: 'trial', loading: false, plan: 'premium',
    complimentary: { used: 0, total: 3, remaining: 3 }, refetch: () => {},
  },
  compareViewProps: [] as Record<string, { id: string }[]>[],
  timelineProps: [] as Record<string, { id: string }[]>[],
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
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/freemium/PremiumPaywall', () => ({ PremiumPaywall: () => null }));
vi.mock('../components/CompareView', () => ({
  CompareView: ({ biomarkersByReport }: { biomarkersByReport: Record<string, { id: string }[]> }) => {
    fixture.compareViewProps.push(biomarkersByReport);
    return null;
  },
}));
vi.mock('../components/LabsTimeline', () => ({
  LabsTimeline: ({ biomarkersByReport }: { biomarkersByReport: Record<string, { id: string }[]> }) => {
    fixture.timelineProps.push(biomarkersByReport);
    return null;
  },
}));

import { Tracker } from './Tracker';

const report = (id: string, report_date: string) => ({
  id, user_id: 'user-1', report_date, status: 'complete', estimated_cycle_phase: 'unknown',
  lab_name: 'Synthetic lab', created_at: `${report_date}T00:00:00Z`, regeneration_count: 0,
});
const biomarker = (id: string, lab_report_id: string, name: string, value: number) => ({
  id, lab_report_id, name, value, raw_value_text: String(value), unit: 'mIU/L', reference_min: 0.4, reference_max: 4.5, flagged: 'in_range',
});
const analyte = (id: string, lab_report_id: string, slug: string, value: number, review: Record<string, unknown>) => ({
  id, lab_report_id, raw_name: slug, canonical_slug: slug, value_numeric: value, raw_value_text: String(value),
  is_core: true, parse_status: 'mapped', confidence_score: 'high', needs_review: false, reviewed_by_user: false, ...review,
});

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', '');
  fixture.compareViewProps = [];
  fixture.timelineProps = [];
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function openLabs() {
  await act(async () => root.render(<MemoryRouter><Tracker /></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const labsTab = Array.from(app.querySelectorAll('button')).find(b => b.textContent === 'labs');
  expect(labsTab).toBeTruthy();
  await act(async () => { labsTab!.click(); });
}
const ids = (byReport: Record<string, { id: string }[]> | undefined) =>
  Object.fromEntries(Object.entries(byReport ?? {}).map(([reportId, rows]) => [reportId, rows.map(r => r.id)]));

it('Compare labs and the timeline leave out her unconfirmed value and keep everything else', async () => {
  fixture.db = createFakeDb({
    lab_reports: [report('r1', '2026-03-01'), report('r2', '2026-06-01')],
    biomarkers: [
      biomarker('b1', 'r1', 'tsh', 2.2), biomarker('b2', 'r2', 'tsh', 0.0008), biomarker('b3', 'r2', 'ferritin', 40),
    ],
    report_analytes: [
      analyte('a1', 'r1', 'tsh', 2.2, {}),
      analyte('a2', 'r2', 'tsh', 0.0008, { needs_review: true, confidence_score: 'low' }),
      analyte('a3', 'r2', 'ferritin', 40, {}),
    ],
  });
  await openLabs();
  const expected = { r1: ['b1'], r2: ['b3'] };
  expect(ids(fixture.compareViewProps[fixture.compareViewProps.length - 1])).toEqual(expected);
  expect(ids(fixture.timelineProps[fixture.timelineProps.length - 1])).toEqual(expected);
});

it('control: once she has confirmed it, the value is compared like any other', async () => {
  fixture.db = createFakeDb({
    lab_reports: [report('r1', '2026-03-01'), report('r2', '2026-06-01')],
    biomarkers: [biomarker('b1', 'r1', 'tsh', 2.2), biomarker('b2', 'r2', 'tsh', 0.0008)],
    report_analytes: [
      analyte('a1', 'r1', 'tsh', 2.2, {}),
      analyte('a2', 'r2', 'tsh', 0.0008, { needs_review: false, reviewed_by_user: true, confidence_score: 'high' }),
    ],
  });
  await openLabs();
  expect(ids(fixture.compareViewProps[fixture.compareViewProps.length - 1])).toEqual({ r1: ['b1'], r2: ['b2'] });
});
