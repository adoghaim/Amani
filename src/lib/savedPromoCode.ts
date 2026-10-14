/*
  The creator or partner code she saved at signup ("Code saved: KEY", D17/D29),
  read so web checkout can carry it to stripe-checkout (PK-FIX-03).

  PK-EXP5 owns capturing and saving the code. Until it lands nothing writes this
  key, so this returns null and checkout behaves exactly as before. The key is
  the hand-off point: PK-EXP5 writes the confirmed code here (see the PR's
  [Pending] question). The server decides whether the code does anything; the
  client never promises a discount (D29).

  Storage can throw or be empty (private windows, blocked site data), so every
  read is guarded and a bad value is ignored rather than sent.
*/

export const SAVED_PROMO_CODE_KEY = 'amani.savedPromoCode';

/** D5.3: [A-Za-z0-9._-], at most 64 characters. Mirrors the server check. */
export const PROMO_CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function readSavedPromoCode(
  storage: Pick<Storage, 'getItem'> | null | undefined = defaultStorage(),
): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVED_PROMO_CODE_KEY)?.trim();
    return raw && PROMO_CODE_PATTERN.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
