// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHASE_ESTIMATE_LABEL } from '../lib/cycleDayRule';

/*
  PK-FIX-06-EXT (owner decision D10): the dashboard's recent reports and the
  Reports list follow the report's cycle rule. Each names a report's cycle day
  first and labels any phase "estimate for a 28-day cycle"; no phase without a
  cycle day; no status-tinted phase badge. Synthetic rows only.
*/

const fixture = vi.hoisted(() => ({
  user: { id: 'user-1' },
  tables: {} as Record<string, unknown[]>,
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: fixture.user, userProfile: null }) }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({ entitled: true, source: 'trial', loading: false }) }));
vi.mock('../components/SubscriptionStatus', () => ({ SubscriptionStatus: () => null }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const result = { data: fixture.tables[table] ?? [], error: null };
    const query = {
      select: () => query, eq: () => query, in: () => query, order: () => query,
      then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return query;
  },
} }));
import { Dashboard } from './Dashboard';
import { Reports } from './Reports';

const report = (id: string, report_date: string, facts: Record<string, unknown>) => ({
  id, user_id: 'user-1', report_date, upload_date: `${report_date}T10:00:00Z`, file_url: null, lab_name: 'Synthetic Lab',
  last_period_start_date: null, average_cycle_length: null, estimated_cycle_day: null, estimated_cycle_phase: 'unknown',
  context: {}, status: 'ready', regeneration_count: 0, lab_source: 'unknown', import_method: 'direct_upload', ...facts,
});

const ROWS = [
  // A phase the rule shows: day first, phase labelled.
  report('r-luteal', '2026-03-01', { last_period_start_date: '2026-02-09', estimated_cycle_day: 21, estimated_cycle_phase: 'luteal' }),
  // No wrap: day 37 stays day 37, no phase.
  report('r-day37', '2026-02-01', { last_period_start_date: '2025-12-27', estimated_cycle_day: 37, average_cycle_length: 28 }),
  // A stored phase with no cycle day (no period entered): nothing shown, never a bare phase.
  report('r-nodate', '2026-01-01', { estimated_cycle_phase: 'menstrual' }),
];

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', '');
  fixture.tables = { lab_reports: ROWS };
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

async function renderPage(page: ReactNode) {
  await act(async () => root.render(<MemoryRouter>{page}</MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

/** Every cycle line inside the links to one report. */
const linesFor = (id: string) => Array.from(app.querySelectorAll(`a[href="/app/reports/${id}"] [data-report-cycle-line], [data-report-row="${id}"] [data-report-cycle-line]`))
  .map(el => el.textContent);

describe('Dashboard recent reports (D10)', () => {
  it('names the cycle day first and labels the phase as an estimate', async () => {
    await renderPage(<Dashboard />);
    expect(linesFor('r-luteal')).toEqual([`Cycle day 21 · luteal phase, ${PHASE_ESTIMATE_LABEL}`]);
    const card = app.querySelector('a[href="/app/reports/r-luteal"]')!;
    expect(card.textContent).not.toMatch(/·\s*luteal(?! phase, estimate)/i);
  });

  it('day 37 stays day 37 with no phase; no cycle day means no phase at all', async () => {
    await renderPage(<Dashboard />);
    expect(linesFor('r-day37')).toEqual(['Cycle day 37']);
    expect(linesFor('r-nodate')).toEqual([]);
    expect(app.querySelector('a[href="/app/reports/r-nodate"]')!.textContent).not.toMatch(/menstrual/i);
  });
});

describe('Reports list (D10)', () => {
  it('names the cycle day first and labels the phase as an estimate, in the table and on mobile', async () => {
    await renderPage(<Reports />);
    const lines = linesFor('r-luteal');
    expect(lines.length).toBeGreaterThan(0);
    for (const text of lines) expect(text).toBe(`Cycle day 21luteal phase, ${PHASE_ESTIMATE_LABEL}`);
    expect(linesFor('r-day37').every(text => text === 'Cycle day 37')).toBe(true);
    expect(linesFor('r-day37').length).toBeGreaterThan(0);
  });

  it('a stored phase with no cycle day is not shown, and no phase wears a badge or a status tint', async () => {
    await renderPage(<Reports />);
    expect(linesFor('r-nodate')).toEqual([]);
    expect(app.textContent).not.toMatch(/menstrual/i);
    for (const el of Array.from(app.querySelectorAll('[data-report-cycle-line], [data-report-cycle-line] *'))) {
      expect(el.getAttribute('class') ?? '').not.toMatch(/flag-|info|cat-|bg-|rounded-full/);
    }
    expect(app.textContent).toContain('Cycle');
  });

  it('search finds a report by its shown phase only', async () => {
    await renderPage(<Reports />);
    const input = app.querySelector<HTMLInputElement>('input[placeholder^="Search"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'menstrual');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(app.querySelector('a[href="/app/reports/r-nodate"]')).toBeNull();
    await act(async () => {
      setValue.call(input, 'luteal');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(app.querySelector('a[href="/app/reports/r-luteal"]')).not.toBeNull();
  });
});
