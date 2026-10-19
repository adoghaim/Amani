import { dateToKey } from './cyclePredictor';

const DATE_PATTERNS = [
  /(?:collection|collected|report|specimen|date of service|test date|draw date|lab date)[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  /(?:collection|collected|report|specimen|date of service|test date|draw date|lab date)[:\s]+(\d{4}-\d{2}-\d{2})/i,
  /(?:collection|collected|report|specimen|date of service|test date|draw date|lab date)[:\s]+([A-Z][a-z]+ \d{1,2},? \d{4})/i,
  /(?:collection|collected|report|specimen|date of service|test date|draw date|lab date)[:\s]+(\d{1,2}-[A-Z][a-z]+-\d{4})/i,
  /\bDate(?:\s+of(?:\s+Service)?)?[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/,
  /\bDate[:\s]+(\d{4}-\d{2}-\d{2})/,
];

/*
  The day a printed date names, as a local date. `new Date` reads '10/10/2026'
  and 'October 10, 2026' as local midnight, but a bare '2026-10-10' as midnight
  UTC, which the local getters then put on the day before anywhere west of UTC.
  So that form is built from its own parts, and a day that does not exist
  ('2026-02-30') is no date rather than one rolled into March.
*/
function parseLocalDay(raw: string): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!iso) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  const parsed = new Date(year, month - 1, day);
  return parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : null;
}

/** The draw date printed on a lab report as 'YYYY-MM-DD', or null when none is found. */
export function extractDateFromText(text: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1] !== undefined) {
      const parsed = parseLocalDay(match[1]);
      if (parsed && parsed.getFullYear() >= 2000 && parsed.getFullYear() <= new Date().getFullYear() + 1) {
        return dateToKey(parsed);
      }
    }
  }
  return null;
}
