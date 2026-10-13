// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { phaseStyle } from '../lib/cyclePhase';

/*
  PK-FIX-02 (campaign fix c): the report header named the recorded cycle phase
  in the flag-low alert palette (red), as if the phase were a finding. It now
  wears the phase's own colours, the same tokens as the cycle dial
  (src/lib/cyclePhase.ts). Synthetic report row only.
*/
const fixture = vi.hoisted(() => ({ phase: 'unknown' }));
vi.mock('../lib/supabase', () => ({ supabase: {
  functions: {
    invoke: async (name: string) => (name === 'get-interpretation'
      ? { data: { access: 'generation_needed', interpretation: null, stored_depth: 'shallow' }, error: null }
      : { data: null, error: new Error('offline') }),
  },
  from: (table: string) => {
    const result = { data: table === 'lab_reports' ? {
      id: 'report-1', status: 'complete', report_date: '2026-09-01', regeneration_count: 0,
      estimated_cycle_phase: fixture.phase, lab_name: 'Synthetic lab',
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

async function renderReport(phase: string) {
  fixture.phase = phase;
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/reports/report-1']}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

const pill = () => app.querySelector<HTMLElement>('[data-testid="report-phase-pill"]');
const ALERT_OR_STATUS = /flag-(?:ok|watch|low)|theme-(?:warning|success|danger)/;

describe('report header phase pill (PK-FIX-02)', () => {
  it.each(['menstrual', 'follicular', 'ovulatory', 'luteal', 'pregnancy_t2'] as const)(
    '%s: the pill wears that phase\'s colours, never the alert palette', async phase => {
      await renderReport(phase);
      expect(app.textContent).toContain('Lab Report:');
      expect(pill()?.textContent).toBe(`${phase.replace(/_/g, ' ')} phase`);
      const classes = pill()!.className.split(/\s+/);
      expect(classes).toContain(phaseStyle(phase).surface);
      expect(classes).toContain(phaseStyle(phase).text);
      expect(pill()!.className).not.toMatch(ALERT_OR_STATUS);
    });

  it('a report with no recorded phase shows no pill', async () => {
    await renderReport('unknown');
    expect(app.textContent).toContain('Lab Report:');
    expect(pill()).toBeNull();
  });

  it('negative control: the check sees the palette this packet removed', () => {
    expect('inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-theme-flag-low-bg border border-theme-flag-low-border text-theme-flag-low capitalize')
      .toMatch(ALERT_OR_STATUS);
  });
});
