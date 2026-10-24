// RV-MM1 AC8: every eval input is committed, synthetic, and copied from the repo file it
// names; values, units and printed ranges are never authored. Each copy is proved here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import * as edgeCases from '../../src/utils/parser/__fixtures__/edgeCases';
import * as labcorpHormones from '../../src/utils/parser/__fixtures__/labcorpHormones';
import * as questHormones from '../../src/utils/parser/__fixtures__/questHormones';
import * as questSmoke from '../../src/utils/parser/__fixtures__/questSmoke';
import {
  FIXTURE_FILES, insightsInput, loadFixtures, pageText, panelAnalyte, panelReport, readFixtureFile, storedRow,
} from './fixtures';

const REPO = new URL('../../', import.meta.url);
const repoText = (path: string) => readFileSync(new URL(path, REPO), 'utf8');
const squash = (text: string) => text.replace(/\s+/g, ' ');
const evaluateTs = (code: string, scope: Record<string, unknown> = {}) =>
  new Function(...Object.keys(scope), transformSync(code, { loader: 'ts', target: 'es2022' }).code)(...Object.values(scope));

const fixtures = loadFixtures();
const SOURCE_MODULES: Record<string, Record<string, unknown>> = {
  'src/utils/parser/__fixtures__/questSmoke.ts': questSmoke,
  'src/utils/parser/__fixtures__/questHormones.ts': questHormones,
  'src/utils/parser/__fixtures__/labcorpHormones.ts': labcorpHormones,
  'src/utils/parser/__fixtures__/edgeCases.ts': edgeCases,
};

/** A JSON value written the way the source suites write TypeScript literals. */
function tsLiteral(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (Array.isArray(value)) return `[${value.map(tsLiteral).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, inner]) => `${key}: ${tsLiteral(inner)}`);
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  return String(value);
}

describe('the inputs are only the committed fixtures', () => {
  it('the fixtures directory holds exactly the four files the loader reads', () => {
    expect(readdirSync(new URL('./fixtures/', import.meta.url)).sort()).toEqual([...FIXTURE_FILES].sort());
  });

  it('no environment variable or argument reaches the loader', () => {
    expect(loadFixtures).toHaveLength(0);
    expect(readFileSync(new URL('./fixtures.ts', import.meta.url), 'utf8')).not.toMatch(/\bprocess\./);
  });

  it.each([
    ['lab-texts.json', 'texts'], ['ocr-cases.json', 'cases'], ['interpretation-panels.json', 'panels'], ['lab-insights-pairs.json', 'pairs'],
  ] as const)('%s: every case is synthetic and names an existing source file', (file, key) => {
    const cases = (readFixtureFile(file) as Record<string, Array<Record<string, unknown>>>)[key]!;
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases) {
      expect(item.synthetic, String(item.id)).toBe(true);
      expect(existsSync(new URL(String(item.copiedFrom), REPO)), String(item.copiedFrom)).toBe(true);
    }
  });
});

describe('lab texts (extraction, and the OCR pages)', () => {
  it.each(fixtures.texts.map(t => [t.id, t] as const))('%s is its source fixture verbatim', (_id, text) => {
    expect(SOURCE_MODULES[text.copiedFrom]?.[text.export]).toBe(text.text);
  });

  it.each(fixtures.texts.map(t => [t.id, t] as const))('%s: its rows are every result the text prints, as printed', (_id, text) => {
    const lines = text.text.split('\n');
    const start = lines.findIndex(line => /^(?:Test\b|Lab Report$)/.test(line));
    const resultLines = lines.slice(start + 1).filter(line => line.trim() !== '' && !/^\s/.test(line));
    expect(resultLines).toHaveLength(text.rows.length);
    for (const [index, row] of text.rows.entries()) {
      const line = resultLines[index]!;
      expect(line.startsWith(`${row.name} `), line).toBe(true);
      const cells = line.slice(row.name.length).trim().split(/\s+/);
      expect(cells[0], line).toBe(row.value);
      if (row.unit !== null) expect(line, row.name).toContain(` ${row.unit}`);
      if (row.range !== null) expect(text.text, row.name).toContain(row.range);
      if (row.range === null && !row.phases) expect(line.trimEnd().endsWith(` ${row.unit}`), `${row.name} prints no interval`).toBe(true);
    }
  });

  it('meets the minimum: four texts, the Quest and LabCorp hormone panels, a "<100" and a "> OR = 50" interval', () => {
    expect(fixtures.texts.length).toBeGreaterThanOrEqual(4);
    expect(fixtures.texts.map(t => t.export)).toEqual(expect.arrayContaining(['questHormoneFixture', 'labcorpHormoneFixture']));
    const ranges = fixtures.texts.flatMap(t => t.rows.map(r => r.range));
    expect(ranges).toEqual(expect.arrayContaining(['<100', '> OR = 50']));
  });
});

describe('OCR cases', () => {
  it('render every lab text as a clean PNG and as a degraded JPEG, one page each', () => {
    for (const text of fixtures.texts) {
      for (const render of ['png', 'jpeg-degraded']) {
        expect(fixtures.ocr.some(c => c.pages.length === 1 && c.pages[0]!.text === text.id && c.pages[0]!.render === render
          && !c.pages[0]!.insertLine), `${text.id} ${render}`).toBe(true);
      }
    }
  });

  it('include one call with two pages', () => {
    expect(fixtures.ocr.filter(c => c.pages.length === 2)).toHaveLength(1);
  });

  it('print a cycle day on exactly one page, with layout text copied from its source; nothing else prints one', () => {
    const printed = fixtures.ocr.filter(c => c.printedCycle.cycle_day !== null || c.printedCycle.cycle_phase !== null);
    expect(printed).toHaveLength(1);
    const [withDay] = printed;
    const line = withDay!.pages[0]!.insertLine!.line;
    expect(repoText(withDay!.copiedFrom)).toContain(line);
    expect(Number(/^Cycle Day (\d+)$/.exec(line)?.[1])).toBe(withDay!.printedCycle.cycle_day);
    expect(pageText(withDay!.pages[0]!, fixtures.texts)).toContain(`\n${line}\n`);
    for (const c of fixtures.ocr.filter(x => x !== withDay)) {
      expect(c.pages.every(page => !page.insertLine)).toBe(true);
      expect(c.pages.map(page => pageText(page, fixtures.texts)).join('\n')).not.toMatch(/cycle day|\bCD \d/i);
    }
  });
});

describe('interpretation panels', () => {
  const source = repoText('supabase/functions/_shared/nutrient-policy.fallback.test.ts');
  const helpers = evaluateTs(
    source.slice(source.indexOf('const lab = (slug: string'), source.indexOf('const cases:')) + '\nreturn { lab, report };',
  ) as { lab: (...args: unknown[]) => unknown; report: (over?: Record<string, unknown>) => Record<string, unknown> };

  it.each(fixtures.panels.map(p => [p.id, p] as const))('%s is its source case verbatim', (_id, panel) => {
    expect(panel.copiedFrom).toBe('supabase/functions/_shared/nutrient-policy.fallback.test.ts');
    const at = source.indexOf(`name: '${panel.caseName}'`);
    expect(at).toBeGreaterThan(0);
    const block = squash(source.slice(at, source.indexOf('\n  },', at)));
    expect(block).toContain(`analytes: [${panel.analytes.join(', ')}]`);
    if (panel.prior.length > 0) expect(block).toContain(`prior: [${panel.prior.join(', ')}]`);
    else expect(block).not.toContain('prior:');
    if (panel.pinned) expect(block).toContain(`pinned: '${panel.pinned}'`);
    else expect(block).not.toContain('pinned:');
    expect(block).toContain(Object.keys(panel.reportOverrides).length === 0 ? 'report: report()' : `report: report(${tsLiteral(panel.reportOverrides)})`);
    expect(source).toContain("c.prior ? '2026-04-17' : null");
    expect(panel.priorDate).toBe(panel.prior.length > 0 ? '2026-04-17' : null);
    // Expanded exactly as the source suite's own lab(...) and report(...) helpers expand them.
    for (const snippet of [...panel.analytes, ...panel.prior]) {
      expect(panelAnalyte(snippet)).toEqual(new Function('lab', `return ${snippet};`)(helpers.lab));
    }
    expect(panelReport(panel)).toEqual(helpers.report(panel.reportOverrides));
  });

  it('meet the minimum: the October smoke panel, a prior report, declared pregnancy, all within the lab range', () => {
    const byId = new Map(fixtures.panels.map(p => [p.id, p]));
    const smoke = repoText('supabase/functions/_shared/generation-pipeline.smoke.test.ts');
    for (const call of ["marker('ferritin', 'Ferritin', 18, 16, 154)", "marker('tsh', 'TSH', 2.85, 0.4, 4.5)",
      "marker('vitamin_d_25_oh', 'Vitamin D', 24, 30, 100)", "marker('ldl_cholesterol', 'LDL', 112, null, null), raw_reference_range: '<100'"]) {
      expect(smoke).toContain(call);
    }
    expect(byId.get('october-smoke')!.analytes.map(panelAnalyte).map(a => [a.canonical_slug, a.value_numeric]))
      .toEqual([['ferritin', 18], ['tsh', 2.85], ['vitamin_d_25_oh', 24], ['ldl_cholesterol', 112]]);
    expect(byId.get('prior-report-trend')!.prior.length).toBeGreaterThan(0);
    expect(panelReport(byId.get('declared-pregnancy')!).context).toEqual({ pregnant: 'yes' });
    for (const analyte of byId.get('all-within-lab-range')!.analytes.map(panelAnalyte)) {
      expect(analyte.value_numeric).toBeGreaterThanOrEqual(analyte.normalized_min!);
      expect(analyte.value_numeric).toBeLessThanOrEqual(analyte.normalized_max!);
    }
  });
});

describe('lab-insights pairs', () => {
  const trend = repoText('supabase/functions/_shared/trend-evidence.test.ts');
  const rowHelper = 'const row = (name: string, value: number, raw_value_text: string | null) =>';
  const row = evaluateTs(`${trend.slice(trend.indexOf(rowHelper), trend.indexOf('\n', trend.indexOf(rowHelper)))}\nreturn row;`) as
    (...args: unknown[]) => unknown;

  it.each(fixtures.pairs.map(p => [p.id, p] as const))('%s: every stored row is the source suite\'s, verbatim', (_id, pair) => {
    const source = repoText(pair.copiedFrom);
    for (const snippet of [...pair.previous, ...pair.current]) {
      expect(source, snippet).toContain(snippet);
      if (snippet.startsWith('row(')) {
        expect(storedRow(snippet)).toEqual(new Function('row', `return ${snippet};`)(row));
      } else {
        const literal = new Function(`return (${snippet});`)() as { name: string; value: unknown; unit: string };
        expect(storedRow(snippet)).toEqual({ name: literal.name, value: Number(literal.value), unit: literal.unit, raw_value_text: null });
      }
    }
  });

  it('meet the minimum: two pairs, one with interventions whose titles are the policy suite\'s', () => {
    expect(fixtures.pairs.length).toBeGreaterThanOrEqual(2);
    const withInterventions = fixtures.pairs.filter(p => p.interventions.length > 0);
    expect(withInterventions.length).toBeGreaterThanOrEqual(1);
    for (const pair of withInterventions) {
      const policySuite = repoText(pair.interventionsCopiedFrom!);
      for (const snippet of pair.interventions) expect(policySuite).toContain(snippet);
      expect(insightsInput(pair).interventions.map(i => i.title)).toEqual(['Vitamin D', 'Morning walks', 'Metformin']);
    }
  });
});
