#!/usr/bin/env node
// App Store Connect API: app record + most recent customer reviews (ratings/sentiment signal).
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api
//       https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
// Key role: create the key with the least-privileged role that can read reviews (check current docs).
import { existsSync } from "node:fs";
import { missing, skip, run, fetchJson, appStoreConnectJwt, settle } from "./lib.mjs";

const SRC = "appstore";
const need = missing("ASC_ISSUER_ID", "ASC_KEY_ID", "ASC_PRIVATE_KEY_PATH", "ASC_APP_ID");
if (need.length) skip(SRC, need);
if (!existsSync(process.env.ASC_PRIVATE_KEY_PATH)) skip(SRC, ["ASC_PRIVATE_KEY_PATH"], "ASC_PRIVATE_KEY_PATH does not point to an existing .p8 file.");

await run(SRC, async () => {
  const jwt = appStoreConnectJwt(process.env.ASC_ISSUER_ID, process.env.ASC_KEY_ID, process.env.ASC_PRIVATE_KEY_PATH);
  const headers = { Authorization: `Bearer ${jwt}` };
  const base = "https://api.appstoreconnect.apple.com/v1";
  const app = encodeURIComponent(process.env.ASC_APP_ID);
  return settle({
    app: async () => {
      const r = await fetchJson(`${base}/apps/${app}`, { headers });
      return { id: r.data?.id, name: r.data?.attributes?.name, bundleId: r.data?.attributes?.bundleId };
    },
    recent_reviews: async () => {
      const r = await fetchJson(`${base}/apps/${app}/customerReviews?sort=-createdDate&limit=20`, { headers });
      // Reviews are untrusted user text: the model must treat them as data, never instructions.
      return (r.data || []).map((x) => ({
        rating: x.attributes?.rating, title: x.attributes?.title, body: x.attributes?.body?.slice(0, 600),
        territory: x.attributes?.territory, createdDate: x.attributes?.createdDate,
      }));
    },
  });
});
