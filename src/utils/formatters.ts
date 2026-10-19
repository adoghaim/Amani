/*
  Two kinds of date reach the app, and they must not be read the same way.

  A Postgres `date` column (report_date, period start and end, symptom and
  intervention days) arrives as a bare calendar day, 'YYYY-MM-DD'.
  `new Date('YYYY-MM-DD')` reads that as midnight UTC, which west of UTC is
  still the evening before, so the day shown was one early: the 2026-10-17
  production smoke test saw a report drawn on 2026-10-10 as "Last panel Oct 9"
  on the Tracker while the report itself said October 10. A calendar day is
  formatted here from its own year, month and day, in UTC, so it reads the
  same in every time zone.

  A timestamp (upload_date, created_at) is a moment, and is shown as the day
  it was in the reader's own zone.
*/
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `formatDate`, or null when the value names no date. */
export function formatDateOrNull(
  dateString: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string | null {
  if (!dateString) return null;
  const opts = options ?? { month: 'short', day: 'numeric', year: 'numeric' };
  const parts = DATE_ONLY.exec(dateString);
  if (parts) {
    const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    // '2026-02-30' names no day; Date.UTC would roll it into March.
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  }
  const moment = new Date(dateString);
  if (Number.isNaN(moment.getTime())) return null;
  return moment.toLocaleDateString('en-US', opts);
}

export function formatDate(
  dateString: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  return formatDateOrNull(dateString, options) ?? '—';
}

export function formatDateLong(dateString: string | null | undefined): string {
  return formatDate(dateString, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function canonicalReportDate(
  reportDate: string | null | undefined,
  createdAt: string | null | undefined,
): string {
  if (reportDate && reportDate.trim().length > 0) return reportDate.trim();
  if (createdAt && createdAt.trim().length > 0) {
    return createdAt.trim().split('T')[0] ?? createdAt.trim();
  }
  return new Date().toISOString().split('T')[0] ?? new Date().toISOString();
}
