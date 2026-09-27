import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { YourTrajectoryCard } from '../YourTrajectoryCard';
import type { BiggestChange, InsightSummary } from '../../lib/insights/buildInsightSummary';
import { FreemiumReportPanel } from './FreemiumReportPanel';
import { parseInterpretationAccess, type InterpretationAccessResult } from '../../lib/freemium/interpretationAccess';

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

function render(state: InterpretationAccessResult | null, extra: Partial<Parameters<typeof FreemiumReportPanel>[0]> = {}) {
  return text(renderToStaticMarkup(
    <FreemiumReportPanel state={state} generating={false} plan="free" complimentaryUsed={1}
      onRetry={noop} onGenerate={noop} onOpenPaywall={noop} {...extra} />,
  ));
}

const basic = parseInterpretationAccess({
  access: 'basic',
  interpretation: { headline: 'Your panel', basic_interpretation: 'Two markers sit outside range.' },
  preview: { kind: 'cross_marker', content: { title: 'Iron and energy', explanation: 'Ferritin tracks with fatigue.' } },
  locked: { patterns: 3, cross_report: 1, lifestyle: 0 },
  plan: 'free', complimentary: { used: 1, total: 3, remaining: 2 }, stored_depth: 'standard',
});

describe('FreemiumReportPanel per access state', () => {
  it('basic: Basic interpretation, exactly one Premium Preview, locked cards, upgrade banner, counter', () => {
    const out = render(basic);
    expect(out).toContain('Two markers sit outside range.');
    expect(out.match(/Premium Preview/g)).toHaveLength(1);
    expect(out).toContain('Iron and energy');
    expect(out).toContain('3 additional patterns found');
    expect(out).toContain('Cross-report relationship available');
    expect(out).toContain('Unlock Premium');
    expect(out).toContain('2 complimentary Premium analyses remaining');
  });

  it('basic (post-limit): only the exhausted line — never "Premium Analysis N of 3 included"', () => {
    const exhausted = { ...basic, complimentary: { used: 3, total: 3, remaining: 0 } };
    const out = render(exhausted, { complimentaryUsed: 3 });
    expect(out).toContain("You've used your 3 complimentary Premium analyses. Future reports still include Basic insights and Premium Previews.");
    expect(out).not.toMatch(/Premium Analysis \d of 3 included/);
    expect(out).toContain('Premium Preview');
    expect(out).toContain('3 additional patterns found');
  });

  it('full: the counter uses get-interpretation\'s read-time figure over the stale hook (the claim this report consumed)', () => {
    const full = (used: number) => parseInterpretationAccess({
      access: 'full', interpretation: { headline: 'H' }, plan: 'free',
      complimentary: { used, total: 3, remaining: 3 - used }, stored_depth: 'deep',
    });
    const first = render(full(1), { complimentaryUsed: 0 });
    expect(first).toContain('Premium Analysis 1 of 3 included');
    expect(first).toContain('2 complimentary Premium analyses remaining');
    expect(first).not.toContain('Every Amani account includes 3 complimentary Premium analyses.');

    const third = render(full(3), { complimentaryUsed: 2 });
    expect(third).toContain('Premium Analysis 3 of 3 included');
    expect(third).toContain("You've used your 3 complimentary Premium analyses. Future reports still include Basic insights and Premium Previews.");
  });

  it('legacy Full without a ledger figure does not show a claim counter or paywall', () => {
    const full = parseInterpretationAccess({ access: 'full', interpretation: { headline: 'H' }, plan: 'free' });
    expect(render(full, { complimentaryUsed: 2 }).trim()).toBe('');
    expect(render({ ...full, plan: null }, { complimentaryUsed: 2 }).trim()).toBe('');
  });

  it('basic without preview or locked findings renders neither', () => {
    const out = render({ ...basic, preview: null, locked: { patterns: 0, cross_report: 0, lifestyle: 0 } });
    expect(out).not.toContain('Premium Preview');
    expect(out).not.toContain('additional pattern');
    expect(out).not.toContain('Cross-report');
  });

  it('locked cards are buttons (they open the paywall on tap)', () => {
    const html = renderToStaticMarkup(
      <FreemiumReportPanel state={basic} generating={false} plan="free" complimentaryUsed={1}
        onRetry={noop} onGenerate={noop} onOpenPaywall={noop} />);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>.*3 additional patterns found/);
  });

  it('full: no preview, no locked cards, no upgrade; counter only for a Free account', () => {
    const full = parseInterpretationAccess({ access: 'full', interpretation: { headline: 'H' }, plan: 'free',
      complimentary: { used: 2, total: 3, remaining: 1 } });
    const freeOut = render(full, { complimentaryUsed: 2 });
    expect(freeOut).toContain('Premium Analysis 2 of 3 included');
    expect(freeOut).not.toMatch(/Premium Preview|Unlock Premium|additional pattern/);
    expect(render(full, { plan: 'premium' }).trim()).toBe('');
  });

  it('error: retryable error state — never a paywall, never Free', () => {
    const out = render(parseInterpretationAccess({ access: 'error', code: 'entitlement_unavailable', retryable: true }));
    expect(out).toContain("We couldn't load your analysis");
    expect(out).toContain('Try again');
    expect(out).not.toMatch(/Premium|Unlock|Free|complimentary/i);
  });

  it('error: a rate limit explains itself without a retry button', () => {
    const out = render(parseInterpretationAccess({ access: 'error', code: 'rate_limit_exceeded', retryable: false }));
    expect(out).toContain("today's limit");
    expect(out).not.toContain('Try again');
  });

  it('generation_needed without a body: the generate action', () => {
    const out = render(parseInterpretationAccess({ access: 'generation_needed', interpretation: null, plan: 'free' }));
    expect(out).toContain('Generate analysis');
    expect(out).not.toMatch(/Unlock Premium|Premium Preview/);
  });

  it('generation_needed with a stored shallow body: the full-analysis offer', () => {
    const out = render(parseInterpretationAccess({ access: 'generation_needed', interpretation: { headline: 'H' }, plan: 'premium' }));
    expect(out).toContain('Generate full Amani analysis');
  });

  it('generating shows progress instead of any state', () => {
    expect(render(basic, { generating: true })).toContain('Generating your analysis');
  });

  it('hides the counter when neither the response nor the ledger read has a figure', () => {
    expect(render({ ...basic, complimentary: null }, { complimentaryUsed: null })).not.toMatch(/complimentary|of 3 included/);
  });
});

const trend = (slug: string, marker = slug) => ({ biomarker_slug: slug, marker,
  previous_value: 10, current_value: 20, unit: 'u', previous_date: '2026-03-01',
  direction: 'increased', status: 'attention', summary: 'SERVER_INTERNAL_NARRATIVE' });
const withTrends = (entries: unknown[]) => ({ ...basic,
  interpretation: { ...basic.interpretation, flagged_trends: entries } });
const change = (key: BiggestChange['key'], trajectoryStatus: BiggestChange['trajectoryStatus']): BiggestChange => ({
  key, displayName: key, previousValue: 10, currentValue: 20, unit: 'u', percentDelta: 100,
  trendDirection: 'up', significance: 'significant', boundaryCrossing: null, trajectoryStatus,
  distanceToNormalImprovement: null, fact: '', priorReportDate: '2026-03-01', priorIsOlderThanImmediatePrior: false,
});
const floorWith = (biggestChanges: BiggestChange[]): InsightSummary => ({ biggestChanges,
  primaryFinding: null, topFindings: [], deltaMap: new Map(), systemSummaries: [],
  questionsForDoctor: [], watchSignals: [], confidence: { score: 1, label: 'high', reasons: [],
    coverageCount: 1, totalCount: 1, normalizationRate: 1, parserQuality: 'high', sourceFormat: 'text' } });

describe('Basic abnormal changes', () => {
  it('renders every values line, direction and prior date, never summary or extra locked counts', () => {
    const state = withTrends([trend('ferritin', 'Ferritin'), trend('tsh', 'TSH')]);
    const out = render(state);
    expect(out).toContain('Changes since your last report');
    expect(out).toContain('Ferritin: 10 → 20 u · increased · 2026-03-01');
    expect(out).toContain('TSH: 10 → 20 u · increased · 2026-03-01');
    expect(out).not.toContain('SERVER_INTERNAL_NARRATIVE');
    expect(out.match(/Premium Preview/g)).toHaveLength(1);
    expect(out).toContain('3 additional patterns found');
    expect(state.locked).toEqual(basic.locked);
  });
  it('absence or an empty key preserves existing markup', () => {
    expect(render(withTrends([]))).toBe(render(basic));
  });
  it('Full ignores the Basic-only field', () => {
    const out = render({ ...withTrends([trend('ferritin')]), access: 'full' });
    expect(out).not.toMatch(/ferritin|SERVER_INTERNAL|increased/);
  });
  it('deduplicates by slug, never by display label, and tolerates malformed entries', () => {
    const out = render(withTrends([trend('ferritin'), trend('ferritin', 'Duplicate'), trend('tsh', 'ferritin'),
      null, false, 'bad', {}, { ...trend('hdl'), previous_value: null, current_value: 0, unit: null }]));
    expect(out.match(/ferritin: 10 → 20/g)).toHaveLength(2);
    expect(out).not.toContain('Duplicate');
    expect(out).toContain('hdl: — → 0');
  });
  it('deduplicates only selected bullets that render both matching values, with mixed significance after filtering', () => {
    const changes = [change('hdl_cholesterol', 'stable_normal'),
      { ...change('ferritin', 'worsening_still_low'), significance: 'minor' as const },
      { ...change('tsh', 'worsening_still_high'), significance: 'moderate' as const },
      change('ldl_cholesterol', 'worsening_still_high'), change('vitamin_d_25_oh', 'worsening_still_low'),
      change('fasting_glucose', 'worsening_still_high')];
    const trajectory = text(renderToStaticMarkup(<YourTrajectoryCard changes={changes} primaryFinding={null} reportCount={2} />));
    const out = render(withTrends(changes.map(c => trend(c.key))), { floorSummary: floorWith(changes) });
    let kept = 0;
    for (const c of changes) {
      // Prove the competing surface contains the two values, not just the name.
      if (trajectory.includes(`${c.key} has risen from 10 to 20 u`) || trajectory.includes(`${c.key} has dropped from 10 to 20 u`)) {
        expect(out).not.toContain(`${c.key}:`);
      } else {
        kept += 1;
        expect(out).toContain(`${c.key}: 10 → 20`);
      }
    }
    // The filtered-out change and the fifth-ranked change keep their lines.
    expect(kept).toBe(2);
    expect(out).toContain('hdl_cholesterol: 10 → 20');
  });
  it.each(['stable_abnormal', 'newly_abnormal', 'normalized'] as const)('keeps %s lines when the real card does not display both values', status => {
    const c = { ...change('ferritin', status), ...(status === 'normalized' ? {
      boundaryCrossing: { direction: 'improved' as const, from: 'out_of_range' as const, to: 'optimal' as const },
    } : {}) };
    const trajectory = text(renderToStaticMarkup(<YourTrajectoryCard changes={[c]} primaryFinding={null} reportCount={2} />));
    expect(trajectory).toContain('ferritin');
    expect(trajectory).not.toContain('10 to 20');
    expect(render(withTrends([trend('ferritin')]), { floorSummary: floorWith([c]) })).toContain('ferritin: 10 → 20');
  });
  it('keeps boundary-only improving text, mismatched values and mismatched units', () => {
    for (const c of [
      { ...change('ferritin', 'improving_still_low'), boundaryCrossing: { direction: 'improved' as const, from: 'out_of_range' as const, to: 'borderline' as const } },
      { ...change('ferritin', 'improving_still_low'), previousValue: 11 },
      { ...change('ferritin', 'improving_still_low'), currentValue: 21 },
      { ...change('ferritin', 'improving_still_low'), unit: 'other' },
    ]) {
      const trajectory = text(renderToStaticMarkup(<YourTrajectoryCard changes={[c]} primaryFinding={null} reportCount={2} />));
      expect(trajectory).not.toContain('from 10 to 20 u');
      expect(render(withTrends([trend('ferritin')]), { floorSummary: floorWith([c]) })).toContain('ferritin: 10 → 20');
    }
  });
  it.each(['improving_still_low', 'improving_still_high', 'worsening_still_low', 'worsening_still_high'] as const)('suppresses matching %s only with proof in the real card', status => {
    const c = change('ferritin', status);
    const trajectory = text(renderToStaticMarkup(<YourTrajectoryCard changes={[c]} primaryFinding={null} reportCount={2} />));
    expect(trajectory).toContain('from 10 to 20 u');
    expect(render(withTrends([trend('ferritin')]), { floorSummary: floorWith([c]) })).not.toContain('ferritin:');
  });
});
