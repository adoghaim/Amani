import { describe, expect, it, vi } from 'vitest';
import {
  dayWindowStart,
  enforceRateLimit,
  isRateLimitExceeded,
  RATE_LIMIT_EXCEEDED,
  RATE_LIMIT_UNAVAILABLE,
  type RateLimitStore,
  type StoreError,
} from './rate-limit';

const NOW = new Date('2026-08-23T13:45:12.345Z');

/** In-memory stand-in for `public.increment_rate_limit()`. */
function fakeStore(seed: Record<string, number> = {}) {
  const counters = new Map<string, number>(Object.entries(seed));
  const calls: Array<{ userId: string; endpoint: string; windowStart: string }> = [];

  const store: RateLimitStore = {
    incrementAndGet: async (args) => {
      calls.push(args);
      const key = `${args.userId}|${args.endpoint}|${args.windowStart}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return { data: next, error: null };
    },
  };

  return { store, calls, counters };
}

function brokenStore(error: StoreError): RateLimitStore {
  return { incrementAndGet: async () => ({ data: null, error }) };
}

const req = { userId: 'u1', endpoint: 'generate-interpretation', limitPerDay: 3, now: NOW };

describe('dayWindowStart', () => {
  it('truncates to the start of the UTC day', () => {
    expect(dayWindowStart(NOW)).toBe('2026-08-23T00:00:00.000Z');
  });

  it('is stable across every instant within the same UTC day', () => {
    expect(dayWindowStart(new Date('2026-08-23T00:00:00.000Z'))).toBe(
      dayWindowStart(new Date('2026-08-23T23:59:59.999Z')),
    );
  });

  it('rolls over at UTC midnight', () => {
    expect(dayWindowStart(new Date('2026-08-24T00:00:00.000Z'))).toBe(
      '2026-08-24T00:00:00.000Z',
    );
  });

  it('does not mutate the date it is given', () => {
    const now = new Date(NOW.getTime());
    dayWindowStart(now);
    expect(now.toISOString()).toBe(NOW.toISOString());
  });
});

describe('enforceRateLimit', () => {
  it('allows the first request and reports the post-increment count', async () => {
    const { store } = fakeStore();
    await expect(enforceRateLimit(store, req)).resolves.toBe(1);
  });

  it('keys the counter by user, endpoint and window', async () => {
    const { store, calls } = fakeStore();
    await enforceRateLimit(store, req);
    expect(calls).toEqual([
      {
        userId: 'u1',
        endpoint: 'generate-interpretation',
        windowStart: '2026-08-23T00:00:00.000Z',
      },
    ]);
  });

  it('allows exactly limitPerDay requests, then rejects', async () => {
    const { store } = fakeStore();
    await expect(enforceRateLimit(store, req)).resolves.toBe(1);
    await expect(enforceRateLimit(store, req)).resolves.toBe(2);
    await expect(enforceRateLimit(store, req)).resolves.toBe(3);
    await expect(enforceRateLimit(store, req)).rejects.toThrow(RATE_LIMIT_EXCEEDED);
  });

  it('stays rejected once over the limit', async () => {
    const { store } = fakeStore({ 'u1|generate-interpretation|2026-08-23T00:00:00.000Z': 9 });
    await expect(enforceRateLimit(store, req)).rejects.toThrow(RATE_LIMIT_EXCEEDED);
    await expect(enforceRateLimit(store, req)).rejects.toThrow(RATE_LIMIT_EXCEEDED);
  });

  it('counts concurrent requests exactly once each — no racer slips through', async () => {
    const { store } = fakeStore();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => enforceRateLimit(store, req)),
    );

    const allowed = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(allowed).toHaveLength(3);
    expect(rejected).toHaveLength(2);
    expect(allowed.map((r) => (r as PromiseFulfilledResult<number>).value).sort()).toEqual([
      1, 2, 3,
    ]);
  });

  it('budgets each endpoint separately', async () => {
    const { store } = fakeStore();
    await enforceRateLimit(store, { ...req, limitPerDay: 1 });
    await expect(enforceRateLimit(store, { ...req, limitPerDay: 1 })).rejects.toThrow(
      RATE_LIMIT_EXCEEDED,
    );
    await expect(
      enforceRateLimit(store, { ...req, endpoint: 'lab-insights', limitPerDay: 1 }),
    ).resolves.toBe(1);
  });

  it('budgets each user separately', async () => {
    const { store } = fakeStore();
    await enforceRateLimit(store, { ...req, limitPerDay: 1 });
    await expect(
      enforceRateLimit(store, { ...req, userId: 'u2', limitPerDay: 1 }),
    ).resolves.toBe(1);
  });

  it('starts a fresh budget on the next UTC day', async () => {
    const { store } = fakeStore();
    await enforceRateLimit(store, { ...req, limitPerDay: 1 });
    await expect(
      enforceRateLimit(store, { ...req, limitPerDay: 1, now: new Date('2026-08-24T00:00:01Z') }),
    ).resolves.toBe(1);
  });

  it('fails closed when the counter errors, and does not report it as a rate limit', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = brokenStore({ code: '57014', message: 'statement timeout' });
      await expect(enforceRateLimit(store, req)).rejects.toThrow(RATE_LIMIT_UNAVAILABLE);
      await expect(enforceRateLimit(store, req)).rejects.not.toThrow(RATE_LIMIT_EXCEEDED);
    } finally {
      spy.mockRestore();
    }
  });

  it('fails closed when the counter returns no count at all', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store: RateLimitStore = {
        incrementAndGet: async () => ({ data: null, error: null }),
      };
      await expect(enforceRateLimit(store, req)).rejects.toThrow(RATE_LIMIT_UNAVAILABLE);
    } finally {
      spy.mockRestore();
    }
  });

  it('defaults the clock to now when none is injected', async () => {
    const { store, calls } = fakeStore();
    await enforceRateLimit(store, { userId: 'u1', endpoint: 'lab-insights', limitPerDay: 1 });
    expect(calls[0].windowStart).toBe(dayWindowStart(new Date()));
  });
});

describe('isRateLimitExceeded', () => {
  it('recognises the limit error', () => {
    expect(isRateLimitExceeded(new Error(RATE_LIMIT_EXCEEDED))).toBe(true);
  });

  it('does not confuse a counter outage for a limit breach', () => {
    expect(isRateLimitExceeded(new Error(RATE_LIMIT_UNAVAILABLE))).toBe(false);
  });

  it('ignores non-errors', () => {
    expect(isRateLimitExceeded(RATE_LIMIT_EXCEEDED)).toBe(false);
    expect(isRateLimitExceeded(null)).toBe(false);
  });
});
