/**
 * Format a date string for display.
 * Example: "2024-03-15" → "Mar 15, 2024"
 */
export function formatDate(
  dateString: string,
  options?: Intl.DateTimeFormatOptions
): string {
  return new Date(dateString).toLocaleDateString(
    'en-US',
    options ?? { month: 'short', day: 'numeric', year: 'numeric' }
  );
}

/**
 * Format a date string in long form.
 * Example: "2024-03-15" → "March 15, 2024"
 */
export function formatDateLong(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
