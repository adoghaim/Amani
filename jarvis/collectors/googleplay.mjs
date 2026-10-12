#!/usr/bin/env node
// Google Play Developer API: recent reviews (the API returns reviews from roughly the last week).
// Installs/ratings history comes from Play Console monthly reports in Cloud Storage
// (https://support.google.com/googleplay/android-developer/answer/6135870), not wired here yet.
// Docs: https://developers.google.com/android-publisher/getting_started
import { existsSync } from "node:fs";
import { missing, skip, run, fetchJson, googleServiceAccountToken } from "./lib.mjs";

const SRC = "googleplay";
const need = missing("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "GOOGLE_PLAY_PACKAGE_NAME");
if (need.length) skip(SRC, need);
if (!existsSync(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)) skip(SRC, ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"], "Service account JSON path does not exist.");

await run(SRC, async () => {
  const token = await googleServiceAccountToken(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, ["https://www.googleapis.com/auth/androidpublisher"]);
  const pkg = encodeURIComponent(process.env.GOOGLE_PLAY_PACKAGE_NAME);
  const r = await fetchJson(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/reviews?maxResults=20`,
    { headers: { Authorization: `Bearer ${token}` } });
  return {
    recent_reviews: (r.reviews || []).map((rv) => {
      const c = rv.comments?.[0]?.userComment || {};
      return { rating: c.starRating, text: c.text?.slice(0, 600), appVersion: c.appVersionName, lastModified: c.lastModified?.seconds };
    }),
  };
});
