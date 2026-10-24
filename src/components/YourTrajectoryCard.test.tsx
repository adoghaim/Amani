import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { YourTrajectoryCard, selectTrajectoryBullets } from './YourTrajectoryCard';
import { buildInsightSummary, type BiggestChange } from '../lib/insights/buildInsightSummary';
import { BOUNDARY_BUCKET_LABEL, bandLanguageByKey, boundaryBucketLabel, compareReports } from '../lib/scoring/compareReports';
import type { AuthorizedLanguage } from '../lib/scoring/insightCopy';

// Synthetic: a SAFE band WITH directional evidence. No catalog band has this.
const AUTHORIZED: AuthorizedLanguage = { reviewStatus: 'SAFE', reviewedWording: true, optimal: false, favourableDirection: true };

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
  const rank = { significant: 0, moderate: 1, minor: 2, unassessed: 2 };
  const withBullet = input.filter(c => c.trajectoryStatus !== 'stable_normal');
  return withBullet.map((c, i) => ({ key: c.key, significance: input[i]!.significance }))
    .sort((a, b) => rank[a.significance] - rank[b.significance])
    .slice(0, 4).map(x => x.key);
}

// V2-03 amendment 2 (B2). Synthetic values only. TSH 2.7 -> 2.0 crosses from
// borderline into the (unreviewed) Amani band: the exact reviewer reproduction.
describe('B2 — a boundary crossing never prints "optimal" for an unreviewed band', () => {
  const tsh = (value: number, reportDate?: string) => ({ key: 'tsh' as const, value, unit: 'mIU/L', labRefMin: 0.45, labRefMax: 4.5, reportDate });

  it('the bucket for optimal and normal statuses is "within_band", never "optimal"', () => {
    const [delta] = compareReports([tsh(2.7)], [tsh(2.0)], null);
    // Amendment 4 R1: was direction 'improved'. The destination band is UNKNOWN,
    // so the crossing is 'changed' and carries that review status.
    expect(delta?.boundaryCrossing).toEqual({ from: 'borderline', to: 'within_band', direction: 'changed', toReviewStatus: 'UNKNOWN' });
    expect(delta?.trajectoryStatus).toBe('changed_into_band');
    expect(Object.keys(BOUNDARY_BUCKET_LABEL).sort()).toEqual(['borderline', 'out_of_range', 'within_band']);
    for (const label of Object.values(BOUNDARY_BUCKET_LABEL)) expect(label).not.toMatch(/optimal/i);
    expect(boundaryBucketLabel('optimal')).toBeNull();
  });

  it('the real compare -> summary -> card chain renders neutral wording', () => {
    const summary = buildInsightSummary([tsh(2.0)], [tsh(2.7, '2025-12-01')], null, '2025-12-01');
    const html = renderToStaticMarkup(<YourTrajectoryCard changes={summary.biggestChanges} primaryFinding={summary.primaryFinding}
      reportCount={1} bandLanguage={bandLanguageByKey(summary.deltaMap.values())} />);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'");
    // Amendment 4 R1: was "TSH improved from borderline to within the Amani band."
    // Now the owner's neutral wording, plus the band's review state.
    expect(text).toContain("TSH changed from its previous range classification. Amani's comparison band for this result has not yet completed clinical review.");
    expect(text).not.toMatch(/optimal/i);
    expect(text).not.toMatch(/improv/i);
    expect(html).not.toContain('text-theme-flag-ok');
    expect(html).toContain('data-bullet-kind="changed"');
    // The summary's own fact line carries the bucket too; it must not say optimal either.
    expect(summary.biggestChanges.map(c => c.fact).join(' ')).not.toMatch(/optimal/i);
  });

  it('every trajectory sentence avoids "optimal", in any casing', () => {
    const statuses = ['improving_still_high', 'improving_still_low', 'worsening_still_high', 'worsening_still_low',
      'newly_abnormal', 'stable_abnormal', 'normalized'] as const;
    for (const status of statuses) {
      const c = { ...change('tsh', status, 'significant'),
        boundaryCrossing: status === 'normalized' ? { from: 'out_of_range', to: 'within_band', direction: 'improved' } : null };
      const [bullet] = selectTrajectoryBullets([c], null);
      expect(bullet?.text, status).toBeDefined();
      expect(bullet!.text, status).not.toMatch(/optimal/i);
    }
  });

  it('a bucket it does not recognise is never echoed', () => {
    const c = { ...change('tsh', 'normalized', 'significant'), boundaryCrossing: { from: 'out_of_range', to: 'optimal', direction: 'improved' } };
    // V2-03b: no crossing sentence names a bucket, even under synthetic authority.
    const [bullet] = selectTrajectoryBullets([c], null, new Map([['tsh', AUTHORIZED]]));
    expect(bullet?.text).toBe("tsh changed from its previous range classification. This compares your result with Amani's reviewed comparison band.");
    const [neutral] = selectTrajectoryBullets([c], null);
    expect(neutral?.text).not.toMatch(/optimal|improv/i);
  });
});

describe('YourTrajectoryCard ordering is unchanged from base', () => {
  it('renders bullets in the base order, including the index-pairing quirk', () => {
    const expected = baseOrder(changes);
    expect(expected).toEqual(['ferritin', 'vitamin_d_25_oh', 'fasting_glucose', 'ldl_cholesterol']);
    const html = renderToStaticMarkup(<YourTrajectoryCard changes={changes} primaryFinding={null} reportCount={2} />);
    // Policy observations may be nested spans; inspect the actual visible text.
    const visible = html.replace(/<[^>]+>/g, ' ');
    const rendered = [...visible.matchAll(/([a-z0-9_]+) (?:has|have) (?:risen|dropped) /g)].map(m => m[1]);
    expect(html).not.toMatch(/text-theme-flag-(?:watch|ok)/);
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
