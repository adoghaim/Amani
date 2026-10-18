import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractDateFromText } from './extractDateFromText';

/*
  The draw date read off a PDF pre-fills "Date your blood was drawn", which is
  stored as report_date. A bare ISO date went through `new Date`, which reads
  it as midnight UTC, and then through local getters: one day early anywhere
  west of UTC. Every case runs either side of UTC; CI itself runs in UTC.
*/
const ZONES = ['UTC', 'America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo', 'Pacific/Kiritimati'];

const originalZone = process.env.TZ;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 17, 12)));
});
afterEach(() => {
  vi.useRealTimers();
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

describe.each(ZONES)('a printed draw date read in %s', zone => {
  beforeEach(() => { process.env.TZ = zone; });

  it.each([
    // The synthetic Quest PDF's own line (2026-10-17 smoke test).
    ['Collected: 10/10/2026 Reported: 10/11/2026', '2026-10-10'],
    ['Collection Date: 2026-10-10', '2026-10-10'],
    ['Date: 2026-10-01', '2026-10-01'],
    ['Date of Service: October 10, 2026', '2026-10-10'],
  ])('%s is %s', (text, expected) => {
    expect(extractDateFromText(text)).toBe(expected);
  });

  it('a printed day that does not exist is not a draw date', () => {
    expect(extractDateFromText('Collection Date: 2026-02-30')).toBeNull();
  });

  it('a year outside 2000 to next year is not a draw date', () => {
    expect(extractDateFromText('Collection Date: 1999-12-31')).toBeNull();
    expect(extractDateFromText('Collection Date: 2028-01-01')).toBeNull();
  });
});
