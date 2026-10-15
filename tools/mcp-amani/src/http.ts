/**
 * The HTTP side of the Amani MCP connector prototype (PK-AIDIST-01). NOT DEPLOYED.
 *
 * A pure function from a request to a response, so it is tested without a
 * listener (http.test.ts). It implements the parts of the MCP Streamable HTTP
 * transport and MCP authorization this prototype needs:
 *
 *   - POST only, one JSON-RPC message per request (no batches, no SSE stream);
 *   - the switched-off connector answers 404, before anything else, so it does
 *     not advertise itself;
 *   - an Origin header that is not on the allow-list is refused (403), the
 *     transport's DNS-rebinding defence;
 *   - an OAuth bearer token in the Authorization header only (never in the URL),
 *     verified by the injected `verifyAccessToken`; a missing or bad token gets
 *     401 with a WWW-Authenticate header naming the protected-resource metadata
 *     (RFC 9728), a token without the scope gets 403 insufficient_scope;
 *   - a body over MAX_BODY_BYTES is refused (413).
 *
 * The token is never logged or echoed. Which authorization server issues the
 * tokens (Supabase Auth acting as an OAuth 2.1 server, or a small one in front
 * of it) is an open owner question in docs/ai-distribution/design.md.
 */
import { ERRORS, REQUIRED_SCOPE, type Caller, type Connector } from './connector.ts';

export const MAX_BODY_BYTES = 64 * 1024;

export interface HttpRequest {
  readonly method: string;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface HttpDeps {
  readonly connector: Connector;
  /** Verifies an access token for this resource. Null (or a throw) means not valid. */
  verifyAccessToken(token: string): Promise<Caller | null>;
  /** Where clients find the protected-resource metadata, e.g. https://mcp.example/.well-known/oauth-protected-resource */
  readonly resourceMetadataUrl: string;
  /** Browser origins allowed to call (the assistants' own origins). Requests with no Origin header are server-to-server. */
  readonly allowedOrigins: readonly string[];
}

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function empty(status: number, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers: { 'cache-control': 'no-store', ...headers }, body: '' };
}

function json(status: number, value: unknown, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(value) };
}

function rpcError(status: number, code: number, message: string): HttpResponse {
  return json(status, { jsonrpc: '2.0', id: null, error: { code, message } });
}

/** RFC 9728 protected-resource metadata for this connector. */
export function protectedResourceMetadata(resource: string, authorizationServer: string) {
  return {
    resource,
    authorization_servers: [authorizationServer],
    scopes_supported: [REQUIRED_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Amani',
  };
}

export async function handleHttp(request: HttpRequest, deps: HttpDeps): Promise<HttpResponse> {
  if (!(await deps.connector.isEnabled())) return empty(404);
  if (request.method !== 'POST') return empty(405, { allow: 'POST' });

  const origin = request.headers.origin;
  if (origin !== undefined && !deps.allowedOrigins.includes(origin)) return empty(403);

  const challenge = `Bearer resource_metadata="${deps.resourceMetadataUrl}", scope="${REQUIRED_SCOPE}"`;
  const authorization = request.headers.authorization ?? '';
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(authorization);
  if (!match?.[1]) return empty(401, { 'www-authenticate': challenge });

  let caller: Caller | null;
  try {
    caller = await deps.verifyAccessToken(match[1]);
  } catch {
    caller = null;
  }
  if (!caller || typeof caller.userId !== 'string' || caller.userId === '') {
    return empty(401, { 'www-authenticate': `${challenge}, error="invalid_token"` });
  }
  if (!caller.scopes.includes(REQUIRED_SCOPE)) {
    return empty(403, { 'www-authenticate': `${challenge}, error="insufficient_scope"` });
  }

  if (new TextEncoder().encode(request.body).length > MAX_BODY_BYTES) return empty(413);

  let message: unknown;
  try {
    message = JSON.parse(request.body);
  } catch {
    return rpcError(400, ERRORS.PARSE, 'parse error');
  }
  if (Array.isArray(message)) return rpcError(400, ERRORS.INVALID_REQUEST, 'batches are not supported');

  const response = await deps.connector.handle(message, caller);
  if (response === null) return empty(202);
  if ('error' in response && response.error.code === ERRORS.INVALID_REQUEST) return json(400, response);
  return json(200, response);
}
