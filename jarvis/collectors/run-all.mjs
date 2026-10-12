#!/usr/bin/env node
// Runs every collector with a timeout and writes one JSON file per source plus bundle.json.
// Usage: node collectors/run-all.mjs <outDir>
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2];
if (!outDir) { console.error("usage: run-all.mjs <outDir>"); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const TIMEOUT = Number(process.env.JARVIS_COLLECTOR_TIMEOUT_MS || 120000);
const only = (process.env.JARVIS_COLLECTORS || "").split(",").map((s) => s.trim()).filter(Boolean);

const files = readdirSync(here).filter((f) => (f.endsWith(".mjs") || f.endsWith(".sh")) && !["lib.mjs", "run-all.mjs"].includes(f));
const selected = files.filter((f) => !only.length || only.includes(f.replace(/\.(mjs|sh)$/, "")));

function runOne(file) {
  return new Promise((resolveP) => {
    const name = file.replace(/\.(mjs|sh)$/, "");
    const cmd = file.endsWith(".sh") ? "bash" : process.execPath;
    const child = spawn(cmd, [join(here, file)], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT);
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed;
      try { parsed = JSON.parse(out); } catch {
        parsed = { source: name, status: "error", note: `Collector produced no valid JSON (exit ${code}). stderr: ${err.slice(0, 300)}` };
      }
      writeFileSync(join(outDir, `${name}.json`), JSON.stringify(parsed, null, 2));
      resolveP([name, parsed]);
    });
  });
}

const results = Object.fromEntries(await Promise.all(selected.map(runOne)));
const summary = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.status + (v.note ? ` - ${String(v.note).slice(0, 140)}` : "")]));
writeFileSync(join(outDir, "bundle.json"), JSON.stringify({ generated_at: new Date().toISOString(), summary, sources: results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
