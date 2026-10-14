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
