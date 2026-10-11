import { describe, expect, it } from 'vitest';
import { deriveBloodDrawIdentity, hashDrawKey } from './blood-draw-identity';

/**
 * TS↔SQL parity pin for TASK-048 remediation eligibility.
 * `evaluate_legacy_remediation` re-derives the edge's draw id in SQL from the
 * server-owned content_hash. These literals are what the production TypeScript
 * produces, and `interpretation-versions.remediation.sql` uses the same literals
 * as its claim fixtures, so a drift on either side turns one of them red.
 */

const keyHash = async (reportId: string, contentHash: string | null) =>
  hashDrawKey(deriveBloodDrawIdentity(null, { reportId, contentHash }).key);

describe('remediation draw parity', () => {
  it('a stored content hash keys the draw, case-insensitively, regardless of report', async () => {
    const expected = 'e3dac0fe1f10c8592b3f267de66bffe4398632659a0a90e8086493984dcf8723';
    expect(await keyHash('04861000-0000-4000-8000-000000000001', 'd'.repeat(64))).toBe(expected);
    expect(await keyHash('04861000-0000-4000-8000-000000000004', 'D'.repeat(64))).toBe(expected);
  });

  it('no hash keys the draw to the report', async () => {
    expect(await keyHash('04861000-0000-4000-8000-000000000002', null))
      .toBe('7f02c49bb613e758aedd4eae219ff175a69cf384b416dcc68d1e7a4ab3aff5d7');
    expect(await keyHash('04861000-0000-4000-8000-000000000003', null))
      .toBe('a6d324ea14a0ea9c9365aec98b1309fe6223da31feb1905d04e8e81e7b039b9f');
  });
});
