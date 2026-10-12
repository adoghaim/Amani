#!/usr/bin/env node
// LinkedIn company page follower count (Community Management API; requires approved access).
// Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
// TODO(owner): confirm endpoint + LinkedIn-Version once the app is approved; versions are retired on a schedule.
import { missing, skip, run, fetchJson } from "./lib.mjs";

const SRC = "linkedin";
const need = missing("LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORGANIZATION_ID", "LINKEDIN_API_VERSION");
if (need.length) skip(SRC, need, "LinkedIn not configured yet (page + Community Management API access still needed).");

await run(SRC, async () => {
  const urn = encodeURIComponent(`urn:li:organization:${process.env.LINKEDIN_ORGANIZATION_ID}`);
  const r = await fetchJson(`https://api.linkedin.com/rest/networkSizes/${urn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, {
    headers: { Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`, "LinkedIn-Version": process.env.LINKEDIN_API_VERSION, "X-Restli-Protocol-Version": "2.0.0" },
  });
  return { followers: r.firstDegreeSize ?? r };
});
