#!/usr/bin/env node
// Netlify: recent production deploys for the web app (site amani-biometrics).
// Docs: https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/
import { missing, skip, run, fetchJson } from "./lib.mjs";

const SRC = "netlify";
const need = missing("NETLIFY_AUTH_TOKEN", "NETLIFY_SITE_ID");
if (need.length) skip(SRC, need);

await run(SRC, async () => {
  const deploys = await fetchJson(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(process.env.NETLIFY_SITE_ID)}/deploys?per_page=15`,
    { headers: { Authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}` } },
  );
  return {
    deploys: deploys.map((d) => ({
      id: d.id, state: d.state, context: d.context, branch: d.branch, commit_ref: d.commit_ref?.slice(0, 7),
      title: d.title, created_at: d.created_at, published_at: d.published_at, error_message: d.error_message,
    })),
  };
});
