import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ANON_EVENTS,
  APP_EVENTS,
  APP_EVENT_PROP_KEYS,
  ATTRIBUTION_PARAMS,
  CLIENT_EVENTS,
  CODE_PATTERN,
  LANDING_PATH_PATTERN,
  SERVER_EVENTS,
  checkProps,
  isCode,
} from './app-events-policy.ts';

/*
  PK-EXP5 item 5: the allow-lists are defined once, in app-events-policy.ts,
  and shared by the SQL CHECK, the RPCs, the edge functions and the client.
  SQL cannot import TypeScript, so this test reads the migration's allow-list
  functions and fails when any list differs from the TypeScript one, and reads
  the client and the edge functions to prove they import this module rather
  than keeping copies.
*/

const MIGRATION = readFileSync(new URL('../../migrations/20261015010000_first_party_events.sql', import.meta.url), 'utf8');
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The quoted strings of `CREATE FUNCTION public.<name>() ... ARRAY[ ... ]`. */
function sqlArray(name: string): string[] {
  const start = MIGRATION.indexOf(`CREATE FUNCTION public.${name}()`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const open = MIGRATION.indexOf('ARRAY[', start);
  const close = MIGRATION.indexOf(']', open);
  return [...MIGRATION.slice(open, close).matchAll(/'([^']*)'/g)].map(m => m[1]!);
}

describe('allow-lists: one definition, the same in SQL', () => {
  it.each([
    ['app_events_allowed_events', APP_EVENTS],
    ['app_events_client_events', CLIENT_EVENTS],
    ['app_events_anon_events', ANON_EVENTS],
    ['app_events_allowed_prop_keys', APP_EVENT_PROP_KEYS],
    ['user_attribution_keys', [...ATTRIBUTION_PARAMS, 'code', 'landing_path']],
  ] as const)('%s matches the TypeScript list, in order', (fn, list) => {
    expect(sqlArray(fn)).toEqual([...list]);
  });

  it('is the owner-approved list: 14 events, 11 prop keys', () => {
    expect([...APP_EVENTS]).toEqual(['landing_view', 'signup_started', 'signup_completed', 'onboarding_completed',
      'upload_started', 'report_parsed', 'interpretation_generated', 'report_viewed', 'compare_viewed',
      'paywall_viewed', 'checkout_started', 'trial_started', 'subscription_activated', 'account_deleted']);
    expect([...APP_EVENT_PROP_KEYS]).toEqual(['platform', 'app_version', 'utm_source', 'utm_medium', 'utm_campaign',
      'utm_content', 'utm_term', 'promo', 'ref', 'report_index', 'tier']);
  });

  it('splits every event into exactly one door: before signup, signed-in client, or server', () => {
    const doors = [...ANON_EVENTS, ...CLIENT_EVENTS, ...SERVER_EVENTS];
    expect(new Set(doors).size).toBe(doors.length);
    expect([...doors].sort()).toEqual([...APP_EVENTS].sort());
    // A client can never claim a trial, a subscription or an interpretation.
    for (const event of SERVER_EVENTS) expect(CLIENT_EVENTS as readonly string[]).not.toContain(event);
  });

  it('the SQL code and path rules are the TypeScript patterns', () => {
    expect(MIGRATION).toContain(`p_value ~ '${CODE_PATTERN.source}'`);
    expect(MIGRATION).toContain(`landing_path ~ '${LANDING_PATH_PATTERN.source.replace('\\/', '/').replace('\\/', '/')}'`);
    expect(MIGRATION).toContain("octet_length(p_props::text) <= 1024");
    expect(MIGRATION).toContain('(kv.value::text)::integer <= 10000');
  });

  it('the client and every server door import this module instead of keeping a copy', () => {
    expect(read('../../../src/lib/firstPartyEvents.ts')).toMatch(/from '\.\.\/\.\.\/supabase\/functions\/_shared\/app-events-policy'/);
    expect(read('./app-events.ts')).toContain('from "./app-events-policy.ts"');
    for (const handler of ['log-anon-event', 'stripe-webhook', 'iap-webhook', 'generate-interpretation', 'delete-user-data']) {
      expect(read(`../${handler}/index.ts`), handler).toMatch(/from ['"]\.\.\/_shared\/app-events\.ts['"]/);
    }
    // No second copy of the event list anywhere in the client.
    expect(read('../../../src/lib/firstPartyEvents.ts')).not.toContain("'interpretation_generated'");
  });
});

describe('the value rules (D5.3)', () => {
  it.each(['abc', 'A.b-c_9', 'x'.repeat(64), 'SPRING25', 'creator.jane'])('accepts %s', value => {
    expect(isCode(value)).toBe(true);
  });

  it.each(['', 'x'.repeat(65), 'a b', 'a/b', '<script>', 'ignore previous instructions', 'é', 'a\nb', 'a\u0000',
    "a'b", 'a;b', '{{x}}', 'a%20b'])('rejects %j', value => {
    expect(isCode(value)).toBe(false);
  });

  it('checkProps keeps allow-listed keys with token values and report_index as a small whole number', () => {
    expect(checkProps(undefined)).toEqual({ ok: true, props: {} });
    expect(checkProps({ platform: 'web', report_index: 2, utm_source: 'tiktok' }))
      .toEqual({ ok: true, props: { platform: 'web', report_index: 2, utm_source: 'tiktok' } });
  });

  it.each([
    ['an unknown key', { email: 'a' }],
    ['a health value under a known key', { tier: '5.4 mIU/L' }],
    ['free text', { utm_campaign: 'my campaign!' }],
    ['a nested object', { platform: { os: 'ios' } }],
    ['a number where a token belongs', { platform: 1 }],
    ['a fractional report_index', { report_index: 1.5 }],
    ['a negative report_index', { report_index: -1 }],
    ['an oversized report_index', { report_index: 10001 }],
    ['a string report_index', { report_index: '2' }],
    ['an array', ['platform']],
    ['a string', 'platform'],
  ])('checkProps rejects %s', (_label, props) => {
    expect(checkProps(props).ok).toBe(false);
  });
});
