#!/usr/bin/env node
// Google Ads API (REST): campaign performance yesterday + last 7 days. Read-only GAQL search.
// Docs: https://developers.google.com/google-ads/api/docs/get-started/introduction
//       https://developers.google.com/google-ads/api/docs/concepts/call-structure
// GOOGLE_ADS_API_VERSION: versions sunset regularly; check the release notes and bump.
import { missing, skip, run, fetchJson, googleRefreshToken, settle } from "./lib.mjs";

const SRC = "googleads";
const need = missing("GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID");
if (need.length) skip(SRC, need, "Google Ads not configured yet.");
const ver = process.env.GOOGLE_ADS_API_VERSION || "v25";
const cid = process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, "");

await run(SRC, async () => {
  const token = await googleRefreshToken(process.env.GOOGLE_ADS_CLIENT_ID, process.env.GOOGLE_ADS_CLIENT_SECRET, process.env.GOOGLE_ADS_REFRESH_TOKEN);
  const headers = { Authorization: `Bearer ${token}`, "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN, "Content-Type": "application/json" };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, "");
  const gaql = (query) => fetchJson(`https://googleads.googleapis.com/${ver}/customers/${cid}/googleAds:search`, { method: "POST", headers, body: JSON.stringify({ query }) })
    .then((r) => (r.results || []).map((x) => ({
      campaign: x.campaign?.name, status: x.campaign?.status, cost: x.metrics?.costMicros ? Number(x.metrics.costMicros) / 1e6 : 0,
      impressions: x.metrics?.impressions, clicks: x.metrics?.clicks, conversions: x.metrics?.conversions,
    })));
  const base = "SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign";
  return settle({
    yesterday: () => gaql(`${base} WHERE segments.date DURING YESTERDAY`),
    last_7_days: () => gaql(`${base} WHERE segments.date DURING LAST_7_DAYS`),
  });
});
