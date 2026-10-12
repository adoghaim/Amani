#!/usr/bin/env bash
# Executes owner-approved proposals. Deliberately NOT automatic:
#  1. Only files in approvals/pending/ or approvals/approved/ whose front matter says
#     status: approved AND approved_by is filled AND not expired are considered.
#  2. Proposals with blocking claims-lint findings are refused unless claims_override_reason is filled
#     (meaning a clinical reviewer cleared it).
#  3. Execution happens in an INTERACTIVE Claude Code session in default permission mode, so the owner
#     sees and approves every single tool call (post, API write, email). There is no headless write path.
#  4. Afterwards the owner confirms, and the file moves to approvals/executed/ with a log line.
#
# Usage: ./execute-approved.sh            # list + execute approved items one by one
#        ./execute-approved.sh --list     # just list
set -euo pipefail
JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$JARVIS_DIR"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -f .env ] && { set -a; . ./.env; set +a; }
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

if [ "${OWNER_APPROVAL_REQUIRED:-true}" != "true" ]; then
  echo "Refusing: OWNER_APPROVAL_REQUIRED must be 'true'. Jarvis has no unattended write mode." >&2; exit 1
fi
if [ ! -t 0 ]; then echo "Refusing: execution must be run interactively by the owner (no TTY)." >&2; exit 1; fi

fm() { # fm <file> <key> -> front-matter value without quotes/comments
  awk -v k="$2" 'NR==1&&/^---/{f=1;next} f&&/^---/{exit} f&&$0~"^"k":"{sub("^"k":[ ]*","");sub(/[ ]+#.*$/,"");gsub(/^"|"$/,"");print;exit}' "$1"
}
TODAY="$(date +%Y-%m-%d)"; LIST_ONLY=0; [ "${1:-}" = "--list" ] && LIST_ONLY=1
mkdir -p approvals/executed approvals/approved logs

found=0
for f in approvals/pending/*.md approvals/approved/*.md; do
  [ -e "$f" ] || continue
  [ "$(fm "$f" status)" = "approved" ] || continue
  by="$(fm "$f" approved_by)"; exp="$(fm "$f" expires)"; blk="$(fm "$f" claims_lint_blocking)"; ovr="$(fm "$f" claims_override_reason)"
  title="$(fm "$f" title)"; type="$(fm "$f" type)"
  if [ -z "$by" ]; then echo "SKIP $f: approved_by is empty"; continue; fi
  if [ -n "$exp" ] && [[ "$exp" < "$TODAY" ]]; then echo "SKIP $f: approval expired on $exp (re-propose)"; continue; fi
  # Re-lint the file as it stands now (the owner may have edited the payload).
  # Only the title + payload are linted (the file's own "Claims lint" section quotes old findings).
  if node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const a=t.indexOf("## Exact change");const b=t.indexOf("## Claims lint");const h=(t.match(/^# .*$/m)||[""])[0];process.stdout.write(h+"\n"+(a>=0?t.slice(a,b>a?b:undefined):t))' "$f" \
     | node lib/claims-lint.mjs - >/dev/null; then blk=0; else blk=1; fi
  if [ "${blk:-0}" != "0" ] && [ -z "$ovr" ]; then echo "SKIP $f: blocking claims-lint findings and no claims_override_reason"; continue; fi
  found=1
  echo "APPROVED: [$type] $title  ($f, approved by $by)"
  [ $LIST_ONLY -eq 1 ] && continue
  read -r -p "Open an interactive Claude Code session to carry this out now? [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || continue
  claude --permission-mode default \
    --append-system-prompt "You are executing ONE owner-approved Jarvis proposal. Do exactly what the payload says and nothing else. Every write action must go through a visible tool call the owner approves. If the payload is ambiguous, stop and ask. Follow the clinical-language rules in $JARVIS_DIR/prompts/marketing.md." \
    "Carry out the approved proposal in $JARVIS_DIR/$f. Summarise what you will do, then do it step by step."
  read -r -p "Was it executed successfully? [y/N] " executed_ok
  if [ "$executed_ok" = "y" ] || [ "$executed_ok" = "Y" ]; then
    mv "$f" approvals/executed/
    printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$by" "$type" "$title" >>logs/executed.tsv
    echo "Moved to approvals/executed/ and logged."
  fi
done
[ $found -eq 0 ] && echo "No approved, unexpired, lint-clean proposals."
exit 0
