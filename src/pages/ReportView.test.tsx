// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  interpretation: null as Record<string, unknown> | null,
  access: 'generation_needed',
  regenerationCount: 0,
  invoke: vi.fn(),
  update: vi.fn(),
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
      update: (values: Record<string, unknown>) => { fixture.update(table, values); return query; },
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
vi.mock('../components/freemium/PremiumPaywall', () => ({ PremiumPaywall: ({ open }: { open: boolean }) => open ? <div role="dialog">Premium paywall</div> : null }));
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
  fixture.update.mockReset();
});
async function renderReport() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/reports/report-1']}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
}

it('offers one first-generation action without spending a regeneration', async () => {
  await renderReport();
  expect(app.textContent).not.toContain('Regenerate (');
  const buttons = Array.from(app.querySelectorAll('button')).filter(b => b.textContent === 'Generate analysis');
  expect(buttons).toHaveLength(1);
  fixture.invoke.mockClear();
  await act(async () => buttons[0]!.click());
  expect(fixture.invoke).toHaveBeenCalledWith('generate-interpretation', {
    body: { reportId: 'report-1', primary_canonical_slug: null },
  });
  expect(fixture.invoke.mock.calls.filter(([name]) => name === 'generate-interpretation')).toHaveLength(1);
  expect(fixture.update).not.toHaveBeenCalledWith('lab_reports', expect.objectContaining({ regeneration_count: expect.anything() }));
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

it.each(['generation_needed', 'basic'])('keeps the regeneration cap for a stored row (%s)', async access => {
  fixture.access = access;
  fixture.interpretation = { headline: 'Stored analysis', summary: 'Existing result' };
  fixture.regenerationCount = 3;
  await renderReport();
  expect(app.textContent).not.toContain('Regenerate (');
});

it('does not open the paywall when first generation returns 402', async () => {
  await renderReport();
  fixture.invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(new Response(null, { status: 402 })) });
  const button = Array.from(app.querySelectorAll('button')).find(b => b.textContent === 'Generate analysis');
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(Array.from(app.querySelectorAll('button')).filter(b => b.textContent === 'Generate analysis')).toHaveLength(0);
  expect(app.querySelector('[role="dialog"]')).toBeNull();
  expect(app.textContent).not.toContain('Regenerate (');
  expect(fixture.update).not.toHaveBeenCalledWith('lab_reports', expect.objectContaining({ regeneration_count: expect.anything() }));
});
