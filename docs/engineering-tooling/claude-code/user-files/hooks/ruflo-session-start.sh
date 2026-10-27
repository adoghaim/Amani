#!/usr/bin/env bash
# SessionStart hook — ensure the ruflo worker daemon is running and surface its
# status at the start of every Claude Code session.
#
# IDEMPOTENCY FIX (2026-06-22): the upstream `@claude-flow/cli` daemon launcher
# forks a NEW foreground daemon on every `daemon start` without a reliable
# pre-fork dedup (no PID-file check before fork in daemon.js, and the shared
# daemon.pid is unlinked on ANY daemon exit). Calling `ruflo daemon start` once
# per session therefore leaked one daemon per session per workspace (92 leaked,
# ~470 MB, observed). We now gate the start on a live-process check keyed to
# this workspace, so we only start when nothing is already running here.
#
# Notes:
#   - ruflo's MCP server (the mcp__ruflo__* tools) auto-starts via the plugin's
#     own mcpServers config; this hook only covers the *worker daemon*.
#   - Invoked via `npx -y ruflo@latest` — same channel the MCP server uses.
#   - Always exits 0 so a ruflo hiccup never blocks a session from starting.

NOISE='Loading ONNX|Disk cache|ONNX embedder'
WS="$PWD"

# --- atomic per-workspace start guard (fixes the TOCTOU duplicate-daemon leak) -
# The pgrep check below is check-then-act: two sessions starting in the SAME
# workspace near-simultaneously both see "no daemon" before either child has
# registered its `--workspace <WS>` argv, so both fork -> duplicate daemons
# (observed 2026-06-22 as a regression on plugin update). Serialize the
# check+start with an atomic mkdir lock keyed to this workspace (portable; no
# flock dependency). Stale locks (crashed holder) are reaped after 30s, and if
# the lock machinery ever wedges we fall through and start anyway — so this can
# never block a session from getting a daemon.
LOCKROOT="${TMPDIR:-/tmp}/ruflo-session-locks"
mkdir -p "$LOCKROOT" 2>/dev/null
LOCKHASH="$(printf '%s' "$WS" | /usr/bin/shasum 2>/dev/null | cut -d' ' -f1)"
[ -z "$LOCKHASH" ] && LOCKHASH="$(printf '%s' "$WS" | cksum | cut -d' ' -f1)"
LOCK="$LOCKROOT/${LOCKHASH}.lock"
_held=0
_t=0
while [ "$_t" -lt 100 ]; do
  if mkdir "$LOCK" 2>/dev/null; then _held=1; break; fi
  _age=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
  [ "$_age" -gt 30 ] && { rm -rf "$LOCK" 2>/dev/null; continue; }
  _t=$((_t + 1)); sleep 0.1
done
[ "$_held" = 1 ] && trap 'rm -rf "$LOCK" 2>/dev/null' EXIT

# The launcher stamps `--workspace <root>` as the FINAL argv entry on every
# foreground daemon (see daemon.js daemonCommandLineBelongsToWorkspace). Match
# it with an end-anchor so workspace /Users/mawad does not match a daemon for
# /Users/mawad/Desktop/... .
# AUTOSTART RE-ENABLED 2026-07-07 at the user's explicit request. They were
# shown the token-burn history (824M tokens / 2,127 SDK sessions overnight; see
# memory: ruflo-daemon-hook-leaks) and chose to re-enable autostart in every
# workspace anyway. The atomic mkdir-lock above + the workspace-end-anchored
# pgrep below prevent the duplicate-daemon PILE-UP leak — they do NOT limit the
# daemon's 24/7 SDK-worker TOKEN spend. To disable autostart again: swap the
# `daemon start` line below for an echo (see .bak-before-reenable-20260707), or
# kill live daemons with:  pkill -f 'ruflo.*daemon start'
if pgrep -f -- "daemon start --foreground --quiet --workspace ${WS}$" >/dev/null 2>&1; then
  echo "ruflo daemon already running for ${WS} — skipping start (idempotent)."
else
  npx -y ruflo@latest daemon start 2>&1 | grep -vE "$NOISE"
fi

# Release the lock once the start decision is made — don't hold it across the
# slower `daemon status` call below.
[ "$_held" = 1 ] && { rm -rf "$LOCK" 2>/dev/null; trap - EXIT; }

# Surface the daemon + worker status box.
npx -y ruflo@latest daemon status 2>&1 | grep -vE "$NOISE"

exit 0
