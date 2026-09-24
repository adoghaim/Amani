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
    const result = addFindingMetadata(payload, { hasPriorComparison: true });
    expect(result.pattern_signals).toBe(payload.pattern_signals);
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'cross_marker', confidence: null, content: pattern, visibility_hint: 'premium' }),
      expect.objectContaining({ kind: 'lifestyle', content: 'Walk' }),
      expect.objectContaining({ kind: 'narrative', content: 'Discuss' }),
      expect.objectContaining({ kind: 'narrative' }),
      expect.objectContaining({ kind: 'trend', observed_at: null }),
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
