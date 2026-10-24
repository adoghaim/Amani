// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  Review F065 on the real ReportView: a read that cannot reach Amani is a
  failed load, with Try again. It is never "Report not found", and never a
  report with no values. postgrest-js answers a failed fetch with
  { data: null, error } rather than throwing, which is what this fake does.
*/

const fixture = vi.hoisted(() => ({
  /** The stored report row; null when there is no such report. */
  report: null as Record<string, unknown> | null,
  failing: new Set<string>(),
  reads: [] as string[],
}));

vi.mock('../lib/supabase', () => ({ supabase: {
  functions: { invoke: async (name: string) => (name === 'generate-interpretation'
    ? { data: { success: true }, error: null } : { data: null, error: null }) },
  from: (table: string) => {
    const failed = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    const rows = (): Record<string, unknown>[] => table === 'biomarkers' && fixture.report ? [{
      id: 'bm-1', lab_report_id: 'report-1', name: 'tsh', value: 2, raw_value_text: '2.0', unit: 'uIU/mL',
      reference_min: 0.45, reference_max: 4.5, flagged: 'in_range', created_at: '2026-09-01T00:00:00Z',
    }] : [];
    const row = () => table === 'lab_reports' ? (fixture.report && { ...fixture.report })
      : table === 'interpretations' && fixture.report
        ? { id: 'interp-1', lab_report_id: 'report-1', json_output: { headline: 'Synthetic stored analysis', summary_bullets: [] }, tier: 'plus' }
        : null;
    const answer = <T,>(value: T) => {
      fixture.reads.push(table);
      return fixture.failing.has(table) ? failed : value;
    };
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'lt', 'order', 'limit', 'in', 'range']) query[method] = () => query;
    query.update = () => query;
    query.maybeSingle = async () => answer({ data: row(), error: null });
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(answer({ data: rows(), error: null })).then(resolve);
    return query;
  },
} }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({
  entitled: true, plan: 'premium', complimentary: { used: 0, total: 3, remaining: 3 }, refetch: vi.fn(),
}) }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/freemium/PremiumPaywall', () => ({ PremiumPaywall: () => null }));
import { ReportView } from './ReportView';

const REPORT = {
  id: 'report-1', user_id: 'user-1', status: 'ready', report_date: '2026-09-01', regeneration_count: 1,
  estimated_cycle_phase: 'unknown', lab_name: 'Synthetic lab',
};

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'false');
  fixture.report = { ...REPORT };
  fixture.failing.clear();
  fixture.reads = [];
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

async function settle(ms = 0) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
async function renderReport() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/reports/report-1']}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
  await settle();
}
const text = () => app.textContent ?? '';
const buttons = (label: string | RegExp) => Array.from(app.querySelectorAll('button'))
  .filter(b => typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.textContent ?? ''));
const notices = () => Array.from(app.querySelectorAll('[role="status"]')).map(n => n.textContent ?? '');
const unreachable = () => notices().filter(n => n.includes("We couldn't reach Amani") && n.includes('Your reports are safe.'));
const reportOnScreen = () => text().includes('Lab Report:');

describe('opening a report that could not be read', () => {
  it('is a load failure with Try again, never "Report not found"', async () => {
    fixture.failing.add('lab_reports');
    await renderReport();
    expect(unreachable()).toHaveLength(1);
    expect(buttons('Try again')).toHaveLength(1);
    expect(text()).not.toContain('Report not found');
    expect(text()).not.toMatch(/Failed to load|Failed to fetch/);
    expect(reportOnScreen()).toBe(false);
  });

  it('Try again opens the report once it can be read', async () => {
    fixture.failing.add('lab_reports');
    await renderReport();
    fixture.failing.clear();
    await act(async () => buttons('Try again')[0]!.click());
    await settle();
    expect(reportOnScreen()).toBe(true);
    expect(unreachable()).toEqual([]);
  });

  it('the report row read but its values did not: still a load failure, never a report with no values', async () => {
    fixture.failing.add('biomarkers');
    await renderReport();
    expect(unreachable()).toHaveLength(1);
    expect(reportOnScreen()).toBe(false);
    expect(text()).not.toContain('0 core biomarkers');
  });

  it('a report that is not there is still "Report not found" (control)', async () => {
    fixture.report = null;
    await renderReport();
    // The page looks twice, 1.2 s apart, before it says so.
    await settle(1300);
    expect(text()).toContain('Report not found');
    expect(unreachable()).toEqual([]);
  });
});

describe('a re-read that fails while the report is on screen', () => {
  it('keeps the report, offers Try again in place, and clears once a read succeeds', async () => {
    await renderReport();
    expect(reportOnScreen()).toBe(true);
    // Regenerate re-reads the report when it is done; that read cannot reach Amani.
    fixture.failing.add('lab_reports');
    await act(async () => buttons(/^Regenerate \(2 left\)$/)[0]!.click());
    await settle();
    expect(reportOnScreen()).toBe(true);
    expect(unreachable()).toHaveLength(1);
    expect(text()).not.toMatch(/Failed to load|Failed to fetch|Report not found/);

    fixture.failing.clear();
    const notice = Array.from(app.querySelectorAll('[role="status"]')).find(n => n.textContent?.includes("We couldn't reach Amani"))!;
    await act(async () => notice.querySelector('button')!.click());
    await settle();
    expect(reportOnScreen()).toBe(true);
    expect(unreachable()).toEqual([]);
  });
});
