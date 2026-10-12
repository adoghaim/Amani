#!/usr/bin/env node
// TikTok: organic account stats (Login Kit / Display API user token) + optional TikTok Ads (API for Business).
// Docs: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info  https://business-api.tiktok.com/portal/docs
import { missing, skip, run, fetchJson, settle, ymd, daysAgo } from "./lib.mjs";

const SRC = "tiktok";
const organic = !missing("TIKTOK_ACCESS_TOKEN").length;
const ads = !missing("TIKTOK_BUSINESS_ACCESS_TOKEN", "TIKTOK_ADVERTISER_ID").length;
if (!organic && !ads) skip(SRC, ["TIKTOK_ACCESS_TOKEN", "TIKTOK_BUSINESS_ACCESS_TOKEN", "TIKTOK_ADVERTISER_ID"], "TikTok not configured yet (account still to be created).");

await run(SRC, () => {
  const q = {};
  if (organic) {
    const h = { Authorization: `Bearer ${process.env.TIKTOK_ACCESS_TOKEN}` };
    q.account = () => fetchJson("https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count,following_count,likes_count,video_count", { headers: h })
      .then((r) => r.data?.user ?? r);
    q.recent_videos = () => fetchJson("https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,view_count,like_count,comment_count,share_count", {
      method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 10 }),
    }).then((r) => r.data?.videos ?? r);
  }
  if (ads) {
    // TODO(owner): confirm the Business API version path (v1.3 at time of writing) in current docs.
    const ver = process.env.TIKTOK_BUSINESS_API_VERSION || "v1.3";
    const qs = new URLSearchParams({
      advertiser_id: process.env.TIKTOK_ADVERTISER_ID, report_type: "BASIC", data_level: "AUCTION_CAMPAIGN",
      dimensions: JSON.stringify(["campaign_id"]), metrics: JSON.stringify(["spend", "impressions", "clicks", "ctr", "conversion"]),
      start_date: ymd(daysAgo(7)), end_date: ymd(daysAgo(1)),
    });
    q.ads_last_7d = () => fetchJson(`https://business-api.tiktok.com/open_api/${ver}/report/integrated/get/?${qs}`, {
      headers: { "Access-Token": process.env.TIKTOK_BUSINESS_ACCESS_TOKEN },
    }).then((r) => r.data ?? r);
  }
  return settle(q);
});
