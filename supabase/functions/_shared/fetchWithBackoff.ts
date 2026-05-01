// Retrying fetch for transient upstream failures (429, 5xx, network errors).
// Each attempt gets its own AbortController so a stuck request times out
// without burning the whole budget. Backoff is exponential from
// `initialDelayMs`. Non-retriable responses (2xx, 4xx other than 429) are
// returned immediately.

interface BackoffOptions {
  tries?: number;
  initialDelayMs?: number;
  attemptTimeoutMs?: number;
}

export async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  options: BackoffOptions = {},
): Promise<Response> {
  const tries = options.tries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 250;
  const attemptTimeoutMs = options.attemptTimeoutMs;

  let lastError: unknown;

  for (let attempt = 0; attempt < tries; attempt++) {
    const controller = new AbortController();
    const tid = attemptTimeoutMs
      ? setTimeout(() => controller.abort(), attemptTimeoutMs)
      : null;

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!isRetriable(res.status) || attempt === tries - 1) {
        return res;
      }
      lastError = new Error(`Upstream ${res.status}`);
      // Drain the body so the connection can be reused on the next attempt.
      await res.body?.cancel().catch(() => {});
    } catch (err) {
      lastError = err;
      if (attempt === tries - 1) throw err;
    } finally {
      if (tid) clearTimeout(tid);
    }

    const delay = initialDelayMs * 2 ** attempt;
    await sleep(delay);
  }

  // Defensive — loop above always returns or throws on the final attempt.
  throw lastError instanceof Error
    ? lastError
    : new Error("fetchWithBackoff: exhausted retries");
}

function isRetriable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
