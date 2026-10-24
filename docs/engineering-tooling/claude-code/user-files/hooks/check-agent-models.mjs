#!/usr/bin/env node
// Guard: flag (and optionally auto-fix) any sub-agent pinned below the 4.6 model floor.
//
// Policy (user request, 2026-06): all Claude sub-agents must be 4.6+.
//   sonnet  -> Sonnet 4.6   OK
//   opus    -> Opus 4.8     OK
//   inherit -> parent model OK
//   (no model: line) -> inherits parent OK
//   haiku   -> Haiku 4.5    BELOW FLOOR (no 4.6 Haiku exists)
//   explicit claude-*-4-5 / older version ids -> BELOW FLOOR
//
// Usage:
//   node check-agent-models.mjs            # scan, human-readable report
//   node check-agent-models.mjs --quiet    # only print if violations/fixes (for hooks)
//   node check-agent-models.mjs --fix      # auto-rewrite below-floor pins to a 4.6+ alias
//   node check-agent-models.mjs --all      # scan every agents/ dir, not just installed
//
// --fix remap (intent-preserving, tracks the latest of the tier via alias):
//   *opus*   -> opus     (Opus 4.8)
//   anything else below floor (haiku, sonnet-4-5, ...) -> sonnet (Sonnet 4.6, cheapest allowed)
// --fix only rewrites confirmed BELOW-floor pins. `unknown` (unrecognized) models are
// never rewritten — they are reported for a human to check.
//
// Exit code: 0 = clean (or everything fixable was fixed), 1 = unresolved violations/unknowns.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".claude");
const QUIET = process.argv.includes("--quiet");
const ALL = process.argv.includes("--all");
const FIX = process.argv.includes("--fix");

// Only these caches/dirs hold agents that can actually be spawned today.
// Keep in sync with ~/.claude/plugins/installed_plugins.json + real user dirs.
const INSTALLED_SCOPES = [
  "plugins/cache",          // every installed plugin loads from cache/
  "agents",                 // user-level agents
  "skills",                 // skill-bundled agents
];

// A model alias is OK if it resolves to the latest of its tier and that
// latest is >= 4.6. haiku is excluded because Haiku tops out at 4.5.
const OK_ALIASES = new Set(["sonnet", "opus", "inherit"]);

// Explicit version ids that are below the 4.6 floor.
const BELOW_FLOOR_ID = /claude-(?:[a-z]+-)?(?:[0-3](?:[.-]\d+)?|4[.-]5)\b/i; // 4-5 and older
// Anything 4-6/4-7/4-8 (or higher) is fine.

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      yield* walk(p);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      yield p;
    }
  }
}

function inInstalledScope(path) {
  const rel = path.slice(ROOT.length + 1);
  return INSTALLED_SCOPES.some((s) => rel.startsWith(s + "/") || rel.startsWith(s + "\\"));
}

// Bounds of the leading --- ... --- frontmatter block. fmEnd is the index of the
// closing fence's leading "\n" (or text.length if unterminated).
function frontmatterBounds(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  return { fmEnd: end === -1 ? text.length : end };
}

function frontmatterModel(text) {
  const b = frontmatterBounds(text);
  if (!b) return null;
  const fm = text.slice(0, b.fmEnd);
  const m = fm.match(/^model:\s*(.+?)\s*$/im);
  return m ? m[1].replace(/['"]/g, "").trim() : null;
}

function classify(model) {
  if (!model) return "ok";                       // inherits parent
  const v = model.toLowerCase();
  if (OK_ALIASES.has(v)) return "ok";
  if (v === "haiku") return "below";             // 4.5 only
  if (BELOW_FLOOR_ID.test(v)) return "below";    // explicit old id
  if (/4[.-](?:[6-9]|\d{2})/.test(v)) return "ok"; // explicit 4.6+ id
  return "unknown";                               // unrecognized -> surface it
}

// Map a below-floor model to a compliant alias, preserving tier intent.
function remap(model) {
  return /opus/i.test(model) ? "opus" : "sonnet";
}

// Rewrite the first `model:` line inside the frontmatter block only.
// Returns the new file text, or null if no frontmatter model line was found.
function rewriteModel(text, newValue) {
  const b = frontmatterBounds(text);
  if (!b) return null;
  const fm = text.slice(0, b.fmEnd);
  const rest = text.slice(b.fmEnd);
  if (!/^model:\s*.+$/im.test(fm)) return null;
  const newFm = fm.replace(/^(model:\s*)(?:.+?)(\s*)$/im, `$1${newValue}$2`);
  return newFm + rest;
}

const violations = [];   // below-floor pins still unresolved (unfixable / write failed)
const unknowns = [];     // unrecognized models — never auto-touched
const fixed = [];        // { file, from, to } successfully rewritten this run

for (const file of walk(join(ROOT, "agents"))) maybe(file);
for (const file of walk(join(ROOT, "skills"))) maybe(file);
for (const file of walk(join(ROOT, "plugins"))) {
  if (!ALL && !inInstalledScope(file)) continue;
  maybe(file);
}

function maybe(file) {
  // only treat files that live under an agents/ dir as agent defs
  if (!/[\\/]agents[\\/]/.test(file)) return;
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return; }
  const model = frontmatterModel(text);
  const verdict = classify(model);
  if (verdict === "below") {
    if (FIX) {
      const to = remap(model);
      const next = rewriteModel(text, to);
      if (next && next !== text) {
        try {
          writeFileSync(file, next);
          fixed.push({ file, from: model, to });
          return;
        } catch { /* fall through -> report as unresolved */ }
      }
    }
    violations.push({ file, model });
  } else if (verdict === "unknown") {
    unknowns.push({ file, model });
  }
}

const scope = ALL ? "ALL agent dirs" : "installed scope only";

if (violations.length === 0 && unknowns.length === 0) {
  // Clean (possibly after fixing). Surface fixes even in --quiet: a file mutation
  // is worth one line so it isn't a silent surprise later.
  if (fixed.length) {
    const noun = fixed.length === 1 ? "sub-agent" : "sub-agents";
    console.log(`[agent-model-guard] auto-fixed ${fixed.length} ${noun} to the 4.6+ floor (${scope}):`);
    for (const f of fixed) {
      console.log(`  → ${f.from} ⇒ ${f.to}   ${f.file.replace(homedir(), "~")}`);
    }
  } else if (!QUIET) {
    console.log(`[agent-model-guard] OK — every sub-agent is 4.6+ (${scope}).`);
  }
  process.exit(0);
}

const lines = [];
if (fixed.length) {
  const noun = fixed.length === 1 ? "sub-agent" : "sub-agents";
  lines.push(`[agent-model-guard] auto-fixed ${fixed.length} ${noun} to the 4.6+ floor (${scope}):`);
  for (const f of fixed) lines.push(`  → ${f.from} ⇒ ${f.to}   ${f.file.replace(homedir(), "~")}`);
}
lines.push(`[agent-model-guard] ⚠ sub-4.6 sub-agents found (${scope}):`);
for (const v of violations) {
  lines.push(`  ✗ ${(v.model || "").padEnd(8)} ${v.file.replace(homedir(), "~")}`);
}
for (const u of unknowns) {
  lines.push(`  ? ${(u.model || "").padEnd(8)} ${u.file.replace(homedir(), "~")} (unrecognized model — verify)`);
}
lines.push(`  Fix: set 'model: sonnet' (4.6) or 'model: opus' (4.8) in the frontmatter, or run with --fix.`);
console.error(lines.join("\n"));
process.exit(1);
