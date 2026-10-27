#!/usr/bin/env bash
# Apply the recommended local Claude Code setup for Amani (see docs/engineering-tooling/claude-code/README.md).
# - Backs up ~/.claude/settings.json, then deep-merges docs/engineering-tooling/claude-code/user-settings.recommended.json
#   into it: keys the template sets take the template's value; keys it doesn't set are kept; permissions.allow and
#   each hook event's list are unioned with yours. Run with --dry-run first to see the result.
# - Installs the helper hooks and status line under ~/.claude/ (existing files are backed up, never silently replaced).
# - Copies .claude/settings.local.example.json to .claude/settings.local.json only if you have none.
# Usage: bash scripts/claude-code/apply-recommended-settings.sh [--dry-run]
set -euo pipefail
command -v jq >/dev/null || { echo "jq is required (brew install jq)" >&2; exit 2; }
REPO=$(git rev-parse --show-toplevel)
SRC="$REPO/docs/engineering-tooling/claude-code"
DRY=${1:-}
STAMP=$(date +%Y%m%d%H%M%S)
USER_SETTINGS="$HOME/.claude/settings.json"

run() { if [ "$DRY" = --dry-run ]; then echo "would: $*"; else "$@"; fi; }

mkdir -p "$HOME/.claude"
[ -f "$USER_SETTINGS" ] || echo '{}' > "$USER_SETTINGS"
merged=$(jq -s '
  .[0] as $cur | .[1] as $rec
  | ($cur * $rec)
  | .permissions.allow = ((($cur.permissions.allow // []) + ($rec.permissions.allow // [])) | unique)
  | .hooks = (($cur.hooks // {}) as $h | ($rec.hooks // {}) | to_entries
      | reduce .[] as $e ($h; .[$e.key] = (((.[$e.key] // []) + $e.value) | unique)))
  | del(.["$schema"])' "$USER_SETTINGS" "$SRC/user-settings.recommended.json")
if [ "$DRY" = --dry-run ]; then
  echo "== merged ~/.claude/settings.json would be:"; echo "$merged"
else
  cp "$USER_SETTINGS" "$USER_SETTINGS.bak-$STAMP"
  printf '%s\n' "$merged" > "$USER_SETTINGS.tmp" && jq -e . "$USER_SETTINGS.tmp" >/dev/null && mv "$USER_SETTINGS.tmp" "$USER_SETTINGS"
  echo "settings merged (backup: $USER_SETTINGS.bak-$STAMP)"
fi

install_file() { # src dest
  local src=$1 dest=$2
  run mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ] && ! cmp -s "$src" "$dest"; then run cp "$dest" "$dest.bak-$STAMP"; fi
  run cp "$src" "$dest"
}
install_file "$SRC/user-files/hooks/check-agent-models.mjs" "$HOME/.claude/hooks/check-agent-models.mjs"
install_file "$SRC/user-files/hooks/ruflo-session-start.sh" "$HOME/.claude/hooks/ruflo-session-start.sh"
install_file "$SRC/user-files/statusline/statusline-extras.cjs" "$HOME/.claude/statusline/statusline-extras.cjs"
install_file "$SRC/user-files/statusline/ruflo-statusline.sh" "$HOME/.claude/statusline/ruflo-statusline.sh"
if [ ! -f "$HOME/.claude/CLAUDE.md" ]; then install_file "$SRC/user-files/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
else echo "kept your ~/.claude/CLAUDE.md (compare with $SRC/user-files/CLAUDE.md)"; fi

if [ ! -f "$REPO/.claude/settings.local.json" ]; then run cp "$SRC/settings.local.example.json" "$REPO/.claude/settings.local.json"
else echo "kept your .claude/settings.local.json"; fi

echo "done. Next: install the plugins and MCP servers listed in docs/engineering-tooling/claude-code/README.md, then restart Claude Code."
