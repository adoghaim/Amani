#!/usr/bin/env node
// Splits the ```jarvis-proposals JSON block out of a report and writes one approval file per proposal
// into approvals/pending/. Each proposal is linted with claims-lint. Nothing is executed here.
// Usage: node lib/extract-proposals.mjs <report.md> <approvalsDir> <YYYY-MM-DD>
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lint } from "./claims-lint.mjs";

const [reportPath, apprDir, date] = process.argv.slice(2);
let md = readFileSync(reportPath, "utf8");
const m = md.match(/```jarvis-proposals\s*\n([\s\S]*?)```/);
if (!m) { console.log("no proposals block"); process.exit(0); }

let proposals;
try { proposals = JSON.parse(m[1]); } catch (e) {
  md = md.replace(m[0], `> Jarvis emitted a proposals block that was not valid JSON (${e.message}). No approval files were created.\n`);
  writeFileSync(reportPath, md); process.exit(0);
}
if (!Array.isArray(proposals)) proposals = [proposals];

const TYPES = new Set(["social_post", "ad_change", "ad_spend_change", "experiment_launch", "experiment_end", "feature_flag_change", "email_send", "content_publish", "account_setup", "other"]);
const slug = (s) => String(s || "proposal").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
const existing = new Set(["pending", "approved", "rejected", "executed"].flatMap((d) => (existsSync(join(apprDir, d)) ? readdirSync(join(apprDir, d)) : [])));
const yamlStr = (s) => JSON.stringify(String(s ?? ""));

const rows = [];
proposals.forEach((p, i) => {
  const type = TYPES.has(p.type) ? p.type : "other";
  const file = `${date}-${String(i + 1).padStart(2, "0")}-${slug(p.title)}.md`;
  if (existing.has(file)) { rows.push(`| ${p.title} | ${type} | already exists: ${file} |`); return; }
  const payloadText = JSON.stringify(p.payload ?? {}, null, 2);
  const lr = lint([p.title, p.rationale, payloadText].join("\n"));
  const expires = new Date(Date.now() + (Number(p.expires_in_days) || 7) * 86400000).toISOString().slice(0, 10);
  const body = `---
id: ${yamlStr(`${date}-${String(i + 1).padStart(2, "0")}`)}
title: ${yamlStr(p.title)}
type: ${type}
channel: ${yamlStr(p.channel)}
status: pending            # owner: change to "approved" or "rejected"
approved_by: ""            # owner: your name when approving
approved_at: ""            # owner: YYYY-MM-DD
expires: ${expires}        # approvals after this date are ignored
risk: ${yamlStr(p.risk || "unrated")}
claims_lint_blocking: ${lr.blocking}
claims_lint_warnings: ${lr.warnings}
claims_override_reason: "" # only if a clinical reviewer cleared a lint finding
---

# ${p.title}

**Why:** ${p.rationale || "-"}

**Success metric:** ${p.metric || "-"}

**Rollback / stop condition:** ${p.rollback || "-"}

**Needs clinical reviewer:** ${p.needs_clinical_review ? "yes" : "no / not stated"}

## Exact change (payload)

\`\`\`json
${payloadText}
\`\`\`

## Claims lint

${lr.findings.length ? lr.findings.map((f) => `- **${f.severity}** \`${f.rule}\`: "${f.match}" … ${f.why}`).join("\n") : "- No findings (this is a heuristic, not clinical sign-off)."}

## How to approve

Edit the front matter: \`status: approved\`, \`approved_by: <name>\`, \`approved_at: <date>\`.
Then run \`jarvis/execute-approved.sh\`. Nothing happens until you do.
`;
  writeFileSync(join(apprDir, "pending", file), body);
  rows.push(`| ${p.title} | ${type} | \`approvals/pending/${file}\` | lint: ${lr.blocking} blocking, ${lr.warnings} warn |`);
});

md = md.replace(m[0], `| Proposal | Type | File | Claims lint |\n|---|---|---|---|\n${rows.join("\n")}\n\nApprove by editing the file's front matter (see jarvis/approvals/README.md).\n`);
writeFileSync(reportPath, md);
console.log(`${rows.length} proposal(s) written`);
