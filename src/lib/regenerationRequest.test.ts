import { describe, expect, it } from 'vitest';
import { createRegenerationRequests } from './regenerationRequest';

const sequence = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('regeneration request identity', () => {
  it('a new tap is a new id', () => {
    const requests = createRegenerationRequests(sequence());
    expect(requests.next(false)).toBe('id-1');
    expect(requests.next(false)).toBe('id-2');
  });

  it('a retry after a failure re-sends the same id', () => {
    const requests = createRegenerationRequests(sequence());
    const first = requests.next(false);
    expect(requests.next(true)).toBe(first);
    expect(requests.next(true)).toBe(first);
  });

  it('success settles the tap: a later retry is a new request', () => {
    const requests = createRegenerationRequests(sequence());
    requests.next(false);
    requests.settle();
    expect(requests.next(true)).toBe('id-2');
  });

  it('a retry with nothing pending starts a new request', () => {
    expect(createRegenerationRequests(sequence()).next(true)).toBe('id-1');
  });

  it('defaults to a v4 UUID, which the server schema requires', () => {
    expect(createRegenerationRequests().next(false)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
