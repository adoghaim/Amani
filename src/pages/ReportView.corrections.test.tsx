// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  PK-CORRECT-01 on the real ReportView: the R18 read path, DESIGN.md
  provenance on the report, and R19's stale mark with its refresh, which goes
  through generate-interpretation as a new version (a fresh request_id) and
  never spends a "Regenerate (N left)". ReportView.test.tsx and
  ReportView.language.test.tsx are unchanged.
*/

const OLD = '2026-10-01T09:00:00.000Z';
const CORRECTED = '2026-10-01T10:05:00.000Z';
const NEW = '2026-10-01T10:06:00.000Z';

const fixture = vi.hoisted(() => ({
  flagOn: true,
  generatedAt: '',
  tables: [] as string[],
  invoke: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../lib/runtimeConfig', () => ({
  isFeatureEnabled: (name: string) => fixture.flagOn && name === 'value_corrections',
}));

vi.mock('../lib/supabase', () => {
  const report = { id: 'report-1', user_id: 'user-1', status: 'complete', report_date: '2026-09-01',
    regeneration_count: 0, estimated_cycle_phase: 'unknown', lab_name: 'Synthetic lab' };
  const ferritinRow = { id: 'b-1', lab_report_id: 'report-1', name: 'ferritin', value: 450, unit: 'ng/mL',
    reference_min: 15, reference_max: 150, flagged: 'out_of_range', raw_value_text: '450' };
  const correctedFerritin = { ...ferritinRow, value: 45, flagged: 'in_range', raw_value_text: '45.0',
    original_value: 450, original_raw_text: '450', original_unit: 'ng/mL', is_corrected: true, corrected_at: '2026-10-01T10:05:00.000Z' };
  const analyteRow = { id: 'ra-1', lab_report_id: 'report-1', raw_name: 'Ferritin', raw_value_text: '450', value_numeric: 450,
    unit: 'ng/mL', raw_reference_range: '15-150', normalized_min: 15, normalized_max: 150, normalized_operator: null,
    normalized_operator_value: null, source_snippet: null, confidence_score: 'high', canonical_analyte_id: null,
    canonical_slug: 'ferritin', parse_status: 'mapped', needs_review: false, is_core: true, created_at: '2026-09-01' };
  const correctedAnalyte = { ...analyteRow, raw_value_text: '45.0', value_numeric: 45, flagged: 'in_range',
    original_value: 450, original_raw_text: '450', original_unit: 'ng/mL', is_corrected: true, corrected_at: '2026-10-01T10:05:00.000Z' };
  const data = (table: string, columns: string): unknown => {
    switch (table) {
      case 'lab_reports': return columns === '*' ? report : [];
      case 'biomarkers': return [ferritinRow];
      case 'biomarkers_corrected': return [correctedFerritin];
      case 'report_analytes': return [analyteRow];
      case 'report_analytes_corrected': return [correctedAnalyte];
      case 'interpretations': return { id: 'interp-1', lab_report_id: 'report-1', tier: 'plus', generated_at: fixture.generatedAt,
        json_output: { headline: 'Synthetic headline', summary: 'Synthetic summary', disclaimer: 'x' } };
      default: return [];
    }
  };
  return { supabase: {
    functions: { invoke: fixture.invoke },
    from: (table: string) => {
      fixture.tables.push(table);
      let columns = '*';
      const result = () => ({ data: data(table, columns), error: null });
      const query = {
        select: (c: string) => { columns = c; return query; },
        update: (values: Record<string, unknown>) => { fixture.update(table, values); return query; },
        eq: () => query, in: () => query, lt: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  } };
});
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({
  entitled: true, plan: 'premium', complimentary: null, refetch: vi.fn(),
}) }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { ReportView } from './ReportView';

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'false');
  fixture.flagOn = true;
  fixture.generatedAt = OLD;
  fixture.tables = [];
  fixture.invoke.mockResolvedValue({ data: { success: true, version: { id: 'v-2', generated_at: NEW } }, error: null });
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
const stale = () => app.querySelector('[data-stale-explanation]');
const refreshButton = () => Array.from(app.querySelectorAll('[data-stale-explanation] button'))
  .find(b => b.textContent?.includes('Refresh explanation')) as HTMLButtonElement | undefined;

describe('ReportView with features.value_corrections on', () => {
  it('reads the corrected views and marks the corrected value: hers in pen, the misread value struck through', async () => {
    await renderReport();
    expect(fixture.tables).toContain('biomarkers_corrected');
    expect(fixture.tables).toContain('report_analytes_corrected');
    expect(fixture.tables).not.toContain('biomarkers');
    // Health Systems start collapsed: open Nutrients.
    const nutrients = Array.from(app.querySelectorAll('button')).filter(b => b.textContent?.startsWith('Nutrients')).pop()!;
    await act(async () => nutrients.click());
    const card = app.querySelector('article[aria-label="Ferritin result"]')!;
    expect(card.querySelector('.font-mono.text-xl')?.textContent).toBe('45.0');
    expect(card.querySelector('.font-mono.text-xl')?.className).toContain('text-theme-pen');
    const mark = card.querySelector('[data-correction-mark]')!;
    expect(mark.textContent).toContain('You corrected this value');
    expect(mark.querySelector('del')?.textContent).toBe('450 ng/mL');
  });

  it('R19: marks the explanation written before the correction, and a refresh appends a version and clears it', async () => {
    await renderReport();
    expect(stale()?.textContent).toContain('This explanation was written before you corrected a value');
    // The explanation itself stays on screen, below the mark.
    expect(app.textContent).toContain('Amani analysis');

    fixture.generatedAt = NEW;
    await act(async () => refreshButton()!.click());
    const calls = fixture.invoke.mock.calls.filter(([name]) => name === 'generate-interpretation');
    expect(calls).toHaveLength(1);
    const body = (calls[0]![1] as { body: Record<string, unknown> }).body;
    expect(body.reportId).toBe('report-1');
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    // Not a "Regenerate (N left)": the count is untouched (Adell's pending D20 ruling; proposed default no).
    expect(fixture.update).not.toHaveBeenCalledWith('lab_reports', expect.objectContaining({ regeneration_count: expect.anything() }));
    expect(stale()).toBeNull();
  });

  it('R19: a refused or failed refresh keeps the explanation marked and offers it again with a new request', async () => {
    fixture.invoke.mockResolvedValue({ data: null, error: new Error('daily limit') });
    await renderReport();
    await act(async () => refreshButton()!.click());
    expect(stale()?.textContent).toContain("We couldn't refresh it just now. Your corrected value is saved.");
    fixture.invoke.mockResolvedValue({ data: { success: true, version: { id: 'v-2', generated_at: NEW } }, error: null });
    fixture.generatedAt = NEW;
    await act(async () => refreshButton()!.click());
    const ids = fixture.invoke.mock.calls.filter(([name]) => name === 'generate-interpretation')
      .map(([, options]) => (options as { body: { request_id: string } }).body.request_id);
    expect(ids).toHaveLength(2);
    expect(stale()).toBeNull();
  });

  it('with the flag off, reads the raw tables and shows no mark at all', async () => {
    fixture.flagOn = false;
    await renderReport();
    expect(fixture.tables).toContain('biomarkers');
    expect(fixture.tables).not.toContain('biomarkers_corrected');
    expect(app.querySelector('[data-correction-mark]')).toBeNull();
    expect(stale()).toBeNull();
  });
});
