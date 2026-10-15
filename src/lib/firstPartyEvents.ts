/**
 * First-party funnel events and signup attribution, client side (PK-EXP5;
 * owner decisions D5.3, D6.1, D6.2, D17, D29).
 *
 * No third-party SDK, no pixel, no fingerprinting (src/pages/Privacy.tsx):
 * events go to Amani's own database through one of two doors,
 *   - signed in: the log_app_event RPC (user id stamped by the server);
 *   - before signup: the log-anon-event edge function (landing_view and
 *     signup_started only), with a random per-device id.
 * The event names and prop keys are the allow-lists in
 * supabase/functions/_shared/app-events-policy.ts, imported here so the
 * client, the edge functions and the SQL CHECK share one definition.
 *
 * D6.2: the backend does not exist in production until the owner's deploy GO,
 * while a merge publishes this client at once. So everything here sits behind
 * the off-by-default runtime flag features.first_party_events: with the flag
 * off nothing is stored and nothing is sent. Every call fails silently and
 * never blocks the UX; nothing here throws.
 *
 * Attribution (D17, D29): utm_*, promo and ref are captured from the URL as
 * FIRST touch (90 days) and a typed or campaign code is held for 24 hours, so
 * it survives the Google or Apple redirect. Every value must match
 * [A-Za-z0-9._-]{1,64}; anything else is dropped, never stored (D5.3). When
 * the account exists, save_signup_attribution writes one row, once.
 *
 * This module is pure: its I/O is injected (createFirstPartyEvents), so the
 * tests need no network, DOM or Supabase. The app's instance is ./firstPartyEventsClient.ts.
 */
import {
  ANON_ID_PATTERN,
  ATTRIBUTION_PARAMS,
  LANDING_PATH_PATTERN,
  checkProps,
  isAnonEvent,
  isClientEvent,
  isCode,
  type AnonEvent,
  type AppEventProps,
  type AttributionParam,
  type ClientEvent,
} from '../../supabase/functions/_shared/app-events-policy';

export const FIRST_PARTY_EVENTS_FLAG = 'first_party_events';

export const FIRST_TOUCH_KEY = 'amani.first-touch.v1';
export const PENDING_CODE_KEY = 'amani.signup-code.v1';
export const PENDING_SIGNUP_KEY = 'amani.signup-pending.v1';
export const ANON_ID_KEY = 'amani.anon-id.v1';

const DAY_MS = 24 * 60 * 60 * 1000;
/** First touch is kept for 90 days. */
export const FIRST_TOUCH_TTL_MS = 90 * DAY_MS;
/** A typed or campaign code is held through the OAuth redirect for 24 hours (D17). */
export const PENDING_CODE_TTL_MS = DAY_MS;
/** A signup started here completes within 24 hours or is forgotten. */
export const PENDING_SIGNUP_TTL_MS = DAY_MS;
/** D10: telemetry gets 3 seconds and one try. */
export const EVENT_CALL_TIMEOUT_MS = 3000;

export type Attribution = Partial<Record<AttributionParam, string>>;

export interface FirstTouch {
  params: Attribution;
  landingPath: string | null;
  at: number;
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface FirstPartyEventsDeps {
  /** Waits for this launch's runtime config, then reads features.first_party_events. Never rejects. */
  flagEnabled(): Promise<boolean>;
  /** The flag as known right now (false until the config has loaded). */
  flagEnabledNow(): boolean;
  /** localStorage, or null. May throw on access. */
  storage(): KeyValueStorage | null;
  /** One RPC with a timeout. Resolves with Supabase's { error }; may also reject. */
  rpc(name: 'log_app_event' | 'save_signup_attribution', args: Record<string, unknown>, timeoutMs: number): Promise<{ error: unknown }>;
  /** POST to log-anon-event with a timeout. May reject. */
  invokeAnon(body: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  now(): number;
  /** A fresh random id; must match [A-Za-z0-9_-]{16,64}. */
  randomId(): string;
  /** platform and app_version, attached to every event. */
  baseProps(): AppEventProps;
}

/** The utm_*, promo and ref values in a query string that pass D5.3. Invalid values are dropped. */
export function parseAttribution(search: string): Attribution {
  const out: Attribution = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return out;
  }
  for (const name of ATTRIBUTION_PARAMS) {
    const value = params.get(name);
    if (isCode(value)) out[name] = value;
  }
  return out;
}

/** The key of a campaign link /go/<key>, or null. */
export function goKey(pathname: string): string | null {
  const match = /^\/go\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let key: string;
  try {
    key = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  return isCode(key) ? key : null;
}

/** A landing path as stored: a bare path that passes the charset, else null. */
export function landingPath(pathname: string): string | null {
  return LANDING_PATH_PATTERN.test(pathname) ? pathname : null;
}

/** The code a campaign link pre-fills the signup field with: promo first, then ref. */
export function campaignCode(params: Attribution): string | null {
  return params.promo ?? params.ref ?? null;
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

function utmProps(params: Attribution): AppEventProps {
  const props: AppEventProps = {};
  for (const key of UTM_KEYS) if (params[key]) props[key] = params[key];
  if (params.promo) props.promo = params.promo;
  if (params.ref) props.ref = params.ref;
  return props;
}

export interface FirstPartyEvents {
  /** On arrival: first-touch capture, campaign-code pre-fill, and landing_view on "/". */
  captureEntry(entry: { pathname: string; search: string }): Promise<void>;
  /** The stored first touch, or null when none, expired or malformed. */
  readFirstTouch(): FirstTouch | null;
  /** The held signup code, or null when none, expired or malformed. */
  pendingCode(): string | null;
  /** Holds a valid code for 24 hours (null clears it). Returns whether it was held. */
  setPendingCode(code: string | null): boolean;
  /** The signup form was submitted, or an OAuth button pressed. */
  markSignupStarted(): void;
  /** Once the account exists: save attribution once and log signup_completed. */
  completeSignup(user: { id: string; created_at?: string | null }): Promise<boolean>;
  /** A signed-in client event. */
  track(event: ClientEvent, props?: AppEventProps): Promise<void>;
  /** A pre-signup event, through log-anon-event. */
  trackAnon(event: AnonEvent, props?: AppEventProps): Promise<void>;
}

export function createFirstPartyEvents(deps: FirstPartyEventsDeps): FirstPartyEvents {
  let sessionAnonId: string | null = null;
  // One capture per URL per launch: a remount (React StrictMode in development,
  // or the /go route after the app-level capture) must not count it twice.
  const captured = new Set<string>();

  const store = () => {
    try {
      return deps.storage();
    } catch {
      return null;
    }
  };
  const read = (key: string): unknown => {
    try {
      const raw = store()?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: unknown): boolean => {
    try {
      const s = store();
      if (!s) return false;
      s.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };
  const remove = (key: string) => {
    try {
      store()?.removeItem(key);
    } catch {
      // Storage blocked: nothing to remove.
    }
  };
  const fresh = (at: unknown, ttl: number) =>
    typeof at === 'number' && Number.isFinite(at) && at <= deps.now() && deps.now() - at < ttl;

  function readFirstTouch(): FirstTouch | null {
    const value = read(FIRST_TOUCH_KEY) as { params?: unknown; landingPath?: unknown; at?: unknown } | null;
    if (!value || typeof value !== 'object') return null;
    if (!fresh(value.at, FIRST_TOUCH_TTL_MS)) {
      remove(FIRST_TOUCH_KEY);
      return null;
    }
    const params: Attribution = {};
    if (value.params && typeof value.params === 'object') {
      for (const name of ATTRIBUTION_PARAMS) {
        const v = (value.params as Record<string, unknown>)[name];
        if (isCode(v)) params[name] = v;
      }
    }
    const path = typeof value.landingPath === 'string' ? landingPath(value.landingPath) : null;
    return { params, landingPath: path, at: value.at as number };
  }

  function pendingCode(): string | null {
    const value = read(PENDING_CODE_KEY) as { code?: unknown; at?: unknown } | null;
    if (!value || typeof value !== 'object') return null;
    if (!fresh(value.at, PENDING_CODE_TTL_MS) || !isCode(value.code)) {
      remove(PENDING_CODE_KEY);
      return null;
    }
    return value.code;
  }

  function setPendingCode(code: string | null): boolean {
    if (code === null || code === '') {
      remove(PENDING_CODE_KEY);
      return false;
    }
    if (!isCode(code)) return false;
    return write(PENDING_CODE_KEY, { code, at: deps.now() });
  }

  function anonId(): string {
    const stored = read(ANON_ID_KEY);
    if (typeof stored === 'string' && ANON_ID_PATTERN.test(stored)) return stored;
    if (sessionAnonId) return sessionAnonId;
    const id = deps.randomId();
    sessionAnonId = id;
    write(ANON_ID_KEY, id);
    return id;
  }

  async function trackAnon(event: AnonEvent, props: AppEventProps = {}): Promise<void> {
    try {
      if (!isAnonEvent(event) || !(await deps.flagEnabled())) return;
      const checked = checkProps({ ...deps.baseProps(), ...props });
      if (!checked.ok) return;
      await deps.invokeAnon({ event, props: checked.props, anon_id: anonId() }, EVENT_CALL_TIMEOUT_MS);
    } catch {
      // Not deployed, offline, rate limited or timed out: the user never knows.
    }
  }

  async function track(event: ClientEvent, props: AppEventProps = {}): Promise<void> {
    try {
      if (!isClientEvent(event) || !(await deps.flagEnabled())) return;
      const checked = checkProps({ ...deps.baseProps(), ...props });
      if (!checked.ok) return;
      await deps.rpc('log_app_event', { p_event: event, p_props: checked.props }, EVENT_CALL_TIMEOUT_MS);
    } catch {
      // Swallowed: an RPC that is missing (not deployed yet) or failing never surfaces.
    }
  }

  return {
    readFirstTouch,
    pendingCode,
    setPendingCode,
    track,
    trackAnon,

    async captureEntry({ pathname, search }) {
      try {
        const entryKey = `${pathname}${search}`;
        if (captured.has(entryKey)) return;
        captured.add(entryKey);
        if (!(await deps.flagEnabled())) return;
        const params = parseAttribution(search);
        const key = goKey(pathname);
        if (key && !params.ref) params.ref = key;
        if (Object.keys(params).length > 0 && readFirstTouch() === null) {
          write(FIRST_TOUCH_KEY, { params, landingPath: landingPath(pathname), at: deps.now() });
        }
        const code = campaignCode(params);
        if (code && pendingCode() === null) setPendingCode(code);
        if (pathname === '/') await trackAnon('landing_view', utmProps(readFirstTouch()?.params ?? params));
      } catch {
        // Never blocks arrival.
      }
    },

    markSignupStarted() {
      try {
        if (!deps.flagEnabledNow()) return;
        write(PENDING_SIGNUP_KEY, { at: deps.now() });
        void trackAnon('signup_started', utmProps(readFirstTouch()?.params ?? {}));
      } catch {
        // Never blocks signup.
      }
    },

    async completeSignup(user) {
      try {
        if (!(await deps.flagEnabled())) return false;
        const marker = read(PENDING_SIGNUP_KEY) as { at?: unknown } | null;
        if (!marker || !fresh(marker.at, PENDING_SIGNUP_TTL_MS)) {
          if (marker) remove(PENDING_SIGNUP_KEY);
          return false;
        }
        // Removed before the calls, so a second SIGNED_IN cannot count the signup twice.
        remove(PENDING_SIGNUP_KEY);
        // An existing account that pressed an OAuth button on the signup page is a login, not a signup.
        const created = user.created_at ? Date.parse(user.created_at) : NaN;
        if (Number.isFinite(created) && deps.now() - created > PENDING_SIGNUP_TTL_MS) return false;

        const touch = readFirstTouch();
        const code = pendingCode();
        const attribution: Record<string, string> = { ...(touch?.params ?? {}) };
        if (code) attribution.code = code;
        if (touch?.landingPath) attribution.landing_path = touch.landingPath;
        try {
          const { error } = await deps.rpc('save_signup_attribution', { p_attribution: attribution }, EVENT_CALL_TIMEOUT_MS);
          if (!error) remove(PENDING_CODE_KEY);
        } catch {
          // The account exists either way; attribution is best effort.
        }
        await track('signup_completed');
        return true;
      } catch {
        return false;
      }
    },
  };
}
