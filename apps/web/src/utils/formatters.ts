export function formatDate(
  dateString: string,
  options?: Intl.DateTimeFormatOptions
): string {
  return new Date(dateString).toLocaleDateString(
    'en-US',
    options ?? { month: 'short', day: 'numeric', year: 'numeric' }
  );
}

export function formatDateLong(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
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
    return createdAt.trim().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

