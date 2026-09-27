import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { YourTrajectoryCard, selectTrajectoryBullets } from './YourTrajectoryCard';
import type { BiggestChange } from '../lib/insights/buildInsightSummary';

const change = (key: BiggestChange['key'], trajectoryStatus: BiggestChange['trajectoryStatus'],
  significance: BiggestChange['significance']): BiggestChange => ({
  key, displayName: key, previousValue: 10, currentValue: 20, unit: 'u', percentDelta: 100,
  trendDirection: 'up', significance, boundaryCrossing: null, trajectoryStatus,
  distanceToNormalImprovement: null, fact: '', priorReportDate: '2026-03-01', priorIsOlderThanImmediatePrior: false,
});

// A filtered-out change first, then mixed significance: the case where the base
// card's bullets[i]/changes[i] pairing matters.
const changes = [
  change('hdl_cholesterol', 'stable_normal', 'significant'),
  change('ferritin', 'worsening_still_low', 'minor'),
  change('tsh', 'worsening_still_high', 'moderate'),
  change('ldl_cholesterol', 'worsening_still_high', 'significant'),
  change('vitamin_d_25_oh', 'worsening_still_low', 'significant'),
  change('fasting_glucose', 'worsening_still_high', 'significant'),
];

/** The base (610beef) ordering, restated independently: every bullet here is
 * worsened and none is primary, so only the paired significance decides. */
function baseOrder(input: BiggestChange[]) {
  const rank = { significant: 0, moderate: 1, minor: 2 };
  const withBullet = input.filter(c => c.trajectoryStatus !== 'stable_normal');
  return withBullet.map((c, i) => ({ key: c.key, significance: input[i]!.significance }))
    .sort((a, b) => rank[a.significance] - rank[b.significance])
    .slice(0, 4).map(x => x.key);
}

describe('YourTrajectoryCard ordering is unchanged from base', () => {
  it('renders bullets in the base order, including the index-pairing quirk', () => {
    const expected = baseOrder(changes);
    expect(expected).toEqual(['ferritin', 'vitamin_d_25_oh', 'fasting_glucose', 'ldl_cholesterol']);
    const html = renderToStaticMarkup(<YourTrajectoryCard changes={changes} primaryFinding={null} reportCount={2} />);
    const rendered = [...html.matchAll(/<p[^>]*>([a-z0-9_]+) (?:has|have) /g)].map(m => m[1]);
    expect(rendered).toEqual(expected);
    expect(selectTrajectoryBullets(changes, null).map(b => b.key)).toEqual(expected);
  });
  it('attaches values only to bullets that print both numbers', () => {
    const [bullet] = selectTrajectoryBullets([change('ferritin', 'worsening_still_low', 'minor')], null);
    expect(bullet?.values).toEqual({ previous: 10, current: 20, unit: 'u' });
    const [stable] = selectTrajectoryBullets([change('ferritin', 'stable_abnormal', 'minor')], null);
    expect(stable).toBeDefined();
    expect(stable?.values).toBeUndefined();
  });
});
