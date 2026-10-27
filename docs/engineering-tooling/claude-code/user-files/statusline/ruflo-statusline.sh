#!/usr/bin/env bash
# Claude Code statusLine — shows ruflo (claude-flow) worker-daemon status plus
# directory / git branch / model context.
#
# Design constraints:
#   * Runs on EVERY statusline refresh (throttled ~300ms) — must be fast and
#     must NEVER spawn `npx`/ruflo. It only reads the daemon's cached state
#     file (~/.claude-flow/daemon-state.json), which the running daemon keeps
#     fresh, and checks liveness via the pidfile.
#   * Must never hang or error: every parse is guarded; missing/garbled state
#     degrades to "ruflo ○ off". Always exits 0.
#
# Data source written by:  @claude-flow/cli daemon  (invoked as `ruflo`)
set -o pipefail 2>/dev/null

STATE="${RUFLO_STATE_FILE:-$HOME/.claude-flow/daemon-state.json}"
PIDF="${RUFLO_PID_FILE:-$HOME/.claude-flow/daemon.pid}"
JQ="$(command -v jq || true)"

# ----- ANSI colors (Claude Code renders these in the statusline) -------------
R=$'\033[0m'; DIM=$'\033[90m'; BOLD=$'\033[1m'
GREEN=$'\033[32m'; BGREEN=$'\033[92m'; RED=$'\033[31m'
YELLOW=$'\033[33m'; CYAN=$'\033[36m'; BCYAN=$'\033[96m'

# ----- 1. Claude Code context from stdin -------------------------------------
input="$(cat)"
cwd=""; model=""
if [ -n "$JQ" ] && [ -n "$input" ]; then
  cwd="$(printf '%s' "$input"   | "$JQ" -r '.cwd // .workspace.current_dir // empty' 2>/dev/null)"
  model="$(printf '%s' "$input" | "$JQ" -r '.model.display_name // .model.id // empty' 2>/dev/null)"
fi
[ -z "$cwd" ] && cwd="$PWD"

# directory, ~-shortened and collapsed to last 2 segments when long
case "$cwd" in
  "$HOME")    dir="~" ;;
  "$HOME"/*)  dir="~/${cwd#"$HOME"/}" ;;
  *)          dir="$cwd" ;;
esac
if [ "${#dir}" -gt 24 ]; then
  dir="…/$(basename "$(dirname "$cwd")")/$(basename "$cwd")"
fi
branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)"

# ----- 2. ruflo daemon liveness ----------------------------------------------
alive=0
if [ -f "$PIDF" ]; then
  pid="$(cat "$PIDF" 2>/dev/null)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then alive=1; fi
fi

# ----- 3. ruflo worker stats from the cached state file ----------------------
rtype=""; en=0; runc=0; runs=0; succ=0; fail=0; nxt=""
if [ -n "$JQ" ] && [ -f "$STATE" ]; then
  JQPROG='
    def rel($s): if $s<=0 then "now"
      elif $s<60 then "\($s|floor)s"
      elif $s<3600 then "\(($s/60)|floor)m"
      else "\(($s/3600)|floor)h" end;
    (.config.workers // [] | map(select(.enabled)) | map(.type)) as $en
    | (.workers // {}) as $w
    | ($en | map($w[.] // {})) as $ew
    | ($en | map(select(($w[.].isRunning // false)))) as $runT
    | [ ($runT[0] // "-"),                              # "-" = no worker running
        ($en|length|tostring),
        ($runT|length|tostring),
        ($ew|map(.runCount//0)|add // 0|tostring),
        ($ew|map(.successCount//0)|add // 0|tostring),
        ($ew|map(.failureCount//0)|add // 0|tostring),
        ( [ $en[] | {t:., r:($w[.].nextRun // null)} | select(.r!=null)
            | {t:.t, e:(.r|sub("\\.[0-9]+Z$";"Z")|fromdateiso8601)} ]
          | map(select(.e>now)) | sort_by(.e) | (.[0] // null)
          | if .==null then "-" else "\(.t) \(rel(.e-now))" end )  # "-" = none scheduled
      ] | @tsv'
  # Every field is non-empty ("-" placeholders) so the tab-delimited read never
  # collapses adjacent tabs (tab is IFS-whitespace).
  IFS=$'\t' read -r rtype en runc runs succ fail nxt < <("$JQ" -r "$JQPROG" "$STATE" 2>/dev/null)
  [ "$rtype" = "-" ] && rtype=""
  [ "$nxt" = "-" ] && nxt=""
  # sanitize numerics (anything non-digit -> 0) so arithmetic/[ -gt ] never errors
  for v in en runc runs succ fail; do
    case "${!v}" in (*[!0-9]*|"") printf -v "$v" 0 ;; esac
  done
fi

# ----- 4. compose the ruflo segment ------------------------------------------
if [ "$alive" = 1 ]; then
  seg="${BOLD}${BGREEN}●${R}${BOLD} ruflo${R}"
  if [ "${runc:-0}" -gt 0 ] && [ -n "$rtype" ]; then
    seg="$seg ${BCYAN}⚙ ${rtype}${R}"               # a worker is actively running
  else
    seg="$seg ${GREEN}idle${R}"
  fi
  seg="$seg ${DIM}·${R} ${en}w"
  if [ "${runs:-0}" -gt 0 ]; then
    rate=$(( 100 * succ / runs ))
    if [ "${fail:-0}" -gt 0 ]; then
      seg="$seg ${DIM}·${R} ${runs} runs ${YELLOW}${rate}%${R} ${RED}${fail}✗${R}"
    else
      seg="$seg ${DIM}·${R} ${runs} runs ${GREEN}${rate}%${R}"
    fi
  fi
  [ -n "$nxt" ] && seg="$seg ${DIM}· next ${nxt}${R}"
elif [ -f "$STATE" ]; then
  seg="${BOLD}${RED}○ ruflo${R} ${RED}stopped${R}${DIM} (daemon not running)${R}"
else
  seg="${DIM}○ ruflo off${R}"
fi

# ----- 5. compose the context segment ----------------------------------------
ctx="${DIM}${dir}${R}"
[ -n "$branch" ] && ctx="$ctx ${DIM}⎇ ${branch}${R}"
[ -n "$model" ]  && ctx="$ctx ${DIM}· ${model}${R}"

printf '%s   %s\n' "$seg" "$ctx"
exit 0
