#!/usr/bin/env node
// Google Search Console: top queries and pages (last 7 full days; GSC data lags ~2-3 days).
// Docs: https://developers.google.com/webmaster-tools
import { existsSync } from "node:fs";
import { missing, skip, run, fetchJson, googleServiceAccountToken, settle, ymd, daysAgo } from "./lib.mjs";

const SRC = "searchconsole";
const need = missing("GOOGLE_SERVICE_ACCOUNT_JSON", "SEARCH_CONSOLE_SITE_URL");
if (need.length) skip(SRC, need);
if (!existsSync(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)) skip(SRC, ["GOOGLE_SERVICE_ACCOUNT_JSON"], "Service account JSON path does not exist.");

await run(SRC, async () => {
  const token = await googleServiceAccountToken(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, ["https://www.googleapis.com/auth/webmasters.readonly"]);
  const site = encodeURIComponent(process.env.SEARCH_CONSOLE_SITE_URL);
  const q = (dimension) => fetchJson(`https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: ymd(daysAgo(10)), endDate: ymd(daysAgo(3)), dimensions: [dimension], rowLimit: 25 }),
  }).then((r) => (r.rows || []).map((x) => ({ key: x.keys[0], clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position })));
  return settle({ top_queries: () => q("query"), top_pages: () => q("page") });
});
