import { describe, expect, it } from 'vitest';
import { addFindingMetadata } from './finding-metadata';
import { findFloorViolations, FLOOR_FINDING_KEYS } from './response-shaping';

describe('stored finding metadata', () => {
  it.each(FLOOR_FINDING_KEYS)('%s findings retain content and remain basic', key => {
    const payload = { headline: 'Summary', cycle_context: {}, questions_for_doctor: [], disclaimer: 'Educational',
      [key]: ['Finding', { title: 'Finding 2' }] };
    const stored = addFindingMetadata(payload, { observedAt: '2026-09-24' });
    expect(stored[key]).toBe(payload[key]);
    expect(stored.findings).toEqual(payload[key].map((content, index) => ({
      source_path: `/${key}/${index}`, content, kind: 'floor', confidence: null,
      magnitude_normalized: null, observed_at: '2026-09-24T00:00:00.000Z', visibility_hint: 'basic',
    })));
    expect(findFloorViolations(stored)).toEqual([]);
    expect(payload).not.toHaveProperty('findings');
  });
  it('preserves categorical confidence and strings in legacy fields', () => {
    const pattern = { title: 'Pattern', confidence: 'strong', related_biomarkers: ['a', 'b'] };
    const payload = { pattern_signals: [pattern], what_you_can_do_now: ['Walk'], what_to_do_next: ['Discuss'],
      primary_concern: { title: 'Concern' }, overall_interpretation: 'Improving' };
    const result = addFindingMetadata(payload);
    expect(result.pattern_signals).toBe(payload.pattern_signals);
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'cross_marker', confidence: null, content: pattern, visibility_hint: 'premium' }),
      expect.objectContaining({ kind: 'lifestyle', content: 'Walk' }),
      expect.objectContaining({ kind: 'narrative', content: 'Discuss' }),
      expect.objectContaining({ kind: 'narrative' }),
      expect.objectContaining({ kind: 'narrative', observed_at: null }),
    ]);
  });
  it('keeps valid numeric evidence, rejects invalid values, and uses narrative without a comparison', () => {
    const result = addFindingMetadata({ pattern_signals: [
      { confidence: 0.8, magnitude_normalized: 0.3 },
      { confidence: 2, magnitude_normalized: NaN },
    ], overall_interpretation: 'Summary' }, { observedAt: 'not a date' });
    expect(result.findings).toEqual([
      expect.objectContaining({ confidence: 0.8, magnitude_normalized: 0.3, observed_at: null }),
      expect.objectContaining({ confidence: null, magnitude_normalized: null }),
      expect.objectContaining({ kind: 'narrative' }),
    ]);
  });
  it('empty fallback finding arrays remain valid floor surfaces', () => {
    const payload = { headline: 'Unavailable', cycle_context: {}, questions_for_doctor: [], disclaimer: '', top_findings: [] };
    expect(addFindingMetadata(payload).findings).toEqual([]);
    expect(findFloorViolations(addFindingMetadata(payload))).toEqual([]);
  });
});

it('requires distinct marker evidence and derives trend from delta or prior values', () => {
  const result = addFindingMetadata({
    key_findings: [{ biomarker_slug: 'a', status: 'monitor' }, { biomarker_slug: 'b', status: 'reassuring' },
      { biomarker_slug: 'c', status: 'reassuring', abnormal: true }],
    pattern_signals: [
      { related_biomarkers: ['a', 'b'] }, { related_biomarkers: ['a', 'a'] },
      { related_biomarkers: ['a'], delta: 0 },
      { related_biomarkers: ['b'], prior_comparison: { previous_value: 1, current_value: 2 } },
      { related_biomarkers: ['a', 'c'] },
    ],
    what_you_can_do_now: [{ related_biomarkers: ['a'] }, 'Generic lifestyle advice'],
  });
  expect((result.findings as Array<{ preview_eligible?: boolean }>).slice(3)).toEqual([
    expect.objectContaining({ kind: 'cross_marker', preview_eligible: true }),
    expect.not.objectContaining({ preview_eligible: true }),
    expect.objectContaining({ kind: 'trend', preview_eligible: true }),
    expect.objectContaining({ kind: 'trend', preview_eligible: true }),
    expect.objectContaining({ kind: 'floor', visibility_hint: 'basic' }),
    expect.objectContaining({ kind: 'lifestyle', preview_eligible: true }),
    expect.not.objectContaining({ preview_eligible: true }),
  ]);
});

describe('deterministic top_findings and stored trend evidence', () => {
  // Shape produced by generateFallbackInterpretation: flags live in top_findings.
  const deterministic = {
    headline: 'h', cycle_context: {}, questions_for_doctor: [], disclaimer: 'd', summary_bullets: [],
    top_findings: [
      { biomarker_slug: 'ferritin', title: 'Ferritin', status: 'discuss', explanation: 'x' },
      { biomarker_slug: 'tsh', title: 'TSH', status: 'monitor', explanation: 'y' },
    ],
    pattern_signals: [
      { title: 'Iron', confidence: 'medium', explanation: 'p0', related_biomarkers: ['ferritin', 'hemoglobin'] },
      { title: 'Thyroid', confidence: 'low', explanation: 'p1', related_biomarkers: ['tsh', 'ft4'] },
    ],
  };
  const byPath = (payload: Record<string, unknown>) => new Map(
    (addFindingMetadata(payload).findings as Array<{ source_path: string; kind: string; preview_eligible?: boolean; magnitude_normalized: number | null }>)
      .map(f => [f.source_path, f]));

  it('discuss markers in top_findings are abnormal; monitor stays borderline (FINDING_STATUS)', () => {
    const findings = byPath(deterministic);
    expect(findings.get('/pattern_signals/0')).toMatchObject({ kind: 'floor', visibility_hint: 'basic' });
    expect(findings.get('/pattern_signals/0')).not.toHaveProperty('preview_eligible');
    expect(findings.get('/pattern_signals/1')).toMatchObject({ kind: 'cross_marker', preview_eligible: true });
  });

  const evidence = [
    { biomarker_slug: 'vitamin_d', marker: 'Vitamin D', previous_value: 18, current_value: 31, delta: 13, percent_change: 72.222 },
    { biomarker_slug: 'ferritin', marker: 'Ferritin', previous_value: 20, current_value: 9, delta: -11, percent_change: -55 },
    { biomarker_slug: 'b12', marker: 'B12', previous_value: 400, current_value: 500, delta: 100, percent_change: 25 },
  ];

  it('catalogues each stored evidence entry as a trend; abnormal markers stay floor', () => {
    const findings = byPath({ ...deterministic, trend_evidence: evidence });
    expect(findings.get('/trend_evidence/0')).toMatchObject({ kind: 'trend', preview_eligible: true, visibility_hint: 'premium', magnitude_normalized: 0.72222 });
    expect(findings.get('/trend_evidence/1')).toMatchObject({ kind: 'floor', visibility_hint: 'basic' });
    expect(findings.get('/trend_evidence/2')).toMatchObject({ kind: 'trend', preview_eligible: true, magnitude_normalized: 0.25 });
  });

  it('a pattern naming stored evidence becomes the trend and absorbs that entry; a forged slug does not', () => {
    const findings = byPath({ ...deterministic, trend_evidence: evidence, pattern_signals: [
      { title: 'D', confidence: 'strong', explanation: 'Vitamin D rose', related_biomarkers: [], trend_biomarker: 'vitamin_d' },
      { title: 'Forged', confidence: 'strong', explanation: 'made up', related_biomarkers: ['x', 'y'], trend_biomarker: 'estradiol' },
    ] });
    expect(findings.get('/pattern_signals/0')).toMatchObject({ kind: 'trend', preview_eligible: true, magnitude_normalized: 0.72222 });
    expect(findings.get('/pattern_signals/1')).toMatchObject({ kind: 'cross_marker' });
    expect(findings.has('/trend_evidence/0')).toBe(false);
    expect(findings.get('/trend_evidence/2')).toMatchObject({ kind: 'trend' });
  });

  it('ignores evidence entries without numeric comparison', () => {
    const findings = byPath({ ...deterministic, trend_evidence: [{ biomarker_slug: 'tsh', delta: 'up' }, null, 'x'] });
    expect([...findings.keys()].filter(path => path.startsWith('/trend_evidence'))).toEqual([]);
  });
});
