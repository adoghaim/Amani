#!/usr/bin/env node
// Builds the runtime MCP config for the daily run from jarvis/.mcp.json:
//  - drops any server whose ${VARS} are not set (so missing credentials degrade gracefully),
//  - drops opt-in servers unless explicitly enabled,
//  - prints the list of allowed MCP tool patterns on stderr-free stdout line 2 for run-daily.sh.
// Usage: node lib/build-mcp-config.mjs <in .mcp.json> <out runtime.json>
import { readFileSync, writeFileSync } from "node:fs";

const [inPath, outPath] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(inPath, "utf8"));
const OPT_IN = { supabase: "JARVIS_ENABLE_SUPABASE_MCP" }; // can read row-level data: opt-in only
const kept = {}, dropped = {};
for (const [name, srv] of Object.entries(cfg.mcpServers || {})) {
  const vars = [...JSON.stringify(srv).matchAll(/\$\{([A-Z0-9_]+)(:-[^}]*)?\}/g)].filter((m) => !m[2]).map((m) => m[1]);
  const unset = vars.filter((v) => !process.env[v]);
  if (OPT_IN[name] && !/^(1|true|yes)$/i.test(process.env[OPT_IN[name]] || "")) { dropped[name] = `opt-in: set ${OPT_IN[name]}=true`; continue; }
  if (unset.length) { dropped[name] = `missing ${unset.join(", ")}`; continue; }
  kept[name] = srv;
}
writeFileSync(outPath, JSON.stringify({ mcpServers: kept }, null, 2));
console.log(Object.keys(kept).map((n) => `mcp__${n}__*`).join(","));
console.log(JSON.stringify({ kept: Object.keys(kept), dropped }));
