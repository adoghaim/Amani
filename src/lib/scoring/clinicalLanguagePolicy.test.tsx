import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClinicalObservation } from '../../components/ClinicalObservation';
import { YourTrajectoryCard } from '../../components/YourTrajectoryCard';
import { buildInsightSummary } from '../insights/buildInsightSummary';
import { bandLanguageByKey } from './compareReports';
import { authorizedLanguage, describeComparisonBand, describeMeasuredMovement, type ClinicalLanguage } from './insightCopy';

const forbidden = /worsen|deteriorat|improv|better|worse|healthier|less healthy|wrong direction|worth discussing|talk to your doctor|consider discussing|seek care|optimal|safe|reassur/i;

describe('V2-03b observation policy', () => {
  it.each(['UNKNOWN', 'DISPUTED', 'NEEDS_CONTEXT'] as const)('%s carries band authority, never clinical authority', review_status => {
    const band = { provenance: { review_status, evidence_grade: 'unsourced' as const, source: null, source_date: null, reviewer: null, reviewed_at: null }, claims: { optimal_target: false, favourable_direction: false } };
    const message = describeComparisonBand(authorizedLanguage(band), 'outside');
    expect(message.category).toBe('comparison_band');
    expect(message.authority).toEqual({ kind: 'amani_comparison_band', reviewStatus: review_status, bands: [band] });
    expect(message.cue).toBe('neutral');
    expect(message.text).not.toMatch(forbidden);
    const html = renderToStaticMarkup(<ClinicalObservation language={message} />);
    expect(html).toContain('data-language-source="amani_comparison_band"');
    expect(html).not.toMatch(forbidden);
  });

  it.each([[6, 9, 'increased'], [9, 6, 'decreased']] as const)('describes %s -> %s without assigning meaning', (previousValue, currentValue, verb) => {
    const message = describeMeasuredMovement({ displayName: 'TSH', previousValue, currentValue, unit: 'uIU/mL', significance: 'significant' });
    expect(message.text).toBe(`TSH ${verb} from ${previousValue} to ${currentValue} uIU/mL.`);
    expect(message).toMatchObject({ category: 'factual_observation', cue: 'neutral', authority: { kind: 'lab_data', previous: previousValue, current: currentValue } });
    expect(message.text).not.toMatch(forbidden);
  });

  it('minor magnitude describes significance without claiming equality or reassurance', () => {
    const message = describeMeasuredMovement({ displayName: 'TSH', previousValue: 6, currentValue: 6.1, unit: 'uIU/mL', significance: 'minor' });
    expect(message.text).toBe('TSH has not changed significantly: 6 to 6.1 uIU/mL.');
    expect(message.text).not.toMatch(forbidden);
    expect(message.text).not.toMatch(/unchanged|unimportant/i);
  });

  it.each([[6, 9], [9, 6], [6, 6.1], [2, 6]])('real summary -> card %s -> %s: neutral visible and accessible semantics', (prev, curr) => {
    const tsh = (value: number) => ({ key: 'tsh' as const, value, unit: 'uIU/mL', labRefMin: 0.45, labRefMax: 4.5 });
    const summary = buildInsightSummary([tsh(curr)], [tsh(prev)], null, '2025-12-01');
    expect(summary.biggestChanges).toHaveLength(1);
    const html = renderToStaticMarkup(<YourTrajectoryCard changes={summary.biggestChanges} primaryFinding={summary.primaryFinding}
      reportCount={2} bandLanguage={bandLanguageByKey(summary.deltaMap.values())} />);
    expect(html).toContain('Your trajectory');
    expect(html).toContain('TSH');
    expect(html).not.toMatch(forbidden);
    expect(html).not.toMatch(/flag-(?:watch|ok|low)|data-bullet-kind="worsened"/);
    expect(html).toContain('data-bullet-kind="changed"');
  });

  it('the observation renderer cannot consume a safety message', () => {
    const safety: Extract<ClinicalLanguage, { category: 'safety_warning' }> = {
      category: 'safety_warning', cue: 'critical', text: 'Synthetic safety message',
      authority: { kind: 'deterministic_safety_rule', ruleId: 'synthetic-only', version: '1' },
    };
    // A compile-time boundary, not a claim that a real safety path is integrated.
    // @ts-expect-error safety must go through its separate renderer
    const forbiddenObservation = <ClinicalObservation language={safety} />;
    expect(forbiddenObservation).toBeDefined();
  });
});
