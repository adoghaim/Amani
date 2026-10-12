#!/usr/bin/env node
// Resend: recent broadcasts (email marketing). Needs a key with read access; a sending-only key
// (the safer choice for report delivery) will return 401/403 here, which is reported, not fatal.
// Docs: https://resend.com/docs/api-reference/introduction
import { missing, skip, run, fetchJson } from "./lib.mjs";

const SRC = "resend";
const keyVar = process.env.RESEND_READ_API_KEY ? "RESEND_READ_API_KEY" : "RESEND_API_KEY";
const need = missing(keyVar);
if (need.length) skip(SRC, need);

await run(SRC, async () => {
  const r = await fetchJson("https://api.resend.com/broadcasts", { headers: { Authorization: `Bearer ${process.env[keyVar]}` } });
  return { broadcasts: (r.data || []).slice(0, 15).map((b) => ({ id: b.id, name: b.name, status: b.status, created_at: b.created_at, sent_at: b.sent_at, scheduled_at: b.scheduled_at })) };
});
