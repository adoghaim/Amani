import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BiggestChangesCard } from './BiggestChangesCard';
import type { BiggestChange } from '../lib/insights/buildInsightSummary';

// V2-03 amendment 2 (B2). Not rendered by ReportView today; guarded so it
// cannot regress if reconnected. Synthetic values only.
const change = (key: BiggestChange['key'], trajectoryStatus: BiggestChange['trajectoryStatus'],
  boundaryCrossing: BiggestChange['boundaryCrossing'] = null): BiggestChange => ({
  key, displayName: key, previousValue: 10, currentValue: 20, unit: 'u', percentDelta: 100,
  trendDirection: 'up', significance: 'significant', boundaryCrossing, trajectoryStatus,
  distanceToNormalImprovement: null, fact: '', priorReportDate: '2026-03-01', priorIsOlderThanImmediatePrior: false,
});

const render = (changes: BiggestChange[]) => renderToStaticMarkup(<BiggestChangesCard changes={changes} />).replace(/<[^>]+>/g, ' ');

describe('BiggestChangesCard never calls an Amani band "optimal"', () => {
  it('names crossings with the neutral bucket labels', () => {
    const text = render([
      change('tsh', 'normalized', { from: 'borderline', to: 'within_band', direction: 'improved' }),
      change('ferritin', 'newly_abnormal', { from: 'within_band', to: 'out_of_range', direction: 'worsened' }),
    ]);
    expect(text).toContain('Improved from borderline to within the Amani band');
    expect(text).toContain('Moved from within the Amani band to outside the Amani band');
    expect(text).not.toMatch(/optimal/i);
  });

  it('every trajectory subtitle and summary line avoids the word', () => {
    for (const status of ['improving_still_high', 'improving_still_low', 'worsening_still_high', 'worsening_still_low'] as const) {
      expect(render([change('tsh', status), change('ferritin', status)]), status).not.toMatch(/optimal/i);
    }
    expect(render([change('tsh', 'newly_abnormal', { from: 'within_band', to: 'out_of_range', direction: 'worsened' }),
      change('ferritin', 'stable_abnormal')])).not.toMatch(/optimal/i);
  });

  it('an unrecognised bucket is never echoed', () => {
    const text = render([change('tsh', 'normalized', { from: 'out_of_range', to: 'optimal', direction: 'improved' })]);
    expect(text).not.toMatch(/optimal/i);
  });
});
