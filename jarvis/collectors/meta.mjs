#!/usr/bin/env node
// Meta: Facebook Page + Instagram professional account + Meta Ads (read-only).
// Docs: https://developers.facebook.com/docs/instagram-platform  https://developers.facebook.com/docs/marketing-api/insights
// Insight metric names change between Graph versions; each sub-query fails independently.
import { missing, skip, run, fetchJson, settle } from "./lib.mjs";

const SRC = "meta";
const v = process.env.META_GRAPH_VERSION || "v26.0";
const G = `https://graph.facebook.com/${v}`;
const pageTok = process.env.META_PAGE_ACCESS_TOKEN;
const adsTok = process.env.META_ADS_ACCESS_TOKEN || pageTok;
const anyConfigured = !missing("META_PAGE_ID", "META_PAGE_ACCESS_TOKEN").length || !missing("META_AD_ACCOUNT_ID", "META_ADS_ACCESS_TOKEN").length;
if (!anyConfigured) skip(SRC, ["META_PAGE_ID", "META_PAGE_ACCESS_TOKEN", "META_IG_BUSINESS_ACCOUNT_ID", "META_AD_ACCOUNT_ID", "META_ADS_ACCESS_TOKEN"],
  "Meta not configured yet (accounts still to be created; see SETUP_ACCOUNTS.md).");

const get = (path, tok, params = {}) => {
  const qs = new URLSearchParams({ ...params, access_token: tok });
  return fetchJson(`${G}/${path}?${qs}`);
};

await run(SRC, () => {
  const q = {};
  if (process.env.META_PAGE_ID && pageTok) {
    q.facebook_page = () => get(process.env.META_PAGE_ID, pageTok, { fields: "name,followers_count,fan_count" });
    q.facebook_recent_posts = () => get(`${process.env.META_PAGE_ID}/posts`, pageTok, { fields: "created_time,message,permalink_url", limit: "10" })
      .then((r) => (r.data || []).map((p) => ({ ...p, message: p.message?.slice(0, 280) })));
  }
  const ig = process.env.META_IG_BUSINESS_ACCOUNT_ID;
  if (ig && pageTok) {
    q.instagram_account = () => get(ig, pageTok, { fields: "username,followers_count,media_count" });
    q.instagram_recent_media = () => get(`${ig}/media`, pageTok, { fields: "caption,media_type,timestamp,permalink,like_count,comments_count", limit: "12" })
      .then((r) => (r.data || []).map((m) => ({ ...m, caption: m.caption?.slice(0, 280) })));
    q.instagram_insights_7d = () => get(`${ig}/insights`, pageTok, { metric: "reach,views,follower_count", period: "day", since: String(Math.floor(Date.now() / 1000) - 7 * 86400) })
      .then((r) => (r.data || []).map((m) => ({ name: m.name, values: m.values })));
  }
  if (process.env.META_AD_ACCOUNT_ID && adsTok) {
    const act = process.env.META_AD_ACCOUNT_ID.startsWith("act_") ? process.env.META_AD_ACCOUNT_ID : `act_${process.env.META_AD_ACCOUNT_ID}`;
    q.ads_yesterday_by_campaign = () => get(`${act}/insights`, adsTok, {
      level: "campaign", date_preset: "yesterday", fields: "campaign_name,spend,impressions,clicks,ctr,cpc,actions",
    }).then((r) => r.data);
    q.ads_last_7d = () => get(`${act}/insights`, adsTok, { date_preset: "last_7d", fields: "spend,impressions,clicks,ctr,cpc,actions" }).then((r) => r.data);
  }
  return settle(q);
});
