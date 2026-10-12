#!/usr/bin/env node
// Stripe (web subscriptions). Uses a RESTRICTED key with read-only permissions.
// Docs: https://docs.stripe.com/keys/restricted-api-keys
import { missing, skip, run, fetchJson, settle } from "./lib.mjs";

const SRC = "stripe";
const need = missing("STRIPE_RESTRICTED_KEY");
if (need.length) skip(SRC, need);
const key = process.env.STRIPE_RESTRICTED_KEY;
if (/^sk_/.test(key)) {
  // Refuse full secret keys: Jarvis is read-only and should never hold a key that can move money.
  console.log(JSON.stringify({ source: SRC, status: "error", note: "STRIPE_RESTRICTED_KEY looks like a full secret key (sk_). Create a restricted read-only key (rk_) instead." }));
  process.exit(0);
}
const headers = { Authorization: `Bearer ${key}` };
const api = (p) => fetchJson(`https://api.stripe.com/v1/${p}`, { headers });
const since = (days) => Math.floor(Date.now() / 1000) - days * 86400;

async function countList(path, cap = 1000) {
  let n = 0, after = null;
  for (;;) {
    const r = await api(`${path}${path.includes("?") ? "&" : "?"}limit=100${after ? `&starting_after=${after}` : ""}`);
    n += r.data.length;
    if (!r.has_more || n >= cap) return { count: n, capped: r.has_more && n >= cap };
    after = r.data[r.data.length - 1].id;
  }
}

await run(SRC, () => settle({
  active_subscriptions: () => countList("subscriptions?status=active"),
  trialing_subscriptions: () => countList("subscriptions?status=trialing"),
  new_subscriptions_24h: () => countList(`subscriptions?status=all&created[gte]=${since(1)}`),
  new_subscriptions_7d: () => countList(`subscriptions?status=all&created[gte]=${since(7)}`),
  cancellations_7d: () => countList(`events?type=customer.subscription.deleted&created[gte]=${since(7)}`),
  failed_payments_7d: () => countList(`events?type=invoice.payment_failed&created[gte]=${since(7)}`),
}));
