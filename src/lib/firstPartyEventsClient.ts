/**
 * The app's first-party events instance (PK-EXP5): firstPartyEvents.ts wired to
 * Supabase, the runtime config flag and the platform. Behaviour and the
 * privacy rules are in firstPartyEvents.ts.
 */
import { supabase } from './supabase';
import { isFeatureEnabled, loadRuntimeConfig } from './runtimeConfig';
import { platform } from './native';
import { createFirstPartyEvents, FIRST_PARTY_EVENTS_FLAG } from './firstPartyEvents';
import type { AppEventProps } from '../../supabase/functions/_shared/app-events-policy';

export { FIRST_PARTY_EVENTS_FLAG } from './firstPartyEvents';

/** "amani@1.0.4+abc1234" -> "1.0.4". Undefined outside a Vite build. */
function appVersion(): string | null {
  try {
    const release = typeof __APP_RELEASE__ === 'string' ? __APP_RELEASE__ : '';
    return /@([0-9]+(?:\.[0-9]+){0,2})/.exec(release)?.[1] ?? null;
  } catch {
    return null;
  }
}

function withTimeout<T>(start: (signal: AbortSignal) => PromiseLike<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return Promise.resolve(start(controller.signal)).finally(() => clearTimeout(timer));
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export const firstPartyEvents = createFirstPartyEvents({
  async flagEnabled() {
    await loadRuntimeConfig();
    return isFeatureEnabled(FIRST_PARTY_EVENTS_FLAG);
  },
  flagEnabledNow() {
    return isFeatureEnabled(FIRST_PARTY_EVENTS_FLAG);
  },
  storage() {
    return typeof window === 'undefined' ? null : window.localStorage;
  },
  rpc(name, args, timeoutMs) {
    return withTimeout(signal => supabase.rpc(name, args).abortSignal(signal), timeoutMs);
  },
  invokeAnon(body, timeoutMs) {
    return supabase.functions.invoke('log-anon-event', { body, timeout: timeoutMs });
  },
  now: () => Date.now(),
  randomId,
  baseProps() {
    const props: AppEventProps = {};
    try {
      const p = platform();
      if (p === 'web' || p === 'ios' || p === 'android') props.platform = p;
    } catch {
      // No platform: left out.
    }
    const version = appVersion();
    if (version) props.app_version = version;
    return props;
  },
});
