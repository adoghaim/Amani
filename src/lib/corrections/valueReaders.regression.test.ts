import { describe, expect, it, vi } from 'vitest';

// The readers default to the app's client; every call here passes the fake.
vi.mock('../supabase', () => ({ supabase: {} }));

import {
  HISTORICAL_BIOMARKER_COLUMNS, readDashboardBiomarkers, readHistoricalBiomarkers, readPreviousBiomarkers,
  readReportValues, readTrackerBiomarkers,
} from './valueReaders';
import { valueTables } from './valueTables';
import { loadComparisonBiomarkers, loadInterpretationAnalytes, valueTables as serverValueTables } from '../../../supabase/functions/_shared/value-corrections';
import { baseTables, fakeValueClient, oneCorrection, REPORT_EARLIER, REPORT_LATER, USER_ID, type Row } from './valueFixture.testkit';

/*
  R24 (engineering re-review, owner answer D11 -> A), the regression contract
  for switching the value readers to the corrected views (R18). One fixture,
  every reader, three states:

    off       features.value_corrections off: the raw tables. Must equal
              today's output exactly: the same query the page or function
              made before PK-CORRECT-01, run on the same rows.
    on-none   the flag on, no correction: must equal `off` exactly.
    on-one    the flag on, one value corrected (twice; the latest wins): must
              differ from `off` only in that value's value, unit, flag and
              correction marker.

  Client readers: Dashboard, ReportView (this report, the previous report,
  history), Tracker. Function payload builders: lab-insights and
  generate-interpretation, through _shared with the fake client. ReportView's
  own tests (ReportView.test.tsx, ReportView.language.test.tsx) are unchanged.
*/

type State = 'off' | 'on-none' | 'on-one';
const STATES: State[] = ['off', 'on-none', 'on-one'];

function world(state: State) {
  const tables = baseTables();
  if (state === 'on-one') tables.analyte_corrections = oneCorrection();
  return { client: fakeValueClient(tables), on: state !== 'off' };
}

/** Today's queries, verbatim from the call sites before PK-CORRECT-01, on the raw tables. */
const today = {
  dashboard: async () => (await fakeValueClient(baseTables()).from('biomarkers').select('*')
    .in('lab_report_id', [REPORT_LATER, REPORT_EARLIER])).data,
  reportBiomarkers: async () => (await fakeValueClient(baseTables()).from('biomarkers').select('*')
    .eq('lab_report_id', REPORT_LATER)).data,
  reportAnalytes: async () => (await fakeValueClient(baseTables()).from('report_analytes').select('*')
    .eq('lab_report_id', REPORT_LATER).order('raw_name')).data,
  previous: async () => (await fakeValueClient(baseTables()).from('biomarkers').select('*')
    .eq('lab_report_id', REPORT_EARLIER)).data,
  history: async () => (await fakeValueClient(baseTables()).from('biomarkers')
    .select('name, value, unit, reference_min, reference_max, lab_report_id')
    .in('lab_report_id', [REPORT_LATER, REPORT_EARLIER])).data,
  tracker: async () => (await fakeValueClient(baseTables()).from('biomarkers').select('*')
    .in('lab_report_id', [REPORT_LATER, REPORT_EARLIER])).data,
  labInsights: async () => {
    const client = fakeValueClient(baseTables());
    const { data: current } = await client.from('biomarkers').select('name, value, unit').eq('lab_report_id', REPORT_LATER);
    const { data: previous } = await client.from('biomarkers').select('name, value, unit').eq('lab_report_id', REPORT_EARLIER);
    return { current, previous };
  },
  generateInterpretation: async () => {
    const client = fakeValueClient(baseTables());
    const columns = 'id, raw_name, canonical_slug, value_numeric, raw_value_text, unit, raw_reference_range, normalized_min, normalized_max, normalized_operator, normalized_operator_value, is_core';
    const { data: rawAnalytes } = await client.from('report_analytes').select(columns).eq('lab_report_id', REPORT_LATER).order('raw_name');
    const { data: priorReport } = await client.from('lab_reports').select('id, report_date').eq('user_id', USER_ID)
      .neq('id', REPORT_LATER).lt('report_date', '2026-09-01').order('report_date', { ascending: false }).limit(1).maybeSingle();
    const { data: priorRows } = await client.from('report_analytes').select(columns).eq('lab_report_id', priorReport!.id as string);
    return { analytes: rawAnalytes ?? [], priorAnalytes: priorRows ?? [], priorReportDate: priorReport!.report_date };
  },
};

/** Every reader as it runs now, through the flag-gated helper of its runtime. */
const readers: Record<keyof typeof today, (state: State) => Promise<unknown>> = {
  dashboard: async s => { const w = world(s); return (await readDashboardBiomarkers([REPORT_LATER, REPORT_EARLIER], valueTables(w.on), w.client)).data; },
  reportBiomarkers: async s => { const w = world(s); return (await readReportValues(REPORT_LATER, valueTables(w.on), w.client)).biomarkers.data; },
  reportAnalytes: async s => { const w = world(s); return (await readReportValues(REPORT_LATER, valueTables(w.on), w.client)).analytes.data; },
  previous: async s => { const w = world(s); return (await readPreviousBiomarkers(REPORT_EARLIER, valueTables(w.on), w.client)).data; },
  history: async s => { const w = world(s); return (await readHistoricalBiomarkers([REPORT_LATER, REPORT_EARLIER], valueTables(w.on), w.client)).data; },
  tracker: async s => { const w = world(s); return (await readTrackerBiomarkers([REPORT_LATER, REPORT_EARLIER], valueTables(w.on), w.client)).data; },
  labInsights: async s => {
    const w = world(s);
    return loadComparisonBiomarkers(w.client, serverValueTables(w.on), REPORT_LATER, REPORT_EARLIER);
  },
  generateInterpretation: async s => {
    const w = world(s);
    return loadInterpretationAnalytes(w.client, serverValueTables(w.on), {
      reportId: REPORT_LATER, userId: USER_ID, report: { report_date: '2026-09-01' },
    });
  },
};

/** Every row in a reader's output, wherever it sits, with its path. */
function rowsOf(output: unknown, path = ''): { path: string; row: Row }[] {
  if (Array.isArray(output)) {
    if (output.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
      return output.map((row, i) => ({ path: `${path}[${i}]`, row: row as Row }));
    }
    return output.flatMap((item, i) => rowsOf(item, `${path}[${i}]`));
  }
  if (typeof output === 'object' && output !== null) {
    return Object.entries(output).flatMap(([key, value]) => rowsOf(value, `${path}.${key}`));
  }
  return [];
}

const CORRECTED_VALUE_KEYS = new Set(['value', 'value_numeric', 'raw_value_text', 'unit', 'flagged', 'correction']);

describe('R24: every value reader, one fixture, three states', () => {
  const names = Object.keys(today) as (keyof typeof today)[];

  it.each(names)('%s: flag off equals today\'s output exactly', async name => {
    const expected = await today[name]();
    expect(rowsOf(expected).length).toBeGreaterThan(0);
    expect(await readers[name]('off')).toStrictEqual(expected);
  });

  it.each(names)('%s: flag on with no corrections equals flag off', async name => {
    expect(await readers[name]('on-none')).toStrictEqual(await readers[name]('off'));
  });

  it.each(names)('%s: flag on with one correction differs only in that value, unit, flag and marker', async name => {
    const off = rowsOf(await readers[name]('off'));
    const on = rowsOf(await readers[name]('on-one'));
    expect(on.map(r => r.path)).toEqual(off.map(r => r.path));
    const changed: string[] = [];
    off.forEach(({ path, row }, i) => {
      const next = on[i]!.row;
      const keys = new Set([...Object.keys(row), ...Object.keys(next)]);
      for (const key of keys) {
        if (Object.is(row[key], next[key]) || JSON.stringify(row[key]) === JSON.stringify(next[key])) continue;
        expect(CORRECTED_VALUE_KEYS.has(key), `${name}${path}.${key} changed`).toBe(true);
        changed.push(`${path}.${key}`);
      }
      // Only the corrected ferritin of the later report moves.
      if (changed.some(c => c.startsWith(`${path}.`))) {
        const label = String(next.name ?? next.canonical_slug);
        expect(label).toBe('ferritin');
        expect(next.value ?? next.value_numeric).toBe(45);
      }
    });
    // The corrected value reaches every reader that reads the later report;
    // the previous-report reader reads only the earlier report, so nothing moves.
    if (name === 'previous') expect(changed).toEqual([]);
    else expect(changed.length).toBeGreaterThan(0);
  });

  it('the latest correction wins and the marker keeps the original reading (client readers)', async () => {
    const { biomarkers, analytes } = await readReportValues(REPORT_LATER, valueTables(true),
      fakeValueClient({ ...baseTables(), analyte_corrections: oneCorrection() }));
    const ferritin = biomarkers.data!.find(b => (b as Row).name === 'ferritin') as Row & { correction?: unknown };
    expect(ferritin.value).toBe(45);
    expect(ferritin.raw_value_text).toBe('45.0');
    expect(ferritin.flagged).toBe('in_range');
    expect(ferritin.correction).toEqual({
      originalValue: 450, originalRawText: '450', originalUnit: 'ng/mL', correctedAt: '2026-10-01T10:05:00.000Z', flag: 'in_range',
    });
    const analyte = analytes.data!.find(a => (a as Row).canonical_slug === 'ferritin') as Row & { correction?: { flag: unknown } };
    expect(analyte.value_numeric).toBe(45);
    expect(analyte.correction?.flag).toBe('in_range');
    expect('flagged' in analyte).toBe(false);
    expect('is_corrected' in analyte).toBe(false);
  });

  it('reads the raw tables with the flag off and the views with it on, with the same queries', async () => {
    const offLog: string[] = [];
    const onLog: string[] = [];
    await readHistoricalBiomarkers([REPORT_LATER], valueTables(false), fakeValueClient(baseTables(), offLog));
    await readHistoricalBiomarkers([REPORT_LATER], valueTables(true), fakeValueClient(baseTables(), onLog));
    expect(offLog).toEqual([`biomarkers:${HISTORICAL_BIOMARKER_COLUMNS.join(',')}`]);
    expect(onLog).toEqual([
      `biomarkers_corrected:${HISTORICAL_BIOMARKER_COLUMNS.join(',')},original_value,original_raw_text,original_unit,is_corrected,corrected_at`,
    ]);
  });
});
