#!/usr/bin/env node
// Pinterest API v5: account analytics for the last 7 days.
// Docs: https://developers.pinterest.com/docs/api/v5/user_account-analytics
import { missing, skip, run, fetchJson, settle, ymd, daysAgo } from "./lib.mjs";

const SRC = "pinterest";
const need = missing("PINTEREST_ACCESS_TOKEN");
if (need.length) skip(SRC, need, "Pinterest not configured yet (business account still to be created).");
const h = { Authorization: `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}` };

await run(SRC, () => settle({
  account: () => fetchJson("https://api.pinterest.com/v5/user_account", { headers: h }).then((r) => ({ username: r.username, account_type: r.account_type, follower_count: r.follower_count, monthly_views: r.monthly_views })),
  analytics_7d: () => fetchJson(`https://api.pinterest.com/v5/user_account/analytics?start_date=${ymd(daysAgo(7))}&end_date=${ymd(daysAgo(1))}`, { headers: h }).then((r) => r.all?.summary_metrics ?? r),
}));
