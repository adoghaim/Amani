import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateLong, formatDateOrNull } from './formatters';

/*
  2026-10-17 production smoke test: a report drawn on 2026-10-10 read
  "Last panel Oct 9" on the Tracker while the report said October 10.
  `new Date('2026-10-10')` is midnight UTC, still October 9 anywhere west of
  UTC. CI runs in UTC, where that cannot show, so every case here runs in zones
  either side of it: both date-line extremes, half-hour offsets, and northern
  and southern daylight saving.
*/
const ZONES = [
  'UTC',
  'America/Los_Angeles', // the smoke test's zone family: UTC-7 in October
  'America/New_York',
  'Pacific/Honolulu', // UTC-10, no daylight saving
  'Pacific/Pago_Pago', // UTC-11
  'America/St_Johns', // UTC-2:30 / -3:30
  'Europe/London',
  'Asia/Kolkata', // UTC+5:30
  'Asia/Tokyo',
  'Australia/Sydney', // southern-hemisphere daylight saving
  'Pacific/Kiritimati', // UTC+14
] as const;

const originalZone = process.env.TZ;
const inZone = (zone: string) => { process.env.TZ = zone; };
afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

describe('the zone harness can see the defect class it guards', () => {
  it('reads a bare day as the evening before west of UTC, the way the Tracker did', () => {
    inZone('America/Los_Angeles');
    expect(new Date('2026-10-10').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).toBe('Oct 9');
    inZone('Asia/Tokyo');
    expect(new Date('2026-10-10').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).toBe('Oct 10');
  });
});

describe.each(ZONES)('a calendar day (YYYY-MM-DD) read in %s', zone => {
  beforeEach(() => inZone(zone));

  it('is the stored day: the Tracker last panel, the report header and lists', () => {
    expect(formatDate('2026-10-10', { month: 'short', day: 'numeric' })).toBe('Oct 10');
    expect(formatDate('2026-10-10')).toBe('Oct 10, 2026');
    expect(formatDateLong('2026-10-10')).toBe('October 10, 2026');
  });

  it('keeps month and year boundaries: "your October 2026 report"', () => {
    expect(formatDateOrNull('2026-10-01', { year: 'numeric', month: 'long' })).toBe('October 2026');
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDate('2025-12-31')).toBe('Dec 31, 2025');
    expect(formatDate('2028-02-29')).toBe('Feb 29, 2028');
  });

  it('is unmoved on daylight-saving change days', () => {
    // United States, European Union and Australian changes in 2026.
    expect(['2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25', '2026-04-05', '2026-10-04'].map(d => formatDate(d)))
      .toEqual(['Mar 8, 2026', 'Nov 1, 2026', 'Mar 29, 2026', 'Oct 25, 2026', 'Apr 5, 2026', 'Oct 4, 2026']);
  });

  it('names no date when the day does not exist, rather than rolling into the next month', () => {
    expect(formatDateOrNull('2026-02-30')).toBeNull();
    expect(formatDateOrNull('2026-13-01')).toBeNull();
    expect(formatDate('2026-02-30')).toBe('—');
  });
});

describe('a timestamp is a moment, shown as the day it was where she reads it', () => {
  // upload_date and created_at are timestamptz: 02:00 UTC on the 17th.
  const uploaded = '2026-10-17T02:00:00+00:00';
  it.each([
    ['UTC', 'Oct 17, 2026'],
    ['America/Los_Angeles', 'Oct 16, 2026'],
    ['Pacific/Honolulu', 'Oct 16, 2026'],
    ['Asia/Tokyo', 'Oct 17, 2026'],
    ['Pacific/Kiritimati', 'Oct 17, 2026'],
  ])('%s: %s', (zone, expected) => {
    inZone(zone);
    expect(formatDate(uploaded)).toBe(expected);
  });
});

describe('absent or unreadable values', () => {
  it('show a dash, or null from formatDateOrNull', () => {
    for (const value of ['', null, undefined, 'not a date']) {
      expect(formatDate(value)).toBe('—');
      expect(formatDateOrNull(value)).toBeNull();
    }
  });
});

/*
  Every date the app shows goes through this module, so a calendar day cannot
  again be read as midnight UTC on some screen that formats its own. The only
  other toLocaleDateString calls format moments, not calendar days; they are
  listed exactly with what each shows, so a new one fails here.
*/
const REVIEWED_MOMENT_FORMATTERS: Record<string, number> = {
  // Trial end from trial_start_date (timestamptz), Stripe period end (Unix
  // seconds), store expiry expires_at (timestamptz).
  [join('src', 'pages', 'Billing.tsx')]: 3,
  // Member since: created_at (timestamptz).
  [join('src', 'features', 'settings', 'sections', 'AccountSection.tsx')]: 1,
};

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const dateFormatCalls = (source: string) => source.match(/\.toLocaleDateString\(/g)?.length ?? 0;

describe('dates are displayed only through src/utils/formatters.ts', () => {
  it('the scan sees the helper the Tracker used, in src/utils/cyclePredictor.ts', () => {
    const removed = [
      'export function formatDateShort(date: Date): string {',
      "  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });",
      '}',
    ].join('\n');
    expect(dateFormatCalls(removed)).toBe(1);
  });

  it('no other file formats a date, beyond the reviewed moments', () => {
    const found = Object.fromEntries(sourceFiles('src')
      .filter(file => file !== join('src', 'utils', 'formatters.ts'))
      .map(file => [file, dateFormatCalls(readFileSync(file, 'utf8'))] as const)
      .filter(([, count]) => count > 0));
    expect(found).toEqual(REVIEWED_MOMENT_FORMATTERS);
  });
});
