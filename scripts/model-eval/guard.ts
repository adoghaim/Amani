/**
 * The eval's only way out (RV-MM1 AC14): POST to OpenAI's Chat Completions
 * endpoint, nothing else. Any other request throws and is recorded, and a run
 * with a recorded violation fails, so a handler retry that swallows the throw
 * cannot hide it. The request cap (AMANI_EVAL_MAX_CALLS) is enforced here,
 * per HTTP request, retries included. No Supabase client exists in the eval.
 */
export const OPENAI_CHAT_COMPLETIONS = 'https://api.openai.com/v1/chat/completions';

/** What actually sends a request: global fetch in a real run, a fake in tests and dry runs. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface AttemptRecord {
  latencyMs: number;
  /** HTTP status, or null when the attempt threw. */
  status: number | null;
  /** The attempt was aborted by the handler's per-attempt timeout. */
  timedOut: boolean;
  /** The thrown error's name, never its message. */
  error: string | null;
}

export interface Guard {
  fetch(input: unknown, init?: RequestInit): Promise<Response>;
  /** Requests handed to the transport. */
  readonly sent: number;
  /** Refused requests (method and origin only) and a reached cap. */
  readonly violations: readonly string[];
}

export interface GuardOptions {
  maxRequests: number;
  now: () => number;
  /** Told about every attempt, with the response body it got (null when the attempt threw). */
  onAttempt: (attempt: AttemptRecord, responseText: string | null) => void;
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'an unparseable URL';
  }
}

export function createGuard(transport: Transport, options: GuardOptions): Guard {
  let sent = 0;
  const violations: string[] = [];
  return {
    get sent() { return sent; },
    get violations() { return violations; },
    async fetch(input, init) {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (typeof input !== 'string' || input !== OPENAI_CHAT_COMPLETIONS || method !== 'POST') {
        const what = `${method} ${typeof input === 'string' ? originOf(input) : `a ${typeof input} request`}`;
        violations.push(`blocked ${what}`);
        throw new Error(`model eval: blocked ${what}; only POST ${OPENAI_CHAT_COMPLETIONS} is allowed`);
      }
      if (sent >= options.maxRequests) {
        violations.push(`request cap of ${options.maxRequests} reached`);
        throw new Error(`model eval: request cap of ${options.maxRequests} reached (AMANI_EVAL_MAX_CALLS)`);
      }
      sent += 1;
      const started = options.now();
      try {
        const response = await transport(input, init ?? {});
        // Read once and hand the handler an equal fresh Response: a clone would tee the body, and
        // the handler's res.body.cancel() on a retriable status then waits on the unread branch.
        const text = await response.text();
        options.onAttempt({ latencyMs: options.now() - started, status: response.status, timedOut: false, error: null }, text);
        return new Response(NULL_BODY_STATUSES.has(response.status) ? null : text, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
      } catch (error) {
        const name = typeof (error as { name?: unknown })?.name === 'string' ? (error as { name: string }).name : 'Error';
        options.onAttempt({ latencyMs: options.now() - started, status: null, timedOut: name === 'AbortError', error: name }, null);
        throw error;
      }
    },
  };
}
