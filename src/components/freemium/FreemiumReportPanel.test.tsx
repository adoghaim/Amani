import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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

  it('falls back to the hook figure when the response carries none', () => {
    const full = parseInterpretationAccess({ access: 'full', interpretation: { headline: 'H' }, plan: 'free' });
    expect(render(full, { complimentaryUsed: 2 })).toContain('Premium Analysis 2 of 3 included');
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
    const full = parseInterpretationAccess({ access: 'full', interpretation: { headline: 'H' }, plan: 'free' });
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
