import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_SOURCE_SNIPPET_LENGTH, sourceSnippetFinder, type SnippetRow } from './source-snippet.ts';
import { redactLabText } from './lab-text-redaction.ts';
import { toExtractedItem, type ExtractedAnalyte } from './lab-extraction.ts';
import { printedLabFlag } from '../../../src/lib/resultRow';
import { findLabCriticalFlags, printedCriticalMarker, type CriticalFlagAnalyte } from '../../../src/lib/safety/labCriticalFlags';
import { questFixture } from '../../../src/utils/parser/__fixtures__/quest';
import { honeFixture } from '../../../src/utils/parser/__fixtures__/hone';
import { edgeCasesFixture } from '../../../src/utils/parser/__fixtures__/edgeCases';

/*
  RV-SN1 (R-SNIPPET): an AI-refined row keeps the lab's printed line as its
  source_snippet, read from the redacted text the model was given and never
  written by the model. Every lab line below is synthetic.
*/

const snippet = (text: unknown, name: unknown, valueText: unknown, valueNumeric: unknown = null) =>
  sourceSnippetFinder(text)({ name, valueText, valueNumeric });

describe('sourceSnippetFinder', () => {
  it('U1 returns the printed line from its label on; CRLF, CR and whitespace runs collapse', () => {
    const line = 'TSH 4.85 H mIU/L 0.45-4.50';
    expect(snippet(line, 'TSH', '4.85', 4.85)).toBe(line);
    const messy = 'Thyroid Panel\r\nTSH      4.85   H\tmIU/L     0.45-4.50  \r\n\r\nFree T4 1.1 ng/dL\rFerritin 18 L ng/mL';
    expect(snippet(messy, 'TSH', '4.85', 4.85)).toBe(line);
    expect(snippet(messy, 'Free T4', '1.1', 1.1)).toBe('Free T4 1.1 ng/dL');
    expect(snippet(messy, 'Ferritin', '18', 18)).toBe('Ferritin 18 L ng/mL');
  });

  it('U2 starts at the label: header text printed before it on the same line is dropped', () => {
    expect(snippet('Ordering Physician: Dr Synthetic TSH 4.85 H mIU/L', 'TSH', '4.85', 4.85)).toBe('TSH 4.85 H mIU/L');
  });

  it('U3 matches the name in any ASCII case and keeps the line in its printed case', () => {
    expect(snippet('TSH 4.85 H mIU/L', 'tsh', '4.85', 4.85)).toBe('TSH 4.85 H mIU/L');
  });

  it('U4 keeps character positions when a letter before the label lowercases to two code units', () => {
    expect('İ'.toLowerCase()).toHaveLength(2);
    expect(snippet('Lab İD TSH 4.85 H mIU/L 0.45-4.50', 'TSH', '4.85', 4.85)).toBe('TSH 4.85 H mIU/L 0.45-4.50');
  });

  it('U5 counts the name only where no letter or number touches it', () => {
    expect(snippet('HEALTH 22 points\nALT 22 U/L 7-35', 'ALT', '22', 22)).toBe('ALT 22 U/L 7-35');
    expect(snippet('ALT2 22 U/L', 'ALT', '22', 22)).toBeNull();
    // A letter outside the BMP (two code units) touching the name counts too.
    expect(snippet('\u{1D400}ALT 22 U/L', 'ALT', '22', 22)).toBeNull();
    expect(snippet('(ALT) 22 U/L', 'ALT', '22', 22)).toBe('ALT) 22 U/L');
  });

  it('U6 never reads the value inside a longer number', () => {
    expect(snippet('WBC 6.8 x10E3/uL', 'WBC', '6', 6)).toBeNull();
    expect(snippet('WBC 6.8 x10E3/uL', 'WBC', '6.8', 6.8)).toBe('WBC 6.8 x10E3/uL');
    expect(snippet('Sodium 1400 mmol/L', 'Sodium', '140', 140)).toBeNull();
    expect(snippet('WBC 6,8 x10E3/uL', 'WBC', '6', 6)).toBeNull();
  });

  it('U7 reads a value glued to its flag or unit', () => {
    expect(snippet('Potassium 6.8HH mmol/L 3.5-5.3', 'Potassium', '6.8', 6.8)).toBe('Potassium 6.8HH mmol/L 3.5-5.3');
    expect(snippet('Potassium 6.8mmol/L 3.5-5.3', 'Potassium', '6.8', 6.8)).toBe('Potassium 6.8mmol/L 3.5-5.3');
  });

  it('U8 needs the value after the name', () => {
    expect(snippet('6.8 Potassium', 'Potassium', '6.8', 6.8)).toBeNull();
  });

  it('U9 answers only a single distinct line: two different lines give null, identical lines count once', () => {
    expect(snippet('Glucose 94 mg/dL 65-99\nGlucose, Fasting 94 mg/dL 65-99', 'Glucose', '94', 94)).toBeNull();
    expect(snippet('Glucose 94 mg/dL 65-99\nPage 2 of 2\nGlucose 94 mg/dL 65-99', 'Glucose', '94', 94)).toBe('Glucose 94 mg/dL 65-99');
  });

  it('U10 matches the printed value text, else the number: a comparator by its text, never its placeholder', () => {
    expect(snippet(edgeCasesFixture, 'Vitamin B12', '<150', 75)).toBe('Vitamin B12 <150 pg/mL 232-1245');
    expect(snippet(edgeCasesFixture, 'Vitamin B12', null, 75)).toBeNull();
    const tsh = 'TSH 4.85 H mIU/L';
    expect(snippet(tsh, 'TSH', 4.85, null)).toBe(tsh);
    expect(snippet(tsh, 'TSH', '  ', 4.85)).toBe(tsh);
    expect(snippet(tsh, 'TSH', Number.NaN, Number.NaN)).toBeNull();
    expect(snippet('eGFR > OR = 60 mL/min', 'eGFR', '> OR = 60', 60)).toBe('eGFR > OR = 60 mL/min');
  });

  it('U11 lets the model add no token: every token of its value text must be printed', () => {
    expect(snippet('TSH 4.85 H mIU/L', 'TSH', '4.85 CRITICAL', 4.85)).toBeNull();
  });

  it('U12 cuts a long line at a space, keeping whole tokens, and never cuts the value off', () => {
    const words = Array.from({ length: 30 }, () => 'Synthetic').join(' ');
    const long = `TSH 4.85 H mIU/L ${words}`;
    // A token straddles index 200.
    expect(long[MAX_SOURCE_SNIPPET_LENGTH - 1]).not.toBe(' ');
    expect(long[MAX_SOURCE_SNIPPET_LENGTH]).not.toBe(' ');
    const cut = snippet(long, 'TSH', '4.85', 4.85);
    expect(cut).toBe(long.slice(0, long.lastIndexOf(' ', MAX_SOURCE_SNIPPET_LENGTH)));
    expect(cut!.length).toBeLessThanOrEqual(MAX_SOURCE_SNIPPET_LENGTH);
    const lineTokens = new Set(long.split(' '));
    for (const token of cut!.split(' ')) expect(lineTokens.has(token)).toBe(true);

    const late = `TSH ${words} 4.85 H mIU/L`;
    expect(late.indexOf('4.85')).toBeGreaterThan(MAX_SOURCE_SNIPPET_LENGTH);
    expect(snippet(late, 'TSH', '4.85', 4.85)).toBeNull();
  });

  it('U13 is total: unusable text, names or fields give null, and a 300 000-character line does not throw', () => {
    for (const text of [42, null, undefined, {}, ['TSH 4.85 H mIU/L']]) {
      expect(snippet(text, 'TSH', '4.85', 4.85)).toBeNull();
    }
    // '125' has no letter; on its own line it would otherwise match.
    for (const name of [42, null, undefined, {}, '', '   ', '125']) {
      expect(snippet('TSH 4.85 H mIU/L\n125 4.85 mg/dL', name, '4.85', 4.85)).toBeNull();
    }
    expect(snippet('TSH 4.85 H mIU/L', 'TSH', {}, {})).toBeNull();
    expect(snippet('TSH 4.85 H mIU/L', 'TSH', null, Number.POSITIVE_INFINITY)).toBeNull();
    expect(sourceSnippetFinder('TSH 4.85 H mIU/L')(null as unknown as SnippetRow)).toBeNull();

    const huge = `TSH 4.85 H ${'a'.repeat(300_000)}`;
    const find = sourceSnippetFinder(huge);
    expect(find({ name: 'TSH', valueText: '4.85', valueNumeric: 4.85 })).toBe('TSH 4.85 H');
    expect(find({ name: 'a'.repeat(5_000), valueText: '1', valueNumeric: 1 })).toBeNull();
    expect(() => sourceSnippetFinder('x'.repeat(300_000))({ name: 'x', valueText: 'x', valueNumeric: 1 })).not.toThrow();
  });

  it('U14 the module has no console, Deno, clock, locale or randomness, builds no RegExp and imports nothing', () => {
    const source = readFileSync(new URL('./source-snippet.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('console.');
    expect(source).not.toContain('Deno.');
    expect(source).not.toMatch(/\bRegExp\(/);
    expect(source).not.toMatch(/\bDate\b|Math\.random|toLocale|\bIntl\b|localeCompare|fetch\(/);
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/from\s+["'][^"']*\bsrc\//);
  });
});

/*
  The snippet is what the app reads the lab's own flags from: printedLabFlag
  (result rows) and printedCriticalMarker / findLabCriticalFlags (the critical
  notice, still off behind features.lab_critical_flag_notice).
*/
const lines = (text: string) => text.split(/\r\n|\r|\n/).map((line) => line.replace(/\s+/g, ' ').trim());

const quest = redactLabText(questFixture).text;
const questFind = sourceSnippetFinder(quest);
const questTsh = questFind({ name: 'TSH', valueText: '4.85', valueNumeric: 4.85 });
const questFerritin = questFind({ name: 'Ferritin', valueText: '18', valueNumeric: 18 });
const questFreeT4 = questFind({ name: 'Free T4', valueText: '1.1', valueNumeric: 1.1 });

const panel = (potassium: string) =>
  `Basic Metabolic Panel\nSodium 139 mmol/L 135-145\n${potassium}\nChloride 101 mmol/L 98-107`;
const criticalLines = [
  'Potassium 6.8 HH 3.5-5.3 mmol/L',
  'Potassium 6.8HH mmol/L 3.5-5.3',
  'Potassium 6.8 mmol/L HH 3.5-5.3',
];
const critical = criticalLines.map((line) => {
  const text = panel(line);
  return { line, text, snippet: sourceSnippetFinder(text)({ name: 'Potassium', valueText: '6.8', valueNumeric: 6.8 }) };
});

describe('contract with the app\'s readers', () => {
  it('C1 Quest, redacted: TSH carries its printed (H), ferritin its (L), free T4 a line with no flag', () => {
    expect(questTsh).toBe('TSH 4.85 (H) mIU/L 0.40-4.50');
    expect(printedLabFlag(questTsh, '4.85', 'mIU/L')).toBe('(H)');
    expect(printedLabFlag(questFerritin, '18', 'ng/mL')).toBe('(L)');
    expect(questFreeT4).toBe('Free T4 1.1 ng/dL 0.8-1.8');
    expect(printedLabFlag(questFreeT4, '1.1', 'ng/dL')).toBeNull();
  });

  it('C2 Hone, label and value on separate lines: no snippet', () => {
    const find = sourceSnippetFinder(redactLabText(honeFixture).text);
    expect(find({ name: 'Estradiol', valueText: '145', valueNumeric: 145 })).toBeNull();
    expect(find({ name: 'Progesterone', valueText: '8.2', valueNumeric: 8.2 })).toBeNull();
    expect(find({ name: 'Free T3', valueText: '3.1', valueNumeric: 3.1 })).toBeNull();
  });

  it('C3 a critical marker the lab printed is read from the snippet, and from the row NewReport saves', () => {
    for (const { line, snippet: printed } of critical) {
      expect(printed).toBe(line);
      expect(printedCriticalMarker(printed, '6.8', ['mmol/L'])).toEqual({ marker: 'HH', printed: 'HH' });
    }
    const analyte: ExtractedAnalyte = {
      raw_name: 'Potassium', raw_value_text: '6.8', value_numeric: 6.8, unit: 'mmol/L',
      raw_reference_range: '3.5-5.3', normalized_min: 3.5, normalized_max: 5.3,
      normalized_operator: null, normalized_operator_value: null, source_snippet: critical[0]!.snippet,
      confidence_score: 'high', canonical_analyte_id: null, canonical_slug: 'potassium',
      parse_status: 'partial', needs_review: false, is_core: false, category: null,
    };
    const item = toExtractedItem(analyte);
    // The report_analytes insert NewReport builds from an AI row (src/pages/NewReport.tsx).
    const saved: CriticalFlagAnalyte = {
      id: '00000000-0000-4000-a000-0000000000c3', raw_name: item.raw_name, display_name: 'Potassium',
      raw_value_text: item.value_text ?? null, value_numeric: item.value_numeric, unit: item.unit ?? null,
      unit_original: item.unit, source_snippet: item.source_snippet ?? null,
    };
    const findings = findLabCriticalFlags([saved]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ marker: 'HH', printed: 'HH' });
    // Without a snippet (every AI row before RV-SN1) the lab's marker is never read.
    expect(findLabCriticalFlags([{ ...saved, source_snippet: null }])).toEqual([]);
  });

  it('C4 every snippet lies inside exactly one normalised line of its text', () => {
    const pairs: [string, string | null][] = [
      [quest, questTsh], [quest, questFerritin], [quest, questFreeT4],
      ...critical.map(({ text, snippet: printed }): [string, string | null] => [text, printed]),
    ];
    for (const [text, printed] of pairs) {
      expect(printed).not.toBeNull();
      expect(lines(text).filter((line) => line.includes(printed!))).toHaveLength(1);
    }
  });
});

/*
  The Deno handler cannot be imported here (npm:/jsr: specifiers, Deno
  globals), so, as lab-extraction.test.ts does, read its source and pin the
  wiring.
*/
const handler = readFileSync(new URL('../extract-biomarkers/index.ts', import.meta.url), 'utf8');

describe('wiring: extract-biomarkers fills source_snippet from the redacted text', () => {
  it('imports the finder, builds it once and gives every row its snippet instead of null', () => {
    expect(handler).toContain('import { sourceSnippetFinder } from "../_shared/source-snippet.ts";');
    expect(handler).toContain('    const snippetFor = sourceSnippetFinder(labText);');
    expect(handler).toContain(
      '          source_snippet: snippetFor({ name: item.raw_name ?? item.name, valueText: item.value_text, valueNumeric: item.value_numeric }),',
    );
    expect(handler).not.toMatch(/source_snippet:\s*null/);
  });

  it('reads the redacted text the model was given, never the uploaded text', () => {
    expect(handler).not.toContain('sourceSnippetFinder(text)');
    const redacted = handler.indexOf('const labText = redactLabText(text).text;');
    expect(redacted).toBeGreaterThan(-1);
    expect(handler.indexOf('const snippetFor = sourceSnippetFinder(labText);')).toBeGreaterThan(redacted);
  });

  it('logs no snippet, and the audit event still carries only the coverage counts', () => {
    const consoleCalls = handler.match(/console\.\w+\([\s\S]*?\);/g) ?? [];
    expect(consoleCalls.length).toBeGreaterThan(0);
    for (const call of consoleCalls) expect(call).not.toMatch(/snippet/i);
    expect(handler).toMatch(/event_type: "lab_uploaded",\s*metadata: \{ \.\.\.coverage \},/);
  });
});
