import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildTrendEvidence, compareBiomarkerValues, compareStoredBiomarkers, formatTrendEvidencePrompt, isSignificantChange,
  MAX_TREND_EVIDENCE, sameTrendUnit, STORED_BIOMARKER_COLUMNS, topChanges, type TrendInputValue,
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

// Review F013: the rule buildPrimaryContext must share with trend evidence.
describe('sameTrendUnit', () => {
  it('pairs only the same unit; a missing unit is ""', () => {
    expect(sameTrendUnit('mmol/L', 'mg/dL')).toBe(false);
    expect(sameTrendUnit('mg/dL', 'mg/dL')).toBe(true);
    expect(sameTrendUnit(null, '')).toBe(true);
    expect(sameTrendUnit(undefined, 'mg/dL')).toBe(false);
  });

  it('LDL 190 mg/dL then 4.9 mmol/L is no trend', () => {
    const ldl = (value: number, unit: string): TrendInputValue => ({ slug: 'ldl_cholesterol', name: 'LDL', value, unit });
    expect(buildTrendEvidence([ldl(4.9, 'mmol/L')], [ldl(190, 'mg/dL')], '2026-01-01')).toEqual([]);
    expect(buildTrendEvidence([ldl(160, 'mg/dL')], [ldl(190, 'mg/dL')], '2026-01-01').map(e => e.direction)).toEqual(['decreased']);
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

// Review F021: the verifier's case. A prior '<8' is stored as 4, and the stored
// summary read "Vitamin D increased 4 → 20 ng/mL", a value the lab never reported.
describe('censored results are never trend evidence (F021)', () => {
  const vitD = (value: number, value_text: string | null): TrendInputValue =>
    ({ slug: 'vitamin_d_25_oh', name: 'Vitamin D', value, unit: 'ng/mL', value_text });

  it('a censored prior value gives no change, summary or prompt line', () => {
    const evidence = buildTrendEvidence([vitD(20, '20')], [vitD(4, '<8')], '2026-03-01');
    expect(evidence).toEqual([]);
    expect(formatTrendEvidencePrompt(evidence)).toBe('');
  });

  it('a censored current value gives no change either', () => {
    expect(buildTrendEvidence([vitD(1000, '>1000')], [vitD(500, '500')], '2026-03-01')).toEqual([]);
  });

  it('two measured values still compare as before', () => {
    expect(buildTrendEvidence([vitD(20, '20')], [vitD(10, '10')], '2026-03-01').map(e => e.summary))
      .toEqual(['Vitamin D increased 10 → 20 ng/mL since 2026-03-01']);
  });

  it('compareBiomarkerValues skips a pair with a censored side (lab-insights pairing)', () => {
    const value = (v: number, valueText?: string | null) => ({ key: 'tsh', name: 'TSH', value: v, unit: 'mIU/L', valueText });
    expect(compareBiomarkerValues([value(2)], [value(0.005, '<0.01')])).toEqual([]);
    expect(compareBiomarkerValues([value(0.005, '< 0.01')], [value(2)])).toEqual([]);
    expect(compareBiomarkerValues([value(2)], [value(1)])).toHaveLength(1);
  });
});

// Review F021, the lab-insights caller: it read only 'name, value, unit' and
// paired values without the printed text, so the guard above never fired and
// its prompt said "Vitamin D: 4 → 20 ng/mL (+16.0, 400%)".
describe('lab-insights pairs stored rows with their printed text (F021)', () => {
  const row = (name: string, value: number, raw_value_text: string | null) => ({ name, value, unit: 'ng/mL', raw_value_text });

  it('a censored side gives no change; measured pairs still compare by normalized name', () => {
    expect(compareStoredBiomarkers([row('Vitamin D', 20, '20')], [row('vitamin d ', 4, '<8')])).toEqual([]);
    expect(compareStoredBiomarkers([row('Ferritin', 1000, '>1000')], [row('Ferritin', 500, '500')])).toEqual([]);
    expect(compareStoredBiomarkers([row('Ferritin', 40, '40')], [row('ferritin', 20, null)]))
      .toEqual([expect.objectContaining({ key: 'ferritin', previous_value: 20, current_value: 40, percent_change: 100 })]);
  });

  it('lab-insights reads raw_value_text for both reports and pairs through compareStoredBiomarkers', () => {
    const handler = readFileSync(new URL('../lab-insights/index.ts', import.meta.url), 'utf8');
    expect(STORED_BIOMARKER_COLUMNS.split(',').map(c => c.trim())).toContain('raw_value_text');
    const reads = handler.match(/\.from\("biomarkers"\)\s*\.select\([^)]*\)/g) ?? [];
    expect(reads).toHaveLength(2);
    for (const read of reads) expect(read).toMatch(/\.select\(STORED_BIOMARKER_COLUMNS\)$/);
    expect(handler).toMatch(/compareStoredBiomarkers\(\s*currentBiomarkers \|\| \[\],\s*previousBiomarkers \|\| \[\],?\s*\)/);
    expect(handler).not.toMatch(/compareBiomarkerValues\(/);
  });
});
