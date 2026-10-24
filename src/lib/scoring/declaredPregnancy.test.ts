import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BiomarkerName } from '../../types';
import { getEntry } from '../biomarkers/dictionary';
import { ANALYTE_CONTEXT } from '../biomarkers/rangeContext.generated';
import { buildInsightSummary } from '../insights/buildInsightSummary';
import { assessAmaniContext, contextFromReport, stateFromPregnancyStatus, type NonCyclingState } from './amaniContext';
import { compareReports } from './compareReports';
import { groupBySystem } from './groupBySystem';
import { markerBandPlacement } from './insightCopy';
import { computeAmaniStatus, scoreBiomarker } from './scoreBiomarker';

/*
  Review F012: Reproductive status declared in onboarding or Settings
  ('Pregnant' | 'Postpartum' | 'Breastfeeding') never reached scoring, so the
  catalog's pregnancy `requires_context` modifiers could not withhold. Interim
  before PK-04: the declared status maps to the existing non-cycling state and
  every client-side assessment entry point accepts it. Synthetic values only.
*/

const REQUIRES_PREGNANCY_CONTEXT = ANALYTE_CONTEXT
  .filter(a => a.bands.some(b => b.kind === 'amani_context' && b.modifiers.pregnancy === 'requires_context'))
  .map(a => a.key);

const DECLARED: Array<[string, NonCyclingState]> = [
  ['Pregnant', 'pregnancy'],
  ['Postpartum', 'postpartum'],
  ['Breastfeeding', 'postpartum'],
];

// Each entry point and the 0-based position of its state argument.
const STATE_ARG: Record<string, number> = {
  contextFromReport: 1, computeAmaniStatus: 3, scoreBiomarker: 6, compareReports: 3,
  markerBandPlacement: 4, buildInsightSummary: 4, groupBySystem: 2,
};
// A design specimen at /dev/design: fixed synthetic values, never her results.
const SPECIMEN_FILES = new Set([join('src/pages', 'DesignGallery.tsx')]);

/** Top-level arguments of the call whose '(' is at `open`, as source text. */
function argsAt(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0, quote: string | null = null, start = open + 1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      depth--;
      if (depth === 0) {
        args.push(src.slice(start, i).trim());
        return args.map(a => a.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim()).filter(a => a !== '');
      }
    } else if (ch === ',' && depth === 1) { args.push(src.slice(start, i).trim()); start = i + 1; }
  }
  throw new Error('unbalanced call');
}

function assessmentCalls() {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test(kit)?\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk('src');
  const calls: { file: string; name: string; call: string; ok: boolean }[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?<!function |\.|\w)(\w+)\(/g)) {
      const name = m[1]!;
      if (!(name in STATE_ARG)) continue;
      const args = argsAt(src, m.index! + name.length);
      const state = args[STATE_ARG[name]!];
      calls.push({ file, name, call: `${name}(${args.join(', ')})`, ok: state !== undefined && state !== 'null' });
    }
    if (SPECIMEN_FILES.has(file)) continue;
    for (const m of src.matchAll(/<(BiomarkerCard|QuickHighlights)\b[^>]*?\/?>/gs)) {
      calls.push({ file, name: m[1]!, call: m[0].replace(/\s+/g, ' '), ok: /\sstate=\{/.test(m[0]) });
    }
  }
  return calls;
}

/** A value the luteal (or unphased) band classifies, and its catalog unit. */
function probe(key: BiomarkerName) {
  const entry = getEntry(key)!;
  const band = entry.phaseRanges?.luteal ?? { optimal: entry.optimal, clinical: entry.clinical };
  const value = band.optimal.max ?? band.optimal.min ?? 1;
  return { value: value * 3, unit: entry.defaultUnit };
}

describe('stateFromPregnancyStatus — the declared reproductive status', () => {
  it.each(DECLARED)('%s → %s', (status, state) => {
    expect(stateFromPregnancyStatus(status)).toBe(state);
    expect(stateFromPregnancyStatus(`  ${status.toUpperCase()} `)).toBe(state);
  });

  it.each([null, undefined, '', 'None', 'Prefer not to say', 'constructor', '__proto__', 'pregnancy_t1'])(
    'declares nothing for %j',
    (status) => {
      expect(stateFromPregnancyStatus(status)).toBeNull();
    },
  );
});

describe('a declared pregnancy withholds every analyte whose catalog band requires pregnancy context', () => {
  it('the catalog has such analytes (56 of 83 at the time of review F012)', () => {
    expect(REQUIRES_PREGNANCY_CONTEXT.length).toBeGreaterThan(0);
    // Without a state each one is scored, so the withholding below is the state's doing.
    for (const key of REQUIRES_PREGNANCY_CONTEXT) {
      const { value, unit } = probe(key);
      expect(assessAmaniContext(key, value, contextFromReport('luteal'), unit).kind, key).toBe('scored');
    }
  });

  it.each(DECLARED)('%s: computeAmaniStatus, scoreBiomarker and markerBandPlacement all withhold', (status) => {
    const state = stateFromPregnancyStatus(status);
    for (const key of REQUIRES_PREGNANCY_CONTEXT) {
      const { value, unit } = probe(key);
      expect(computeAmaniStatus(key, value, 'luteal', state, unit), key).toBe('unknown');
      const scored = scoreBiomarker(key, value, unit, null, null, 'luteal', state);
      expect(scored.amaniStatus, key).toBe('unknown');
      expect(scored.concern, key).toBe(0);
      expect(markerBandPlacement(key, value, 'luteal', unit, state), key).toBeNull();
    }
  });

  it.each(DECLARED)('%s: groupBySystem counts nothing outside a band', (status) => {
    const state = stateFromPregnancyStatus(status);
    const scored = REQUIRES_PREGNANCY_CONTEXT.map(key => {
      const { value, unit } = probe(key);
      return scoreBiomarker(key, value, unit, null, null, 'luteal', state);
    });
    const groups = groupBySystem(scored, 'luteal', state);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.flaggedCount, g.category).toBe(0);
      expect(g.scoredCount, g.category).toBe(0);
    }
  });

  it.each(DECLARED)('%s: compareReports makes no band judgement', (status) => {
    const state = stateFromPregnancyStatus(status);
    const previous = REQUIRES_PREGNANCY_CONTEXT.map(key => ({ key, value: probe(key).value / 9, unit: probe(key).unit }));
    const current = REQUIRES_PREGNANCY_CONTEXT.map(key => ({ key, ...probe(key) }));
    const deltas = compareReports(previous, current, 'luteal', state);
    expect(deltas).toHaveLength(REQUIRES_PREGNANCY_CONTEXT.length);
    for (const d of deltas) {
      expect(d.currentStatus, d.key).toBe('unknown');
      expect(d.previousStatus, d.key).toBe('unknown');
      expect(d.boundaryCrossing, d.key).toBeNull();
      expect(d.trajectoryStatus, d.key).toBeNull();
    }
  });

  it.each(DECLARED)('%s: buildInsightSummary authorizes no band language and ranks nothing from a band', (status) => {
    const state = stateFromPregnancyStatus(status);
    const input = (div: number) => REQUIRES_PREGNANCY_CONTEXT.map(key => {
      const { value, unit } = probe(key);
      return { key, value: value / div, unit, labRefMin: null, labRefMax: null, reportDate: '2026-01-01' };
    });
    const summary = buildInsightSummary(input(1), input(9), 'luteal', '2026-01-01', state);
    expect(summary.bandLanguage?.size).toBe(0);
    expect(summary.primaryFinding).toBeNull();
    expect(summary.topFindings).toEqual([]);
    for (const g of summary.systemSummaries) expect(g.flaggedCount, g.category).toBe(0);
    for (const d of summary.deltaMap.values()) expect(d.trajectoryStatus, d.key).toBeNull();
  });

  it('every client-side assessment call passes a declared state, never a literal null', () => {
    const offenders = assessmentCalls().filter(c => !c.ok).map(c => `${c.file}: ${c.call}`);
    expect(offenders).toEqual([]);
    // The scan sees the entry points it guards (a vacuous scan would pass too).
    const seen = new Set(assessmentCalls().map(c => c.name));
    expect([...seen].sort()).toEqual([...Object.keys(STATE_ARG), 'BiomarkerCard'].sort());
  });

  it('the same panel without a declared state is scored and ranked (the test is not vacuous)', () => {
    const current = REQUIRES_PREGNANCY_CONTEXT.map(key => {
      const { value, unit } = probe(key);
      return { key, value, unit, labRefMin: null, labRefMax: null };
    });
    const summary = buildInsightSummary(current, null, 'luteal', null);
    expect(summary.bandLanguage?.size).toBeGreaterThan(0);
    expect(summary.primaryFinding).not.toBeNull();
  });
});
