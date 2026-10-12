#!/usr/bin/env node
// RevenueCat (iOS/Android subscriptions) via REST API v2 metrics overview.
// Docs: https://www.revenuecat.com/docs/api-v2  https://www.revenuecat.com/docs/projects/authentication
import { missing, skip, run, fetchJson } from "./lib.mjs";

const SRC = "revenuecat";
const need = missing("REVENUECAT_API_V2_KEY", "REVENUECAT_PROJECT_ID");
if (need.length) skip(SRC, need);

await run(SRC, async () => {
  const r = await fetchJson(
    `https://api.revenuecat.com/v2/projects/${encodeURIComponent(process.env.REVENUECAT_PROJECT_ID)}/metrics/overview`,
    { headers: { Authorization: `Bearer ${process.env.REVENUECAT_API_V2_KEY}` } },
  );
  return { metrics: (r.metrics || []).map((m) => ({ id: m.id, name: m.name, value: m.value, unit: m.unit, period: m.period, last_updated_at: m.last_updated_at })) };
});
