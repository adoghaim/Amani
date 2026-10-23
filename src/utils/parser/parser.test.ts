import { describe, expect, it } from 'vitest';
import { parseAllReportItems } from './pipeline';
import { detectReportSource } from './sourceDetection';
import { questFixture } from './__fixtures__/quest';
import { labcorpFixture } from './__fixtures__/labcorp';
import { honeFixture } from './__fixtures__/hone';
import { genericFixture } from './__fixtures__/generic';
import { edgeCasesFixture } from './__fixtures__/edgeCases';
import { questHormoneFixture } from './__fixtures__/questHormones';
import { labcorpHormoneFixture } from './__fixtures__/labcorpHormones';

// Snapshot regression harness for the parser pipeline.
// Each test pins current behavior of `parseAllReportItems` for a representative
// fixture. Snapshots are NOT a correctness check — a diff means parser
// behavior changed, which a reviewer must approve (or the test was the canary
// that caught the regression).

describe('parser pipeline (regression snapshots)', () => {
  it('Quest fixture: detects source and parses thyroid + iron + vitamin D panel', () => {
    expect(detectReportSource(questFixture)).toBe('quest');
    expect(parseAllReportItems(questFixture)).toMatchSnapshot();
  });

  it('LabCorp fixture: detects source and parses lipid + A1c panel via Ref. Interval format', () => {
    expect(detectReportSource(labcorpFixture)).toBe('labcorp');
    expect(parseAllReportItems(labcorpFixture)).toMatchSnapshot();
  });

  it('Hone fixture: detects source and parses cycle hormones via Optimal Range layout', () => {
    expect(detectReportSource(honeFixture)).toBe('hone');
    expect(parseAllReportItems(honeFixture)).toMatchSnapshot();
  });

  it('Generic fixture: falls back to unknown source and exercises extended-item heuristic', () => {
    expect(detectReportSource(genericFixture)).toBe('unknown');
    expect(parseAllReportItems(genericFixture)).toMatchSnapshot();
  });

  it('Edge cases: physiological bounds rejection, comparator value, and unmapped analyte', () => {
    expect(parseAllReportItems(edgeCasesFixture)).toMatchSnapshot();
  });

  // Synthetic hormone panels (PK-FIX-05). Their intervals are placeholders, not
  // clinical ranges (see the fixture headers). rangeBinding.test.ts asserts which
  // marker each interval belongs to; these snapshots pin the full output.
  it('Quest hormone fixture: phase intervals captured with labels, own-row intervals bound', () => {
    expect(detectReportSource(questHormoneFixture)).toBe('quest');
    expect(parseAllReportItems(questHormoneFixture)).toMatchSnapshot();
  });

  it('LabCorp hormone fixture: phase intervals captured, including one on the result row', () => {
    expect(detectReportSource(labcorpHormoneFixture)).toBe('labcorp');
    expect(parseAllReportItems(labcorpHormoneFixture)).toMatchSnapshot();
  });
});

/*
  What the snapshots above only pin, asserted (review F098). The edge-case
  fixture's third row is an analyte with no catalog entry; it must come out
  unmapped, not as Vitamin B12 because its name ends in "cobalamin". And a
  result printed below a limit ("<150") is stored as half the limit by the
  shared convention, which no lab measured: it waits for her confirmation.
*/
describe('parser pipeline (semantic assertions)', () => {
  const lab = (row: string) => `Lab Report\n\n${row}\n`;

  it.each([
    'Holotranscobalamin           42        pmol/L    50-150',
    'Holotranscobalamin           80        pmol/L    50-150',
    'Holotranscobalamin 80 pmol/L 50-150',
    'Transcobalamin II            950       pmol/L    700-1500',
    'Holotranscobalamin           <10       pmol/L    50-150',
  ])('a *cobalamin analyte is never read as Vitamin B12: %s', row => {
    expect(parseAllReportItems(lab(row)).filter(i => i.canonical_slug === 'vitamin_b12')).toEqual([]);
  });

  it('the edge-case fixture keeps Holotranscobalamin as its own unmapped row beside Vitamin B12', () => {
    const items = parseAllReportItems(edgeCasesFixture);
    expect(items.find(i => i.raw_name === 'Holotranscobalamin')).toMatchObject({
      canonical_slug: null, normalization_status: 'unmapped', excluded_reason: 'no_canonical_match',
      value_numeric: 42, unit: 'pmol/L',
    });
    const b12 = items.filter(i => i.canonical_slug === 'vitamin_b12');
    expect(b12).toHaveLength(1);
    expect(b12[0]?.source_snippet).toMatch(/^Vitamin B12\s+<150/);
  });

  it.each([
    ['Vitamin B12                  2000      pg/mL     232-1245', 2000],
    ['Vitamin B12                  150       pg/mL     232-1245', 150],
    ['Vitamin B12 2000 H 200-1100 pg/mL', 2000],
  ])('a Holotranscobalamin row still ends the B12 block above it: %s', (b12, value) => {
    const items = parseAllReportItems(lab(`${b12}\nHolotranscobalamin           42        pmol/L    50-150`));
    expect(items.filter(i => i.canonical_slug === 'vitamin_b12').map(i => i.value_numeric)).toEqual([value]);
  });

  it.each([
    ['Cobalamin                    410       pg/mL     232-1245', 'vitamin_b12'],
    ['Cyanocobalamin               410       pg/mL     232-1245', 'vitamin_b12'],
    ['Vitamin B12, Serum           410       pg/mL     232-1245', 'vitamin_b12'],
    ['B12                          410       pg/mL     232-1245', 'vitamin_b12'],
  ])('a whole B12 name still reads as Vitamin B12: %s', (row, slug) => {
    expect(parseAllReportItems(lab(row)).find(i => i.canonical_slug === slug)).toMatchObject({ value_numeric: 410 });
  });

  const fixtures = {
    quest: questFixture, labcorp: labcorpFixture, hone: honeFixture, generic: genericFixture,
    edgeCases: edgeCasesFixture, questHormones: questHormoneFixture, labcorpHormones: labcorpHormoneFixture,
  };
  it.each(Object.entries(fixtures))('%s: every "<X" result needs her review or carries no number', (_, text) => {
    for (const item of parseAllReportItems(text).filter(i => /^\s*</.test(i.value_text ?? ''))) {
      expect(item.needs_review || item.value_numeric == null, item.source_snippet ?? item.raw_name).toBe(true);
    }
  });

  it.each([
    ['a core row', edgeCasesFixture, 'vitamin_b12'],
    ['an unmapped extended row', lab('Holotranscobalamin           <10       pmol/L    50-150'), null],
  ])('%s printed below a limit needs her review', (_, text, slug) => {
    const below = parseAllReportItems(text).filter(i => i.canonical_slug === slug && /^</.test(i.value_text ?? ''));
    expect(below).toHaveLength(1);
    expect(below[0]).toMatchObject({ needs_review: true });
  });
});
