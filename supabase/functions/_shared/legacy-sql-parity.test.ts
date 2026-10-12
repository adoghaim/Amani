/** TASK-047: shared expectations; live parity requires the harness-provided DB output. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClinicalObservation } from '../../../src/components/ClinicalObservation';
import { authorizeModelProse, describeMeasuredMovement } from '../../../src/lib/scoring/insightCopy';
import { storedClaimSet, quarantineCustomerRead, legacyCustomerFloor, servedBasic } from './claim-authority';
import { sanitizeBasicProjection, isDeterministicSource, BASIC_KEYS } from './interpretation-visibility';
import { readInterpretation } from './interpretation-read';
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

// TASK-048 turn 8. interpretation-versions.run.sh §10 ALWAYS supplies this from
// interpretation-versions.read-export.sql after the reader cutover; ordinary
// Vitest has no live SQL and skips it. The SQL readers choose the body; the
// real TS functions decide what that body must be, from the exported inputs.
if (process.env.TASK048_READ_RESULTS !== undefined) {
  type Stored = { id: string; full: InterpretationPayload; basic: InterpretationPayload; source: string | null;
    generated_at: string; stored_depth: string };
  type RpcRow = { json_output: InterpretationPayload; stored_depth: string; has_claim: boolean; tier: string;
    interpretation_source: string | null; historical_interpretation_id: string | null;
    selected_version_id: string | null; selected_generated_at: string | null };
  type ViewRow = { id: string; json_output: InterpretationPayload; generated_at: string; disclaimer_version: string | null;
    interpretation_source: string | null; tier: string };
  type ReadCase = { name: string; history: Stored; selected: Stored | null; rpc_full: RpcRow; rpc_basic: RpcRow;
    view_off: ViewRow; view_on: ViewRow };
  const cases: ReadCase[] = JSON.parse(readFileSync(process.env.TASK048_READ_RESULTS, 'utf8'));
  describe('TASK-048 LIVE version readers versus real TypeScript functions', () => {
    it('contains every version case exactly once', () => {
      expect(cases.map(c => c.name).sort()).toEqual(['current-no-versions', 'never-remediated', 'selected-covered',
        'selected-covered-rewound', 'selected-uncovered', 'selected-uncovered-rewound', 'version-without-pointer']);
      expect(cases.filter(c => c.selected !== null).map(c => c.name).sort()).toEqual(['selected-covered',
        'selected-covered-rewound', 'selected-uncovered', 'selected-uncovered-rewound']);
    });
    it.each(cases)('version parity: $name', async c => {
      // Selected version when there is one; otherwise the historical row, as before.
      const served = c.selected ?? c.history;
      const trusted = isDeterministicSource(served.source) || storedClaimSet(served.full) !== null;
      const full = quarantineCustomerRead(served.full, true, served.source);
      const basic = trusted ? sanitizeBasicProjection(served.basic, served.source) : legacyCustomerFloor();
      const covered = c.rpc_basic.has_claim; // fixtures hold no subscription: claim is the only Full route
      expect(c.rpc_full.json_output).toEqual(full);
      expect(c.rpc_basic.json_output).toEqual(covered ? full : basic);
      expect(c.view_off.json_output).toEqual(full);
      expect(c.view_on.json_output).toEqual(covered ? full : trusted ? servedBasic(basic) : legacyCustomerFloor());
      for (const row of [c.rpc_full, c.rpc_basic]) {
        expect(row.stored_depth).toBe(served.stored_depth);
        expect(row.interpretation_source).toBe(served.source);
        expect(row.selected_version_id).toBe(c.selected?.id ?? null);
        expect(row.selected_generated_at).toBe(c.selected?.generated_at ?? null);
        expect(row.historical_interpretation_id).toBe(c.selected ? c.history.id : null);
      }
      for (const row of [c.view_off, c.view_on]) {
        expect(row.id).toBe(c.history.id);
        expect(row.generated_at).toBe(served.generated_at);
      }
      // The same SQL rows through the real edge read policy.
      const result = await readInterpretation({ ownsReport: async () => true,
        resolveEntitlement: async () => ({ allowed: true, plan: 'free' }),
        readSelected: async premium => premium ? c.rpc_full : c.rpc_basic, countClaims: async () => 1 }, true);
      expect(result.status).toBe(200);
      expect(result.body.version).toEqual(c.selected ? { id: c.selected.id, generated_at: c.selected.generated_at } : null);
      expect(result.body.historical_interpretation_id).toBe(c.selected ? c.history.id : null);
      if (c.selected) expect(result.body.version?.id).not.toBe(c.history.id);
      expect(JSON.stringify([c.rpc_full, c.rpc_basic, c.view_off, c.view_on, result.body])).not.toContain('H048V historical');
    });
  });
}
