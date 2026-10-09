/** TASK-047: shared expectations; live parity requires the harness-provided DB output. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClinicalObservation } from '../../../src/components/ClinicalObservation';
import { authorizeModelProse, describeMeasuredMovement } from '../../../src/lib/scoring/insightCopy';
import { storedClaimSet, quarantineCustomerRead, legacyCustomerFloor, servedBasic } from './claim-authority';
import { sanitizeBasicProjection, isDeterministicSource, BASIC_KEYS } from './interpretation-visibility';
import type { InterpretationPayload } from './response-shaping';

type Result = { current: boolean; trust: string; full: InterpretationPayload; rpc_basic: InterpretationPayload; view_basic: InterpretationPayload };
type Case = { name: string; source: string | null; full: InterpretationPayload; basic: InterpretationPayload; expected: Result };
const corpus: Case[] = JSON.parse(readFileSync(new URL('../../migrations/__verification__/legacy-quarantine.corpus.json', import.meta.url), 'utf8'));
function typescript(c: Case): Result {
  // Real TS Full validator decides whether selection is allowed. The hidden
  // Full body must be validated in SQL before returning a selected Basic body.
  const current = storedClaimSet(c.full) !== null;
  const full = quarantineCustomerRead(c.full, true, c.source);
  const trusted = isDeterministicSource(c.source) || current;
  const rpcBasic = trusted ? sanitizeBasicProjection(c.basic, c.source) : legacyCustomerFloor();
  return { current, trust: isDeterministicSource(c.source) ? 'deterministic' : current ? 'current' : 'legacy',
    full, rpc_basic: rpcBasic, view_basic: trusted ? servedBasic(rpcBasic) : legacyCustomerFloor() };
}

describe('TASK-047 fixed corpus and real TypeScript functions (not live SQL evidence)', () => {
  it.each(corpus)('$name', c => {
    const before = JSON.stringify(c);
    expect(typescript(c)).toEqual(c.expected);
    expect(JSON.stringify(c)).toBe(before);
    if (c.expected.trust === 'legacy') {
      for (const body of [c.expected.full, c.expected.rpc_basic, c.expected.view_basic]) {
        expect(body).toEqual(legacyCustomerFloor());
        expect(Object.keys(body).every(k => (BASIC_KEYS as readonly string[]).includes(k))).toBe(true);
        expect(JSON.stringify(body)).not.toContain('paper boats');
      }
    }
  });
  it('positive current control would fail under blanket quarantine or a double count gate', () => {
    const c = corpus.find(c => c.name === 'current-authorized')!;
    expect(c.expected.current).toBe(true);
    expect(c.expected.view_basic.preview).not.toBeNull();
    expect(c.expected.view_basic.locked).toMatchObject({ cross_report: 1 });
    expect(c.expected.view_basic.critical_findings).toMatchObject([{ critical: true }]);
    expect(typescript(c).full).toEqual(c.full);
  });
  it('M10: server strips first; independent client gate still rejects a raw bypass', () => {
    const c = corpus.find(c => c.name === 'missing-version-current-basic')!;
    expect(c.full.headline).toBe('Amber paper boats'); // non-vacuous raw input
    expect(typescript(c).full.headline).not.toBe(c.full.headline); // no client function involved
    expect(authorizeModelProse('interpretation.headline', c.full.headline, [])).toEqual([]);
    const valid = describeMeasuredMovement({ displayName: 'TSH', previousValue: 6, currentValue: 9,
      unit: 'uIU/mL', significance: 'significant' });
    expect(renderToStaticMarkup(createElement(ClinicalObservation, { language: valid }))).not.toBe('');
    expect(renderToStaticMarkup(createElement(ClinicalObservation, { language: { ...valid, text: c.full.headline as string } }))).toBe('');
  });
});

// This block is intentionally not called a SQL proof during ordinary Vitest.
// run.sh ALWAYS supplies this variable and asserts a nonempty file first.
// A supplied missing/empty file, missing case, extra case, or SQL-only mutation
// fails; there is no skip, SQL reimplementation, or source-text parity check.
if (process.env.TASK047_SQL_RESULTS !== undefined) {
  const sql: Array<Result & { name: string }> = JSON.parse(readFileSync(process.env.TASK047_SQL_RESULTS, 'utf8'));
  describe('TASK-047 LIVE PostgreSQL versus real TypeScript functions', () => {
    it('contains every corpus case exactly once', () => {
      expect(sql.map(c => c.name).sort()).toEqual(corpus.map(c => c.name).sort());
    });
    it.each(corpus)('M9 SQL-only negative control: $name', c => {
      const actual = sql.find(r => r.name === c.name);
      expect(actual).toBeDefined();
      const { name: _name, ...result } = actual!;
      expect(result).toEqual(typescript(c));
      expect(result).toEqual(c.expected);
    });
  });
}
