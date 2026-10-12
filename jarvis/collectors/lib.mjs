// Shared helpers for Jarvis collectors. Node >= 18 (global fetch), ESM, no dependencies.
// Contract: every collector prints exactly ONE JSON object to stdout:
//   { source, status: "ok" | "skipped" | "error", generated_at, note?, missing_env?, data? }
// A collector must never print secrets, and must exit 0 even when it skips or errors,
// so one broken service never blocks the morning report.
import { readFileSync } from "node:fs";
import { createSign, createPrivateKey, sign as cryptoSign } from "node:crypto";

export const nowIso = () => new Date().toISOString();

export function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
export const ymd = (d) => d.toISOString().slice(0, 10);

/** Return the names of env vars that are unset or empty. */
export function missing(...names) {
  return names.filter((n) => !process.env[n] || String(process.env[n]).trim() === "");
}

export function emit(source, payload) {
  const out = { source, generated_at: nowIso(), ...payload };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

export function skip(source, missingEnv, note) {
  emit(source, {
    status: "skipped",
    missing_env: missingEnv,
    note: note || `Skipped: set ${missingEnv.join(", ")} in jarvis/.env to enable.`,
  });
  process.exit(0);
}

/** Strip anything that looks like a credential from an error message before printing it. */
export function scrub(msg) {
  return String(msg)
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[redacted]")
    .replace(/(access_token=)[^&\s"]+/gi, "$1[redacted]")
    .replace(/\b(sk|rk|phx|re|ghp|github_pat|gho)_[A-Za-z0-9_]{6,}/g, "[redacted-key]")
    .slice(0, 800);
}

/**
 * Wrap a collector body. Any thrown error becomes {status:"error"} with a scrubbed message.
 */
export async function run(source, fn) {
  try {
    const data = await fn();
    emit(source, { status: "ok", data });
  } catch (err) {
    emit(source, { status: "error", note: scrub(err?.message || err) });
  }
  process.exit(0);
}

/** fetch with timeout that throws on non-2xx and returns parsed JSON (or text). */
export async function fetchJson(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`HTTP ${res.status} from ${new URL(url).host}${new URL(url).pathname}: ${scrub(detail)}`);
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

/** Run several labelled sub-queries; one failing sub-query does not sink the others. */
export async function settle(entries) {
  const out = {};
  await Promise.all(
    Object.entries(entries).map(async ([k, fn]) => {
      try { out[k] = await fn(); } catch (e) { out[k] = { error: scrub(e?.message || e) }; }
    }),
  );
  return out;
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/**
 * Google service-account access token (JWT bearer flow, RS256).
 * keyFile: path to the service-account JSON. scopes: array of OAuth scopes.
 */
export async function googleServiceAccountToken(keyFile, scopes) {
  const key = JSON.parse(readFileSync(keyFile, "utf8"));
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email, scope: scopes.join(" "),
    aud: key.token_uri || "https://oauth2.googleapis.com/token", iat, exp: iat + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = b64url(signer.sign(key.private_key));
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${header}.${claims}.${sig}`,
  });
  const tok = await fetchJson(key.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
  return tok.access_token;
}

/** Google OAuth refresh-token -> access token (installed-app / web client). */
export async function googleRefreshToken(clientId, clientSecret, refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken,
  });
  const tok = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
  return tok.access_token;
}

/** App Store Connect API JWT (ES256, 20-minute max lifetime per Apple docs). */
export function appStoreConnectJwt(issuerId, keyId, p8Path) {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: issuerId, iat, exp: iat + 15 * 60, aud: "appstoreconnect-v1" }));
  const key = createPrivateKey(readFileSync(p8Path, "utf8"));
  const sig = cryptoSign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64url(sig)}`;
}

export const bool = (v, d = false) => (v == null || v === "" ? d : /^(1|true|yes|on)$/i.test(String(v)));
