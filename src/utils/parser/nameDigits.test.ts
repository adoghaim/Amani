import { describe, expect, it } from 'vitest';
import { parseAllReportItems, parseAllReportItemsWithDebug } from './pipeline';
import { extractValueFromWindow } from './valueExtraction';
import { firstNumericToken } from './rangeDetection';
import { matchBiomarkerLabel, matchLabelLine } from './labelMatching';
import { isPartOfWord } from './textUtils';
import { detectReportSource } from './sourceDetection';
import { getAdapter } from './adapters';
import type { ReportItem } from './types';
import { questSmokeFixture } from './__fixtures__/questSmoke';

/*
  Digits inside a test name are never its result (2026-10-17 smoke test).

  "Vitamin D, 25-OH, Total 24 L 30-100 ng/mL" was read as 25. Only a digit
  glued to a letter ("A1c", "T4", "B12") counted as part of the name, so the
  "25" of "25-OH" was a result candidate next to 24, and with a min-max
  interval the candidate nearest the interval's midpoint wins: 25 beat 24 for
  30-100. Every result below 25 or above 105 read as 25.

  Now a number that is part of a word ("25-OH", "25-Hydroxy", "Omega-3",
  "Apo B-100") or of the name the matcher recognised ("25 Hydroxy Vitamin D",
  "Free T 4") is never the result. Rows are synthetic, written the way Quest
  and Labcorp print these names; each interval is only text printed on the row.
*/

const QUEST = 'Quest Diagnostics\nTest Name In Range Out Of Range Reference Range Lab\n';
const LABCORP = 'Labcorp\nTests Result Flag Units Reference Interval\n';

/** Both entry points (tests use parseAllReportItems; uploads use the debug variant) must agree. */
function parseBoth(text: string): ReportItem[] {
  const items = parseAllReportItems(text);
  expect(parseAllReportItemsWithDebug(text).items).toEqual(items);
  return items;
}

/** The single item a one-row report yields. */
function only(text: string): ReportItem {
  const items = parseBoth(text);
  expect(items).toHaveLength(1);
  return items[0]!;
}

describe('the smoke-test report, as the PDF extractor reads it', () => {
  const items = parseBoth(questSmokeFixture);

  it('reads Vitamin D as 24, not the 25 of "25-OH"', () => {
    expect(items.find(i => i.canonical_slug === 'vitamin_d_25_oh')).toMatchObject({
      value_numeric: 24, value_text: '24', unit: 'ng/mL', raw_reference_range: '30-100',
      parse_status: 'mapped', needs_review: false,
    });
  });

  it('reads every row as printed', () => {
    expect(detectReportSource(questSmokeFixture)).toBe('quest');
    expect(Object.fromEntries(items.map(i => [i.canonical_slug, i.value_numeric]))).toEqual({
      ferritin: 18, hemoglobin: 12.1, tsh: 2.85, free_t4: 1.1, vitamin_d_25_oh: 24, hemoglobin_a1c: 5.4,
      fasting_glucose: 88, total_cholesterol: 192, hdl_cholesterol: 61, ldl_cholesterol: 112,
      triglycerides: 95, vitamin_b12: 410,
    });
    expect(items.every(i => i.parse_status === 'mapped')).toBe(true);
  });
});

// Each name with a result inside its interval, far below it, and far above it:
// the old midpoint pick hid the bug for results near the middle.
describe('Quest rows', () => {
  it.each([
    ['VITAMIN D,25-OH,TOTAL,IA 24 L 30-100 ng/mL', 'vitamin_d_25_oh', 24],
    ['VITAMIN D,25-OH,TOTAL,IA 12 L 30-100 ng/mL', 'vitamin_d_25_oh', 12],
    ['VITAMIN D,25-OH,TOTAL,IA 112 H 30-100 ng/mL', 'vitamin_d_25_oh', 112],
    ['VITAMIN D,25-OH,TOTAL,IA 42 30-100 ng/mL', 'vitamin_d_25_oh', 42],
    ['VITAMIN D,25-OH,TOTAL,IA 24 L 30-100 ng/mL EZ', 'vitamin_d_25_oh', 24],
    ['VITAMIN D, 25-OH, TOTAL 9 L 30-100 ng/mL', 'vitamin_d_25_oh', 9],
    ['HEMOGLOBIN A1c 5.4 <5.7 % of total Hgb', 'hemoglobin_a1c', 5.4],
    ['HEMOGLOBIN A1c 9.8 H <5.7 % of total Hgb', 'hemoglobin_a1c', 9.8],
    ['T4, FREE 1.1 0.8-1.8 ng/dL', 'free_t4', 1.1],
    ['T4, FREE 0.3 L 0.8-1.8 ng/dL', 'free_t4', 0.3],
    ['T4, FREE 4.2 H 0.8-1.8 ng/dL', 'free_t4', 4.2],
    ['VITAMIN B12 410 200-1100 pg/mL', 'vitamin_b12', 410],
    ['VITAMIN B12 150 L 200-1100 pg/mL', 'vitamin_b12', 150],
    ['VITAMIN B12 1500 H 200-1100 pg/mL', 'vitamin_b12', 1500],
  ])('%s reads %s as %s', (row, slug, value) => {
    expect(only(QUEST + row)).toMatchObject({ canonical_slug: slug, value_numeric: value });
  });

  it('reads a wrapped row (the name alone, the result on the next line)', () => {
    expect(only(`${QUEST}VITAMIN D,25-OH,TOTAL,IA\n24 L 30-100 ng/mL`)).toMatchObject({
      canonical_slug: 'vitamin_d_25_oh', value_numeric: 24, raw_reference_range: '30-100',
    });
  });

  it('reads the total of a 25-OH panel, not the 25 of its name', () => {
    const items = parseBoth(`${QUEST}VITAMIN D, 25-OH, TOTAL 24 L 30-100 ng/mL\nVITAMIN D, 25-OH, D3 24 ng/mL\nVITAMIN D, 25-OH, D2 <4 ng/mL`);
    expect(items.find(i => i.canonical_slug === 'vitamin_d_25_oh')).toMatchObject({ value_numeric: 24, raw_reference_range: '30-100' });
  });

  it('does not read sub-rows that open with a name digit as the total\'s own interval', () => {
    // "25-OH D2 <4" is another row: its "<4" is not a second interval for the total.
    expect(only(`${QUEST}VITAMIN D, 25-OH, TOTAL 49 ng/mL 30-100\n25-OH D3 45\n25-OH D2 <4`)).toMatchObject({
      canonical_slug: 'vitamin_d_25_oh', value_numeric: 49, raw_reference_range: '30-100', needs_review: false,
    });
  });

  it('takes a comparator result after a name digit as the result, with the interval printed under it', () => {
    expect(only(`${QUEST}VITAMIN D, 25-OH, TOTAL <5 ng/mL\nReference Range: 30-100`)).toMatchObject({
      canonical_slug: 'vitamin_d_25_oh', value_text: '<5', raw_reference_range: '30-100',
    });
  });
});

describe('Labcorp rows', () => {
  it.each([
    ['Vitamin D, 25-Hydroxy 24.1 Low ng/mL 30.0-100.0', 'vitamin_d_25_oh', 24.1],
    ['Vitamin D, 25-Hydroxy 8.9 Low ng/mL 30.0-100.0', 'vitamin_d_25_oh', 8.9],
    ['Vitamin D, 25-Hydroxy 128.4 High ng/mL 30.0-100.0', 'vitamin_d_25_oh', 128.4],
    ['Vitamin D, 25-Hydroxy 47.2 ng/mL 30.0-100.0', 'vitamin_d_25_oh', 47.2],
    ['Hemoglobin A1c 5.4 % 4.8-5.6', 'hemoglobin_a1c', 5.4],
    ['Hemoglobin A1c 10.2 High % 4.8-5.6', 'hemoglobin_a1c', 10.2],
    ['T4,Free(Direct) 1.10 ng/dL 0.82-1.77', 'free_t4', 1.1],
    ['T4,Free(Direct) 0.31 Low ng/dL 0.82-1.77', 'free_t4', 0.31],
    ['Vitamin B12 410 pg/mL 232-1245', 'vitamin_b12', 410],
    ['Vitamin B12 2000 High pg/mL 232-1245', 'vitamin_b12', 2000],
  ])('%s reads %s as %s', (row, slug, value) => {
    expect(only(LABCORP + row)).toMatchObject({ canonical_slug: slug, value_numeric: value });
  });
});

describe('other spellings the alias table anticipates', () => {
  it.each([
    ['25-Hydroxyvitamin D 24 ng/mL 30-100', 'vitamin_d_25_oh', 24],
    ['25-Hydroxyvitamin D 141 H 30-100 ng/mL', 'vitamin_d_25_oh', 141],
    ['25 Hydroxy Vitamin D 24 ng/mL 30-100', 'vitamin_d_25_oh', 24],
    ['25 Hydroxy Vitamin D 9 L 30-100 ng/mL', 'vitamin_d_25_oh', 9],
    ['25-OH Vitamin D 12 ng/mL 30-100', 'vitamin_d_25_oh', 12],
    ['25 OH Vitamin D 12 ng/mL 30-100', 'vitamin_d_25_oh', 12],
    ['25(OH)D 24 ng/mL 30-100', 'vitamin_d_25_oh', 24],
    ['25(OH)D 133 H 30-100 ng/mL', 'vitamin_d_25_oh', 133],
    ['Vitamin D (25-OH) 18 ng/mL 30-100', 'vitamin_d_25_oh', 18],
    ['Free T 4 4.5 ng/dL 0.8-1.8', 'free_t4', 4.5],
    ['Free T 4 6.5 H 0.8-1.8 ng/dL', 'free_t4', 6.5],
    ['Free T 3 5.6 pg/mL 2.3-4.2', 'free_t3', 5.6],
    // Inside its interval and still misread before: the "3" sat nearer the midpoint.
    ['Free T 3 2.6 2.3-4.2 pg/mL', 'free_t3', 2.6],
    ['E 2 650 H 30-400 pg/mL', 'estradiol', 650],
    ['E 2 12 pg/mL', 'estradiol', 12],
    ['T-3 Uptake 30 % 22-35', 't3_uptake', 30],
    ['T-3 Uptake 58 H 22-35 %', 't3_uptake', 58],
    ['Apolipoprotein B-100 95 mg/dL <90', 'apob', 95],
    ['Apolipoprotein B-100 35 L 52-109 mg/dL', 'apob', 35],
    ['Apo B-100 130 H mg/dL <90', 'apob', 130],
    ['TSH, 3rd Generation 8.2 H 0.40-4.50 mIU/L', 'tsh', 8.2],
    ['Day 21 Progesterone 12.5 ng/mL', 'progesterone', 12.5],
  ])('%s reads %s as %s', (row, slug, value) => {
    expect(only(row)).toMatchObject({ canonical_slug: slug, value_numeric: value });
  });

  it('reads a wrapped row whose name carries an ordinal', () => {
    expect(only('TSH, 3rd Generation\n0.02 L mIU/L 0.40-4.50')).toMatchObject({ canonical_slug: 'tsh', value_numeric: 0.02 });
  });

  it('reads a short alias found inside a line (the fallback text search) without the digit glued to it', () => {
    // Only parseAllReportItems falls back to a text search when no line opens
    // with a known name ("vit d" is too short for the line matcher); the upload
    // path does not. The "3" of "D3" is part of the name.
    const items = parseAllReportItems('Vit D3: 45 ng/mL');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ canonical_slug: 'vitamin_d_25_oh', value_numeric: 45 });
  });
});

describe('the window reader, for digit-bearing names the matcher does not know', () => {
  const quest = getAdapter('quest');
  it.each([
    ['Omega-3 Index 5.2 % >8.0', 5.2],
    ['IGF-1 150 ng/mL 52-328', 150],
    ['Beta-2 Microglobulin 1.8 mg/L 0.8-2.2', 1.8],
    ['Alpha-1 Antitrypsin 95 L mg/dL 100-188', 95],
    ['Interleukin-6 2.1 pg/mL <5.0', 2.1],
  ])('%s reads %s', (line, value) => {
    expect(extractValueFromWindow([line], [], quest)?.value).toBe(value);
  });

  it('takes a comparator after a hyphenated name as the result, not as a second interval', () => {
    expect(extractValueFromWindow(['IGF-1 <25 ng/mL 52-328'], [], quest)).toMatchObject({
      rawValue: '<25', referenceResult: { min: 52, max: 328 },
    });
  });
});

describe('isPartOfWord', () => {
  const at = (text: string, token: string) => {
    const start = text.indexOf(token);
    return isPartOfWord(text, start, start + token.length);
  };

  it('holds for digits glued to a letter or joined to one by a hyphen', () => {
    expect(at('Hemoglobin A1c 5.4', '1')).toBe(true);
    expect(at('Free T4 1.1', '4')).toBe(true);
    expect(at('Vitamin B12 410', '12')).toBe(true);
    expect(at('Vitamin D, 25-OH, Total 24', '25')).toBe(true);
    expect(at('Vitamin D, 25-Hydroxy 24', '25')).toBe(true);
    expect(at('VITAMIN D,25-OH,TOTAL,IA 24', '25')).toBe(true);
    expect(at('Omega-3 Index 5.2', '3')).toBe(true);
    expect(at('IGF-1 150', '1')).toBe(true);
    expect(at('Apo B-100 95', '100')).toBe(true);
    expect(at('Vitamin D, 1,25-Dihydroxy 45', '1')).toBe(true);
    expect(at('Vitamin D, 1,25-Dihydroxy 45', '25')).toBe(true);
    expect(at('TSH, 3rd Generation 8.2', '3')).toBe(true);
  });

  it('does not hold for a result, an interval, a sign, or a result glued to its flag or unit', () => {
    expect(at('Vitamin D, 25-OH, Total 24 L', '24')).toBe(false);
    expect(at('30-100 ng/mL', '30')).toBe(false);
    expect(at('30-100 ng/mL', '100')).toBe(false);
    expect(at('Base Excess -2.1 mmol/L', '2.1')).toBe(false);
    expect(at('Ferritin 18L 16-154', '18')).toBe(false);
    expect(at('HEMOGLOBIN A1c 9.8H <5.7', '9.8')).toBe(false);
    expect(at('Glucose 88mg/dL', '88')).toBe(false);
    expect(at('TSH <0.01', '0.01')).toBe(false);
    expect(at('Absolute Lymphocytes 1,250 cells/uL', '1')).toBe(false);
  });
});

describe('firstNumericToken', () => {
  const token = (line: string, from?: number) => {
    const t = firstNumericToken(line, from);
    return t && line.slice(t.start, t.end);
  };

  it('skips numbers that are part of the name', () => {
    expect(token('VITAMIN D,25-OH,TOTAL,IA 24 L 30-100 ng/mL')).toBe('24');
    expect(token('Omega-3 Index <4.0 % >8.0')).toBe('<4.0');
    expect(token('Hemoglobin A1c 5.4 <5.7 %')).toBe('5.4');
  });

  it('starts at the end of the name when given one', () => {
    expect(token('Free T 4 4.5 ng/dL', 'Free T 4'.length)).toBe('4.5');
    expect(token('Free T 4 4.5 ng/dL')).toBe('4');
  });
});

describe('matchLabelLine', () => {
  it('ends the name where the matched alias ends', () => {
    expect(matchLabelLine('Vitamin D, 25-OH, Total 24 L 30-100 ng/mL')?.nameEnd).toBe('Vitamin D, 25-OH'.length);
    expect(matchLabelLine('VITAMIN D,25-OH,TOTAL,IA 24 L 30-100 ng/mL')?.nameEnd).toBe('VITAMIN D'.length);
    expect(matchLabelLine('25 Hydroxy Vitamin D 24 ng/mL 30-100')?.nameEnd).toBe('25 Hydroxy Vitamin D'.length);
    expect(matchLabelLine('Free T 4 4.5 ng/dL 0.8-1.8')?.nameEnd).toBe('Free T 4'.length);
    expect(matchLabelLine('TSH 2.85 0.40-4.50 mIU/L')?.nameEnd).toBe('TSH'.length);
  });

  it('matches the same analyte as matchBiomarkerLabel', () => {
    for (const line of questSmokeFixture.split('\n')) {
      expect(matchLabelLine(line, getAdapter('quest'))?.pattern ?? null).toBe(matchBiomarkerLabel(line, getAdapter('quest')));
    }
  });
});
