#!/usr/bin/env node
// X (Twitter) API v2: public metrics for the brand account. X API is pay-per-use, so this
// collector is OFF unless X_ENABLE_COLLECTOR=true. Docs: https://docs.x.com/x-api/getting-started/pricing
import { missing, skip, run, fetchJson, bool, emit } from "./lib.mjs";

const SRC = "x";
if (!bool(process.env.X_ENABLE_COLLECTOR)) { emit(SRC, { status: "skipped", note: "X collector disabled (X_ENABLE_COLLECTOR=false) because X API reads are billed per use." }); process.exit(0); }
const need = missing("X_BEARER_TOKEN", "X_USERNAME");
if (need.length) skip(SRC, need);

await run(SRC, async () => {
  const r = await fetchJson(`https://api.x.com/2/users/by/username/${encodeURIComponent(process.env.X_USERNAME)}?user.fields=public_metrics`,
    { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
  return { account: r.data };
});
