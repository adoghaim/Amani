/**
 * The model eval's inputs (RV-MM1 AC8): the committed JSON files under
 * fixtures/ and nothing else. No environment variable or argument adds or
 * changes a case. Every case is synthetic and copies its values, units and
 * printed ranges from the repository file named in copiedFrom; only layout
 * (a printed "Cycle Day" line, report dates, the intervention window) may be
 * authored. fixtures.test.ts proves every copy against its source.
 */
import { readFileSync } from 'node:fs';
import type { InsightsInput, StoredBiomarkerRow } from './handlers';

export const FIXTURE_FILES = ['lab-texts.json', 'ocr-cases.json', 'interpretation-panels.json', 'lab-insights-pairs.json'] as const;
export type FixtureFile = typeof FIXTURE_FILES[number];

const FIXTURES = new URL('./fixtures/', import.meta.url);

export function readFixtureFile(name: FixtureFile): unknown {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));
}

export interface ExpectedRow {
  name: string;
  /** The result as printed, e.g. "18" or "<150". */
  value: string;
  unit: string | null;
  /** The printed interval or limit; null when none is printed. */
  range: string | null;
  /** A list of cycle-phase intervals: not scored as one range. */
  phases?: boolean;
}

export interface LabText {
  id: string;
  synthetic: true;
  copiedFrom: string;
  export: string;
  text: string;
  rows: ExpectedRow[];
}

export type RenderMode = 'png' | 'jpeg-degraded';

export interface OcrPage {
  text: string;
  render: RenderMode;
  insertLine?: { after: string; line: string };
}

export interface PrintedCycle {
  cycle_day: number | null;
  cycle_phase: string | null;
}

export interface OcrCase {
  id: string;
  synthetic: true;
  copiedFrom: string;
  pages: OcrPage[];
  printedCycle: PrintedCycle;
}

export interface InterpretationPanel {
  id: string;
  synthetic: true;
  copiedFrom: string;
  caseName: string;
  reportOverrides: Record<string, unknown>;
  analytes: string[];
  prior: string[];
  priorDate: string | null;
  pinned: string | null;
}

export interface InsightsPair {
  id: string;
  synthetic: true;
  copiedFrom: string;
  previousReport: InsightsInput['previousReport'];
  currentReport: InsightsInput['currentReport'];
  previous: string[];
  current: string[];
  interventionsCopiedFrom?: string;
  interventions: string[];
}

export interface Fixtures {
  texts: LabText[];
  ocr: OcrCase[];
  panels: InterpretationPanel[];
  pairs: InsightsPair[];
}

function fail(message: string): never {
  throw new Error(`model eval fixtures: ${message}`);
}

function entries<T>(file: FixtureFile, key: string): T[] {
  const doc = readFixtureFile(file) as Record<string, unknown>;
  const list = doc?.[key];
  if (!Array.isArray(list) || list.length === 0) fail(`${file} has no ${key}`);
  const ids = new Set<string>();
  for (const item of list as Array<Record<string, unknown>>) {
    if (typeof item?.id !== 'string' || ids.has(item.id)) fail(`${file}: missing or repeated id`);
    ids.add(item.id);
    if (item.synthetic !== true) fail(`${file} ${item.id}: synthetic must be true`);
    if (typeof item.copiedFrom !== 'string' || item.copiedFrom.trim() === '') fail(`${file} ${item.id}: copiedFrom is required`);
  }
  return list as T[];
}

/** Loads and checks every committed fixture. Throws on anything malformed. */
export function loadFixtures(): Fixtures {
  const texts = entries<LabText>('lab-texts.json', 'texts');
  for (const t of texts) {
    if (typeof t.text !== 'string' || !Array.isArray(t.rows) || t.rows.length === 0) fail(`${t.id}: text and rows are required`);
  }
  const ocr = entries<OcrCase>('ocr-cases.json', 'cases');
  for (const c of ocr) {
    if (!Array.isArray(c.pages) || c.pages.length === 0) fail(`${c.id}: pages are required`);
    for (const page of c.pages) {
      if (!texts.some(t => t.id === page.text)) fail(`${c.id}: unknown text ${page.text}`);
      if (page.render !== 'png' && page.render !== 'jpeg-degraded') fail(`${c.id}: unknown render mode`);
    }
  }
  const panels = entries<InterpretationPanel>('interpretation-panels.json', 'panels');
  for (const p of panels) [...p.analytes, ...p.prior].forEach(panelAnalyte);
  const pairs = entries<InsightsPair>('lab-insights-pairs.json', 'pairs');
  for (const p of pairs) {
    [...p.previous, ...p.current].forEach(storedRow);
    p.interventions.forEach(snippet => intervention(snippet, p));
  }
  return { texts, ocr, panels, pairs };
}

/** A page's text: its lab text, with any authored layout line inserted. */
export function pageText(page: OcrPage, texts: readonly LabText[]): string {
  const text = texts.find(t => t.id === page.text)?.text ?? fail(`unknown text ${page.text}`);
  if (!page.insertLine) return text;
  const lines = text.split('\n');
  const at = lines.findIndex(line => line.trim() === page.insertLine!.after);
  if (at < 0) fail(`${page.text}: no line ${JSON.stringify(page.insertLine.after)} to insert after`);
  lines.splice(at + 1, 0, page.insertLine.line);
  return lines.join('\n');
}

/** The rows an OCR case's pages print, page by page. */
export function ocrExpectedRows(ocrCase: OcrCase, texts: readonly LabText[]): ExpectedRow[] {
  return ocrCase.pages.flatMap(page => texts.find(t => t.id === page.text)?.rows ?? []);
}

export interface PanelAnalyte {
  id: string;
  raw_name: string;
  canonical_slug: string;
  value_numeric: number;
  raw_value_text: string;
  unit: string;
  raw_reference_range: string;
  normalized_min: number | null;
  normalized_max: number | null;
  normalized_operator: string | null;
  normalized_operator_value: number | null;
  is_core: boolean;
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const LAB_CALL = new RegExp(
  String.raw`^lab\('([a-z0-9_]+)', '([^']+)', (${NUMBER}), '([^']+)', (null|${NUMBER}), (null|${NUMBER})` +
  String.raw`(?:, \{ operator: '([<>]=?)', value: (${NUMBER}) \})?\)$`,
);

const numberOrNull = (text: string): number | null => (text === 'null' ? null : Number(text));

/** One analyte of a panel: the source suite's lab(...) call, expanded as its `lab` helper does. */
export function panelAnalyte(snippet: string): PanelAnalyte {
  const m = LAB_CALL.exec(snippet) ?? fail(`not a lab(...) call: ${snippet}`);
  const [, slug, name, value, unit, min, max, operator, operatorValue] = m as unknown as string[];
  const op = operator === undefined ? undefined : { operator, value: Number(operatorValue) };
  const lo = numberOrNull(min!);
  const hi = numberOrNull(max!);
  return {
    id: slug!, raw_name: name!, canonical_slug: slug!, value_numeric: Number(value), raw_value_text: String(Number(value)), unit: unit!,
    raw_reference_range: op ? `${op.operator}${op.value}` : `${lo ?? ''}-${hi ?? ''}`,
    normalized_min: op ? null : lo, normalized_max: op ? null : hi,
    normalized_operator: op?.operator ?? null, normalized_operator_value: op?.value ?? null, is_core: true,
  };
}

/** The report the panel's source case builds with its `report(...)` helper. */
export function panelReport(panel: InterpretationPanel): Record<string, unknown> {
  return {
    id: 'synthetic', report_date: '2026-10-17', estimated_cycle_day: null, estimated_cycle_phase: 'unknown', context: {},
    ...panel.reportOverrides,
  };
}

const TREND_ROW = new RegExp(
  String.raw`^\{ slug: '[a-z0-9_]+', name: '([^']+)', value: (?:'(${NUMBER})'|(${NUMBER})), unit: '([^']+)' \}$`,
);
const ROW_CALL = new RegExp(String.raw`^row\('([^']+)', (${NUMBER}), (null|'[^']*')\)$`);

/** A stored biomarkers row (lab-insights' read), from the trend suite's row literal or its row(...) helper. */
export function storedRow(snippet: string): StoredBiomarkerRow {
  const trend = TREND_ROW.exec(snippet);
  if (trend) {
    const [, name, quoted, plain, unit] = trend as unknown as string[];
    return { name: name!, value: Number(quoted ?? plain), unit: unit!, raw_value_text: null };
  }
  const call = ROW_CALL.exec(snippet) ?? fail(`not a stored row: ${snippet}`);
  const [, name, value, text] = call as unknown as string[];
  return { name: name!, value: Number(value), unit: 'ng/mL', raw_value_text: text === 'null' ? null : text!.slice(1, -1) };
}

const INTERVENTION = /^promptInterventionLabel\('([^']+)', '([a-z]+)'\)$/;

/** A tracked intervention: the policy suite's title and category, active from the previous report on. */
export function intervention(snippet: string, pair: InsightsPair): InsightsInput['interventions'][number] {
  const m = INTERVENTION.exec(snippet) ?? fail(`not an intervention label call: ${snippet}`);
  return { title: m[1]!, category: m[2]!, start_date: pair.previousReport.report_date, end_date: null };
}

export function insightsInput(pair: InsightsPair): InsightsInput {
  return {
    previousReport: pair.previousReport,
    currentReport: pair.currentReport,
    previous: pair.previous.map(storedRow),
    current: pair.current.map(storedRow),
    interventions: pair.interventions.map(snippet => intervention(snippet, pair)),
  };
}
