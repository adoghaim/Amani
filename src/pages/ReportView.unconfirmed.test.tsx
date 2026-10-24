// @vitest-environment jsdom
/**
 * F022 on the report page: a value Amani may have misread that she has not
 * confirmed (report_analytes.needs_review, low confidence or printed below a
 * limit, not reviewed_by_user) never picks her primary finding, is no trend
 * point and asks no question about a change, in this report or as history.
 * Safety copy still shows for it, marked unconfirmed. Synthetic rows only.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb, type Row } from '../lib/fetchAllRows.fake';
import type { SafetyRule } from '../lib/scoring/insightCopy';

const fixture = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  auth: { user: { id: 'user-1' }, userProfile: null },
  subscription: {
    entitled: true, source: 'trial', loading: false, plan: 'premium',
    complimentary: { used: 0, total: 3, remaining: 3 }, refetch: () => {},
  },
  trajectory: [] as { changes: { key: string; previousValue: number }[]; primaryFinding: { key: string } | null }[],
  baselineCalls: [] as { entries: unknown[]; current: unknown }[],
  focusAreas: [] as { relatedMarkers: { slug: string }[] }[][],
  guidanceCards: [] as unknown[][],
  flaggedSlugs: [] as (string[] | undefined)[],
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
vi.mock('../components/SubscriptionStatus', () => ({ SubscriptionStatus: () => null }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/freemium/PremiumPaywall', () => ({ PremiumPaywall: () => null }));
vi.mock('../components/YourTrajectoryCard', () => ({
  YourTrajectoryCard: (props: { changes: { key: string; previousValue: number }[]; primaryFinding: { key: string } | null }) => {
    fixture.trajectory.push(props);
    return null;
  },
}));
// What the page hands its focus areas, Support plan and recommended labs (finding 2 of the IA2 review).
vi.mock('../components/FocusAreas', () => ({
  FocusAreas: (props: { focusAreas: { relatedMarkers: { slug: string }[] }[] }) => { fixture.focusAreas.push(props.focusAreas); return null; },
}));
vi.mock('../components/GuidanceCards', () => ({
  GuidanceCards: (props: { cards: unknown[] }) => { fixture.guidanceCards.push(props.cards); return null; },
}));
vi.mock('../components/RecommendedLabs', () => ({
  RecommendedLabs: (props: { flaggedSlugs?: string[] }) => { fixture.flaggedSlugs.push(props.flaggedSlugs); return null; },
}));
vi.mock('../lib/personalization/baseline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/personalization/baseline')>();
  return {
    ...actual,
    computeBaseline: ((entries: unknown[], current: unknown, ...rest: unknown[]) => {
      fixture.baselineCalls.push({ entries, current });
      return (actual.computeBaseline as (...a: unknown[]) => unknown)(entries, current, ...rest);
    }) as typeof actual.computeBaseline,
  };
});
// No safety rule is approved today; one synthetic rule shows how the channel treats her unconfirmed value.
vi.mock('../lib/scoring/insightCopy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/scoring/insightCopy')>();
  const rule: SafetyRule = {
    ruleId: 'synthetic-tsh', version: '1', analyte: 'tsh',
    approval: { approvedBy: 'synthetic fixture', approvedAt: '2026-10-23', evidenceId: 'SYNTHETIC-ONLY' },
    evaluate: value => value < 0.01 ? { cue: 'critical', text: 'Synthetic safety text for a test.' } : null,
  };
  return { ...actual, evaluateSafetyRules: (measured: Parameters<typeof actual.evaluateSafetyRules>[0]) => actual.evaluateSafetyRules(measured, [rule]) };
});

import { ReportView } from './ReportView';

const report = (id: string, report_date: string) => ({
  id, user_id: 'user-1', report_date, status: 'complete', estimated_cycle_phase: 'unknown',
  lab_name: 'Synthetic lab', created_at: `${report_date}T00:00:00Z`, regeneration_count: 0,
});
type Value = [reportId: string, slug: string, value: number, unit: string, min: number, max: number];
const biomarker = ([reportId, name, value, unit, min, max]: Value, i: number): Row => ({
  id: `${reportId}-${i}`, lab_report_id: reportId, name, value, raw_value_text: String(value), unit,
  reference_min: min, reference_max: max, flagged: 'in_range',
});
const analyte = ([reportId, slug, value, unit, min, max]: Value, i: number, review: Row): Row => ({
  id: `a-${reportId}-${i}`, lab_report_id: reportId, raw_name: slug, raw_value_text: String(value), value_numeric: value, unit,
  raw_reference_range: `${min}-${max}`, normalized_min: min, normalized_max: max, normalized_operator: null,
  normalized_operator_value: null, source_snippet: null, canonical_analyte_id: null, canonical_slug: slug,
  parse_status: 'mapped', is_core: true, normalization_status: 'mapped', source_format: 'text',
  confidence_score: 'high', needs_review: false, reviewed_by_user: false, review_status: 'pending', ...review,
});
/** Each value is saved twice, as NewReport saves it; `unconfirmed` marks the analytes rows she never confirmed. */
function account(reports: Row[], values: Value[], unconfirmed: (v: Value) => boolean) {
  return createFakeDb({
    lab_reports: reports,
    biomarkers: values.map(biomarker),
    report_analytes: values.map((v, i) => analyte(v, i, unconfirmed(v) ? { needs_review: true, confidence_score: 'low' } : {})),
    interpretations: [],
  });
}

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', '');
  fixture.trajectory = [];
  fixture.baselineCalls = [];
  fixture.focusAreas = [];
  fixture.guidanceCards = [];
  fixture.flaggedSlugs = [];
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

async function open(reportId: string) {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/app/reports/${reportId}`]}>
      <Routes><Route path="/app/reports/:id" element={<ReportView />} /></Routes>
    </MemoryRouter>,
  ));
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const latestTrajectory = () => fixture.trajectory[fixture.trajectory.length - 1];
const baselinesFor = (value: number) => fixture.baselineCalls.filter(c => c.current === value);

describe('ReportView with a value she has not confirmed (F022)', () => {
  // TSH 0.0008 is the most deviated value, so it would lead; Ferritin 8 is below its lab interval too.
  const current: Value[] = [['current', 'tsh', 0.0008, 'mIU/L', 0.4, 4.5], ['current', 'ferritin', 8, 'ng/mL', 16, 154]];
  const isTsh0008 = ([, slug, value]: Value) => slug === 'tsh' && value === 0.0008;

  it('the primary finding is a confirmed value, not her unconfirmed one', async () => {
    fixture.db = account([report('current', '2026-09-01')], current, isTsh0008);
    await open('current');
    expect(latestTrajectory()?.primaryFinding?.key).toBe('ferritin');
    expect(app.querySelector('[data-testid="primary-finding"]')?.textContent).toContain('Ferritin');
  });

  it('control: once she has confirmed it, that value may lead', async () => {
    fixture.db = account([report('current', '2026-09-01')], current, () => false);
    await open('current');
    expect(latestTrajectory()?.primaryFinding?.key).toBe('tsh');
  });

  // IA2 review wave 2, finding 3: before IA2, typing her value left reviewed_by_user false.
  it('a value she corrected before reviewed_by_user was recorded (legacy edited_by_user) counts as confirmed', async () => {
    fixture.db = createFakeDb({
      lab_reports: [report('current', '2026-09-01')],
      biomarkers: current.map(biomarker),
      report_analytes: current.map((v, i) => analyte(v, i, isTsh0008(v)
        ? { needs_review: true, confidence_score: 'low', reviewed_by_user: false, review_status: 'edited_by_user' } : {})),
      interpretations: [],
    });
    await open('current');
    expect(latestTrajectory()?.primaryFinding?.key).toBe('tsh');
  });

  it('her unconfirmed value is no trend point in this report: no change, no baseline', async () => {
    fixture.db = account(
      [report('p1', '2026-03-01'), report('p2', '2026-06-01'), report('current', '2026-09-01')],
      [['p1', 'tsh', 2.2, 'mIU/L', 0.4, 4.5], ['p2', 'tsh', 2.4, 'mIU/L', 0.4, 4.5], ...current],
      isTsh0008,
    );
    await open('current');
    expect(latestTrajectory()?.changes.map(c => c.key)).not.toContain('tsh');
    expect(baselinesFor(0.0008)).toEqual([]);
  });

  it('an unconfirmed value in an earlier report is no trend point either', async () => {
    fixture.db = account(
      [report('p1', '2026-03-01'), report('p2', '2026-05-01'), report('p3', '2026-07-01'), report('current', '2026-09-01')],
      [
        ['p1', 'tsh', 2.2, 'mIU/L', 0.4, 4.5], ['p2', 'tsh', 2.6, 'mIU/L', 0.4, 4.5],
        ['p3', 'tsh', 0.0008, 'mIU/L', 0.4, 4.5], ['current', 'tsh', 2, 'mIU/L', 0.4, 4.5],
      ],
      isTsh0008,
    );
    await open('current');
    // The baseline sees her two confirmed readings; any change is measured from May's, not from 0.0008.
    expect(baselinesFor(2).map(c => c.entries)).toEqual([[{ date: '2026-03-01', value: 2.2 }, { date: '2026-05-01', value: 2.6 }]]);
    expect(latestTrajectory()?.changes.find(c => c.key === 'tsh')?.previousValue).not.toBe(0.0008);
  });

  it('safety copy still shows for her unconfirmed value, marked as unconfirmed', async () => {
    fixture.db = account([report('current', '2026-09-01')], current, isTsh0008);
    await open('current');
    const alert = app.querySelector('[data-safety-rule="synthetic-tsh"]');
    expect(alert?.textContent).toContain('Synthetic safety text for a test.');
    expect(alert?.textContent).toContain("You haven't confirmed this value. Check it against your report.");
  });

  describe('focus areas, Support plan cards and recommended labs (IA2 review, finding 2)', () => {
    // Ferritin 8 sits outside its band and would open a Nutrients focus area and card; TSH 2 sits inside.
    const values: Value[] = [['current', 'tsh', 2, 'mIU/L', 0.4, 4.5], ['current', 'ferritin', 8, 'ng/mL', 16, 154]];
    const isFerritin8 = ([, slug, value]: Value) => slug === 'ferritin' && value === 8;
    const last = <T,>(calls: T[]) => calls[calls.length - 1];
    const focusSlugs = () => (last(fixture.focusAreas) ?? []).flatMap(a => a.relatedMarkers.map(m => m.slug));
    const cardIds = () => (last(fixture.guidanceCards) ?? []).map(c => (c as { id: string }).id);

    it('her unconfirmed value opens no focus area, no Support plan card and flags no lab', async () => {
      fixture.db = account([report('current', '2026-09-01')], values, isFerritin8);
      await open('current');
      expect(focusSlugs()).not.toContain('ferritin');
      expect(cardIds()).not.toContain('nutrient_sufficiency');
      expect(last(fixture.flaggedSlugs) ?? []).not.toContain('ferritin');
    });

    it('control: once she has confirmed it, that value does', async () => {
      fixture.db = account([report('current', '2026-09-01')], values, () => false);
      await open('current');
      expect(focusSlugs()).toContain('ferritin');
      expect(cardIds()).toContain('nutrient_sufficiency');
      expect(last(fixture.flaggedSlugs)).toContain('ferritin');
    });
  });

  /*
    IA2 review wave 2, finding 4: the headline Amani writes from its own data
    names no value she has not confirmed, and does not hide it behind an
    all-clear either.
  */
  describe('the report headline', () => {
    const headline = () => app.querySelector('h2.text-lg')?.textContent ?? '';

    it('names her confirmed out-of-band value, not her unconfirmed one', async () => {
      fixture.db = account([report('current', '2026-09-01')], current, isTsh0008);
      await open('current');
      expect(headline()).toContain('Ferritin');
      expect(headline()).not.toContain('TSH');
    });

    it('with only her unconfirmed value out of band, names nothing and claims no all-clear', async () => {
      fixture.db = account(
        [report('current', '2026-09-01')],
        [['current', 'tsh', 0.0008, 'mIU/L', 0.4, 4.5], ['current', 'ferritin', 40, 'ng/mL', 16, 154]],
        isTsh0008,
      );
      await open('current');
      expect(headline()).not.toContain('TSH');
      expect(headline()).not.toContain('All scored values');
    });

    it('control: once she has confirmed it, the headline names it', async () => {
      fixture.db = account([report('current', '2026-09-01')], current, () => false);
      await open('current');
      expect(headline()).toContain('TSH');
    });

    /*
      #152 x F022: the headline speaks the lab's own range for a lab-flagged
      value. HDL 61 sits above its lab's range and inside its Amani band, so
      with her HDL unconfirmed an all-clear in Amani's bands would hide it.
    */
    describe('her unconfirmed value outside its lab range, inside its Amani band', () => {
      const values: Value[] = [['current', 'hdl_cholesterol', 61, 'mg/dL', 40, 60], ['current', 'ferritin', 40, 'ng/mL', 16, 154]];
      const isHdl = ([, slug]: Value) => slug === 'hdl_cholesterol';

      it('names nothing and claims no all-clear', async () => {
        fixture.db = account([report('current', '2026-09-01')], values, isHdl);
        await open('current');
        expect(headline()).not.toContain('HDL');
        expect(headline()).not.toContain('All scored values');
      });

      it("control: once she has confirmed it, the headline names it in her lab's words", async () => {
        fixture.db = account([report('current', '2026-09-01')], values, () => false);
        await open('current');
        expect(headline()).toContain("HDL is above your lab's reference range at 61 mg/dL.");
      });
    });
  });

  it('control: a confirmed value\'s safety copy carries no such mark', async () => {
    fixture.db = account([report('current', '2026-09-01')], current, () => false);
    await open('current');
    const alert = app.querySelector('[data-safety-rule="synthetic-tsh"]');
    expect(alert?.textContent).toContain('Synthetic safety text for a test.');
    expect(alert?.textContent).not.toContain("You haven't confirmed this value.");
  });
});
