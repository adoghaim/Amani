/**
 * The app's calls for launch consent (PK-CONSENT-01). Every one of them stays
 * behind features.consent_gate (D6.2): nothing here runs while the flag is off,
 * because consent_current and record_consent exist only after the owner's
 * db push.
 */
import { supabase } from '../supabase';
import { platform } from '../native';
import { CURRENT_CONSENT_VERSION, missingConsents, type ConsentType } from './consentPolicy';

export type ConsentPlatform = 'web' | 'ios' | 'android';

export function consentPlatform(): ConsentPlatform {
  try {
    const name = platform();
    return name === 'ios' || name === 'android' ? name : 'web';
  } catch {
    return 'web';
  }
}

/**
 * The consent types she has not currently granted. Throws when the read fails.
 * consent_current holds at most one row per type, so the 1,000-row cap never applies.
 */
export async function readMissingConsents(userId: string): Promise<ConsentType[]> {
  const { data, error } = await supabase
    .from('consent_current')
    .select('consent_type,version,granted')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return missingConsents(data);
}

/** Appends one grant or withdrawal to her ledger (record_consent). Throws when it fails. */
export async function recordConsent(type: ConsentType, granted: boolean): Promise<void> {
  const { error } = await supabase.rpc('record_consent', {
    p_consent_type: type,
    p_version: CURRENT_CONSENT_VERSION,
    p_granted: granted,
    p_platform: consentPlatform(),
  });
  if (error) throw new Error(error.message);
}

/**
 * D13: erase the account she has just made, through the existing account
 * deletion path (delete-user-data). Throws, leaving her signed in, when the
 * erasure did not complete: a non-2xx from delete-user-data is never treated
 * as success.
 */
export async function eraseAccount(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has ended. Please sign in again.');
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user-data`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledge_store_subscriptions: false }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === 'string' ? body.error : 'The account could not be removed.');
  }
}

/** After an erasure: the identity is gone on the server, so clear this device's session only. */
export async function signOutLocally(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}
