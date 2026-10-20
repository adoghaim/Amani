import { describe, expect, it } from 'vitest';
import { buildHealthStory } from '../insights/buildHealthStory';
import { buildInsightSummary, type BiggestChange } from '../insights/buildInsightSummary';
import type { FocusArea } from '../insights/buildFocusAreas';
import type { TrajectoryStatus } from './compareReports';
import { primaryTrajectory, withBandReview } from './healthStoryTrajectory';
import { authorizedLanguage, claimsFavourableDirection, reviewStatement, type AuthorizedLanguage } from './insightCopy';

// V2-03 amendment 5: R1's neutral statuses fell through to 'unchanged', so a
// TSH that fell from 9 to 6 read "is unchanged from your prior report".
// Synthetic values only.

// A Record over the union: adding a TrajectoryStatus fails typecheck here
// until the sweep below covers it.
const STATUS_TABLE: Record<NonNullable<TrajectoryStatus>, true> = {
  improving_still_high: true, improving_still_low: true,
  worsening_still_high: true, worsening_still_low: true,
  normalized: true, newly_abnormal: true, stable_abnormal: true, stable_normal: true,
  changed_into_band: true, changed_still_high: true, changed_still_low: true,
};
const STATUSES: TrajectoryStatus[] = [...(Object.keys(STATUS_TABLE) as NonNullable<TrajectoryStatus>[]), null];
// Every BoundaryCrossing direction, no crossing, and one this code does not know.
const DIRECTIONS = [undefined, 'improved', 'worsened', 'changed', 'sideways'] as const;

const lang = (reviewStatus: AuthorizedLanguage['reviewStatus'], favourableDirection = false): AuthorizedLanguage =>
  ({ reviewStatus, reviewedWording: reviewStatus === 'SAFE', optimal: false, favourableDirection });
const AUTHORIZED = lang('SAFE', true);
const LANGUAGES = [lang('UNKNOWN'), lang('DISPUTED'), lang('NEEDS_CONTEXT'), lang('SAFE'), authorizedLanguage(null), AUTHORIZED];

const FOCUS: FocusArea[] = [{ id: 'thyroid', title: 'Thyroid function', whyItMatters: '', relatedMarkers: [], isPrimaryAligned: true }];

const change = (
  status: TrajectoryStatus, direction: (typeof DIRECTIONS)[number], previousValue: number, currentValue: number,
): BiggestChange => ({
  key: 'tsh', displayName: 'TSH', previousValue, currentValue, unit: 'uIU/mL', percentDelta: null,
  trendDirection: currentValue < previousValue ? 'down' : currentValue > previousValue ? 'up' : 'stable',
  significance: 'significant',
  boundaryCrossing: direction ? { from: 'out_of_range', to: 'borderline', direction } : null,
  trajectoryStatus: status, distanceToNormalImprovement: null, fact: '',
  priorReportDate: '2025-12-01', priorIsOlderThanImmediatePrior: false,
});

const storyText = (c: BiggestChange | undefined, language: AuthorizedLanguage) => {
  const trajectory = primaryTrajectory(c, language);
  const story = buildHealthStory({
    primaryContext: {
      primary_biomarker: 'TSH', canonical_slug: 'tsh', current_value: c?.currentValue ?? 6,
      previous_value: c?.previousValue ?? null, unit: 'uIU/mL', current_status: 'elevated', trajectory,
      percent_change: null, prior_report_date: null, supporting_biomarker: null,
    },
    focusAreas: FOCUS,
    primaryCategory: 'thyroid',
  });
  return { trajectory, text: withBandReview(story, trajectory, language).sentences.map(s => s.text).join(' ') };
};

describe('amendment 5 — the health story states only what is true', () => {
  it('exhaustive sweep: every status, crossing direction and band language', () => {
    let swept = 0;
    for (const status of STATUSES) {
      for (const direction of DIRECTIONS) {
        for (const language of LANGUAGES) {
          for (const [prev, curr] of [[9, 6], [6, 9.5], [6, 6]] as const) {
            const where = `${status} ${direction} ${language.reviewStatus}/${language.favourableDirection} ${prev}->${curr}`;
            const { trajectory, text } = storyText(change(status, direction, prev, curr), language);
            if (prev !== curr) {
              expect(trajectory, where).not.toBe('unchanged');
              expect(text, where).not.toMatch(/unchanged/i);
            }
            if (!language.favourableDirection) {
              expect(trajectory, where).not.toBe('improving');
              expect(claimsFavourableDirection(text), where).toBe(false);
            }
            // A band direction cannot authorize an adverse clinical judgement either.
            expect(trajectory, where).not.toBe('worsening');
            expect(text, where).not.toMatch(/wrong direction|worsen|worth discussing/i);
            expect(trajectory, where).not.toBe('no_prior_data');
            if (trajectory === 'changed') {
              expect(text, where).toContain('has changed since your prior report.');
              expect(text, where).toContain(reviewStatement(language));
            }
            swept++;
          }
        }
      }
    }
    expect(swept).toBe(STATUSES.length * DIRECTIONS.length * LANGUAGES.length * 3);
  });

  it('every R1 neutral status and the changed crossing map to "changed"', () => {
    for (const language of LANGUAGES.filter(l => !l.favourableDirection)) {
      for (const status of ['changed_into_band', 'changed_still_high', 'changed_still_low', 'improving_still_high', 'normalized'] as const) {
        expect(primaryTrajectory(change(status, undefined, 9, 6), language), status).toBe('changed');
      }
      expect(primaryTrajectory(change(null, 'changed', 9, 6), language)).toBe('changed');
      expect(primaryTrajectory(change(null, 'improved', 9, 6), language)).toBe('changed');
    }
  });

  /*
    V2-03b Stage 2 replaces "favourable wording survives only under authorized
    language". The trajectory still distinguishes 'improving' under authorized
    language, but the story never words it as judgement or follow-up advice:
    "moving in the right direction but still needs follow-up" carried both, and
    the authorization it relied on is a boolean, not a traceable reviewed rule.
  */
  it('even under authorized language the story states the movement, never its direction or advice', () => {
    expect(primaryTrajectory(change('improving_still_high', undefined, 9, 6), AUTHORIZED)).toBe('improving');
    expect(primaryTrajectory(change(null, 'improved', 9, 6), AUTHORIZED)).toBe('improving');
    for (const language of LANGUAGES) {
      const { text } = storyText(change('improving_still_high', undefined, 9, 6), language);
      expect(text, String(language.reviewStatus)).toContain('and has changed since your prior report.');
      expect(text, String(language.reviewStatus)).not.toMatch(/right direction|wrong direction|improv|follow-up|worse/i);
    }
  });

  it('"unchanged" only when the value did not move; "no prior data" only without a prior', () => {
    expect(primaryTrajectory(change('stable_abnormal', undefined, 6, 6), lang('UNKNOWN'))).toBe('unchanged');
    expect(primaryTrajectory(change('stable_abnormal', undefined, 6, 6.1), lang('UNKNOWN'))).toBe('changed');
    expect(primaryTrajectory(undefined, lang('UNKNOWN'))).toBe('no_prior_data');
    expect(primaryTrajectory({ ...change('changed_still_high', undefined, 9, 6), isFirstRecorded: true }, lang('UNKNOWN'))).toBe('no_prior_data');
  });

  it('the Lead\'s case through the real pipeline: TSH 9 -> 6', () => {
    const tsh = (value: number, reportDate?: string) => ({ key: 'tsh' as const, value, unit: 'uIU/mL', labRefMin: 0.45, labRefMax: 4.5, reportDate });
    const summary = buildInsightSummary([tsh(6)], [tsh(9, '2025-12-01')], null, '2025-12-01');
    expect(summary.primaryFinding?.key).toBe('tsh');
    const c = summary.biggestChanges.find(b => b.key === 'tsh');
    expect(c?.trajectoryStatus).toBe('changed_still_high');
    const language = summary.deltaMap.get('tsh')!.bandLanguage;
    const { trajectory, text } = storyText(c, language);
    expect(trajectory).toBe('changed');
    expect(text).toContain('TSH is the primary finding shown above and has changed since your prior report.');
    expect(text).toContain(reviewStatement(language));
    expect(text).not.toMatch(/unchanged|improv/i);
  });
});
