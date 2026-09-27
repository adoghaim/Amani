import { describe, expect, it } from 'vitest';
import {
  buildTrendEvidence, compareBiomarkerValues, formatTrendEvidencePrompt, isSignificantChange,
  MAX_TREND_EVIDENCE, topChanges, type TrendInputValue,
} from './trend-evidence';
import { addFindingMetadata } from './finding-metadata';
import { buildBasicProjection } from './interpretation-visibility';
import type { CatalogFinding } from './preview-selector';

// Two reports for one user, as generate-interpretation reads them from
// report_analytes (current report, and the most recent earlier report).
const previousReport: TrendInputValue[] = [
  { slug: 'vitamin_d', name: 'Vitamin D', value: 18, unit: 'ng/mL' },
  { slug: 'tsh', name: 'TSH', value: '2.0', unit: 'mIU/L' },
  { slug: 'ferritin', name: 'Ferritin', value: 40, unit: 'ng/mL' },
  { slug: 'glucose', name: 'Glucose', value: 90, unit: 'mg/dL' },
  { slug: 'b12', name: 'B12', value: 400, unit: 'pg/mL' },
  { slug: 'crp', name: 'CRP', value: 0, unit: 'mg/L' },
];
const currentReport: TrendInputValue[] = [
  { slug: 'vitamin_d', name: 'Vitamin D', value: 31, unit: 'ng/mL' },
  { slug: 'tsh', name: 'TSH', value: 2.6, unit: 'mIU/L' },
  { slug: 'ferritin', name: 'Ferritin', value: 42, unit: 'ng/mL' },     // +5%: not significant
  { slug: 'glucose', name: 'Glucose', value: 5.4, unit: 'mmol/L' },     // unit changed: not comparable
  { slug: 'b12', name: 'B12', value: null, unit: 'pg/mL' },             // no numeric value
  { slug: 'crp', name: 'CRP', value: 1.2, unit: 'mg/L' },               // zero baseline, delta >= 0.5
  { slug: 'amh', name: 'AMH', value: 2, unit: 'ng/mL' },                // no prior value
];

describe('buildTrendEvidence (two-report fixture)', () => {
  const evidence = buildTrendEvidence(currentReport, previousReport, '2026-03-01T10:00:00Z');

  it('emits significant same-unit changes, largest relative change first', () => {
    expect(evidence.map(e => e.biomarker_slug)).toEqual(['vitamin_d', 'tsh', 'crp']);
    expect(evidence[0]).toEqual({
      biomarker_slug: 'vitamin_d', marker: 'Vitamin D', previous_value: 18, current_value: 31,
      delta: 13, percent_change: 72.222, unit: 'ng/mL', previous_date: '2026-03-01', direction: 'increased',
      summary: 'Vitamin D increased 18 → 31 ng/mL since 2026-03-01',
    });
    expect(evidence[1]).toMatchObject({ previous_value: 2, current_value: 2.6, delta: 0.6, percent_change: 30 });
    expect(evidence[2]).toMatchObject({ previous_value: 0, percent_change: null, delta: 1.2 });
  });

  it('is deterministic and bounded', () => {
    expect(buildTrendEvidence(currentReport, previousReport, '2026-03-01')).toEqual(evidence);
    const many = Array.from({ length: 20 }, (_, i) => ({ slug: `m${i}`, name: `M${i}`, value: 100 + i * 10, unit: 'u' }));
    const base = many.map(m => ({ ...m, value: 50 }));
    expect(buildTrendEvidence(many, base, null)).toHaveLength(MAX_TREND_EVIDENCE);
    expect(buildTrendEvidence(many, base, null)[0]).toMatchObject({ biomarker_slug: 'm19', previous_date: null,
      summary: 'M19 increased 50 → 290 u since your previous report' });
  });

  it('no earlier report yields no evidence and an unchanged prompt', () => {
    expect(buildTrendEvidence(currentReport, [], null)).toEqual([]);
    expect(formatTrendEvidencePrompt([])).toBe('');
  });

  it('prompt block lists each change once with its slug for trend_biomarker', () => {
    const block = formatTrendEvidencePrompt(evidence);
    expect(block).toContain('- Vitamin D [vitamin_d]: 18 → 31 ng/mL (+13, +72%) since 2026-03-01');
    expect(block).toContain('"trend_biomarker"');
    expect(block.split('\n').filter(line => line.startsWith('- '))).toHaveLength(3);
    // Prompt-token delta estimate: ~4 chars/token; header+instruction ~70 tokens,
    // each change line ~15-20 tokens, so at most ~230 tokens at MAX_TREND_EVIDENCE.
    expect(block.length / 4).toBeLessThan(150);
  });

  it('composes into a selectable canonical preview and a non-zero cross_report count', () => {
    const payload = { headline: 'h', cycle_context: {}, questions_for_doctor: [], disclaimer: 'd',
      key_findings: [{ biomarker_slug: 'vitamin_d', status: 'reassuring' }], overall_interpretation: 'AI_LOCKED',
      trend_evidence: evidence };
    const basic = buildBasicProjection(addFindingMetadata(payload, { observedAt: '2026-09-20' }), undefined, { source: 'ai' });
    expect((basic.preview as CatalogFinding).content).toMatchObject({ summary: 'Vitamin D increased 18 → 31 ng/mL since 2026-03-01' });
    expect(basic.locked).toEqual({ patterns: 0, cross_report: 2, lifestyle: 0 });
    expect(JSON.stringify(basic)).not.toMatch(/AI_LOCKED|TSH increased|CRP increased/);
  });
});

describe('lab-insights comparison rules (moved verbatim)', () => {
  it('pairs by key with equal units; percent is 0 against a zero baseline', () => {
    const changes = compareBiomarkerValues(
      [{ key: 'a', name: 'A', value: 12, unit: 'x' }, { key: 'b', name: 'B', value: 1, unit: 'y' }, { key: 'c', name: 'C', value: 3, unit: 'z' }],
      [{ key: 'a', name: 'A0', value: 10, unit: 'x' }, { key: 'b', name: 'B', value: 1, unit: 'other' }, { key: 'c', name: 'C', value: 0, unit: 'z' }],
    );
    expect(changes).toEqual([
      { key: 'a', name: 'A', previous_value: 10, current_value: 12, unit: 'x', delta: 2, percent_change: 20 },
      { key: 'c', name: 'C', previous_value: 0, current_value: 3, unit: 'z', delta: 3, percent_change: 0 },
    ]);
    expect(changes.map(isSignificantChange)).toEqual([true, true]);
    expect(isSignificantChange({ ...changes[0], percent_change: 9.9 })).toBe(false);
    expect(topChanges([{ ...changes[0], percent_change: -50 }, changes[0]], 1)[0].percent_change).toBe(-50);
  });
});

describe('duplicate analyte slugs', () => {
  const row = (value: unknown, unit: string | null = 'u'): TrendInputValue => ({ slug: 'a', name: 'A', value, unit });
  it.each([
    { current: [row(20), row(30)], previous: [row(10)], from: 10, to: 30 },
    { current: [row(30)], previous: [row(5), row(10)], from: 10, to: 30 },
    { current: [row(20), row(30)], previous: [row(5), row(10)], from: 10, to: 30 },
    { current: [row(30), row(null), row(''), row(Infinity)], previous: [row(10)], from: 10, to: 30 },
    { current: [row(99, null), row(30), row(80, null)], previous: [row(10), row(90, null)], from: 10, to: 30 },
    { current: [row(20, null), row(30, null)], previous: [row(5, null), row(10, null)], from: 10, to: 30 },
  ])('dedupes current=$current previous=$previous before cataloguing', ({ current, previous, from, to }) => {
    const evidence = buildTrendEvidence(current, previous, null);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ previous_value: from, current_value: to });
    const catalog = addFindingMetadata({ trend_evidence: evidence }).findings as CatalogFinding[];
    expect(catalog.filter(f => f.kind === 'trend')).toHaveLength(1);
  });
  it('does not borrow an older unit to force a comparison', () => {
    expect(buildTrendEvidence([row(20), row(30, 'other')], [row(10)], null)).toEqual([]);
  });
});

it('catalogues only the first pattern referencing a trend slug', () => {
  const evidence = buildTrendEvidence(currentReport, previousReport, null);
  const catalog = addFindingMetadata({ trend_evidence: evidence, pattern_signals: [
    { trend_biomarker: 'vitamin_d', explanation: 'First' },
    { trend_biomarker: 'vitamin_d', explanation: 'Repeated' },
  ] }).findings as CatalogFinding[];
  expect(catalog.filter(f => f.kind === 'trend')).toHaveLength(evidence.length);
  expect(catalog.some(f => f.source_path === '/pattern_signals/1')).toBe(false);
  expect(catalog.some(f => f.source_path === '/trend_evidence/0')).toBe(false);
});
