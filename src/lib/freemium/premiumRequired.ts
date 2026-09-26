/**
 * Is this a Premium-only surface refusing a Free account (flag on)?
 *
 * The server answers `402 { code: 'premium_required' }` for that, and a plain
 * 402 `subscription_required` for everything else (onboarding, legacy gate).
 * Only the former opens the paywall. Reads a clone, so the caller can still
 * hand the original response to `handle402`.
 */
export async function isPremiumRequiredResponse(res: Response): Promise<boolean> {
  if (res.status !== 402) return false;
  const body = await res.clone().json().catch(() => null) as { code?: unknown } | null;
  return body?.code === 'premium_required';
}
