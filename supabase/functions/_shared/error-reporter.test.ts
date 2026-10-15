import { describe, expect, it, vi } from 'vitest';
import {
  buildEnvelope,
  createErrorReporter,
  envelopeEndpoint,
  parseSentryDsn,
  safeTags,
  SENTRY_TELEMETRY_TIMEOUT_MS,
  SENTRY_TELEMETRY_TRIES,
  type ErrorReporterActions,
} from './error-reporter.ts';

/*
  PK-FIX-01b: edge-function error capture through the reporter port. The DSN
  is the SENTRY_DSN secret (name only); with none set nothing is sent. What is
  sent is scrubbed of PHI, and a report never blocks or fails a request.
*/

const DSN = 'https://abc123public@o4500.ingest.sentry.io/4501234';

function fakeActions(overrides: Partial<ErrorReporterActions> = {}) {
  const sent: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const actions: ErrorReporterActions = {
    dsn: DSN,
    environment: 'test',
    release: 'r1',
    async send(url, headers, body) { sent.push({ url, headers, body }); },
    now: () => Date.UTC(2026, 9, 13, 12, 0, 0),
    newEventId: () => '0123456789abcdef0123456789abcdef',
    ...overrides,
  };
  return { actions, sent };
}

const eventOf = (body: string) => JSON.parse(body.split('\n')[2]!) as Record<string, unknown>;

describe('parseSentryDsn', () => {
  it('parses a standard DSN into the envelope endpoint and auth header', () => {
    const dsn = parseSentryDsn(DSN)!;
    expect(dsn).toMatchObject({ publicKey: 'abc123public', origin: 'https://o4500.ingest.sentry.io', projectId: '4501234' });
    const endpoint = envelopeEndpoint(dsn);
    expect(endpoint.url).toBe('https://o4500.ingest.sentry.io/api/4501234/envelope/');
    expect(endpoint.headers['X-Sentry-Auth']).toContain('sentry_key=abc123public');
    expect(endpoint.headers['X-Sentry-Auth']).toContain('sentry_version=7');
  });

  it('keeps a path prefix for self-hosted Sentry', () => {
    expect(envelopeEndpoint(parseSentryDsn('https://k@sentry.example.org/prefix/7')!).url)
      .toBe('https://sentry.example.org/prefix/api/7/envelope/');
  });

  it.each([undefined, null, '', '   ', 'not a url', 'https://o1.ingest.sentry.io/123', 'https://k@o1.ingest.sentry.io/abc',
    'ftp://k@o1.ingest.sentry.io/1', 'https://k:secret@o1.ingest.sentry.io/1'])('treats %j as no DSN', value => {
    expect(parseSentryDsn(value)).toBeNull();
  });
});

describe('createErrorReporter', () => {
  it('sends nothing, and says so, while SENTRY_DSN is unset', async () => {
    const { actions, sent } = fakeActions({ dsn: undefined });
    const reporter = createErrorReporter('generate-interpretation', actions);
    expect(reporter.enabled).toBe(false);
    expect(await reporter.captureException(new Error('boom'))).toBe(false);
    expect(await reporter.captureMessage('hello')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('sends one envelope with the scrubbed error, fixed tags and nothing else', async () => {
    const { actions, sent } = fakeActions();
    const reporter = createErrorReporter('parse-lab-report-ocr', actions);
    const error = new Error(
      'OpenAI API error: "Patient Jane Doe DOB 1990-04-02 TSH 4.2 uIU/mL" for jane@example.com user 3f9a1c2e-7b4d-4e8a-9f01-2c5d6e7a8b90',
    );
    expect(await reporter.captureException(error, { stage: 'openai_call', tags: { note: 'Jane Doe has TSH 4.2' } })).toBe(true);
    expect(sent).toHaveLength(1);
    const { url, body } = sent[0]!;
    expect(url).toBe('https://o4500.ingest.sentry.io/api/4501234/envelope/');

    // No PHI anywhere in what leaves.
    for (const leak of ['Jane', 'Doe', '1990', '4.2', 'uIU', 'jane@example.com', '3f9a1c2e', 'TSH']) {
      expect(body, leak).not.toContain(leak);
    }

    const event = eventOf(body);
    expect(Object.keys(event).sort()).toEqual(
      ['environment', 'event_id', 'exception', 'level', 'logger', 'platform', 'release', 'server_name', 'tags', 'timestamp'],
    );
    expect(event.exception).toEqual({ values: [{ type: 'Error', value: expect.stringContaining('OpenAI API error') }] });
    // A free-text tag is dropped; the machine label stays.
    expect(event.tags).toEqual({ function: 'parse-lab-report-ocr', stage: 'openai_call' });
    expect(event).not.toHaveProperty('user');
    expect(event).not.toHaveProperty('request');
    expect(event).not.toHaveProperty('extra');
  });

  it('scrubs a message too, so numbers for an alert travel as tags', async () => {
    const { actions, sent } = fakeActions();
    const reporter = createErrorReporter('ai-budget-check', actions);
    await reporter.captureMessage('spend 80 percent for jane@example.com', 'warning', {
      tags: { ai_budget_threshold: 0.8, ai_spend_usd: '200.00' },
    });
    const event = eventOf(sent[0]!.body);
    expect(event.message).toEqual({ formatted: 'spend [n] percent for [email]' });
    expect(event.level).toBe('warning');
    expect(event.tags).toEqual({ function: 'ai-budget-check', ai_budget_threshold: '0.8', ai_spend_usd: '200.00' });
  });

  it('never blocks or fails a request: a send that throws resolves false and is only logged', async () => {
    const onError = vi.fn();
    const { actions } = fakeActions({ send: async () => { throw new Error('network down'); }, onError });
    const reporter = createErrorReporter('lab-insights', actions);
    await expect(reporter.captureException(new Error('x'))).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a throwing logger is absorbed as well', async () => {
    const { actions } = fakeActions({
      send: async () => { throw new Error('down'); },
      onError: () => { throw new Error('logger down'); },
    });
    await expect(createErrorReporter('lab-insights', actions).captureException('x')).resolves.toBe(false);
  });

  it('a throwing clock or id source cannot fail a request either', async () => {
    const { actions } = fakeActions({ newEventId: () => { throw new Error('no entropy'); } });
    await expect(createErrorReporter('extract-biomarkers', actions).captureException(new Error('x'))).resolves.toBe(false);
  });

  it('uses the telemetry budget the owner set: one try, 3 seconds (R5)', () => {
    expect(SENTRY_TELEMETRY_TRIES).toBe(1);
    expect(SENTRY_TELEMETRY_TIMEOUT_MS).toBe(3000);
  });
});

describe('buildEnvelope', () => {
  it('is three newline-separated JSON lines with a correct item length', () => {
    const dsn = parseSentryDsn(DSN)!;
    const envelope = buildEnvelope(dsn, { event_id: 'e1', level: 'error' }, Date.UTC(2026, 0, 1));
    const [header, item, payload] = envelope.split('\n');
    expect(JSON.parse(header!)).toEqual({ event_id: 'e1', sent_at: '2026-01-01T00:00:00.000Z', dsn: DSN });
    expect(JSON.parse(item!)).toEqual({ type: 'event', content_type: 'application/json', length: payload!.length });
    expect(JSON.parse(payload!)).toEqual({ event_id: 'e1', level: 'error' });
  });
});

describe('safeTags', () => {
  it('keeps short machine identifiers and drops free text', () => {
    expect(safeTags({ stage: 'openai_call', status: 503, ok: true, note: 'Jane Doe', blank: '', missing: undefined, 'bad key': 'x' }))
      .toEqual({ stage: 'openai_call', status: '503', ok: 'true' });
  });
});
