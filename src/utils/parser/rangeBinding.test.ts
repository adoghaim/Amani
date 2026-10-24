import { describe, expect, it } from 'vitest';
import { parseAllReportItems, parseAllReportItemsWithDebug } from './pipeline';
import { bindReferenceRange, detectReferenceRange, isReferenceSubLabel } from './rangeDetection';
import { extractValueFromWindow } from './valueExtraction';
import { detectReportSource } from './sourceDetection';
import { getAdapter } from './adapters';
import type { LabelledRange, ReportItem } from './types';
import { questHormoneFixture } from './__fixtures__/questHormones';
import { labcorpHormoneFixture } from './__fixtures__/labcorpHormones';
import { honeFixture } from './__fixtures__/hone';
import { questFixture } from './__fixtures__/quest';
import { labcorpFixture } from './__fixtures__/labcorp';
import { genericFixture } from './__fixtures__/generic';
import { edgeCasesFixture } from './__fixtures__/edgeCases';

/*
  PK-FIX-05: bind each printed interval to its own marker, and never silently
  take the first of several.

  The fixtures are synthetic and their intervals are arbitrary placeholders
  (see the fixture headers): these tests check which marker an interval is
  bound to, never whether an interval is clinically right.
*/

function item(items: ReportItem[], name: string): ReportItem {
  const found = items.find(i => i.canonical_slug === name || i.raw_name === name);
  if (!found) throw new Error(`no parsed item for ${name}`);
  return found;
}

/** Every interval text an item carries: the bound one, or each captured candidate. */
function carriedIntervals(i: ReportItem): string[] {
  if (i.reference_candidates) return i.reference_candidates.map(c => c.raw);
  return i.raw_reference_range === null ? [] : [i.raw_reference_range];
}

function minMax(raw: string, label: string, min: number, max: number): LabelledRange {
  return { min, max, raw, label };
}

function atMost(raw: string, label: string, operator: '<' | '<=', value: number): LabelledRange {
  return { comparator: { operator, value, raw }, raw, label };
}

/** Both entry points (tests use parseAllReportItems; uploads use the debug variant) must agree. */
function parseBoth(text: string): ReportItem[] {
  const items = parseAllReportItems(text);
  expect(parseAllReportItemsWithDebug(text).items).toEqual(items);
  return items;
}

describe('acceptance: synthetic Quest hormone panel', () => {
  const items = parseBoth(questHormoneFixture);

  // What each marker printed for itself, and nothing else.
  const own: Record<string, string[]> = {
    fsh: ['2.1-11.1', '5.2-22.2', '1.3-8.8', '22.2-133.3'],
    lh: ['1.6-11.6', '6.6-66.6', '0.6-12.6', '12.6-56.6'],
    estradiol: ['21-121', '61-361', '51-251', '<=31'],
    progesterone: ['<=1.1', '2.2-22.2', '<=0.4'],
    prolactin: ['3.3-33.3'],
    shbg: [],
    total_testosterone: ['2-45'],
    tsh: ['0.44-4.44'],
    ANDROSTENEDIONE: ['33-333'],
  };

  it('is read as a Quest report and yields exactly the printed markers', () => {
    expect(detectReportSource(questHormoneFixture)).toBe('quest');
    expect(items.map(i => i.canonical_slug ?? i.raw_name).sort()).toEqual(Object.keys(own).sort());
  });

  it('binds each own-row interval to its own marker, as before', () => {
    expect(item(items, 'prolactin')).toMatchObject({
      value_numeric: 11.4, raw_reference_range: '3.3-33.3',
      normalized_reference_min: 3.3, normalized_reference_max: 33.3, needs_review: false,
    });
    expect(item(items, 'total_testosterone')).toMatchObject({
      value_numeric: 31, raw_reference_range: '2-45',
      normalized_reference_min: 2, normalized_reference_max: 45, needs_review: false,
    });
    expect(item(items, 'tsh')).toMatchObject({
      value_numeric: 1.9, raw_reference_range: '0.44-4.44',
      normalized_reference_min: 0.44, normalized_reference_max: 4.44, needs_review: false,
    });
    expect(item(items, 'ANDROSTENEDIONE')).toMatchObject({
      value_numeric: 88, raw_reference_range: '33-333',
      normalized_reference_min: 33, normalized_reference_max: 333,
    });
    for (const name of ['prolactin', 'total_testosterone', 'tsh', 'ANDROSTENEDIONE']) {
      expect(item(items, name).reference_candidates, name).toBeUndefined();
    }
  });

  it('captures cycle-phase intervals with their labels, binds none, and sends the row to review', () => {
    const expected: Record<string, { value: number; printed: string; candidates: LabelledRange[] }> = {
      fsh: {
        value: 6.1,
        printed: 'Follicular Phase 2.1-11.1; Mid-Cycle Peak 5.2-22.2; Luteal Phase 1.3-8.8; Postmenopausal 22.2-133.3',
        candidates: [
          minMax('2.1-11.1', 'Follicular Phase', 2.1, 11.1),
          minMax('5.2-22.2', 'Mid-Cycle Peak', 5.2, 22.2),
          minMax('1.3-8.8', 'Luteal Phase', 1.3, 8.8),
          minMax('22.2-133.3', 'Postmenopausal', 22.2, 133.3),
        ],
      },
      lh: {
        value: 5.6,
        printed: 'Follicular Phase 1.6-11.6; Mid-Cycle Peak 6.6-66.6; Luteal Phase 0.6-12.6; Postmenopausal 12.6-56.6',
        candidates: [
          minMax('1.6-11.6', 'Follicular Phase', 1.6, 11.6),
          minMax('6.6-66.6', 'Mid-Cycle Peak', 6.6, 66.6),
          minMax('0.6-12.6', 'Luteal Phase', 0.6, 12.6),
          minMax('12.6-56.6', 'Postmenopausal', 12.6, 56.6),
        ],
      },
      estradiol: {
        value: 145,
        printed: 'Follicular Phase 21-121; Mid-Cycle Phase 61-361; Luteal Phase 51-251; Postmenopausal <=31',
        candidates: [
          minMax('21-121', 'Follicular Phase', 21, 121),
          minMax('61-361', 'Mid-Cycle Phase', 61, 361),
          minMax('51-251', 'Luteal Phase', 51, 251),
          atMost('<=31', 'Postmenopausal', '<=', 31),
        ],
      },
      progesterone: {
        value: 8.2,
        printed: 'Follicular Phase <=1.1; Luteal Phase 2.2-22.2; Postmenopausal <=0.4',
        candidates: [
          atMost('<=1.1', 'Follicular Phase', '<=', 1.1),
          minMax('2.2-22.2', 'Luteal Phase', 2.2, 22.2),
          atMost('<=0.4', 'Postmenopausal', '<=', 0.4),
        ],
      },
    };
    for (const [name, want] of Object.entries(expected)) {
      const row = item(items, name);
      expect(row, name).toMatchObject({
        value_numeric: want.value,
        raw_reference_range: want.printed,
        normalized_reference_min: null,
        normalized_reference_max: null,
        reference_operator: null,
        reference_operator_value: null,
        needs_review: true,
        parse_status: 'needs_review',
      });
      expect(row.reference_candidates, name).toEqual(want.candidates);
    }
  });

  it('never gives SHBG the interval (or the result) of the unrecognised row printed under it', () => {
    expect(item(items, 'shbg')).toMatchObject({
      value_numeric: 62,
      unit: 'nmol/L',
      raw_reference_range: null,
      normalized_reference_min: null,
      normalized_reference_max: null,
      reference_operator: null,
    });
  });

  it('carries no interval that another marker printed', () => {
    for (const i of items) {
      const name = i.canonical_slug ?? i.raw_name;
      for (const raw of carriedIntervals(i)) expect(own[name], `${name} carries ${raw}`).toContain(raw);
    }
  });

  it('turns no labelled interval line into an analyte of its own', () => {
    expect(items.filter(i => isReferenceSubLabel(i.raw_name))).toEqual([]);
  });
});

describe('acceptance: synthetic Labcorp hormone panel', () => {
  const items = parseBoth(labcorpHormoneFixture);

  const own: Record<string, string[]> = {
    estradiol: ['21.1 – 121.1', '61.1 – 361.1', '51.1 – 251.1', '<31.1'],
    progesterone: ['0.1 – 1.1', '2.2 – 22.2', '0.2 – 12.2'],
    fsh: ['2.5 – 10.5', '3.5 – 20.5', '1.5 – 9.5', '25.5 – 135.5'],
    dheas: ['111.1 – 333.3'],
    prolactin: ['4.4 – 44.4'],
    shbg: [],
    total_testosterone: ['3 – 41'],
    Estrone: ['33 – 333'],
  };

  it('is read as a Labcorp report and yields exactly the printed markers', () => {
    expect(detectReportSource(labcorpHormoneFixture)).toBe('labcorp');
    expect(items.map(i => i.canonical_slug ?? i.raw_name).sort()).toEqual(Object.keys(own).sort());
  });

  it('binds each own interval to its own marker, as before', () => {
    expect(item(items, 'prolactin')).toMatchObject({
      value_numeric: 11.4, raw_reference_range: '4.4 – 44.4',
      normalized_reference_min: 4.4, normalized_reference_max: 44.4, needs_review: false,
    });
    expect(item(items, 'total_testosterone')).toMatchObject({
      value_numeric: 31, raw_reference_range: '3 – 41',
      normalized_reference_min: 3, normalized_reference_max: 41, needs_review: false,
    });
    // One population-labelled interval under the row: exactly one applies, so it binds.
    expect(item(items, 'dheas')).toMatchObject({
      value_numeric: 210, raw_reference_range: '111.1 – 333.3',
      normalized_reference_min: 111.1, normalized_reference_max: 333.3, needs_review: false,
    });
    expect(item(items, 'Estrone')).toMatchObject({
      value_numeric: 88, raw_reference_range: '33 – 333',
      normalized_reference_min: 33, normalized_reference_max: 333,
    });
    for (const name of ['prolactin', 'total_testosterone', 'dheas', 'Estrone']) {
      expect(item(items, name).reference_candidates, name).toBeUndefined();
    }
  });

  it('captures cycle-phase intervals, including one printed on the result row, and binds none', () => {
    const expected: Record<string, { value: number; printed: string; candidates: LabelledRange[] }> = {
      estradiol: {
        value: 145,
        printed: 'Follicular phase 21.1 – 121.1; Ovulation phase 61.1 – 361.1; Luteal phase 51.1 – 251.1; Postmenopausal <31.1',
        candidates: [
          minMax('21.1 – 121.1', 'Follicular phase', 21.1, 121.1),
          minMax('61.1 – 361.1', 'Ovulation phase', 61.1, 361.1),
          minMax('51.1 – 251.1', 'Luteal phase', 51.1, 251.1),
          atMost('<31.1', 'Postmenopausal', '<', 31.1),
        ],
      },
      // The old parser bound "0.1 – 1.1" here: the first interval on the result row.
      progesterone: {
        value: 8.2,
        printed: 'Follicular phase 0.1 – 1.1; Luteal phase 2.2 – 22.2; Ovulation phase 0.2 – 12.2',
        candidates: [
          minMax('0.1 – 1.1', 'Follicular phase', 0.1, 1.1),
          minMax('2.2 – 22.2', 'Luteal phase', 2.2, 22.2),
          minMax('0.2 – 12.2', 'Ovulation phase', 0.2, 12.2),
        ],
      },
      fsh: {
        value: 6.1,
        printed: 'Follicular phase 2.5 – 10.5; Ovulation phase 3.5 – 20.5; Luteal phase 1.5 – 9.5; Postmenopausal 25.5 – 135.5',
        candidates: [
          minMax('2.5 – 10.5', 'Follicular phase', 2.5, 10.5),
          minMax('3.5 – 20.5', 'Ovulation phase', 3.5, 20.5),
          minMax('1.5 – 9.5', 'Luteal phase', 1.5, 9.5),
          minMax('25.5 – 135.5', 'Postmenopausal', 25.5, 135.5),
        ],
      },
    };
    for (const [name, want] of Object.entries(expected)) {
      const row = item(items, name);
      expect(row, name).toMatchObject({
        value_numeric: want.value,
        raw_reference_range: want.printed,
        normalized_reference_min: null,
        normalized_reference_max: null,
        reference_operator: null,
        reference_operator_value: null,
        needs_review: true,
        parse_status: 'needs_review',
      });
      expect(row.reference_candidates, name).toEqual(want.candidates);
    }
  });

  it('never gives SHBG the interval (or the result) of the unrecognised row printed under it', () => {
    expect(item(items, 'shbg')).toMatchObject({
      value_numeric: 62,
      unit: 'nmol/L',
      raw_reference_range: null,
      normalized_reference_min: null,
      normalized_reference_max: null,
      reference_operator: null,
    });
  });

  it('carries no interval that another marker printed', () => {
    for (const i of items) {
      const name = i.canonical_slug ?? i.raw_name;
      for (const raw of carriedIntervals(i)) expect(own[name], `${name} carries ${raw}`).toContain(raw);
    }
  });

  it('turns no labelled interval line into an analyte of its own', () => {
    expect(items.filter(i => isReferenceSubLabel(i.raw_name))).toEqual([]);
  });
});

describe('the Hone fixture: the cross-marker capture that motivated PK-FIX-05', () => {
  const items = parseAllReportItems(honeFixture);

  it('gives Progesterone and Free T3 their own intervals, not the previous marker\'s', () => {
    expect(item(items, 'estradiol')).toMatchObject({ raw_reference_range: '30-400', value_numeric: 145 });
    expect(item(items, 'progesterone')).toMatchObject({
      raw_reference_range: '1.8-24', normalized_reference_min: 1.8, normalized_reference_max: 24, value_numeric: 8.2,
    });
    expect(item(items, 'free_t3')).toMatchObject({
      raw_reference_range: '2.0-4.4', normalized_reference_min: 2, normalized_reference_max: 4.4,
    });
  });

  // The only number after the "alt" inside "Hone Health" is the member ID
  // "HM-00481": part of a word, so it is no result and no ALT row is invented.
  it('invents no ALT row from the "alt" inside "Hone Health" and the member ID "HM-00481"', () => {
    expect(items.find(i => i.canonical_slug === 'alt' || i.raw_name === 'alt')).toBeUndefined();
  });

  it('gives a spurious ALT match (the "alt" inside "Hone Health") no interval and sends it to review', () => {
    // A bare member number still reads as a value after that "alt".
    const spurious = item(parseAllReportItems(honeFixture.replace('HM-00481', '00481')), 'alt');
    expect(spurious).toMatchObject({ value_numeric: 481, raw_reference_range: null, needs_review: true, confidence_score: 'low' });
  });
});

describe('bindReferenceRange', () => {
  it('binds exactly what detectReferenceRange did for every single-interval row of the legacy fixtures', () => {
    const legacy = [questFixture, labcorpFixture, honeFixture, genericFixture, edgeCasesFixture];
    let compared = 0;
    for (const text of legacy) {
      const adapter = getAdapter(detectReportSource(text));
      for (const line of text.split('\n').map(l => l.trim()).filter(l => l.length > 0)) {
        const before = detectReferenceRange(line, adapter) ?? undefined;
        const after = bindReferenceRange([line], adapter);
        expect(after.range, line).toEqual(before);
        expect(after.ambiguous, line).toBeUndefined();
        if (before) compared++;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(20);
  });

  it('binds nothing when one row prints several intervals', () => {
    const b = bindReferenceRange(['TSH 2.1 mIU/L 0.45-4.5 0.4-4.0']);
    expect(b.range).toBeUndefined();
    expect(b.ambiguous?.candidates.map(c => c.raw)).toEqual(['0.45-4.5', '0.4-4.0']);
  });

  it('binds nothing for a single interval tied to a cycle phase, pregnancy or menopause', () => {
    for (const lines of [
      ['Progesterone 8.2 ng/mL', 'Luteal Phase 2.2-22.2'],
      ['Estradiol 145 pg/mL', 'Postmenopausal <=31'],
      ['Estradiol 145 pg/mL', 'Pregnancy', '1st Trimester 211-4311'],
      ['Estradiol 145 pg/mL', 'Follicular Phase', '21-121'],
    ]) {
      const b = bindReferenceRange(lines);
      expect(b.range, lines.join(' / ')).toBeUndefined();
      expect(b.ambiguous?.candidates, lines.join(' / ')).toHaveLength(1);
    }
    expect(bindReferenceRange(['Estradiol 145 pg/mL', 'Pregnancy', '1st Trimester 211-4311']).ambiguous?.candidates[0]?.label)
      .toBe('1st Trimester');
  });

  it('binds the one interval printed under a reference or population heading', () => {
    expect(bindReferenceRange(['DHEA-Sulfate 210 ug/dL', 'Adult Female:', '111.1-333.3']).range)
      .toEqual({ min: 111.1, max: 333.3, raw: '111.1-333.3' });
    expect(bindReferenceRange(['Estradiol', 'Your Result: 145 pg/mL', 'Optimal Range: 30-400']).range)
      .toEqual({ min: 30, max: 400, raw: '30-400' });
    expect(bindReferenceRange(['LDL 132 mg/dL', 'Reference Range: <100']).range)
      .toEqual({ comparator: { operator: '<', value: 100, raw: '<100' }, raw: '<100' });
  });

  it('binds an interval printed twice once', () => {
    const b = bindReferenceRange(['Ferritin 18 ng/mL 16-232', 'Reference Range: 16-232']);
    expect(b.range).toEqual({ min: 16, max: 232, raw: '16-232' });
    expect(b.ambiguous).toBeUndefined();
  });

  it('reads modified phase labels, flag lines and plain result lines as part of the marker block', () => {
    const phases = bindReferenceRange(['Estradiol 145 pg/mL', 'Early Follicular 21-121', 'Mid Luteal 51-251']);
    expect(phases.range).toBeUndefined();
    expect(phases.ambiguous?.candidates.map(c => c.label)).toEqual(['Early Follicular', 'Mid Luteal']);
    expect(bindReferenceRange(['TSH', 'Current 2.1 mIU/L', 'Abnormal', 'Reference Range: 0.40-4.50']).range)
      .toEqual({ min: 0.4, max: 4.5, raw: '0.40-4.50' });
  });

  it('stops at the next row: a labelled result, or a heading that is not reference words', () => {
    expect(bindReferenceRange(['SHBG 62 nmol/L', 'ANDROSTENEDIONE 88 ng/dL 33-333'])).toEqual({ candidates: [] });
    expect(bindReferenceRange(['SHBG 62 nmol/L', 'ANDROSTENEDIONE', '88 ng/dL 33-333'])).toEqual({ candidates: [] });
    expect(bindReferenceRange(['SHBG 62 nmol/L', 'Comment: see note', 'Reference Range: 33-333'])).toEqual({ candidates: [] });
  });

  it('treats a leading "<0.5" on the label row as the result once the block prints an interval', () => {
    const lines = ['PROGESTERONE <0.5 ng/mL', 'Reference Range: <=1.4'];
    expect(bindReferenceRange(lines).range)
      .toEqual({ comparator: { operator: '<=', value: 1.4, raw: '<=1.4' }, raw: '<=1.4' });
    expect(extractValueFromWindow(lines, ['ng/mL'])).toMatchObject({
      value: 0.25, rawValue: '<0.5',
      referenceResult: { comparator: { operator: '<=', value: 1.4, raw: '<=1.4' }, raw: '<=1.4' },
    });
    // Alone on its row, the legacy reading is unchanged.
    expect(bindReferenceRange(['PROGESTERONE <0.5 ng/mL']).range).toEqual(detectReferenceRange('PROGESTERONE <0.5 ng/mL'));
  });

  it('keeps the result of a phase block out of its candidates', () => {
    const b = bindReferenceRange(['PROGESTERONE <0.5 ng/mL', 'Follicular Phase <=1.1', 'Luteal Phase 2.2-22.2']);
    expect(b.range).toBeUndefined();
    expect(b.ambiguous?.candidates.map(c => c.raw)).toEqual(['<=1.1', '2.2-22.2']);
    expect(b.ambiguous?.printed).toBe('Follicular Phase <=1.1; Luteal Phase 2.2-22.2');
  });
});

describe('isReferenceSubLabel', () => {
  it('recognises interval labels and leaves analyte names alone', () => {
    for (const label of [
      'Follicular Phase', 'Mid-Cycle Peak', 'Postmenopausal', 'Adult Female', '1st Trimester', 'Luteal', 'Early Follicular',
    ]) {
      expect(isReferenceSubLabel(label), label).toBe(true);
    }
    // "MID" is the mid-cell row of a three-part CBC differential, not a phase.
    for (const label of ['Estradiol', 'ANDROSTENEDIONE', 'Androstenedione, Female', 'Holotranscobalamin', 'Free T3', 'MID']) {
      expect(isReferenceSubLabel(label), label).toBe(false);
    }
  });
});

describe('fallback path: an interval is never read as the result', () => {
  it('reads "Optimal Range: <100" as the interval, not as a result of 50', () => {
    const text = [
      'Hone Health',
      'LDL Cholesterol',
      'Your Result: 132 mg/dL',
      'Optimal Range: <100',
    ].join('\n');
    expect(item(parseAllReportItems(text), 'ldl_cholesterol')).toMatchObject({
      value_numeric: 132, raw_reference_range: '<100', reference_operator: '<', reference_operator_value: 100,
    });
  });
});
