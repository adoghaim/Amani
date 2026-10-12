#!/usr/bin/env node
// Software-factory status ledger. Reads factory/status.json (preferred) or factory/STATUS.md
// from the Amani repo checkout. Accepts both vocabularies seen in drafts:
//   todo | in-progress | review | done | blocked   and   next | in-progress | shipped | blocked
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { emit, run } from "./lib.mjs";

const SRC = "factory";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.env.JARVIS_REPO_DIR || join(here, "..", ".."));
const candidates = [process.env.FACTORY_STATUS_PATH, join(repo, "factory", "status.json"), join(repo, "factory", "STATUS.md")].filter(Boolean);
const found = candidates.find((p) => existsSync(p));
if (!found) {
  emit(SRC, { status: "skipped", note: `No factory ledger found (looked in: ${candidates.join(", ")}). The factory may not be merged yet.` });
  process.exit(0);
}

const norm = (s) => {
  const v = String(s || "").toLowerCase().trim();
  if (["done", "shipped", "merged", "complete", "completed"].includes(v)) return "shipped";
  if (["todo", "next", "ready", "queued"].includes(v)) return "next";
  if (["in-progress", "in progress", "wip", "doing", "review"].includes(v)) return v === "review" ? "in-review" : "in-progress";
  if (v === "blocked") return "blocked";
  return v || "unknown";
};

await run(SRC, async () => {
  if (found.endsWith(".json")) {
    const j = JSON.parse(readFileSync(found, "utf8"));
    const packets = (j.packets || []).map((p) => ({
      id: p.id, title: p.title, phase: p.phase, wave: p.wave, status: norm(p.status), raw_status: p.status,
      depends_on: p.depends_on || [], pr: p.pr, branch: p.branch, blocked_reason: p.blocked_reason,
      gates_required: p.gates_required, gates_passed: p.gates_passed, owner_approval: p.owner_approval,
      deployed: p.deployed, updated: p.updated,
    }));
    const byId = Object.fromEntries(packets.map((p) => [p.id, p]));
    const ready = packets.filter((p) => p.status === "next" && p.depends_on.every((d) => byId[d]?.status === "shipped"));
    const counts = packets.reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {});
    return {
      path: found, generated: j.generated, schema_version: j.schema_version, counts,
      in_progress: packets.filter((p) => p.status === "in-progress" || p.status === "in-review"),
      blocked: packets.filter((p) => p.status === "blocked"),
      ready_next: ready.map((p) => ({ id: p.id, title: p.title, phase: p.phase })),
      recently_shipped: packets.filter((p) => p.status === "shipped").slice(-10),
      awaiting_owner_approval: packets.filter((p) => (p.gates_required || []).includes("G5") && !(p.gates_passed || []).includes("G5") && p.status === "in-review"),
      note: j.note,
    };
  }
  // Markdown fallback: hand the table to the model verbatim (truncated).
  return { path: found, markdown: readFileSync(found, "utf8").slice(0, 20000) };
});
