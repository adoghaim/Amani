import { describe, expect, it } from 'vitest';
import {
  BANDS_UNDER_REVIEW, FOCUS_AREA_BAND_SENTENCE, authorizeText, authorizeTitle, authorizedLanguage, claimsOptimal,
  combineLanguage, primaryFindingSentence, reviewPhrase, reviewStatement, unauthorizedClaims, withoutOptimalClaims,
  type AuthorizedLanguage,
} from './insightCopy';
import { NO_CLAIM_EVIDENCE, type RangeProvenance } from '../biomarkers/provenance';
import { evaluateInsightRules, INSIGHT_RULES } from '../../utils/derivedMetrics';
import { authorizeInsightMatches, gateInsightMatches } from './insightGate';
import { contextFromReport } from './amaniContext';
import type { Biomarker } from '../../types';
import { buildInsightSummary } from '../insights/buildInsightSummary';
import { buildFocusAreas } from '../insights/buildFocusAreas';
import { BIOMARKER_EXPLANATIONS } from '../insights/biomarkerExplanations';
import { scoreBiomarker } from './scoreBiomarker';

// V2-03 amendment 3. Synthetic values only: the e2e luteal fixture panel.
const panel = [
  { key: 'progesterone' as const, value: 2, unit: 'ng/mL', labRefMin: 0.2, labRefMax: 25 },
  { key: 'tsh' as const, value: 2, unit: 'uIU/mL', labRefMin: 0.45, labRefMax: 4.5 },
  { key: 'estradiol' as const, value: 120, unit: 'pg/mL', labRefMin: null, labRefMax: null },
  { key: 'lh' as const, value: 30, unit: 'mIU/mL', labRefMin: 2.4, labRefMax: 12.6 },
  { key: 'fsh' as const, value: 6, unit: 'mIU/mL', labRefMin: 3.5, labRefMax: 12.5 },
];

describe('withoutOptimalClaims', () => {
  it('replaces each optimality sentence once and keeps the rest in order', () => {
    expect(withoutOptimalClaims('A is outside the optimal range. Phase matters. B is Optimal.', 'R.'))
      .toBe('R. Phase matters.');
  });

  it('drops optimality sentences when no replacement is given', () => {
    expect(withoutOptimalClaims('TSH signals the thyroid. Levels outside the OPTIMAL range vary.'))
      .toBe('TSH signals the thyroid.');
    expect(withoutOptimalClaims('Below optimal.')).toBe('');
  });

  it('returns text with no such sentence byte-for-byte', () => {
    const text = 'Inflammation markers are elevated.  Tracking helps.';
    expect(withoutOptimalClaims(text, 'R.')).toBe(text);
  });

  it('the copy it substitutes never says "optimal" itself', () => {
    for (const text of [BANDS_UNDER_REVIEW, FOCUS_AREA_BAND_SENTENCE]) expect(claimsOptimal(text)).toBe(false);
  });
});

describe('retained Amani finding — the luteal progesterone of 2', () => {
  const summary = buildInsightSummary(panel, null, 'luteal');
  const pf = summary.primaryFinding!;

  // V2-03b Stage 2 replaces "the builder still emits the optimality claim": the
  // builder's fact is now the policy's own sentence, so nothing is left to qualify.
  it('the builder no longer emits the optimality claim; its fact is the policy sentence', () => {
    // Ruling 7 is a true floor (owner, 2026-10-23): the lab-flagged LH keeps its
    // lab wording but never takes the Primary slot from Amani's own pick.
    expect(summary.topFindings.find(f => f.key === 'lh')?.fact).toBe("LH is above your lab's reference range at 30 mIU/mL.");
    expect(pf.key).toBe('progesterone');
    expect(pf.fact).toBe("Progesterone is below the Amani band at 2 ng/mL. Amani's context bands are still under review.");
  });

  it('the rendered sentence names the Amani band and its review state instead', () => {
    expect(primaryFindingSentence(pf))
      .toBe("Progesterone is below the Amani band at 2 ng/mL. Amani's context bands are still under review.");
  });

  it('a DISPUTED band withholds placement in the rendered sentence', () => {
    expect(summary.bandLanguage?.get('progesterone')?.reviewStatus).toBe('DISPUTED');
    expect(primaryFindingSentence(pf, summary.bandLanguage!.get('progesterone')))
      .toBe('Progesterone was measured at 2 ng/mL. Interpretation unavailable pending clinical review.');
  });

  it.each([['high', 'above'], ['low', 'below'], ['unknown', 'outside']] as const)(
    'direction %s reads "%s the Amani band" and never "optimal"', (direction, where) => {
      const text = primaryFindingSentence({ displayName: 'X', direction, value: 1, unit: 'u' });
      expect(text).toContain(`X is ${where} the Amani band at 1 u.`);
      expect(claimsOptimal(text)).toBe(false);
    });
});

/*
  V2-03b Stage 2 replaces "the cycle_hormones rule still says optimal; the
  qualified text does not". The rule sentence no longer exists: the builder
  composes the policy's placement, which a DISPUTED band (luteal progesterone)
  withholds entirely, so no qualifier is needed and none is applied.
*/
describe('Focus areas — the persistent half of the breach', () => {
  it('the cycle_hormones area is the policy statement for its bands, with no placement under DISPUTED', () => {
    const summary = buildInsightSummary(panel, null, 'luteal');
    const scored = panel.map(b => scoreBiomarker(b.key, b.value, b.unit, b.labRefMin, b.labRefMax, 'luteal'));
    const area = buildFocusAreas(summary, summary.watchSignals, scored).find(a => a.id === 'hormones_cycle_hormones');
    expect(summary.bandLanguage?.get('progesterone')?.reviewStatus).toBe('DISPUTED');
    expect(area?.whyItMatters).toBe("LH is above your lab's reference range at 30 mIU/mL. Interpretation unavailable pending clinical review.");
    expect(area?.whyItMatters).not.toMatch(/optimal|borderline|outside|within|elevated|low\b/i);
  });

  it('an UNKNOWN band states placement with its review state, and never the lab\'s "reference range"', () => {
    // No supplied lab interval: this isolates comparison-band language from
    // the independently tested lab-flag floor.
    const tsh = [{ key: 'tsh' as const, value: 6, unit: 'uIU/mL', labRefMin: null, labRefMax: null }];
    const summary = buildInsightSummary(tsh, null, null);
    const [area] = buildFocusAreas(summary, [], tsh.map(b => scoreBiomarker(b.key, b.value, b.unit, b.labRefMin, b.labRefMax, null)));
    expect(area!.whyItMatters).toBe("TSH is outside Amani's current comparison band. This band has not yet completed clinical review.");
  });
});

describe('BiomarkerCard "Why this matters" explanations', () => {
  // V2-03b Stage 2 replaces "survives qualification": the interpretive
  // sentences are gone at the source, so the stronger property holds unqualified.
  it('every explanation says what the test measures, with no optimality, judgement, risk or condition', () => {
    const entries = Object.entries(BIOMARKER_EXPLANATIONS);
    expect(entries.length).toBeGreaterThan(15);
    for (const [key, text] of entries) {
      expect(withoutOptimalClaims(text!), key).toBe(text);
      expect(text, key).not.toMatch(/optimal|elevated|\blow levels|\bhigher levels|risk|favou?rable|harmful|associated with|indicat|autoimmun|deficien/i);
    }
  });
});

// ── V2-03 amendment 4, R2: the authorized-language function ────────────────

const provenance = (review_status: RangeProvenance['review_status'], reviewed = false): RangeProvenance => reviewed
  ? { evidence_grade: 'A', review_status, source: 'synthetic', source_date: '2000-01-01', reviewer: 'synthetic', reviewed_at: '2000-01-01' }
  : { evidence_grade: 'unsourced', review_status, source: null, source_date: null, reviewer: null, reviewed_at: null };
const band = (review_status: RangeProvenance['review_status'], reviewed = false, claims = NO_CLAIM_EVIDENCE) =>
  ({ provenance: provenance(review_status, reviewed), claims });
const CLAIMS = 'Your level is optimal. It has improved. That is good. Healthy range. A bad sign. Phase matters.';

describe('R2 — authorized language by review status', () => {
  it('NEEDS_CONTEXT says "More context needed"; DISPUTED says "Interpretation unavailable pending clinical review"', () => {
    expect(reviewPhrase(authorizedLanguage(band('NEEDS_CONTEXT')))).toBe('More context needed');
    expect(reviewPhrase(authorizedLanguage(band('DISPUTED')))).toBe('Interpretation unavailable pending clinical review');
    expect(reviewStatement(authorizedLanguage(band('NEEDS_CONTEXT')))).toMatch(/^More context needed\./);
    expect(reviewStatement(authorizedLanguage(band('DISPUTED')))).toBe('Interpretation unavailable pending clinical review.');
  });

  it('UNKNOWN allows neutral comparison only: no optimal, healthy, improved, good or bad', () => {
    const unknown = authorizedLanguage(band('UNKNOWN'));
    expect(unauthorizedClaims(CLAIMS, unknown).sort()).toEqual(['evaluative', 'favourable_direction', 'optimal']);
    for (const word of ['optimal', 'healthy', 'improved', 'good', 'bad']) {
      expect(unauthorizedClaims(`It is ${word}.`, unknown).length, word).toBeGreaterThan(0);
    }
    const shown = authorizeText(CLAIMS, unknown, 'outside');
    expect(shown).toBe("Your result falls outside Amani's current comparison band. This band has not yet completed clinical review. Phase matters.");
  });

  it('an unestablished review is treated as UNKNOWN, never as reviewed', () => {
    expect(authorizedLanguage(null)).toEqual({ reviewStatus: null, reviewedWording: false, optimal: false, favourableDirection: false });
    expect(authorizeText(CLAIMS, authorizedLanguage(undefined))).not.toMatch(/optimal|improv|\bgood\b|\bbad\b|healthy/i);
  });

  it('the trap: SAFE allows reviewed wording but NOT "optimal" without optimal-target evidence', () => {
    const safe = authorizedLanguage(band('SAFE', true));
    expect(safe.reviewedWording).toBe(true);
    expect(safe.optimal).toBe(false);
    expect(safe.favourableDirection).toBe(false);
    expect(unauthorizedClaims('That is good.', safe)).toEqual([]);
    expect(unauthorizedClaims('It is optimal.', safe)).toEqual(['optimal']);
    expect(unauthorizedClaims('It improved.', safe)).toEqual(['favourable_direction']);
    const target = authorizedLanguage(band('SAFE', true, { ...NO_CLAIM_EVIDENCE, optimal_target: true }));
    expect(unauthorizedClaims('It is optimal.', target)).toEqual([]);
    expect(unauthorizedClaims('It improved.', target)).toEqual(['favourable_direction']);
    // SAFE as a status, with incomplete provenance, is not reviewed at all.
    expect(authorizedLanguage(band('SAFE', false, { optimal_target: true, favourable_direction: true })))
      .toMatchObject({ reviewedWording: false, optimal: false, favourableDirection: false });
  });

  it('every statement it substitutes is itself authorized under the same language', () => {
    const languages: AuthorizedLanguage[] = [null, 'UNKNOWN', 'DISPUTED', 'NEEDS_CONTEXT', 'SAFE']
      .map(s => authorizedLanguage(s ? band(s as RangeProvenance['review_status'], s === 'SAFE') : null));
    for (const language of languages) {
      for (const placement of ['within', 'outside', null] as const) {
        expect(unauthorizedClaims(reviewStatement(language, placement), language), String(language.reviewStatus)).toEqual([]);
      }
    }
  });

  it('combined bands take the most restrictive status and grant only what every band grants', () => {
    const l = (s: RangeProvenance['review_status']) => authorizedLanguage(band(s, s === 'SAFE'));
    expect(combineLanguage([l('SAFE'), l('UNKNOWN'), l('DISPUTED')]).reviewStatus).toBe('DISPUTED');
    expect(combineLanguage([l('SAFE'), l('NEEDS_CONTEXT')]).reviewStatus).toBe('NEEDS_CONTEXT');
    expect(combineLanguage([l('SAFE'), l('UNKNOWN')])).toMatchObject({ reviewStatus: 'UNKNOWN', reviewedWording: false });
    expect(combineLanguage([])).toEqual(authorizedLanguage(null));
  });

  it('a title carrying an unauthorized claim becomes "<subject> needs review"', () => {
    expect(authorizeTitle('Vitamin D Below Optimal', 'Vitamin D', authorizedLanguage(band('NEEDS_CONTEXT')))).toBe('Vitamin D needs review');
    expect(authorizeTitle('Elevated HbA1c', 'HbA1c', authorizedLanguage(band('UNKNOWN')))).toBe('Elevated HbA1c');
  });
});

describe('R2 — insight-flag cards through the real rules, gate and catalog', () => {
  const panelOf = (values: Record<string, number>) =>
    Object.entries(values).map(([name, value]) => ({ name, value } as Biomarker));
  const cards = (values: Record<string, number>, phase: string | null) => {
    const biomarkers = panelOf(values);
    const ctx = contextFromReport(phase);
    const gated = gateInsightMatches(evaluateInsightRules(biomarkers, phase), biomarkers, ctx);
    return { gated, shown: authorizeInsightMatches(gated, biomarkers, ctx) };
  };

  /*
    V2-03b Stage 2 replaces the four tests that read the rules' own titles and
    descriptions through authorizeTitle/authorizeText. Those filtered prose
    for "optimal" and kept the rest, which is how "worth discussing with your
    provider" and condition names (PCOS, Hashimoto's, prediabetes) still
    reached the page. The rules now author nothing; the policy words a match.
  */
  it('the rules author no language: a match is an id, a severity and its inputs', () => {
    for (const rule of INSIGHT_RULES) expect(Object.keys(rule).sort()).toEqual(['biomarkers_involved', 'check', 'rule_id', 'severity']);
    const matches = evaluateInsightRules(panelOf({ vitamin_d_25_oh: 40, hemoglobin_a1c: 6 }), null);
    expect(matches.length).toBe(2);
    for (const m of matches) expect(Object.keys(m).sort()).toEqual(['biomarkers_involved', 'rule_id', 'severity']);
  });

  it('a vitamin D match against its NEEDS_CONTEXT band: values, review state, no condition, no advice', () => {
    for (const value of [20, 40]) {
      const [card] = cards({ vitamin_d_25_oh: value }, null).shown;
      expect(card!.title.text).toBe('Vitamin D: pattern-rule match');
      expect(card!.description.text).toBe(
        "More context needed. Amani's comparison band for this result has not yet completed clinical review."
        + ` Measured: Vitamin D ${value}. These values matched one of Amani's pattern rules, which have not yet completed clinical review.`);
      expect(card!.description.authority).toMatchObject({ kind: 'amani_comparison_band', reviewStatus: 'NEEDS_CONTEXT' });
    }
  });

  it('the luteal progesterone card against its DISPUTED band withholds the match as well as the placement', () => {
    const [card] = cards({ progesterone: 2 }, 'luteal').shown;
    expect(card!.rule_id).toBe('possible_luteal_insufficiency');
    expect(card!.description.text).toBe('Interpretation unavailable pending clinical review. Measured: Progesterone 2.');
  });

  const CONDITION_OR_ADVICE = /optimal|deficien|insufficien|resistance|prediabet|an(a)?emi|autoimmun|hashimoto|pcos|polycystic|risk|liver health|elevat|concern|worth|discuss|provider|doctor|clinician|should|recommend|consider|improv|worse|healthy|favou?rable|typical/i;

  it('property: every shown card, in every context, is a neutral comparison observation with no condition or advice', () => {
    const everything = {
      tpo_antibodies: 200, tsh: 3, fasting_glucose: 100, fasting_insulin: 15, triglycerides: 150,
      hdl_cholesterol: 40, progesterone: 0.5, ferritin: 20, iron_saturation: 20, lh: 30, fsh: 6, total_testosterone: 80,
      dheas: 400, shbg: 30, free_t4: 1, free_t3: 2.5, ldl_cholesterol: 130, apob: 100, hs_crp: 2, lpa: 80,
      alt: 30, ast: 30, ggt: 30, vitamin_d_25_oh: 40, hemoglobin_a1c: 6,
    };
    let shownCount = 0;
    for (const phase of [null, 'unknown', 'menstrual', 'follicular', 'ovulatory', 'luteal', 'pregnancy_t1']) {
      for (const values of [everything, { ...everything, progesterone: 2, ferritin: 25 }]) {
        const { gated, shown } = cards(values, phase);
        expect(shown.map(m => m.rule_id)).toEqual(gated.map(m => m.rule_id));
        expect(shown.map(m => [m.severity, m.biomarkers_involved])).toEqual(gated.map(m => [m.severity, m.biomarkers_involved]));
        for (const m of shown) {
          shownCount++;
          for (const part of [m.title, m.description, m.badge]) {
            expect(part.category, `${phase} ${m.rule_id}`).toBe('comparison_band');
            expect(part.cue, `${phase} ${m.rule_id}`).toBe('attention');
            expect(part.text, `${phase} ${m.rule_id}`).not.toMatch(CONDITION_OR_ADVICE);
            expect(unauthorizedClaims(part.text, authorizedLanguage(null)), `${phase} ${m.rule_id}`).toEqual([]);
          }
        }
      }
    }
    expect(shownCount).toBeGreaterThan(20);
  });

  it('negative control: the condition-or-advice pattern sees the old rule copy', () => {
    for (const old of [
      'May suggest early insulin resistance — worth discussing with your provider.',
      'Possible PCOS-Related Pattern', 'Vitamin D Below Optimal', 'Elevated HbA1c',
      "This pattern may be worth discussing with your provider alongside any thyroid-related symptoms.",
      'This pattern is consistent with iron deficiency that may precede anemia.',
    ]) expect(old).toMatch(CONDITION_OR_ADVICE);
  });
});
