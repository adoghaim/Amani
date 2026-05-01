// Pull a user-shaped string out of `unknown` thrown values. The
// hand-rolled `err instanceof Error ? err.message : 'Unknown'` ternary
// was duplicated in ~10 places across pages/components/hooks; centralizing
// keeps fallback wording and `instanceof` checks consistent.

export function errorMessage(e: unknown, fallback = 'Unknown error'): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return fallback
}
