import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CONSENT_CHECK_UNAVAILABLE_CODE, CONSENT_FLAG_TTL_MS, CONSENT_GATE_FLAG, CONSENT_READ_TIMEOUT_MS, CONSENT_REQUIRED_CODE,
  CONSENT_TYPES, CURRENT_CONSENT_VERSION, consentGateFromConfig, consentRefusal, createConsentGate, hasCurrentConsent,
  isMissingRelationError, missingConsents, type ConsentGateActions,
} from './consent';
import { consentGateFor, resetConsentGateForTests, supabaseConsentActions, type ConsentDbClient } from './consent-gate-supabase';
import * as clientPolicy from '../../../src/lib/consent/consentPolicy';

/*
  PK-CONSENT-01: the server-side consent gate. Uploads and AI processing need
  current consent while features.consent_gate is on; off, nothing is read and
  everything is allowed, exactly as before the gate existed.
*/

const grant = (consent_type: string, version = CURRENT_CONSENT_VERSION) => ({ consent_type, version, granted: true });
const ALL = CONSENT_TYPES.map(type => grant(type));
const config = (features: unknown) => [{ key: 'min_version_ios', value: null }, { key: 'features', value: features }];

function actions(over: Partial<ConsentGateActions> & { clock?: { t: number } } = {}) {
  const clock = over.clock ?? { t: 1_000 };
  const calls = { config: 0, consents: [] as string[] };
  const port: ConsentGateActions = {
    readPublicConfig: over.readPublicConfig ?? (async () => { calls.config++; return config({ [CONSENT_GATE_FLAG]: true }); }),
    readCurrentConsents: over.readCurrentConsents ?? (async (userId) => { calls.consents.push(userId); return ALL; }),
    now: () => clock.t,
    onError: over.onError ?? (() => {}),
  };
  if (over.readPublicConfig) {
    const inner = over.readPublicConfig;
    port.readPublicConfig = async (signal) => { calls.config++; return inner(signal); };
  }
  if (over.readCurrentConsents) {
    const inner = over.readCurrentConsents;
    port.readCurrentConsents = async (userId, signal) => { calls.consents.push(userId); return inner(userId, signal); };
  }
  return { port, calls, clock };
}

afterEach(() => {
  vi.useRealTimers();
  resetConsentGateForTests();
});

describe('missingConsents (the policy)', () => {
  it('needs a current grant of all three types: 18+, health data, AI processing', () => {
    expect([...CONSENT_TYPES]).toEqual(['age_18_plus', 'health_data', 'ai_processing']);
    expect(missingConsents(ALL)).toEqual([]);
    expect(hasCurrentConsent(ALL)).toBe(true);
    expect(missingConsents([])).toEqual(['age_18_plus', 'health_data', 'ai_processing']);
  });

  it.each([
    ['a withdrawal', [grant('age_18_plus'), grant('health_data'), { consent_type: 'ai_processing', version: CURRENT_CONSENT_VERSION, granted: false }], ['ai_processing']],
    ['a grant at an older version', [grant('age_18_plus'), grant('health_data', 'draft-0'), grant('ai_processing')], ['health_data']],
    ['a missing type', [grant('age_18_plus'), grant('ai_processing')], ['health_data']],
    ['a truthy but non-boolean grant', [grant('age_18_plus'), grant('health_data'), { consent_type: 'ai_processing', version: CURRENT_CONSENT_VERSION, granted: 'true' }], ['ai_processing']],
    ['junk rows', [null, 7, 'x', grant('age_18_plus'), grant('health_data'), grant('ai_processing')], []],
  ])('%s', (_label, answers, missing) => {
    expect(missingConsents(answers)).toEqual(missing);
  });

  it('fails closed on a reply that is not a list', () => {
    expect(() => missingConsents(null)).toThrow();
    expect(() => missingConsents({ data: [] })).toThrow();
  });
});

describe('consentGateFromConfig: the same key the client reads (finding 7)', () => {
  it.each([
    [config({ consent_gate: true }), true],
    [config({ consent_gate: false }), false],
    [config({}), false],
    [config({ consent_gate: 'true' }), false],
    [config(null), false],
    [config([true]), false],
    [[{ key: 'min_version_ios', value: null }], false],
  ])('%j -> %s', (rows, on) => {
    expect(consentGateFromConfig(rows)).toBe(on);
  });

  it('a missing relation is PGRST205 or 42P01, nothing else', () => {
    expect(isMissingRelationError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingRelationError({ code: '42P01' })).toBe(true);
    expect(isMissingRelationError({ code: '57014' })).toBe(false);
    expect(isMissingRelationError(new Error('PGRST205'))).toBe(false);
  });
});

describe('createConsentGate', () => {
  it('flag off: allows and never reads her consent (today\'s behaviour)', async () => {
    const { port, calls } = actions({ readPublicConfig: async () => config({}) });
    const gate = createConsentGate(port);
    await expect(gate.check('user-1')).resolves.toEqual({ allowed: true, gate: 'off' });
    expect(calls.consents).toEqual([]);
  });

  it('flag on: allows with current consent, refuses with what is missing', async () => {
    const answers: unknown[] = [...ALL];
    const { port } = actions({ readCurrentConsents: async () => answers });
    const gate = createConsentGate(port);
    await expect(gate.check('user-1')).resolves.toEqual({ allowed: true, gate: 'on' });
    answers.splice(0, answers.length, grant('age_18_plus'));
    await expect(gate.check('user-1')).resolves.toEqual({
      allowed: false, reason: CONSENT_REQUIRED_CODE, missing: ['health_data', 'ai_processing'] });
  });

  it('her consent is never cached: a withdrawal stops the very next request', async () => {
    let current: unknown[] = ALL;
    const { port, calls } = actions({ readCurrentConsents: async () => current });
    const gate = createConsentGate(port);
    expect((await gate.check('user-1')).allowed).toBe(true);
    current = [grant('age_18_plus'), grant('health_data')];
    expect((await gate.check('user-1')).allowed).toBe(false);
    expect(calls.consents).toEqual(['user-1', 'user-1']);
  });

  it('a failed consent read fails closed with a retryable refusal, and is reported', async () => {
    const onError = vi.fn();
    const { port } = actions({ readCurrentConsents: async () => { throw new Error('connection reset'); }, onError });
    await expect(createConsentGate(port).check('user-1')).resolves.toEqual({ allowed: false, reason: CONSENT_CHECK_UNAVAILABLE_CODE });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('a malformed consent reply fails closed', async () => {
    const { port } = actions({ readCurrentConsents: async () => ({ rows: ALL }) });
    await expect(createConsentGate(port).check('user-1')).resolves.toEqual({ allowed: false, reason: CONSENT_CHECK_UNAVAILABLE_CODE });
  });

  it('caches the flag for the TTL, then reads it again', async () => {
    const { port, calls, clock } = actions();
    const gate = createConsentGate(port);
    await gate.check('a');
    clock.t += CONSENT_FLAG_TTL_MS - 1;
    await gate.check('b');
    expect(calls.config).toBe(1);
    clock.t += 1;
    await gate.check('c');
    expect(calls.config).toBe(2);
  });

  it('config table not deployed (PGRST205, as the error or its cause): the gate is off', async () => {
    for (const thrown of [{ code: 'PGRST205', message: 'Could not find the table' },
      new Error('Reading app_public_config failed', { cause: { code: '42P01' } })]) {
      const { port, calls } = actions({ readPublicConfig: async () => { throw thrown; } });
      await expect(createConsentGate(port).check('user-1')).resolves.toEqual({ allowed: true, gate: 'off' });
      expect(calls.consents).toEqual([]);
    }
  });

  it('any other flag-read failure on a cold start fails closed: the gate is on', async () => {
    const { port, calls } = actions({ readPublicConfig: async () => { throw new Error('timeout'); } });
    const gate = createConsentGate(port);
    expect(await gate.isGateOn()).toBe(true);
    await expect(gate.check('user-1')).resolves.toEqual({ allowed: true, gate: 'on' });
    expect(calls.consents).toEqual(['user-1']);
  });

  it('a flag-read failure after a good read keeps the last value', async () => {
    let fail = false;
    const { port, clock } = actions({ readPublicConfig: async () => { if (fail) throw new Error('outage'); return config({}); } });
    const gate = createConsentGate(port);
    expect(await gate.isGateOn()).toBe(false);
    fail = true;
    clock.t += CONSENT_FLAG_TTL_MS;
    expect(await gate.isGateOn()).toBe(false);
  });

  it('a read that hangs is aborted after the 10 s business-call budget (D8/D10) and fails closed', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const { port } = actions({
      readCurrentConsents: (_user, signal) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }),
    });
    const result = createConsentGate(port).check('user-1');
    await vi.advanceTimersByTimeAsync(CONSENT_READ_TIMEOUT_MS);
    await expect(result).resolves.toEqual({ allowed: false, reason: CONSENT_CHECK_UNAVAILABLE_CODE });
    expect(aborted).toBe(true);
    expect(CONSENT_READ_TIMEOUT_MS).toBe(10_000);
  });

  it('a throwing error reporter does not turn a handled failure into an outage', async () => {
    const { port } = actions({ readCurrentConsents: async () => { throw new Error('x'); }, onError: () => { throw new Error('reporter'); } });
    await expect(createConsentGate(port).check('u')).resolves.toMatchObject({ allowed: false });
  });
});

describe('consentRefusal', () => {
  it('allowed: no response', () => {
    expect(consentRefusal({ allowed: true, gate: 'off' })).toBeNull();
    expect(consentRefusal({ allowed: true, gate: 'on' })).toBeNull();
  });
  it('missing consent: 403 consent_required, not retryable, naming what is missing', () => {
    expect(consentRefusal({ allowed: false, reason: CONSENT_REQUIRED_CODE, missing: ['ai_processing'] })).toEqual({
      status: 403,
      body: expect.objectContaining({ code: 'consent_required', missing: ['ai_processing'], retry: false }),
    });
  });
  it('check unavailable: 503, retryable, nothing processed', () => {
    expect(consentRefusal({ allowed: false, reason: CONSENT_CHECK_UNAVAILABLE_CODE })).toEqual({
      status: 503,
      body: expect.objectContaining({ code: 'consent_check_unavailable', retry: true }),
    });
  });
});

describe('supabaseConsentActions (wiring)', () => {
  function fakeClient(replies: Record<string, { data: unknown; error: { message: string; code?: string } | null }>) {
    const log: string[] = [];
    const client: ConsentDbClient = {
      from(table) {
        const query = {
          select(columns: string) { log.push(`${table}.select(${columns})`); return query; },
          eq(column: string, value: string) { log.push(`${table}.eq(${column},${value})`); return query; },
          abortSignal(signal: AbortSignal) { log.push(`${table}.abortSignal(${signal instanceof AbortSignal})`); return query; },
          then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
            return Promise.resolve(replies[table]).then(resolve, reject);
          },
        };
        return query;
      },
    };
    return { client, log };
  }

  it('reads the flag from app_public_config and her latest answers from consent_current, by user_id', async () => {
    const { client, log } = fakeClient({
      app_public_config: { data: config({ consent_gate: true }), error: null },
      consent_current: { data: ALL, error: null },
    });
    await expect(createConsentGate(supabaseConsentActions(client)).check('user-9')).resolves.toEqual({ allowed: true, gate: 'on' });
    expect(log).toEqual([
      'app_public_config.select(key,value)', 'app_public_config.abortSignal(true)',
      'consent_current.select(consent_type,version,granted)', 'consent_current.eq(user_id,user-9)', 'consent_current.abortSignal(true)',
    ]);
  });

  it('a PostgREST error throws with its code as the cause, so a missing table reads as off', async () => {
    const { client } = fakeClient({ app_public_config: { data: null, error: { message: 'Could not find the table', code: 'PGRST205' } } });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(createConsentGate(supabaseConsentActions(client)).check('u')).resolves.toEqual({ allowed: true, gate: 'off' });
    errors.mockRestore();
  });

  it('consentGateFor keeps one gate per isolate, so the flag cache survives between requests', () => {
    const { client } = fakeClient({});
    expect(consentGateFor(client)).toBe(consentGateFor(client));
  });
});

describe('one policy everywhere', () => {
  const migration = readFileSync(new URL('../../migrations/20261015040000_consent_records.sql', import.meta.url), 'utf8');

  it('consent_required_version() in the migration is CURRENT_CONSENT_VERSION', () => {
    const sqlVersion = /consent_required_version\(\) RETURNS text[\s\S]*?SELECT '([^']+)'::text/.exec(migration)?.[1];
    expect(sqlVersion).toBe(CURRENT_CONSENT_VERSION);
  });

  it('the migration checks the same three types', () => {
    const types = /consent_type text NOT NULL CHECK \(consent_type IN \(([^)]*)\)\)/.exec(migration)?.[1];
    expect(types?.split(',').map(t => t.trim().replace(/'/g, ''))).toEqual([...CONSENT_TYPES]);
  });

  it('the client mirror (src/lib/consent/consentPolicy.ts) agrees', () => {
    expect([...clientPolicy.CONSENT_TYPES]).toEqual([...CONSENT_TYPES]);
    expect(clientPolicy.CURRENT_CONSENT_VERSION).toBe(CURRENT_CONSENT_VERSION);
    expect(clientPolicy.CONSENT_GATE_FLAG).toBe(CONSENT_GATE_FLAG);
    for (const answers of [[], ALL, [grant('age_18_plus')], [grant('health_data', 'old'), grant('ai_processing')]]) {
      expect(clientPolicy.missingConsents(answers)).toEqual(missingConsents(answers));
    }
  });
});

describe('the four processing functions check consent first (D7.1)', () => {
  it.each(['parse-lab-report-ocr', 'extract-biomarkers', 'lab-insights', 'generate-interpretation'])('%s', (name) => {
    const source = readFileSync(new URL(`../${name}/index.ts`, import.meta.url), 'utf8');
    const handler = source.slice(source.indexOf('Deno.serve('));
    const check = handler.indexOf('consentRefusal(await consentGateFor(');
    expect(check, 'the handler calls the consent gate').toBeGreaterThan(0);
    expect(handler.indexOf('getUser()'), 'after authenticating her').toBeLessThan(check);
    expect(check, 'before the rate limit is spent').toBeLessThan(handler.indexOf('enforceRateLimit('));
    const openai = handler.search(/api\.openai\.com|tryOpenAI\(|fetchWithBackoff\(/);
    if (openai >= 0) expect(check, 'before any OpenAI call').toBeLessThan(openai);
    expect(handler.slice(check, check + 400)).toContain('consentRefused.status');
  });
});
