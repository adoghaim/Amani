/**
 * Per-user, per-endpoint daily rate limiting for the four AI edge functions.
 *
 * This replaces a read-then-write helper that had been copy-pasted into all
 * four of them and that disabled itself under concurrency: two racing requests
 * both read the same count and both wrote count + 1, and the moment that left
 * two rows for one window, `.maybeSingle()` began returning an error rather
 * than a row. Every call site destructured only `{ data }`, so the error was
 * discarded, the "no existing row" branch ran, and each subsequent request
 * inserted another count = 1 row. The limit was then unreachable for that user
 * for the rest of the day.
 *
 * The counter is now a single atomic statement behind
 * `public.increment_rate_limit()` (migration
 * 20260823010000_atomic_rate_limits.sql), which serializes racers on a unique
 * index and returns the post-increment count.
 *
 * As with `stripe-idempotency.ts`, this module deliberately has no Supabase
 * import: the counter lives behind a `RateLimitStore` port so the policy is
 * testable under Node (`rate-limit.test.ts`) while each edge function supplies
 * the PostgREST-backed implementation.
 */

/** Thrown message for "over the daily limit" — handlers map this to HTTP 429. */
export const RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED";

/**
 * Thrown message for "the counter itself is broken".
 *
 * `enforceRateLimit` fails closed, matching `subscription-guard.ts`: if we
 * cannot count a request we do not let it through. The alternative — treating a
 * store outage as "unlimited" — is precisely the unbounded-OpenAI-spend
 * failure this limiter exists to prevent.
 */
export const RATE_LIMIT_UNAVAILABLE = "RATE_LIMIT_UNAVAILABLE";

/** PostgREST-shaped failure: reported, never thrown, so callers must handle it. */
export interface StoreError {
  code?: string;
  message: string;
}

export interface RateLimitStore {
  /**
   * Atomically bump the counter for (userId, endpoint, windowStart) and resolve
   * with the count *after* the increment. Never throws; reports failure via
   * `error`.
   */
  incrementAndGet(args: {
    userId: string;
    endpoint: string;
    windowStart: string;
  }): Promise<{ data: number | null; error: StoreError | null }>;
}

export interface RateLimitRequest {
  userId: string;
  endpoint: string;
  limitPerDay: number;
  /** Injectable for tests; the edge functions let it default. */
  now?: Date;
}

/**
 * Start of the UTC day containing `now`, as an ISO timestamp.
 *
 * The old helper used `setHours(0, 0, 0, 0)` — local midnight. Deno Deploy runs
 * in UTC so the value was already this; saying UTC explicitly just makes the
 * window deterministic under a test runner with a real timezone.
 */
export function dayWindowStart(now: Date): string {
  const start = new Date(now.getTime());
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

export function isRateLimitExceeded(err: unknown): boolean {
  return err instanceof Error && err.message === RATE_LIMIT_EXCEEDED;
}

/**
 * Counts one request against the caller's daily budget.
 *
 * Resolves with the post-increment count when the request is allowed, throws
 * `RATE_LIMIT_EXCEEDED` when it is not. The increment happens before the
 * comparison — the reverse of the old check-then-write — which is what makes
 * concurrent requests impossible to slip past the limit. Exactly `limitPerDay`
 * requests are allowed per UTC day, the same budget as before.
 */
export async function enforceRateLimit(
  store: RateLimitStore,
  { userId, endpoint, limitPerDay, now = new Date() }: RateLimitRequest,
): Promise<number> {
  const { data: count, error } = await store.incrementAndGet({
    userId,
    endpoint,
    windowStart: dayWindowStart(now),
  });

  if (error || count === null) {
    console.error(
      `[rate-limit] counter unavailable for ${endpoint}, failing closed:`,
      error?.message ?? "no count returned",
    );
    throw new Error(RATE_LIMIT_UNAVAILABLE);
  }

  if (count > limitPerDay) {
    throw new Error(RATE_LIMIT_EXCEEDED);
  }

  return count;
}
