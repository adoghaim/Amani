// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REGENERATION_COPY, type RegenerationNoticeKind } from '../lib/regenerationFailure';
import { PRODUCT_DISCLAIMERS } from '../lib/scoring/insightCopy';

/*
  PK-PL-A, Adell's pre-launch rulings (b) and (c), on the real ReportView in
  both flag states, against a stateful fake Supabase: every lab_reports write
  is recorded and applied, so a re-read shows what the page left behind.

  (b) A regenerate that fails wrote nothing on the server (see
      supabase/functions/_shared/regeneration-failure.handler.test.ts), so it
      spends no attempt and never brands the report "error": the status and the
      attempt the tap spent optimistically are put back, the analysis stays on
      screen, and a calm notice says what happened.
  (c) Flag on, the Regenerate action is hidden when get-interpretation says a
      regeneration cannot succeed for this viewer.
*/

type Reply = { data: unknown; error: unknown };
const fixture = vi.hoisted(() => ({
  report: {} as Record<string, unknown>,
  /** Flag off: the `interpretations` view row's body (null: none stored). */
  stored: null as Record<string, unknown> | null,
  /** Flag on: the get-interpretation answer. */
  access: {} as Record<string, unknown>,
  generate: null as unknown as (body: Record<string, unknown>) => Promise<Reply>,
  updates: [] as Record<string, unknown>[],
  generateBodies: [] as Record<string, unknown>[],
  reads: 0,
  subscription: { entitled: true, plan: 'premium' as 'premium' | 'free', complimentary: { used: 0, total: 3, remaining: 3 } },
}));

vi.mock('../lib/supabase', () => ({ supabase: {
  functions: {
    invoke: async (name: string, options: { body: Record<string, unknown> }) => {
      if (name === 'get-interpretation') { fixture.reads += 1; return { data: fixture.access, error: null }; }
      if (name === 'generate-interpretation') { fixture.generateBodies.push(options.body); return fixture.generate(options.body); }
      return { data: null, error: null };
    },
  },
  from: (table: string) => {
    const row = () => table === 'lab_reports' ? { ...fixture.report }
      : table === 'interpretations' && fixture.stored
        ? { id: 'interp-1', lab_report_id: 'report-1', json_output: fixture.stored, tier: 'plus' } : null;
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'lt', 'order', 'limit', 'in']) query[method] = () => query;
    query.update = (values: Record<string, unknown>) => {
      if (table === 'lab_reports') { fixture.updates.push(values); Object.assign(fixture.report, values); }
      return query;
    };
    query.maybeSingle = async () => ({ data: row(), error: null });
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return query;
  },
} }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({ ...fixture.subscription, refetch: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ userProfile: null }) }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/freemium/PremiumPaywall', () => ({
  PremiumPaywall: ({ open }: { open: boolean }) => open ? <div role="dialog">Premium paywall</div> : null,
}));
import { ReportView } from './ReportView';

const http = (status: number, body: unknown = null) =>
  ({ data: null, error: new FunctionsHttpError(new Response(body === null ? null : JSON.stringify(body), { status })) });
const OUTCOMES: { label: string; reply: () => Reply; notice: RegenerationNoticeKind; retry: boolean }[] = [
  { label: '503 regeneration_failed, retryable', reply: () => http(503, { error: 'regeneration_failed', retryable: true }), notice: 'retryable', retry: true },
  { label: '503 regeneration_failed, not retryable', reply: () => http(503, { error: 'regeneration_failed', retryable: false }), notice: 'unavailable', retry: false },
  { label: '409 legacy_history_protected', reply: () => http(409, { error: 'legacy_history_protected' }), notice: 'already_saved', retry: false },
  { label: '400 request_id_required', reply: () => http(400, { error: 'request_id_required' }), notice: 'unavailable', retry: false },
  { label: '500 Failed to save interpretation', reply: () => http(500, { error: 'Failed to save interpretation' }), notice: 'retryable', retry: true },
  { label: '503 entitlement_unavailable', reply: () => http(503, { code: 'entitlement_unavailable', retryable: true }), notice: 'retryable', retry: true },
  { label: 'network failure (no answer)', reply: () => ({ data: null, error: new FunctionsFetchError(new Error('offline')) }), notice: 'retryable', retry: true },
  { label: '200 without success', reply: () => ({ data: { success: false }, error: null }), notice: 'retryable', retry: true },
];

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.report = { id: 'report-1', status: 'ready', report_date: '2026-09-01', regeneration_count: 0,
    estimated_cycle_phase: 'unknown', lab_name: 'Synthetic lab' };
  fixture.stored = { headline: 'Stored synthetic analysis', summary_bullets: [], disclaimer: 'Synthetic fixture.' };
  fixture.access = {};
  fixture.generate = async () => ({ data: { success: true }, error: null });
  fixture.updates = [];
  fixture.generateBodies = [];
  fixture.reads = 0;
  fixture.subscription = { entitled: true, plan: 'premium', complimentary: { used: 0, total: 3, remaining: 3 } };
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

async function renderReport() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/reports/report-1']}>
      <Routes>
        <Route path="/app/reports/:id" element={<ReportView />} />
        <Route path="/pricing" element={<div>Synthetic pricing page</div>} />
      </Routes>
    </MemoryRouter>,
  ));
}
const buttons = (pattern: RegExp) => Array.from(app.querySelectorAll('button')).filter(b => pattern.test(b.textContent ?? ''));
const button = (pattern: RegExp) => {
  const found = buttons(pattern);
  expect(found, String(pattern)).toHaveLength(1);
  return found[0]!;
};
const text = () => app.textContent ?? '';
const last = <T,>(items: T[]) => items[items.length - 1];
const branded = () => fixture.updates.filter(u => u.status === 'error');
const analysisOnScreen = () => text().includes(PRODUCT_DISCLAIMERS.report.text);

describe('PK-PL-A (b), flag off: a failed regenerate spends nothing and brands nothing', () => {
  beforeEach(() => { vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'false'); });

  it.each(OUTCOMES)('$label: attempt and status put back, analysis kept, calm notice', async ({ reply, notice, retry }) => {
    fixture.report.regeneration_count = 1;
    fixture.generate = async () => reply();
    await renderReport();
    expect(analysisOnScreen()).toBe(true);
    await act(async () => button(/^Regenerate \(2 left\)$/).click());

    expect(fixture.generateBodies).toHaveLength(1);
    expect(fixture.generateBodies[0]!.request_id).toMatch(/^[0-9a-f-]{36}$/);
    // The optimistic spend, then exactly the values it replaced: no attempt consumed.
    expect(fixture.updates[0]).toEqual({ status: 'processing', regeneration_count: 2 });
    expect(last(fixture.updates)).toEqual({ status: 'ready', regeneration_count: 1 });
    expect(branded()).toEqual([]);
    expect(fixture.report).toMatchObject({ status: 'ready', regeneration_count: 1 });
    // The page shows the same remaining count and the analysis it had.
    expect(buttons(/^Regenerate \(2 left\)$/)).toHaveLength(1);
    expect(analysisOnScreen()).toBe(true);
    expect(text()).toContain(REGENERATION_COPY[notice].title);
    expect(text()).toContain(REGENERATION_COPY[notice].body);
    expect(text()).not.toContain('AI summary failed');
    expect(buttons(/^Try again$/)).toHaveLength(retry ? 1 : 0);
  });

  it('the retry re-sends the same request and, on success, spends exactly one attempt', async () => {
    fixture.report.regeneration_count = 1;
    fixture.generate = async () => http(503, { error: 'regeneration_failed', retryable: true });
    await renderReport();
    await act(async () => button(/^Regenerate \(2 left\)$/).click());
    fixture.generate = async () => ({ data: { success: true }, error: null });
    await act(async () => button(/^Try again$/).click());
    expect(fixture.generateBodies[1]!.request_id).toBe(fixture.generateBodies[0]!.request_id);
    expect(fixture.report).toMatchObject({ status: 'processing', regeneration_count: 2 });
    expect(branded()).toEqual([]);
    expect(text()).not.toContain(REGENERATION_COPY.retryable.title);
    expect(buttons(/^Regenerate \(1 left\)$/)).toHaveLength(1);
  });

  it('402: the attempt and status are put back before the redirect to pricing', async () => {
    fixture.generate = async () => http(402, { error: 'subscription_required', reason: 'trial_expired' });
    await renderReport();
    await act(async () => button(/^Regenerate \(3 left\)$/).click());
    expect(last(fixture.updates)).toEqual({ status: 'ready', regeneration_count: 0 });
    expect(branded()).toEqual([]);
    expect(text()).toContain('Synthetic pricing page');
  });

  it('429: the daily-limit notice shows over the stored analysis too, nothing spent', async () => {
    fixture.generate = async () => http(429, { error: 'Synthetic daily limit message.' });
    await renderReport();
    await act(async () => button(/^Regenerate \(3 left\)$/).click());
    expect(last(fixture.updates)).toEqual({ status: 'ready', regeneration_count: 0 });
    expect(text()).toContain('Synthetic daily limit message.');
    expect(branded()).toEqual([]);
  });

  it('a thrown failure is handled like no answer', async () => {
    fixture.generate = async () => { throw new Error('synthetic transport failure'); };
    await renderReport();
    await act(async () => button(/^Regenerate \(3 left\)$/).click());
    expect(last(fixture.updates)).toEqual({ status: 'ready', regeneration_count: 0 });
    expect(branded()).toEqual([]);
    expect(text()).toContain(REGENERATION_COPY.retryable.title);
  });

  it('with no analysis to keep (the first analysis failed), the report stays marked failed but the attempt is put back', async () => {
    fixture.stored = null;
    fixture.report.status = 'error';
    // The page's own first-analysis attempt fails, which offers the retry card.
    fixture.generate = async () => http(500, { error: 'Internal server error' });
    await renderReport();
    expect(text()).toContain('AI summary failed');
    fixture.updates = [];
    await act(async () => button(/^Retry summary \(3 of 3 left\)$/).click());
    expect(fixture.updates[0]).toEqual({ status: 'processing', regeneration_count: 1 });
    expect(last(fixture.updates)).toEqual({ status: 'error', regeneration_count: 0 });
    expect(buttons(/^Retry summary \(3 of 3 left\)$/)).toHaveLength(1);
    expect(text()).not.toContain(REGENERATION_COPY.retryable.title);
  });

  it('control: a successful regenerate spends one attempt and shows no notice', async () => {
    await renderReport();
    await act(async () => button(/^Regenerate \(3 left\)$/).click());
    expect(fixture.updates).toEqual([{ status: 'processing', regeneration_count: 1 }]);
    expect(text()).not.toContain(REGENERATION_COPY.retryable.title);
  });
});

describe('PK-PL-A, flag on', () => {
  const stored = { headline: 'Stored synthetic analysis', summary: 'Existing result' };
  beforeEach(() => {
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true');
    fixture.subscription = { entitled: false, plan: 'free', complimentary: { used: 3, total: 3, remaining: 0 } };
    fixture.access = { access: 'basic', interpretation: stored, stored_depth: 'standard', plan: 'free',
      complimentary: { used: 3, total: 3, remaining: 0 }, regeneration: { available: true, reason: null } };
  });

  it('(c) Free post-limit: no Regenerate action when the server says it cannot succeed', async () => {
    fixture.access = { ...fixture.access, regeneration: { available: false, reason: 'introductory_access_exhausted' } };
    await renderReport();
    expect(text()).toContain('Basic insights');
    expect(buttons(/Regenerate/)).toHaveLength(0);
    expect(fixture.generateBodies).toHaveLength(0);
  });

  it('(c) offered when the server says it can succeed, and when an older server says nothing', async () => {
    await renderReport();
    expect(buttons(/^Regenerate \(3 left\)$/)).toHaveLength(1);
    await act(async () => root.unmount());
    root = createRoot(app);
    const { regeneration: _absent, ...older } = fixture.access;
    fixture.access = older;
    await renderReport();
    expect(buttons(/^Regenerate \(3 left\)$/)).toHaveLength(1);
  });

  it('(c) a refusal the server calls final hides the action: re-read, no retry, nothing spent', async () => {
    fixture.generate = async () => {
      // The availability the server reports from now on (e.g. a claim settled elsewhere).
      fixture.access = { ...fixture.access, regeneration: { available: false, reason: 'introductory_access_exhausted' } };
      return http(503, { error: 'regeneration_failed', retryable: false });
    };
    await renderReport();
    const readsBefore = fixture.reads;
    await act(async () => button(/^Regenerate \(3 left\)$/).click());
    expect(last(fixture.updates)).toEqual({ status: 'ready', regeneration_count: 0 });
    expect(branded()).toEqual([]);
    expect(fixture.reads).toBeGreaterThan(readsBefore);
    expect(text()).toContain(REGENERATION_COPY.unavailable.title);
    expect(buttons(/^Try again$/)).toHaveLength(0);
    expect(buttons(/Regenerate/)).toHaveLength(0);
  });

  it.each(OUTCOMES.filter(o => o.notice !== 'unavailable' || o.label.startsWith('400')))(
    '$label: attempt and status put back, calm notice', async ({ reply, notice, retry }) => {
      fixture.generate = async () => reply();
      await renderReport();
      await act(async () => button(/^Regenerate \(3 left\)$/).click());
      expect(fixture.updates[0]).toEqual({ status: 'processing', regeneration_count: 1 });
      expect(last(fixture.updates)).toEqual({ status: 'ready', regeneration_count: 0 });
      expect(branded()).toEqual([]);
      expect(text()).toContain(REGENERATION_COPY[notice].title);
      expect(buttons(/^Try again$/)).toHaveLength(retry ? 1 : 0);
      expect(text()).toContain('Basic insights');
    });

  it('the fuller-analysis offer on a stored body is keyed (no 400) and spends no attempt; a failure says the analysis is unchanged', async () => {
    fixture.subscription = { entitled: true, plan: 'premium', complimentary: { used: 0, total: 3, remaining: 3 } };
    fixture.access = { access: 'generation_needed', interpretation: stored, stored_depth: 'standard', plan: 'premium',
      regeneration: { available: true, reason: null } };
    fixture.generate = async body => typeof body.request_id === 'string'
      ? http(503, { error: 'regeneration_failed', retryable: true })
      : http(400, { error: 'request_id_required' });
    await renderReport();
    await act(async () => button(/^Generate full Amani analysis$/).click());
    expect(fixture.generateBodies).toHaveLength(1);
    expect(fixture.generateBodies[0]!.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fixture.updates).toEqual([]);
    expect(text()).toContain(REGENERATION_COPY.retryable.title);
    // The offer itself is the way to try again; the notice carries no second button.
    expect(buttons(/^Try again$/)).toHaveLength(0);
    expect(buttons(/^Generate full Amani analysis$/)).toHaveLength(1);
  });
});
