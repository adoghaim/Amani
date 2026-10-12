#!/usr/bin/env node
// Google Analytics 4 Data API: marketing-site traffic by channel (last 7 days vs prior 7).
// Docs: https://developers.google.com/analytics/devguides/reporting/data/v1
import { existsSync } from "node:fs";
import { missing, skip, run, fetchJson, googleServiceAccountToken } from "./lib.mjs";

const SRC = "ga4";
const need = missing("GOOGLE_SERVICE_ACCOUNT_JSON", "GA4_PROPERTY_ID");
if (need.length) skip(SRC, need, "GA4 not configured (optional if PostHog web analytics covers the site).");
if (!existsSync(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)) skip(SRC, ["GOOGLE_SERVICE_ACCOUNT_JSON"], "Service account JSON path does not exist.");

await run(SRC, async () => {
  const token = await googleServiceAccountToken(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, ["https://www.googleapis.com/auth/analytics.readonly"]);
  const r = await fetchJson(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(process.env.GA4_PROPERTY_ID)}:runReport`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday", name: "last7" }, { startDate: "14daysAgo", endDate: "8daysAgo", name: "prior7" }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "newUsers" }, { name: "keyEvents" }],
      limit: 25,
    }),
  });
  return {
    headers: [...(r.dimensionHeaders || []), ...(r.metricHeaders || [])].map((h) => h.name),
    rows: (r.rows || []).map((row) => [...row.dimensionValues.map((d) => d.value), ...row.metricValues.map((m) => m.value)]),
  };
});
