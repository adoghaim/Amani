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

export type PaymentRequiredAction =
  | { kind: 'none' }
  | { kind: 'paywall' }
  | { kind: 'redirect'; to: string };

/**
 * What a raw-fetch caller (Tracker's report comparison) does with a response.
 * Flag on, `premium_required` opens the paywall in place and the legacy
 * redirect is never consulted; any other 402 keeps the 1.0.5 redirect.
 */
export async function paymentRequiredAction(
  res: Response,
  freemiumActive: boolean,
  legacyRedirect: (res: Response) => Promise<string | null>,
): Promise<PaymentRequiredAction> {
  if (res.status !== 402) return { kind: 'none' };
  if (freemiumActive && await isPremiumRequiredResponse(res)) return { kind: 'paywall' };
  const to = await legacyRedirect(res);
  return to ? { kind: 'redirect', to } : { kind: 'none' };
}
