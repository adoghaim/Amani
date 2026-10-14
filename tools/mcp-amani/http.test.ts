import { describe, expect, it, vi } from 'vitest';
import { ERRORS, FEATURE_FLAG, REQUIRED_SCOPE, createConnector, type Caller } from './src/connector.ts';
import { MAX_BODY_BYTES, handleHttp, protectedResourceMetadata, type HttpDeps, type HttpRequest } from './src/http.ts';

const TOKEN = 'good-token.abc';
const METADATA = 'https://mcp.amani.test/.well-known/oauth-protected-resource';
const ASSISTANT = 'https://assistant.example';

function deps(overrides: { flag?: boolean; verify?: HttpDeps['verifyAccessToken'] } = {}) {
  const listReports = vi.fn(async () => []);
  const connector = createConnector({
    readPublicConfigRows: async () => [{ key: 'features', value: overrides.flag === false ? {} : { [FEATURE_FLAG]: true } }],
    hasConnectorConsent: async () => true,
    listReports,
    findReport: async () => null,
    rateLimitStore: { incrementAndGet: async () => ({ data: 1, error: null }) },
    appOrigin: 'https://amanibiometrics.com',
  });
  const verifyAccessToken = overrides.verify ?? vi.fn(async (token: string): Promise<Caller | null> =>
    token === TOKEN ? { userId: 'user-alice', scopes: [REQUIRED_SCOPE] } : null);
  return { listReports, verifyAccessToken, deps: { connector, verifyAccessToken, resourceMetadataUrl: METADATA, allowedOrigins: [ASSISTANT] } };
}

const post = (body: unknown, headers: Record<string, string> = {}): HttpRequest => ({
  method: 'POST',
  headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_my_reports' } };

describe('handleHttp', () => {
  it('serves a tools/call with a valid token', async () => {
    const { deps: d, listReports } = deps();
    const response = await handleHttp(post(LIST), d);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(response.body)).toMatchObject({ id: 1, result: { structuredContent: { reports: [] } } });
    expect(listReports).toHaveBeenCalledWith('user-alice', 20);
  });

  it('answers 404 to everything while the flag is off, before checking the token', async () => {
    const { deps: d, verifyAccessToken } = deps({ flag: false });
    for (const request of [post(LIST), { method: 'GET', headers: {}, body: '' }, post(LIST, { authorization: '' })]) {
      const response = await handleHttp(request, d);
      expect(response).toEqual({ status: 404, headers: { 'cache-control': 'no-store' }, body: '' });
    }
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('a missing or malformed bearer gets 401 with the resource metadata', async () => {
    const { deps: d } = deps();
    for (const authorization of [undefined, '', 'Basic abc', `bearer ${TOKEN}`, `Bearer ${TOKEN} extra`]) {
      const headers: Record<string, string | undefined> = { authorization };
      const response = await handleHttp({ method: 'POST', headers, body: JSON.stringify(LIST) }, d);
      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe(`Bearer resource_metadata="${METADATA}", scope="${REQUIRED_SCOPE}"`);
      expect(response.body).toBe('');
    }
  });

  it('an invalid or failing token gets 401 invalid_token, and the token is never echoed', async () => {
    const throwing = deps({ verify: async () => { throw new Error('jwks down'); } });
    for (const [d, auth] of [[deps().deps, 'Bearer wrong-token'], [throwing.deps, `Bearer ${TOKEN}`]] as const) {
      const response = await handleHttp(post(LIST, { authorization: auth }), d);
      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
      expect(JSON.stringify(response)).not.toContain('token.abc');
      expect(JSON.stringify(response)).not.toContain('wrong-token');
    }
  });

  it('a token without the scope gets 403 insufficient_scope', async () => {
    const { deps: d, listReports } = deps({ verify: async () => ({ userId: 'user-alice', scopes: ['profile'] }) });
    const response = await handleHttp(post(LIST), d);
    expect(response.status).toBe(403);
    expect(response.headers['www-authenticate']).toContain('error="insufficient_scope"');
    expect(listReports).not.toHaveBeenCalled();
  });

  it('a token without a user is refused', async () => {
    const { deps: d } = deps({ verify: async () => ({ userId: '', scopes: [REQUIRED_SCOPE] }) });
    expect((await handleHttp(post(LIST), d)).status).toBe(401);
  });

  it('refuses an origin that is not allowed (DNS rebinding) and allows a listed one', async () => {
    const { deps: d } = deps();
    expect((await handleHttp(post(LIST, { origin: 'https://evil.example' }), d)).status).toBe(403);
    expect((await handleHttp(post(LIST, { origin: ASSISTANT }), d)).status).toBe(200);
  });

  it('only POST', async () => {
    const { deps: d } = deps();
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const response = await handleHttp({ ...post(LIST), method }, d);
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe('POST');
    }
  });

  it('refuses oversized bodies, bad JSON, batches and invalid requests', async () => {
    const { deps: d, listReports } = deps();
    expect((await handleHttp(post('x'.repeat(MAX_BODY_BYTES + 1)), d)).status).toBe(413);
    const parse = await handleHttp(post('{not json'), d);
    expect(parse.status).toBe(400);
    expect(JSON.parse(parse.body)).toMatchObject({ error: { code: ERRORS.PARSE } });
    const batch = await handleHttp(post([LIST, LIST]), d);
    expect(batch.status).toBe(400);
    expect(JSON.parse(batch.body)).toMatchObject({ error: { code: ERRORS.INVALID_REQUEST } });
    expect((await handleHttp(post({ id: 1, method: 'ping' }), d)).status).toBe(400);
    expect(listReports).not.toHaveBeenCalled();
  });

  it('accepts a notification with 202 and no body', async () => {
    const { deps: d } = deps();
    const response = await handleHttp(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), d);
    expect(response.status).toBe(202);
    expect(response.body).toBe('');
  });
});

describe('protectedResourceMetadata (RFC 9728)', () => {
  it('names the authorization server, the one scope and header-only bearer tokens', () => {
    expect(protectedResourceMetadata('https://mcp.amani.test/mcp', 'https://auth.amani.test')).toEqual({
      resource: 'https://mcp.amani.test/mcp',
      authorization_servers: ['https://auth.amani.test'],
      scopes_supported: [REQUIRED_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'Amani',
    });
  });
});
