// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { phaseStyle } from '../lib/cyclePhase';
import { PHASE_ESTIMATE_LABEL } from '../lib/cycleDayRule';

/*
  PK-FIX-02 (campaign fix c): the report header named the recorded cycle phase
  in the flag-low alert palette (red), as if the phase were a finding.

  Merge train (#110 onto #106): PK-FIX-06-EXT (owner decision D10) removed the
  header pill altogether. The header now names the phase only in the report's
  cycle line (ReportCycleLine), after the cycle day and labelled as an
  estimate, in plain and muted ink. PK-FIX-02's invariant is kept against that
  line: the phase in the header never wears the alert palette, a status tint or
  an unpatterned phase tint, and it is never a pill. Synthetic report row only.
*/
const fixture = vi.hoisted(() => ({ phase: 'unknown', day: null as number | null }));
vi.mock('../lib/supabase', () => ({ supabase: {
  functions: {
    invoke: async (name: string) => (name === 'get-interpretation'
      ? { data: { access: 'generation_needed', interpretation: null, stored_depth: 'shallow' }, error: null }
      : { data: null, error: new Error('offline') }),
  },
  from: (table: string) => {
    const result = { data: table === 'lab_reports' ? {
      id: 'report-1', status: 'complete', report_date: '2026-09-01', regeneration_count: 0,
      estimated_cycle_phase: fixture.phase, estimated_cycle_day: fixture.day, lab_name: 'Synthetic lab',
    } : [], error: null };
    const query = {
      update: () => query, select: () => query, eq: () => query, order: () => query,
      maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  },
} }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({
  entitled: false, plan: 'free', complimentary: { used: 3, total: 3, remaining: 0 }, refetch: vi.fn(),
}) }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/freemium/PremiumPaywall', () => ({ PremiumPaywall: () => null }));
import { ReportView } from './ReportView';

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true');
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

async function renderReport(phase: string, day: number | null = null) {
  fixture.phase = phase;
  fixture.day = day;
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/reports/report-1']}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

const pill = () => app.querySelector<HTMLElement>('[data-testid="report-phase-pill"]');
const cycleLine = () => app.querySelector<HTMLElement>('[data-report-cycle-line]');
const ALERT_OR_STATUS = /flag-(?:ok|watch|low)|theme-(?:warning|success|danger)/;
/** Every class on the header cycle line and everything inside it. */
const lineClasses = () => [cycleLine()!, ...cycleLine()!.querySelectorAll<HTMLElement>('*')]
  .map(el => el.getAttribute('class') ?? '').join(' ');

describe('report header phase (PK-FIX-02, carried onto the D10 cycle line)', () => {
  it.each([['menstrual', 3], ['follicular', 9], ['ovulatory', 14], ['luteal', 21]] as const)(
    '%s: the phase is named in the cycle line, never as a pill and never in the alert palette', async (phase, day) => {
      await renderReport(phase, day);
      expect(app.textContent).toContain('Lab Report:');
      expect(pill()).toBeNull();
      expect(cycleLine()?.querySelector('[data-report-cycle-phase]')?.textContent)
        .toBe(`${phase} phase, ${PHASE_ESTIMATE_LABEL}`);
      const classes = lineClasses();
      expect(classes).not.toMatch(ALERT_OR_STATUS);
      // DESIGN.md: a phase tint never appears without its pattern, so the line carries no tint fill.
      expect(classes.split(/\s+/)).not.toContain(phaseStyle(phase).surface);
      expect(classes).not.toMatch(/bg-theme-phase-/);
      expect(classes).not.toMatch(/rounded-full/);
    });

  it('pregnancy_t2: no pill and no phase in the header', async () => {
    await renderReport('pregnancy_t2', 21);
    expect(app.textContent).toContain('Lab Report:');
    expect(pill()).toBeNull();
    expect(app.querySelector('[data-report-cycle-phase]')).toBeNull();
  });

  it('a report with no recorded phase shows no pill', async () => {
    await renderReport('unknown');
    expect(app.textContent).toContain('Lab Report:');
    expect(pill()).toBeNull();
    expect(app.querySelector('[data-report-cycle-phase]')).toBeNull();
  });

  it('negative control: the check sees the palette this packet removed', () => {
    expect('inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-theme-flag-low-bg border border-theme-flag-low-border text-theme-flag-low capitalize')
      .toMatch(ALERT_OR_STATUS);
  });
});
