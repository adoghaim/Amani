import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FocusAreas } from '../../components/FocusAreas';
import * as context from '../scoring/amaniContext';
import { reviewStatement } from '../scoring/insightCopy';
import { scoreBiomarker } from '../scoring/scoreBiomarker';
import { buildInsightSummary, type BiggestChange } from './buildInsightSummary';
import { buildFocusAreas } from './buildFocusAreas';

const forbidden = /wrong direction|right direction|worsen|deteriorat|improv|better|worse|healthier|worth discussing|talk to your doctor|seek care/i;
const cases: { name: string; previous: number; current: number; status: BiggestChange['trajectoryStatus']; crossing: BiggestChange['boundaryCrossing'] }[] = [
  { name: 'worsening_still_high', previous: 6, current: 9, status: 'worsening_still_high', crossing: null },
  { name: 'worsening_still_low', previous: 0.5, current: 0.1, status: 'worsening_still_low', crossing: null },
  { name: 'newly_abnormal', previous: 2, current: 6, status: 'newly_abnormal', crossing: null },
  { name: 'worsened crossing', previous: 2, current: 6, status: 'newly_abnormal', crossing: { from: 'within_band', to: 'out_of_range', direction: 'worsened' } },
];
const assess = context.assessAmaniContext;
const tsh = (value: number) => ({ key: 'tsh' as const, value, unit: 'mIU/L', labRefMin: 0.45, labRefMax: 4.5 });

afterEach(() => vi.restoreAllMocks());

describe.each(['UNKNOWN', 'DISPUTED', 'NEEDS_CONTEXT'] as const)('focus-area movement against %s', review_status => {
  it.each(cases)('$name is an observation, including in the rendered focus card', ({ previous, current, status, crossing }) => {
    // Synthetic review metadata only. Numeric bands/thresholds are untouched.
    vi.spyOn(context, 'assessAmaniContext').mockImplementation((...args) => {
      const result = assess(...args);
      return result.kind !== 'scored' ? result : {
        ...result, band: { ...result.band, provenance: { ...result.band.provenance, review_status } },
      };
    });
    const summary = buildInsightSummary([tsh(current)], [tsh(previous)], null, '2025-12-01');
    expect(summary.deltaMap.get('tsh')?.bandLanguage.reviewStatus).toBe(review_status);
    expect(summary.biggestChanges).toHaveLength(1);
    // Exercise every legacy producer input independently, including status-only
    // newly_abnormal (a crossing must not hide that switch branch in the proof).
    Object.assign(summary.biggestChanges[0]!, { trajectoryStatus: status, boundaryCrossing: crossing });
    const areas = buildFocusAreas(summary, [], [scoreBiomarker('tsh', current, 'mIU/L', 0.45, 4.5)]);
    expect(areas).toHaveLength(1);
    expect(areas[0]!.id).toBe('thyroid');
    expect(areas[0]!.whyItMatters).not.toMatch(forbidden);
    expect(areas[0]!.whyItMatters).toContain('TSH has changed since your prior report.');
    const html = renderToStaticMarkup(<FocusAreas focusAreas={areas} />);
    expect(html).toContain('Thyroid function');
    expect(html).toContain('TSH has changed since your prior report.');
    expect(html).not.toMatch(forbidden);
    const statement = reviewStatement(summary.deltaMap.get('tsh')!.bandLanguage, 'outside');
    const requiredDisclosure = {
      UNKNOWN: 'This band has not yet completed clinical review.',
      DISPUTED: 'Interpretation unavailable pending clinical review.',
      NEEDS_CONTEXT: "More context needed. Amani's comparison band for this result has not yet completed clinical review.",
    }[review_status];
    expect(statement).toContain(requiredDisclosure);
    // Compare rendered text first: the negative control must fail on the card.
    expect(html.replace(/&#x27;/g, "'")).toContain(statement);
    expect(areas[0]!.whyItMatters).toContain(statement);
    expect(html).not.toMatch(/remains outside/i);
    if (review_status === 'DISPUTED') {
      expect(html).not.toMatch(/(?:outside|within|inside|above|below).*?(?:band|range)/i);
    }
  });
});

it('R4 uses calculated magnitude, never a raw stable status as proof of no significant change', () => {
  for (const [current, expected] of [[6.1, 'has not changed significantly'], [9, 'has changed since your prior report']] as const) {
    const summary = buildInsightSummary([tsh(current)], [tsh(6)], null, '2025-12-01');
    summary.biggestChanges[0]!.trajectoryStatus = 'stable_abnormal';
    const [area] = buildFocusAreas(summary, [], [scoreBiomarker('tsh', current, 'mIU/L', 0.45, 4.5)]);
    expect(area!.whyItMatters).toContain(`TSH ${expected}.`);
    expect(area!.whyItMatters).not.toMatch(/unchanged|safe|healthy|reassur/i);
  }
});
