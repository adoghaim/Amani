/**
 * Store-subscription teardown for account deletion (PK-STORE-01).
 *
 * Two outside parties hold billing state for a native-app customer, and
 * `account-deletion.ts` now removes what each of them lets a server remove:
 *
 *   - Google Play lets a server stop a subscription's future payments
 *     (`purchases.subscriptionsv2.cancel`). `cancelPlaySubscriptions` does that
 *     for every Play subscription still billing. It needs Play Developer API
 *     credentials, so it ships OFF: with `PLAY_SERVICE_ACCOUNT_ENV` unset it
 *     makes no request at all, and the store acknowledgement in
 *     `account-deletion.ts` is the only protection, exactly as before.
 *   - RevenueCat keeps a customer record (app user id, purchase history) for
 *     anyone who reached the paywall on a native build.
 *     `deleteRevenueCatSubscriber` deletes it. Already gone (404) is success,
 *     which is what lets a retried deletion finish.
 *
 * Apple has no equivalent of either cancel call, by design, so the App Store
 * side is still the acknowledgement gate and nothing here.
 *
 * Pure in the sense `iap-verification.ts` is: no Deno, no Supabase, no network
 * or clock it was not handed. Requests go through the injected `HttpPort` (the
 * handler wires `fetchWithBackoff`) and secrets through the `EnvPort`, so
 * Vitest drives every branch with fakes. Each request carries its own timeout
 * and retry policy, `STORE_REQUEST_POLICY`, so the policy is decided and tested
 * here rather than in the handler. The one platform API used directly is Web
 * Crypto, which Deno and Node both ship, to sign the service-account assertion.
 *
 * Failure policy: anything that is not a clear "done" or "already gone" throws
 * `StoreTeardownError`, so the handler answers non-2xx and the account is never
 * reported deleted. That includes a request whose every attempt timed out. A
 * secret that is set but unusable throws too: a broken credential must not
 * quietly pass for a disabled feature.
 */

import type { AccountDeletionActions, PlaySubscriptionToCancel } from "./account-deletion.ts";

// ─── Ports ────────────────────────────────────────────────────────────────

/**
 * The options each store request hands to `fetchWithBackoff`. The field names
 * are that helper's own, so the handler wires it as the `HttpPort` unchanged.
 */
export interface StoreRequestPolicy {
  /** Each attempt is aborted after this long. */
  attemptTimeoutMs: number;
  /** Attempts in all, the first included. 429, 5xx, no answer and a timeout are retried. */
  tries: number;
  /** Wait before the second attempt; it doubles before each one after that. */
  initialDelayMs: number;
}

/** The one network primitive. The handler wires `fetchWithBackoff`. */
export type HttpPort = (
  url: string,
  init: RequestInit,
  policy: Readonly<StoreRequestPolicy>,
) => Promise<Response>;

/** Reads a server secret by name. The handler wires `Deno.env.get`. */
export type EnvPort = (name: string) => string | undefined;

/** Operational log line. Never carries a secret, token, order id or user id. */
export type TeardownLog = (level: "info" | "warn", message: string) => void;

// ─── Fixed configuration ──────────────────────────────────────────────────

/** Secret names only, never values. */
export const REVENUECAT_SECRET_ENV = "REVENUECAT_SECRET_API_KEY";

/**
 * The Play Developer API service-account key file, as JSON text (not a path).
 *
 * Deliberately not `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: jarvis uses that name
 * for a file path, and the release automation reserves it for a credential
 * with publishing rights. This one needs only order and subscription access.
 */
export const PLAY_SERVICE_ACCOUNT_ENV = "GOOGLE_PLAY_SUBSCRIPTIONS_SERVICE_ACCOUNT_JSON";

export const REVENUECAT_SUBSCRIBERS_API = "https://api.revenuecat.com/v1/subscribers";

/** Must equal the Android applicationId / Capacitor appId (pinned by a test). */
export const ANDROID_PACKAGE_NAME = "com.amani.health";

export const ANDROID_PUBLISHER_API =
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

/** Pinned rather than read from the key file, so the assertion goes nowhere else. */
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/**
 * Every store request is a business call, so each attempt gets 10 s. Every one
 * is also safe to repeat, so each gets 3 tries (engineering review D10):
 *
 *   - the token exchange only mints a short-lived access token, and both Play
 *     lookups only read;
 *   - a repeated RevenueCat DELETE answers 404, which is already-deleted success;
 *   - a repeated Play cancel can neither charge nor refund. If Google refuses
 *     one whose first attempt already landed, the step fails non-2xx, and the
 *     user's retry finds the subscription CANCELED and skips it.
 *
 * When the last attempt times out, `fetchWithBackoff` rejects, `send` turns that
 * into a `StoreTeardownError`, and the deletion answers non-2xx (D8). A timeout
 * is never read as success.
 */
export const STORE_REQUEST_POLICY: Readonly<StoreRequestPolicy> = Object.freeze({
  attemptTimeoutMs: 10_000,
  tries: 3,
  initialDelayMs: 250,
});

/**
 * Google's two cancellation types differ in the one way that matters here:
 * USER_REQUESTED_STOP_RENEWALS can be restored from the Play Store, and a
 * restore after deletion would start charging for an account that no longer
 * exists. DEVELOPER_REQUESTED_STOP_PAYMENTS cannot be restored. Neither
 * refunds; access runs to the end of the paid period either way.
 */
export const PLAY_CANCELLATION_TYPE = "DEVELOPER_REQUESTED_STOP_PAYMENTS";

/**
 * subscriptionsv2 states in which Google will not charge again. Every other
 * state, including one this code has never seen, gets a cancel request: an
 * answer we cannot read is not evidence that billing has stopped.
 */
const PLAY_STATES_NOT_BILLING = new Set([
  "SUBSCRIPTION_STATE_CANCELED",
  "SUBSCRIPTION_STATE_EXPIRED",
  "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
]);

/** Shown to the user by the client. Never claims anything was deleted. */
const INCOMPLETE = "Account deletion is incomplete; please try again later.";

export class StoreTeardownError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`${message} ${INCOMPLETE}`, options);
    this.name = "StoreTeardownError";
  }
}

// ─── Small helpers ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Sends one request under `STORE_REQUEST_POLICY`. A request that never got an
 * answer (no connection, or every attempt timed out) becomes a
 * `StoreTeardownError` naming the step only: the request itself carries a
 * credential, so neither it nor its URL goes into the message.
 */
async function send(http: HttpPort, step: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await http(url, init, STORE_REQUEST_POLICY);
  } catch (cause) {
    throw new StoreTeardownError(`${step} failed: the request did not complete.`, { cause });
  }
}

/** Releases a body we do not read. */
async function drain(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

async function readJson(response: Response): Promise<unknown> {
  return await response.json().catch(() => null);
}

/**
 * 404: Google has no such order or purchase. 410: the purchase expired long
 * enough ago that Google no longer serves it. Either way nothing is left to bill.
 */
function isGone(status: number): boolean {
  return status === 404 || status === 410;
}

// ─── RevenueCat ───────────────────────────────────────────────────────────

export type RevenueCatDeletionOutcome = "deleted" | "already_gone" | "disabled";

/**
 * `DELETE /v1/subscribers/{app_user_id}`. The app user id is the Supabase
 * `auth.users.id` (`initIap()` configures the SDK with exactly that).
 */
export async function deleteRevenueCatSubscriber(
  http: HttpPort,
  secretKey: string | undefined,
  appUserId: string,
): Promise<RevenueCatDeletionOutcome> {
  if (!isPresent(secretKey)) return "disabled";
  if (!isPresent(appUserId)) {
    throw new StoreTeardownError("RevenueCat customer deletion needs an app user id.");
  }

  const response = await send(
    http,
    "RevenueCat customer deletion",
    `${REVENUECAT_SUBSCRIBERS_API}/${encodeURIComponent(appUserId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secretKey.trim()}`, Accept: "application/json" },
    },
  );
  await drain(response);

  if (response.ok) return "deleted";
  // RevenueCat's own guidance for retry-safe flows: 404 means the customer is
  // already gone, which is the state this step exists to reach.
  if (response.status === 404) return "already_gone";
  throw new StoreTeardownError(`RevenueCat customer deletion failed (HTTP ${response.status}).`);
}

// ─── Google Play: credentials ─────────────────────────────────────────────

export interface PlayServiceAccount {
  clientEmail: string;
  privateKeyPem: string;
}

/**
 * Null when the secret is unset, which is the switch that keeps Play
 * cancellation off. Throws when it is set but unusable.
 */
export function parsePlayServiceAccount(raw: string | undefined): PlayServiceAccount | null {
  if (!isPresent(raw)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StoreTeardownError(
      `Google Play cancellation is misconfigured: ${PLAY_SERVICE_ACCOUNT_ENV} is not JSON ` +
        "(it must hold the service-account key file's contents, not a path).",
    );
  }

  const type = isRecord(parsed) ? parsed.type : undefined;
  const clientEmail = isRecord(parsed) ? parsed.client_email : undefined;
  const privateKey = isRecord(parsed) ? parsed.private_key : undefined;
  if (type !== "service_account" || !isPresent(clientEmail) || !isPresent(privateKey)) {
    throw new StoreTeardownError(
      `Google Play cancellation is misconfigured: ${PLAY_SERVICE_ACCOUNT_ENV} is not a ` +
        "service-account key (it needs type, client_email and private_key).",
    );
  }

  return { clientEmail, privateKeyPem: privateKey };
}

/**
 * Whether account deletion stops Google Play billing itself: true exactly when
 * the credential parses, which is when `cancelPlaySubscriptions` cancels (or
 * the deletion stops there instead of going on without it). The handler's
 * store-subscription 409 reports it as `play_cancellation_enabled`, so what the
 * user is told and what the cancel step does come from one parse. Unset is
 * false, and so is set but unusable: that deletion fails at the cancel step
 * rather than cancelling.
 */
export function playCancellationConfigured(raw: string | undefined): boolean {
  try {
    return parsePlayServiceAccount(raw) !== null;
  } catch {
    return false;
  }
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromText(text: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(text));
}

function arrayBufferFromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buffer;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    // Tolerates a key pasted with its newlines still escaped.
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      arrayBufferFromBase64(body),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new StoreTeardownError(
      `Google Play cancellation is misconfigured: the private key in ${PLAY_SERVICE_ACCOUNT_ENV} ` +
        "could not be read.",
    );
  }
}

/**
 * The signed JWT a service account trades for an access token (Google's
 * OAuth 2.0 JWT-bearer flow), scoped to the Android Publisher API only.
 */
export async function signServiceAccountAssertion(
  account: PlayServiceAccount,
  nowMs: number,
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: account.clientEmail,
    scope: ANDROID_PUBLISHER_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    // Google's maximum. The token is used once, inside this request.
    exp: issuedAt + 3600,
  };
  const signingInput = `${base64UrlFromText(JSON.stringify(header))}.${
    base64UrlFromText(JSON.stringify(claims))
  }`;
  const key = await importPrivateKey(account.privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

async function fetchAccessToken(
  http: HttpPort,
  account: PlayServiceAccount,
  nowMs: number,
): Promise<string> {
  const assertion = await signServiceAccountAssertion(account, nowMs);
  const response = await send(http, "Google Play authorization", GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!response.ok) {
    await drain(response);
    throw new StoreTeardownError(`Google Play authorization failed (HTTP ${response.status}).`);
  }
  const json = await readJson(response);
  const token = isRecord(json) ? json.access_token : undefined;
  if (!isPresent(token)) {
    throw new StoreTeardownError("Google Play authorization returned no access token.");
  }
  return token;
}

// ─── Google Play: one subscription ────────────────────────────────────────

interface PlayApi {
  http: HttpPort;
  accessToken: string;
}

function playUrl(path: string): string {
  return `${ANDROID_PUBLISHER_API}/${encodeURIComponent(ANDROID_PACKAGE_NAME)}/${path}`;
}

function authorized(api: PlayApi): Record<string, string> {
  return { Authorization: `Bearer ${api.accessToken}` };
}

/**
 * RevenueCat reports a Play purchase by its order id (`GPA.1234-5678-9012-34567`,
 * renewals add `..N`), and that is what `iap_subscriptions.store_subscription_id`
 * holds. subscriptionsv2 needs the purchase token instead; `orders.get` maps one
 * to the other. Any other id is taken to be a purchase token already.
 */
export function isPlayOrderId(id: string): boolean {
  return id.startsWith("GPA.");
}

/** Purchase token for an order id, or null when Google has no such order. */
async function purchaseTokenForOrder(api: PlayApi, orderId: string): Promise<string | null> {
  const response = await send(
    api.http,
    "Google Play order lookup",
    playUrl(`orders/${encodeURIComponent(orderId)}`),
    { method: "GET", headers: authorized(api) },
  );
  if (isGone(response.status)) {
    await drain(response);
    return null;
  }
  if (!response.ok) {
    await drain(response);
    throw new StoreTeardownError(`Google Play order lookup failed (HTTP ${response.status}).`);
  }
  const json = await readJson(response);
  const token = isRecord(json) ? json.purchaseToken : undefined;
  if (!isPresent(token)) {
    throw new StoreTeardownError("Google Play order lookup returned no purchase token.");
  }
  return token;
}

/** Google's current state for a purchase, or null when Google no longer has it. */
async function subscriptionState(api: PlayApi, purchaseToken: string): Promise<string | null> {
  const response = await send(
    api.http,
    "Google Play subscription lookup",
    playUrl(`purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`),
    { method: "GET", headers: authorized(api) },
  );
  if (isGone(response.status)) {
    await drain(response);
    return null;
  }
  if (!response.ok) {
    await drain(response);
    throw new StoreTeardownError(
      `Google Play subscription lookup failed (HTTP ${response.status}).`,
    );
  }
  const json = await readJson(response);
  const state = isRecord(json) ? json.subscriptionState : undefined;
  return isPresent(state) ? state : "SUBSCRIPTION_STATE_UNSPECIFIED";
}

/** True once Google has accepted the cancel; false when the purchase is gone. */
async function cancelPurchase(api: PlayApi, purchaseToken: string): Promise<boolean> {
  const response = await send(
    api.http,
    "Google Play cancellation",
    playUrl(`purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}:cancel`),
    {
      method: "POST",
      headers: { ...authorized(api), "Content-Type": "application/json" },
      body: JSON.stringify({ cancellationContext: { cancellationType: PLAY_CANCELLATION_TYPE } }),
    },
  );
  await drain(response);
  if (response.ok) return true;
  if (isGone(response.status)) return false;
  throw new StoreTeardownError(`Google Play cancellation failed (HTTP ${response.status}).`);
}

// ─── Google Play: the step ────────────────────────────────────────────────

/** What happened to one subscription. */
export type PlayCancellationResult = "cancelled" | "not_billing" | "not_found";

export type PlayCancellationOutcome =
  | { kind: "disabled"; uncancelled: number }
  | { kind: "processed"; results: PlayCancellationResult[] };

/**
 * Stops future payments for each subscription Google still bills.
 *
 * Google's own state decides, not the local row: a subscription the user has
 * already cancelled is left alone (which is also what makes a retry safe), and
 * one Google no longer knows about (404/410) has nothing left to bill.
 * Sequential, so the first failure stops the run with a clear error.
 */
export async function cancelPlaySubscriptions(
  deps: { http: HttpPort; now: () => number },
  serviceAccountJson: string | undefined,
  subscriptions: readonly PlaySubscriptionToCancel[],
): Promise<PlayCancellationOutcome> {
  if (subscriptions.length === 0) return { kind: "processed", results: [] };

  const account = parsePlayServiceAccount(serviceAccountJson);
  if (!account) return { kind: "disabled", uncancelled: subscriptions.length };

  const api: PlayApi = {
    http: deps.http,
    accessToken: await fetchAccessToken(deps.http, account, deps.now()),
  };

  const results: PlayCancellationResult[] = [];
  const handled = new Set<string>();
  for (const subscription of subscriptions) {
    const id = subscription.storeSubscriptionId;
    if (!isPresent(id)) {
      throw new StoreTeardownError("A Google Play subscription has no store id to cancel it by.");
    }

    const purchaseToken = isPlayOrderId(id) ? await purchaseTokenForOrder(api, id) : id;
    if (purchaseToken === null) {
      results.push("not_found");
      continue;
    }
    // Two rows can lead to one purchase; cancel it once.
    if (handled.has(purchaseToken)) continue;
    handled.add(purchaseToken);

    const state = await subscriptionState(api, purchaseToken);
    if (state === null) {
      results.push("not_found");
    } else if (PLAY_STATES_NOT_BILLING.has(state)) {
      results.push("not_billing");
    } else {
      results.push((await cancelPurchase(api, purchaseToken)) ? "cancelled" : "not_found");
    }
  }
  return { kind: "processed", results };
}

function summarize(results: readonly PlayCancellationResult[]): string {
  const count = (result: PlayCancellationResult) => results.filter((r) => r === result).length;
  return `${count("cancelled")} cancelled, ${count("not_billing")} already not billing, ` +
    `${count("not_found")} unknown to Google`;
}

// ─── Wiring for the handler ───────────────────────────────────────────────

export interface StoreTeardownDeps {
  env: EnvPort;
  http: HttpPort;
  now: () => number;
  log: TeardownLog;
}

/**
 * The two store steps as `AccountDeletionActions` methods. Secrets are read
 * when a step runs, so a malformed Play credential can only affect a user who
 * actually has a Play subscription to cancel.
 */
export function createStoreTeardownActions(
  deps: StoreTeardownDeps,
): Pick<AccountDeletionActions, "cancelPlaySubscriptions" | "deleteRevenueCatSubscriber"> {
  return {
    async cancelPlaySubscriptions(_userId, subscriptions) {
      const outcome = await cancelPlaySubscriptions(
        deps,
        deps.env(PLAY_SERVICE_ACCOUNT_ENV),
        subscriptions,
      );
      if (outcome.kind === "disabled") {
        deps.log(
          "info",
          `Play server-side cancellation is off (${PLAY_SERVICE_ACCOUNT_ENV} not set); ` +
            `${outcome.uncancelled} subscription(s) rely on the user's acknowledgement.`,
        );
      } else {
        deps.log("info", `Play subscriptions: ${summarize(outcome.results)}.`);
      }
    },

    async deleteRevenueCatSubscriber(userId) {
      const outcome = await deleteRevenueCatSubscriber(
        deps.http,
        deps.env(REVENUECAT_SECRET_ENV),
        userId,
      );
      if (outcome === "disabled") {
        deps.log("warn", `RevenueCat customer not deleted: ${REVENUECAT_SECRET_ENV} is not set.`);
      } else {
        deps.log(
          "info",
          `RevenueCat customer ${outcome === "deleted" ? "deleted" : "already gone"}.`,
        );
      }
    },
  };
}
