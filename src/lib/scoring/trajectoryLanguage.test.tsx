import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BiomarkerName, CyclePhase } from '../../types';
import { getAllEntries, getEntry } from '../biomarkers/dictionary';
import { ANALYTE_CONTEXT } from '../biomarkers/rangeContext.generated';
import { NO_CLAIM_EVIDENCE } from '../biomarkers/provenance';
import { buildInsightSummary, type BiggestChange } from '../insights/buildInsightSummary';
import { buildFocusAreas } from '../insights/buildFocusAreas';
import { YourTrajectoryCard, selectTrajectoryBullets } from '../../components/YourTrajectoryCard';
import { MENSTRUAL_PHASES, assessAmaniContext, contextFromReport } from './amaniContext';
import {
  bandLanguageByKey, compareReports, computeTrajectoryStatus, detectBoundaryCrossing, getBiggestChanges,
} from './compareReports';
import { authorizedLanguage, claimsFavourableDirection, type AuthorizedLanguage } from './insightCopy';
import { scoreBiomarker } from './scoreBiomarker';

// V2-03 amendment 4, R1: movement into an unapproved band is not "improved"
// and gets no green check. Synthetic values only.

const FAVOURABLE_STATUSES = ['improving_still_high', 'improving_still_low', 'normalized'];
const lang = (reviewStatus: AuthorizedLanguage['reviewStatus'], favourableDirection = false): AuthorizedLanguage =>
  ({ reviewStatus, reviewedWording: reviewStatus === 'SAFE', optimal: false, favourableDirection });
// Synthetic: SAFE plus directional evidence. No catalog band has this.
const AUTHORIZED = lang('SAFE', true);

const valuesFor = (key: BiomarkerName) => {
  const e = getEntry(key)!;
  const points = [e.optimal.min, e.optimal.max, e.clinical.min, e.clinical.max].filter((v): v is number => v !== null);
  return [...new Set([0.01, ...points, ...points.map(v => v * 0.8), ...points.map(v => v * 1.2), ...points.map(v => v * 3)])];
};

describe('R1 — the real catalog can never produce a favourable direction', () => {
  it('no applied band, at any phase, authorizes favourable direction wording', () => {
    for (const analyte of ANALYTE_CONTEXT) {
      for (const phase of [null, ...MENSTRUAL_PHASES]) {
        const a = assessAmaniContext(analyte.key, 1, contextFromReport(phase));
        if (a.kind !== 'scored') continue;
        expect(a.band.claims, analyte.key).toEqual(NO_CLAIM_EVIDENCE);
        expect(authorizedLanguage(a.band).favourableDirection, `${analyte.key} ${phase}`).toBe(false);
      }
    }
  });

  it('sweep: every analyte, phase and value pair — no "improved" crossing and no improving or normalized status', () => {
    let towardBand = 0;
    for (const e of getAllEntries()) {
      const values = valuesFor(e.key);
      for (const phase of [null, ...MENSTRUAL_PHASES] as (CyclePhase | null)[]) {
        for (const prev of values) {
          for (const curr of values) {
            const [d] = compareReports([{ key: e.key, value: prev, unit: 'u' }], [{ key: e.key, value: curr, unit: 'u' }], phase);
            if (!d) continue;
            expect(d.boundaryCrossing?.direction, `${e.key} ${phase} ${prev}->${curr}`).not.toBe('improved');
            expect(FAVOURABLE_STATUSES, `${e.key} ${phase} ${prev}->${curr}`).not.toContain(d.trajectoryStatus);
            expect(d.bandLanguage.favourableDirection).toBe(false);
            if (d.boundaryCrossing?.direction === 'changed' || d.trajectoryStatus?.startsWith('changed_')) towardBand++;
          }
        }
      }
    }
    // The sweep is not vacuous: it reaches the movements the old code called improvement.
    expect(towardBand).toBeGreaterThan(100);
  });

  it('the crossing carries the destination band review status', () => {
    const [d] = compareReports([{ key: 'vitamin_d_25_oh', value: 30, unit: 'ng/mL' }], [{ key: 'vitamin_d_25_oh', value: 60, unit: 'ng/mL' }]);
    expect(d?.boundaryCrossing).toMatchObject({ direction: 'changed', toReviewStatus: 'NEEDS_CONTEXT' });
    expect(d?.bandLanguage.reviewStatus).toBe('NEEDS_CONTEXT');
    const [p] = compareReports([{ key: 'progesterone', value: 1, unit: 'ng/mL' }], [{ key: 'progesterone', value: 10, unit: 'ng/mL' }], 'luteal');
    expect(p?.boundaryCrossing).toMatchObject({ direction: 'changed', toReviewStatus: 'DISPUTED' });
  });
});

describe('R1 — the favourable path exists only behind authorized language', () => {
  it('a crossing toward the band is "improved" only when the destination band authorizes it', () => {
    for (const status of ['UNKNOWN', 'DISPUTED', 'NEEDS_CONTEXT', 'SAFE', null] as const) {
      expect(detectBoundaryCrossing('borderline_high', 'optimal', lang(status))?.direction, String(status)).toBe('changed');
    }
    expect(detectBoundaryCrossing('borderline_high', 'optimal', AUTHORIZED)?.direction).toBe('improved');
    // Worsening is unaffected by R1.
    expect(detectBoundaryCrossing('optimal', 'borderline_high', lang('UNKNOWN'))?.direction).toBe('worsened');
  });

  it('trajectory statuses are favourable only under authorized language', () => {
    const run = (language: AuthorizedLanguage, prev: number, curr: number, prevS: 'out_of_range_high' | 'borderline_high', currS: 'optimal' | 'out_of_range_high') =>
      computeTrajectoryStatus(prevS, currS, prev, curr, detectBoundaryCrossing(prevS, currS, language), null, 'significant', 'tsh', null, language);
    expect(run(lang('UNKNOWN'), 3, 2, 'borderline_high', 'optimal')).toBe('changed_into_band');
    expect(run(AUTHORIZED, 3, 2, 'borderline_high', 'optimal')).toBe('normalized');
    expect(run(lang('DISPUTED'), 9, 6, 'out_of_range_high', 'out_of_range_high')).toBe('changed_still_high');
    expect(run(AUTHORIZED, 9, 6, 'out_of_range_high', 'out_of_range_high')).toBe('improving_still_high');
  });

  it('neutral movements keep their rank in the biggest-changes selection', () => {
    const [d] = compareReports([{ key: 'tsh', value: 9, unit: 'uIU/mL' }], [{ key: 'tsh', value: 6, unit: 'uIU/mL' }]);
    expect(d?.trajectoryStatus).toBe('changed_still_high');
    expect(getBiggestChanges([d!])).toHaveLength(1);
  });
});

const change = (status: BiggestChange['trajectoryStatus'], crossing: BiggestChange['boundaryCrossing'] = null): BiggestChange => ({
  key: 'tsh', displayName: 'TSH', previousValue: 3, currentValue: 2, unit: 'uIU/mL', percentDelta: -33,
  trendDirection: 'down', significance: 'significant', boundaryCrossing: crossing, trajectoryStatus: status,
  distanceToNormalImprovement: null, fact: '', priorReportDate: '2026-01-01', priorIsOlderThanImmediatePrior: false,
});
const html = (c: BiggestChange, language?: AuthorizedLanguage) => renderToStaticMarkup(
  <YourTrajectoryCard changes={[c]} primaryFinding={null} reportCount={1}
    bandLanguage={language ? new Map([['tsh', language]]) : undefined} />);
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'");

const MOVEMENTS: BiggestChange[] = [
  change('normalized', { from: 'borderline', to: 'within_band', direction: 'improved' }),
  change('changed_into_band', { from: 'borderline', to: 'within_band', direction: 'changed' }),
  change('improving_still_high'), change('improving_still_low'),
  change('changed_still_high'), change('changed_still_low'),
  change('improving_still_high', { from: 'out_of_range', to: 'borderline', direction: 'improved' }),
];

describe('R1 — the trajectory card', () => {
  it.each([['UNKNOWN'], ['DISPUTED'], ['NEEDS_CONTEXT'], ['SAFE'], [null], ['absent']] as const)(
    'review %s: neutral change language, no "improved", no green check', status => {
      const language = status === 'absent' ? undefined : lang(status);
      for (const c of MOVEMENTS) {
        const h = html(c, language);
        const t = text(h);
        expect(t, `${c.trajectoryStatus}`).not.toMatch(/improv|right direction|optimal/i);
        expect(h).not.toContain('text-theme-flag-ok');
        expect(h).toContain('data-bullet-kind="changed"');
        expect(t).toMatch(/TSH changed from /);
        if (status === 'NEEDS_CONTEXT') expect(t).toContain('More context needed.');
        if (status === 'DISPUTED') expect(t).toContain('Interpretation unavailable pending clinical review.');
        if (status === 'UNKNOWN' || status === null || status === 'absent') {
          expect(t).toContain('has not yet completed clinical review.');
        }
      }
    });

  it('the owner\'s example sentence for a crossing', () => {
    expect(text(html(MOVEMENTS[1]!, lang('UNKNOWN')))).toContain('TSH changed from its previous range classification.');
  });

  /*
    V2-03b Stage 2 replaces "only SAFE plus directional evidence restores
    improved and the green check". That authority was a boolean on the band,
    not a reviewed rule the policy can trace (OPTIMAL_TARGET and favourable
    claims need one), so no band restores it any longer.
  */
  it('even SAFE with directional evidence reads as a movement, with no green check', () => {
    for (const c of MOVEMENTS) {
      const h = html(c, AUTHORIZED);
      expect(text(h), `${c.trajectoryStatus}`).not.toMatch(/improv|right direction|better/i);
      expect(h).not.toMatch(/text-theme-flag-(?:ok|watch|low)/);
      expect(h).toContain('data-bullet-kind="changed"');
      expect(text(h)).toMatch(/TSH changed from /);
    }
  });

  it('values stay attached to neutral bullets that print both numbers (Basic panel dedupe)', () => {
    const [b] = selectTrajectoryBullets([change('changed_still_high')], null);
    expect(b?.values).toEqual({ previous: 3, current: 2, unit: 'uIU/mL' });
    expect(b?.text).toBe("TSH changed from 3 to 2 uIU/mL. Amani's comparison band for this result has not yet completed clinical review.");
  });
});

describe('R1 — downstream copy no longer sees a favourable movement', () => {
  const tsh = (value: number, reportDate?: string) => ({ key: 'tsh' as const, value, unit: 'uIU/mL', labRefMin: 0.45, labRefMax: 4.5, reportDate });

  it.each([[2.7, 2.0], [9, 6], [6, 9.5]])('TSH %s -> %s: no fact, focus area or top-finding trend says improved', (prev, curr) => {
    const summary = buildInsightSummary([tsh(curr)], [tsh(prev, '2025-12-01')], null, '2025-12-01');
    const scored = [scoreBiomarker('tsh', curr, 'uIU/mL', 0.45, 4.5, null)];
    const focus = buildFocusAreas(summary, summary.watchSignals, scored);
    const copy = [
      ...summary.biggestChanges.map(c => c.fact),
      ...focus.map(f => f.whyItMatters),
      ...summary.topFindings.map(f => f.fact),
    ].join(' ');
    expect(claimsFavourableDirection(copy)).toBe(false);
    for (const f of [summary.primaryFinding, ...summary.topFindings]) {
      if (f?.trend) expect(f.trend.interpretation).not.toBe('improved');
    }
    for (const d of summary.deltaMap.values()) expect(bandLanguageByKey([d]).get('tsh')?.favourableDirection).toBe(false);
  });
});
