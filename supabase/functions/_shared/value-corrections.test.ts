import { describe, expect, it, vi } from 'vitest';
import {
  featureEnabledIn, isExplanationStale, newestCorrectionAt, readValueCorrectionsFlag, REFRESH_EXPLANATION_LABEL,
  STALE_EXPLANATION_TEXT, VALUE_CORRECTIONS_FLAG, valueTables,
} from './value-corrections.ts';

vi.mock('../../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../../src/lib/runtimeConfig', () => ({ isFeatureEnabled: () => false }));
import * as client from '../../../src/lib/corrections/provenance';
import * as clientTables from '../../../src/lib/corrections/valueTables';

/*
  PK-CORRECT-01 server side (R18, R19): the flag-gated table helper, the flag
  read (fails closed), the staleness rule, and parity with the client mirror
  in src/lib/corrections. The payload builders are driven in
  src/lib/corrections/valueReaders.regression.test.ts (R24).
*/

describe('value tables (R18)', () => {
  it('names the raw tables while the flag is off and the corrected views while it is on', () => {
    expect(valueTables(false)).toEqual({ biomarkers: 'biomarkers', reportAnalytes: 'report_analytes' });
    expect(valueTables(true)).toEqual({ biomarkers: 'biomarkers_corrected', reportAnalytes: 'report_analytes_corrected' });
  });

  it('matches the client helper exactly', () => {
    expect(clientTables.VALUE_CORRECTIONS_FLAG).toBe(VALUE_CORRECTIONS_FLAG);
    for (const on of [false, true]) expect(clientTables.valueTables(on)).toEqual(valueTables(on));
  });
});

describe('features.value_corrections on the server (D5)', () => {
  const rows = (features: unknown) => [{ key: 'min_version_ios', value: null }, { key: 'features', value: features }];

  it('is on only for the boolean true', () => {
    expect(featureEnabledIn(rows({ value_corrections: true }), VALUE_CORRECTIONS_FLAG)).toBe(true);
    for (const value of [false, 'true', 1, null, undefined]) {
      expect(featureEnabledIn(rows({ value_corrections: value }), VALUE_CORRECTIONS_FLAG)).toBe(false);
    }
    expect(featureEnabledIn(rows({}), VALUE_CORRECTIONS_FLAG)).toBe(false);
    expect(featureEnabledIn(rows([]), VALUE_CORRECTIONS_FLAG)).toBe(false);
    expect(featureEnabledIn([], VALUE_CORRECTIONS_FLAG)).toBe(false);
    expect(featureEnabledIn(null, VALUE_CORRECTIONS_FLAG)).toBe(false);
  });

  it('fails closed: an error, a rejection or a malformed reply keeps the raw tables', async () => {
    expect(await readValueCorrectionsFlag(async () => ({ data: rows({ value_corrections: true }), error: null }))).toBe(true);
    expect(await readValueCorrectionsFlag(async () => ({ data: rows({ value_corrections: true }), error: { message: 'x' } }))).toBe(false);
    expect(await readValueCorrectionsFlag(async () => { throw new Error('relation "app_public_config" does not exist'); })).toBe(false);
    expect(await readValueCorrectionsFlag(async () => ({ data: 'nonsense', error: null }))).toBe(false);
  });
});

describe('R19: an explanation written before a correction', () => {
  const version = '2026-10-01T10:00:00.000Z';

  it('is stale only when the newest correction is later than the explanation', () => {
    expect(isExplanationStale(null, version)).toBe(false);
    expect(isExplanationStale('2026-10-01T09:59:59.000Z', version)).toBe(false);
    expect(isExplanationStale(version, version)).toBe(false);
    expect(isExplanationStale('2026-10-01T10:00:00.001Z', version)).toBe(true);
    // Postgres' own format, with microseconds and an offset.
    expect(isExplanationStale('2026-10-01 12:00:00.123456+02', version)).toBe(true);
    // A correction, and no known writing time: nothing shows the explanation came after it.
    expect(isExplanationStale('2026-10-01T10:00:00.000Z', null)).toBe(true);
    expect(isExplanationStale('not a time', version)).toBe(false);
  });

  it('takes the newest corrected_at among corrected view rows only', () => {
    expect(newestCorrectionAt([
      { is_corrected: false, corrected_at: null },
      { is_corrected: true, corrected_at: '2026-10-01T10:00:00.000Z' },
      { is_corrected: true, corrected_at: '2026-10-02T10:00:00.000Z' },
      { is_corrected: false, corrected_at: '2026-10-09T10:00:00.000Z' },
    ])).toBe('2026-10-02T10:00:00.000Z');
    expect(newestCorrectionAt([])).toBeNull();
    expect(newestCorrectionAt(null)).toBeNull();
  });

  it('agrees with the client rule and copy', () => {
    const times = [null, 'bad', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.001Z', '2026-10-02T00:00:00.000Z'];
    for (const correction of times) {
      for (const written of times) {
        expect(client.isExplanationStale(correction, written), `${correction} vs ${written}`)
          .toBe(isExplanationStale(correction, written));
      }
    }
    expect(client.STALE_EXPLANATION_TEXT).toBe(STALE_EXPLANATION_TEXT);
    expect(client.REFRESH_EXPLANATION_LABEL).toBe(REFRESH_EXPLANATION_LABEL);
  });
});
