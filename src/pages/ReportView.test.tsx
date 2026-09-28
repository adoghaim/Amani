// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  interpretation: null as Record<string, unknown> | null,
  access: 'generation_needed',
  regenerationCount: 0,
  invoke: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({ supabase: {
  functions: { invoke: fixture.invoke },
  from: (table: string) => {
    const result = { data: table === 'lab_reports' ? {
      id: 'report-1', status: 'complete', report_date: '2026-09-01',
      regeneration_count: fixture.regenerationCount, estimated_cycle_phase: 'unknown',
      lab_name: 'Test lab',
    } : [], error: null };
    const query = {
      select: () => query, eq: () => query, order: () => query,
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
  fixture.interpretation = null;
  fixture.access = 'generation_needed';
  fixture.regenerationCount = 0;
  fixture.invoke.mockImplementation(async (name: string) => {
    if (name === 'get-interpretation') return { data: {
      access: fixture.access, interpretation: fixture.interpretation, stored_depth: 'shallow',
    }, error: null };
    // Auto-generation can fail; the initial-generation presentation must remain.
    return { data: null, error: new Error('offline') };
  });
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
  fixture.invoke.mockReset();
});
async function renderReport() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/reports/report-1']}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
}

it('uses Generate analysis for generation_needed without a stored interpretation', async () => {
  await renderReport();
  expect(app.textContent).not.toContain('Regenerate (');
  expect(Array.from(app.querySelectorAll('button')).some(b => b.textContent === 'Generate analysis')).toBe(true);
  expect(fixture.invoke).toHaveBeenCalledWith('get-interpretation', expect.anything());
});

it.each(['generation_needed', 'basic'])('keeps the remaining regeneration label for a stored non-deep row (%s)', async access => {
  fixture.access = access;
  fixture.interpretation = { headline: 'Stored analysis', summary: 'Existing result' };
  fixture.regenerationCount = 1;
  await renderReport();
  expect(app.textContent).toContain('Regenerate (2 left)');
  expect(fixture.invoke.mock.calls.filter(([name]) => name === 'generate-interpretation')).toHaveLength(0);
});
