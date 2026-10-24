#!/usr/bin/env node
'use strict';
/**
 * statusline-extras.cjs — user-owned wrapper around the RuFlo V3 statusline.
 *
 * Why a wrapper, and why it lives in ~/.claude/statusline/: any newer
 * `@claude-flow/cli` run auto-refreshes ~/.claude/helpers/statusline.cjs and
 * silently drops local edits, and `ruflo cleanup --force` deletes the whole
 * helpers dir. RuFlo never touches ~/.claude/statusline/, and no automatic
 * RuFlo path rewrites the global settings.json statusLine while that file is
 * valid JSON.
 *
 * Runs the RuFlo statusline with Claude Code's stdin JSON, then adds:
 *   - a "📁 ~/path" segment to the header, right before the model name
 *   - a usage row under the header: Claude plan limits (5-hour + 7-day) from
 *     the `rate_limits` field Claude Code pipes to the statusline
 *     (Claude.ai subscribers only; absent for API-key / Bedrock sessions)
 * If the RuFlo statusline is missing or fails, a minimal header is shown.
 *
 * Usage (settings.json statusLine.command):
 *   node ~/.claude/statusline/statusline-extras.cjs [path/to/statusline.cjs]
 *   (default target: ~/.claude/helpers/statusline.cjs)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const tty = require('tty');
const { spawnSync } = require('child_process');

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[0;36m',
  purple: '\x1b[0;35m',
  brightGreen: '\x1b[1;32m',
  brightYellow: '\x1b[1;33m',
  brightRed: '\x1b[1;31m',
  brightBlue: '\x1b[1;34m',
  brightPurple: '\x1b[1;35m',
};
const SEP = '  ' + c.dim + '│' + c.reset + '  ';
const DOT = '  ' + c.dim + '·' + c.reset + '  ';
const ANSI = '(?:\\x1b\\[[0-9;]*m)*';
const MAX_DIR = 48;
// RuFlo's own worst case is ~8s CLI + 3s git + 3s sqlite; stay above it so its
// internal timeouts fire first and it still prints a (degraded) full statusline.
const TARGET_TIMEOUT_MS = 20000;
const STDIN_DEADLINE_MS = 2000;

function str(v) {
  return typeof v === 'string' ? v : '';
}

// ─── 📁 workspace segment ──────────────────────────────────────
// C0/C1 control chars, DEL, and bidi embedding/override/isolate marks
function isUnsafe(ch) {
  const cp = ch.codePointAt(0);
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

function workspaceDir(data) {
  const dir = str(data && data.workspace && data.workspace.current_dir) || str(data && data.cwd) || process.cwd();
  const home = os.homedir();
  let shown = dir;
  if (dir === home) shown = '~';
  else if (dir.startsWith(home + path.sep)) shown = '~' + dir.slice(home.length);
  const cps = Array.from(shown).filter((ch) => !isUnsafe(ch)); // code points, so an emoji is never split
  return cps.length > MAX_DIR ? '…' + cps.slice(-(MAX_DIR - 1)).join('') : cps.join('');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addWorkspace(header, data) {
  if (header.includes('📁')) return header; // copies patched the old way render it themselves
  const seg = c.brightBlue + '📁 ' + workspaceDir(data) + c.reset;
  const model = str(data && data.model && data.model.display_name);
  if (model) {
    const m = new RegExp('  ' + ANSI + '│' + ANSI + '  ' + ANSI + escapeRegExp(model)).exec(header);
    if (m) return header.slice(0, m.index) + SEP + seg + header.slice(m.index);
  }
  return header + SEP + seg;
}

// ─── ⏳ usage-limits row ────────────────────────────────────────
function fmtReset(resetsAt) {
  if (typeof resetsAt !== 'number' || !isFinite(resetsAt)) return '';
  let s = Math.max(0, Math.round(resetsAt - Date.now() / 1000));
  if (s < 60) return '<1m';
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return d + 'd' + (h ? ' ' + h + 'h' : '');
  if (h > 0) return h + 'h' + String(m).padStart(2, '0') + 'm';
  return m + 'm';
}

function limitSegment(label, win) {
  if (!win || typeof win.used_percentage !== 'number' || !isFinite(win.used_percentage)) return null;
  // used_percentage is an unrounded double (0.58 arrives as 57.99999999999999)
  const pct = Math.max(0, Math.round(win.used_percentage));
  const color = pct >= 80 ? c.brightRed : pct >= 50 ? c.brightYellow : c.brightGreen;
  const width = 10;
  const filled = Math.min(width, Math.round((pct / 100) * width));
  const bar = color + '█'.repeat(filled) + c.reset + c.dim + '░'.repeat(width - filled) + c.reset;
  const reset = fmtReset(win.resets_at);
  return c.cyan + label + c.reset + ' ' + bar + ' ' + color + pct + '%' + c.reset +
    (reset ? ' ' + c.dim + '↻ ' + reset + c.reset : '');
}

function usageRow(data) {
  const rl = data && data.rate_limits;
  if (!rl || typeof rl !== 'object') return '';
  const parts = [
    limitSegment('5h', rl.five_hour),
    limitSegment('7d', rl.seven_day),
    limitSegment('spend', rl.spend_limit),
  ].filter(Boolean);
  return parts.length ? '⏳ ' + parts.join(DOT) : '';
}

function decorate(output, data) {
  const lines = output.split('\n');
  lines[0] = addWorkspace(lines[0], data);
  const row = usageRow(data);
  if (row) lines.splice(1, 0, row);
  return lines.join('\n');
}

// ─── main ──────────────────────────────────────────────────────
// Never touch process.stdin: creating it flips fd 0 to non-blocking, and a
// payload whose EOF arrives late would then be dropped.
function readStdin() {
  if (tty.isatty(0)) return '';
  const chunks = [];
  const buf = Buffer.alloc(65536);
  const deadline = Date.now() + STDIN_DEADLINE_MS;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e.code === 'EAGAIN' && Date.now() < deadline) {
        Atomics.wait(sleeper, 0, 0, 5);
        continue;
      }
      break; // EOF / closed fd / deadline: keep what was read
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(raw) {
  try {
    const t = raw.trim();
    return t.startsWith('{') ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

function main() {
  const raw = readStdin();
  const data = parseJson(raw);
  const target = process.argv[2] || path.join(os.homedir(), '.claude', 'helpers', 'statusline.cjs');

  let output = '';
  if (fs.existsSync(target)) {
    const r = spawnSync(process.execPath, [target], {
      input: raw,
      encoding: 'utf8',
      timeout: TARGET_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    output = typeof r.stdout === 'string' ? r.stdout : '';
  }
  if (!output.trim()) {
    const model = str(data && data.model && data.model.display_name);
    output = c.brightPurple + '▊ ' + c.reset + 'Claude' + (model ? SEP + c.purple + model + c.reset : '') + '\n';
  }
  let final = output;
  try {
    final = decorate(output, data);
  } catch {
    /* an extra must never blank the whole statusline */
  }
  process.stdout.write(final);
}

if (require.main === module) main();

module.exports = { decorate, usageRow, addWorkspace, workspaceDir, fmtReset };
