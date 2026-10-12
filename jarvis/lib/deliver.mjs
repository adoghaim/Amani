#!/usr/bin/env node
// Delivers the finished report. REPORT_DELIVERY is a comma list of: file (always), slack, email.
// Slack: incoming webhook (summary + local path). Email: Resend, to the OWNER only (REPORT_EMAIL_TO).
// This sends to the owner's own destinations configured in .env; it never contacts customers.
import { readFileSync } from "node:fs";

const [reportPath, date] = process.argv.slice(2);
const md = readFileSync(reportPath, "utf8");
const modes = (process.env.REPORT_DELIVERY || "file").split(",").map((s) => s.trim().toLowerCase());
const results = {};

if (modes.includes("slack")) {
  if (!process.env.SLACK_WEBHOOK_URL) results.slack = "skipped: SLACK_WEBHOOK_URL not set";
  else {
    const tldr = md.split(/\n## /)[0].slice(0, 2800) + (md.length > 2800 ? "\n…" : "");
    const r = await fetch(process.env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `*Jarvis daily report ${date}*\n${tldr}\n_Full report: ${reportPath}_` }) });
    results.slack = r.ok ? "sent" : `failed: HTTP ${r.status}`;
  }
}
if (modes.includes("email")) {
  const need = ["RESEND_API_KEY", "REPORT_EMAIL_TO", "REPORT_EMAIL_FROM"].filter((k) => !process.env[k]);
  if (need.length) results.email = `skipped: missing ${need.join(", ")}`;
  else {
    const r = await fetch("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.REPORT_EMAIL_FROM, to: process.env.REPORT_EMAIL_TO.split(",").map((s) => s.trim()),
        subject: `Jarvis daily report ${date}`, text: md }) });
    results.email = r.ok ? "sent" : `failed: HTTP ${r.status}`;
  }
}
console.log(JSON.stringify(results));
