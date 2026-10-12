#!/usr/bin/env bash
# Jarvis installer for macOS and Linux. Idempotent: safe to re-run after editing .env.
#
#   ./setup.sh                 # interactive: check tools, logins, .env, dirs, schedule
#   ./setup.sh --no-schedule   # skip launchd/cron
#   ./setup.sh --install-cron  # Linux: install the crontab line (otherwise it is only printed)
#   ./setup.sh --non-interactive
#   ./setup.sh --test          # after setup, run collectors only (no Claude call) as a smoke test
set -euo pipefail
JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$JARVIS_DIR"
export PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"

SCHEDULE=1; INSTALL_CRON=0; INTERACTIVE=1; TEST=0
for a in "$@"; do case "$a" in
  --no-schedule) SCHEDULE=0 ;; --install-cron) INSTALL_CRON=1 ;; --non-interactive) INTERACTIVE=0 ;; --test) TEST=1 ;;
  *) echo "unknown option $a" >&2; exit 2 ;; esac; done
[ -t 0 ] || INTERACTIVE=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
ask()  { [ $INTERACTIVE -eq 1 ] || return 1; read -r -p "  $1 [y/N] " r; [ "$r" = y ] || [ "$r" = Y ]; }
OS="$(uname -s)"; FAIL=0

echo "== 1. Tools"
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -ge 18 ]; then ok "node $(node -v)"; else bad "node $(node -v) is too old (need >= 18 for built-in fetch)"; FAIL=1; fi
else bad "node not found. macOS: brew install node | Linux: https://nodejs.org/en/download"; FAIL=1; fi
if command -v gh >/dev/null 2>&1; then ok "gh $(gh --version | head -1 | awk '{print $3}')"; else bad "gh not found. https://cli.github.com/ (macOS: brew install gh)"; FAIL=1; fi
if command -v claude >/dev/null 2>&1; then ok "claude $(claude --version 2>/dev/null | head -1)"; else
  bad "Claude Code CLI not found. Install: https://code.claude.com/docs/en/setup"; FAIL=1; fi
command -v git >/dev/null 2>&1 && ok "git" || { bad "git not found"; FAIL=1; }
command -v psql >/dev/null 2>&1 && ok "psql (optional, Supabase metrics)" || warn "psql not found (optional; macOS: brew install libpq, Linux: apt install postgresql-client)"

echo "== 2. Logins"
if command -v claude >/dev/null 2>&1; then
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then warn "ANTHROPIC_API_KEY is set in this shell. Jarvis unsets it at run time so the subscription login is used."; fi
  if claude auth status >/dev/null 2>&1; then
    method="$(claude auth status 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).authMethod||"?")}catch{console.log("?")}})')"
    ok "Claude Code logged in (authMethod: $method)"
    [ "$method" = "api_key" ] && warn "Logged in with an API key. The owner requirement is the Claude subscription: run 'claude auth logout' then 'claude auth login'."
  else
    warn "Claude Code is not logged in."
    if ask "Run 'claude auth login' now (opens a browser; choose your Claude subscription account)?"; then
      claude auth login || bad "login failed"
    else
      echo "    Later: run 'claude auth login'. On a headless box use 'claude setup-token' and put the token in .env as CLAUDE_CODE_OAUTH_TOKEN."
    fi
  fi
fi
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then ok "gh authenticated"; else
    warn "gh not authenticated."
    if ask "Run 'gh auth login' now?"; then gh auth login || bad "gh login failed"; else echo "    Later: gh auth login (or set GH_TOKEN in .env)"; fi
  fi
fi

echo "== 3. .env"
if [ ! -f .env ]; then cp .env.example .env; chmod 600 .env; ok "Created jarvis/.env from .env.example (chmod 600). Fill it in, then re-run ./setup.sh"; else ok ".env exists"; chmod 600 .env || true; fi
set -a; . ./.env; set +a

REQUIRED=(GITHUB_REPO POSTHOG_HOST POSTHOG_PROJECT_ID POSTHOG_PERSONAL_API_KEY REPORT_TIME OWNER_APPROVAL_REQUIRED)
RECOMMENDED=(STRIPE_RESTRICTED_KEY REVENUECAT_API_V2_KEY REVENUECAT_PROJECT_ID NETLIFY_AUTH_TOKEN NETLIFY_SITE_ID SUPABASE_READONLY_DB_URL REPORT_DELIVERY)
for v in "${REQUIRED[@]}"; do if [ -n "${!v:-}" ]; then ok "$v set"; else bad "$v missing (day-1 required)"; FAIL=1; fi; done
for v in "${RECOMMENDED[@]}"; do [ -n "${!v:-}" ] && ok "$v set" || warn "$v not set (recommended; that section will be skipped)"; done
if [ "${OWNER_APPROVAL_REQUIRED:-}" != "true" ]; then bad "OWNER_APPROVAL_REQUIRED must be 'true'"; FAIL=1; fi
if ! [[ "${REPORT_TIME:-}" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then bad "REPORT_TIME must be HH:MM (24h), got '${REPORT_TIME:-}'"; FAIL=1; fi
if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then bad "SUPABASE_SERVICE_ROLE_KEY is set in .env. Remove it: Jarvis must never hold the service role key."; FAIL=1; fi
if [[ "${STRIPE_RESTRICTED_KEY:-}" == sk_* ]]; then bad "STRIPE_RESTRICTED_KEY is a full secret key (sk_). Use a restricted read-only key (rk_)."; FAIL=1; fi
REPO_DIR="${JARVIS_REPO_DIR:-$(cd .. && pwd)}"
[ -d "$REPO_DIR/.git" ] && ok "Amani repo checkout: $REPO_DIR" || warn "JARVIS_REPO_DIR ($REPO_DIR) is not a git checkout; repo docs/factory status will be missing"
if [ -n "${SECOND_BRAIN_PATH:-}" ]; then [ -f "$SECOND_BRAIN_PATH/80 Skills/Load Project Context.md" ] && ok "Second Brain found" || warn "SECOND_BRAIN_PATH set but '80 Skills/Load Project Context.md' not found there"; fi

echo "== 4. Directories"
mkdir -p reports logs approvals/pending approvals/approved approvals/rejected approvals/executed
chmod +x run-daily.sh execute-approved.sh collectors/*.sh collectors/*.mjs lib/*.mjs 2>/dev/null || true
ok "reports/ logs/ approvals/{pending,approved,rejected,executed}"

echo "== 5. Schedule"
HOUR=$((10#${REPORT_TIME%%:*})); MIN=$((10#${REPORT_TIME##*:}))
CRON_LINE="$MIN $HOUR * * * cd \"$JARVIS_DIR\" && /bin/bash ./run-daily.sh >> \"$JARVIS_DIR/logs/cron.log\" 2>&1 # amani-jarvis"
if [ $SCHEDULE -eq 0 ]; then warn "Skipped (--no-schedule)"
elif [ $FAIL -ne 0 ]; then warn "Not installing the schedule until the errors above are fixed."
elif [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.amani.jarvis.plist"; mkdir -p "$HOME/Library/LaunchAgents"
  RUN_PATH="$(dirname "$(command -v node)"):$(dirname "$(command -v gh)"):$(dirname "$(command -v claude)"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  sed -e "s|__JARVIS_DIR__|$JARVIS_DIR|g" -e "s|__HOUR__|$HOUR|g" -e "s|__MINUTE__|$MIN|g" -e "s|__PATH__|$RUN_PATH|g" -e "s|__HOME__|$HOME|g" \
    com.amani.jarvis.plist >"$PLIST.new"
  plutil -lint "$PLIST.new" >/dev/null && mv "$PLIST.new" "$PLIST"
  launchctl bootout "gui/$(id -u)/com.amani.jarvis" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  ok "LaunchAgent installed: $PLIST (daily at $REPORT_TIME local time)"
  echo "    Run now:  launchctl kickstart -k gui/$(id -u)/com.amani.jarvis"
  echo "    Remove:   launchctl bootout gui/$(id -u)/com.amani.jarvis && rm \"$PLIST\""
else
  echo "    Cron line (local time):"
  echo "    $CRON_LINE"
  if [ $INSTALL_CRON -eq 1 ]; then
    ( crontab -l 2>/dev/null | grep -v '# amani-jarvis$' || true; echo "$CRON_LINE" ) | crontab -
    ok "Installed in crontab (replaced any previous amani-jarvis line)"
  else
    echo "    Install with: ./setup.sh --install-cron   (or crontab -e and paste it)"
  fi
  echo "    Windows: use WSL2 and Task Scheduler, see README.md 'Windows'."
fi

if [ $TEST -eq 1 ] && [ $FAIL -eq 0 ]; then echo "== 6. Smoke test (collectors only)"; ./run-daily.sh --collect-only; fi

echo
if [ $FAIL -ne 0 ]; then bad "Setup incomplete: fix the items marked ✗ and re-run ./setup.sh"; exit 1; fi
ok "Setup complete. Try: ./run-daily.sh --force   (writes reports/$(date +%Y-%m-%d).md)"
