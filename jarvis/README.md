# Jarvis — Amani's daily admin & growth agent

Jarvis runs every morning on the owner's machine, gathers what happened across the codebase, the software
factory, product analytics, revenue, app stores and marketing channels, and writes one prioritised report:
**what changed, what matters, and what to do next** — for product, growth and strategic marketing — with
drafted content that follows Amani's clinical-language rules.

Jarvis is **read-and-recommend**. It never publishes, sends, launches, ends, changes spend, merges or deploys.
Anything like that becomes a proposal file the owner approves by editing it, and is executed later in an
attended session.

It runs on the **owner's Claude subscription** via Claude Code's headless mode (`claude -p`) with Claude Code's
own login — no Anthropic API key.

---

## Architecture

```
launchd (macOS) / cron (Linux) / Task Scheduler+WSL (Windows)
        │  daily at REPORT_TIME
        ▼
run-daily.sh ── loads .env, unsets ANTHROPIC_API_KEY, fast-forwards the repo checkout (read-only)
   │
   ├─ 1. collectors/run-all.mjs ──► reports/.data/<date>/<source>.json + bundle.json
   │      github.sh (gh CLI) · factory.mjs · posthog.mjs · stripe.mjs · revenuecat.mjs · supabase.sh
   │      netlify.mjs · appstore.mjs · googleplay.mjs · meta.mjs · tiktok.mjs · youtube.mjs · pinterest.mjs
   │      x.mjs · linkedin.mjs · googleads.mjs · ga4.mjs · searchconsole.mjs · resend.mjs
   │      (each prints one JSON object; missing credentials => "skipped" with the env var names)
   │
   ├─ 2. lib/build-mcp-config.mjs ──► runtime MCP config with only the servers whose credentials exist
   │      posthog (read-only header) · github (read-only endpoint) · stripe (restricted key) · revenuecat
   │      supabase (opt-in only)
   │
   ├─ 3. claude -p  (subscription login)
   │      system prompt: prompts/daily-report.md (+ marketing.md, ab-testing.md read as files)
   │      tools: Read, Glob, Grep [+ WebSearch] + read-only MCP; Bash/Edit/Write/WebFetch denied;
   │      --permission-mode dontAsk --strict-mcp-config; --add-dir <repo> [<Second Brain>]
   │      ──► reports/<date>.md
   │
   ├─ 4. lib/extract-proposals.mjs ──► approvals/pending/<date>-NN-<slug>.md  (+ claims lint per proposal)
   │
   └─ 5. lib/deliver.mjs ──► file (always) · Slack webhook · email to owner via Resend (optional)

execute-approved.sh (manual, attended) ──► one interactive Claude Code session per approved proposal
```

### Files

| Path | Purpose |
|---|---|
| `setup.sh` | Idempotent installer: checks node/gh/claude/git, logins, creates `.env`, validates, dirs, schedule |
| `run-daily.sh` | The daily pipeline above. Flags: `--force`, `--collect-only`, `--date YYYY-MM-DD` |
| `execute-approved.sh` | Lists/executes approved proposals in attended sessions (`--list` to only list) |
| `.env.example` | Every variable, grouped by service, tagged DAY-1 / REC / LATER |
| `.mcp.json` | Claude Code MCP config (also usable interactively: `cd jarvis && claude`) |
| `com.amani.jarvis.plist` | launchd template rendered by `setup.sh` |
| `prompts/daily-report.md` | Jarvis's system/task prompt and report format |
| `prompts/ab-testing.md` | How to propose PostHog experiments (hypothesis, metric, sample size, guardrails) |
| `prompts/marketing.md` | Positioning, clinical-language rules for marketing, pillars, channels |
| `collectors/` | One small script per service; Node ESM with built-in `fetch`, no npm dependencies |
| `lib/claims-lint.mjs` | Heuristic linter for marketing copy (mirrors the repo's nutrient/claims rules) |
| `sql/supabase-readonly-role.sql` | Optional count-only views + read-only role for Supabase metrics (manual, not a migration) |
| `approvals/` | Approve-by-editing workflow (see `approvals/README.md`) |
| `SETUP_ACCOUNTS.md` | Creating each business account and obtaining each credential, with official links |

## Daily flow

1. **Collect** (≈1 min): deterministic scripts call each API read-only and save JSON. A failing or unconfigured
   service is recorded and skipped; it never blocks the report.
2. **Reason**: Claude reads the bundle, the repo's `AGENTS.md`/`CLAUDE.md`/`NUTRIENT_GUIDELINES.md`, the factory
   ledger (`factory/status.json` or `factory/STATUS.md`, whichever exists), recent reports, pending approvals and,
   if configured, the Second Brain; it may drill down through read-only MCP (e.g. PostHog experiment results).
3. **Report**: `jarvis/reports/YYYY-MM-DD.md` with TL;DR, data health, build (repo + factory), product analytics,
   revenue, experiments & flags, marketing & social, a prioritised "what to do next" list, content drafts and
   proposals.
4. **Proposals → approvals/pending/**, each linted for clinical-language problems.
5. **Delivery** to Slack/email if configured. If Claude fails (login expired, usage limit), a data-only fallback
   report is written so the morning still has something.

## Safety and approval model

- **Read-only by construction.** Collectors only issue GET requests (plus read-only query endpoints such as
  PostHog HogQL and Google Ads search). The Claude step has no shell, no file-write tools and no web fetch;
  MCP servers are configured read-only (PostHog `x-posthog-read-only`, GitHub `/mcp/readonly`, Stripe restricted
  key, RevenueCat read-only key, Supabase `read_only=true` and opt-in). `--permission-mode dontAsk` denies any
  tool not explicitly allowed.
- **Least-privilege credentials.** `.env.example` asks for read-only/restricted variants. `setup.sh` refuses a
  Stripe `sk_` key and any `SUPABASE_SERVICE_ROLE_KEY`; the Supabase collector refuses privileged DB roles.
- **Approve-by-editing.** Proposals are files with `status: pending`. The owner sets `status: approved` and
  `approved_by`. `execute-approved.sh` checks status, approver, expiry and the claims lint, requires
  `OWNER_APPROVAL_REQUIRED=true` and a TTY, and then opens an **interactive** Claude Code session where each write
  is a visible tool call the owner approves. Publishing credentials are added only when that capability is wanted.
- **Clinical language.** Marketing follows the same rules as the app (no diagnosis, no treatment claims, no
  dosing/supplements, no "optimal/better/worse/normal" without authority). `lib/claims-lint.mjs` flags drafts;
  a clean lint is not clinical sign-off.
- **Untrusted content.** Reviews, comments, PR text and web results are data; the prompt tells Jarvis to ignore
  instructions inside them and to report suspicious content. With no write tools, injected instructions have
  nothing to act with.
- **Privacy.** Aggregates only; no user-level data in reports. The Supabase path uses count-only views.
- **Second Brain.** Read-only via `--add-dir`; Jarvis may *suggest* Brain updates in the report, never writes,
  never puts secrets there.
- **Repo.** `run-daily.sh` only fast-forwards a clean checkout; it never commits, pushes, merges or deploys.

## Install on a new machine

Prerequisites: a Claude Pro/Max (or Team) subscription, Node ≥ 18, git, GitHub CLI, Claude Code CLI;
optional `psql`.

```bash
# 1. Tools (macOS shown; Linux: use your package manager)
brew install node gh git
# Claude Code: follow https://code.claude.com/docs/en/setup  (native installer or npm)

# 2. Clone the repo (Jarvis lives in jarvis/)
git clone https://github.com/adoghaim/Amani.git ~/Amani && cd ~/Amani/jarvis

# 3. First pass: checks tools, offers `claude auth login` and `gh auth login`, creates .env
./setup.sh

# 4. Fill in jarvis/.env (DAY-1 vars at minimum: GITHUB_REPO, POSTHOG_HOST, POSTHOG_PROJECT_ID,
#    POSTHOG_PERSONAL_API_KEY, REPORT_TIME, OWNER_APPROVAL_REQUIRED=true). See SETUP_ACCOUNTS.md.

# 5. Second pass: validates and installs the schedule; --test runs the collectors once
./setup.sh --test

# 6. First real report now
./run-daily.sh --force && open reports/$(date +%F).md
```

Claude login notes:
- `claude auth login` stores the subscription login (macOS Keychain; `~/.claude/.credentials.json` on Linux).
  `claude auth status` must report a subscription method, not `api_key`.
- On a headless machine use `claude setup-token` and put the token in `.env` as `CLAUDE_CODE_OAUTH_TOKEN`.
- Logins expire; Claude Code warns a few days ahead. If a run fails with "login expired", the fallback report
  says so; run `claude auth login` again.
- Jarvis's runs count toward the subscription's usage limits. If it hits a limit, the fallback report is written.
- Do not run Claude with `--bare` here: bare mode ignores the subscription login.

### macOS (launchd)

`setup.sh` renders `com.amani.jarvis.plist` into `~/Library/LaunchAgents/` and loads it with
`launchctl bootstrap gui/<uid>`. It runs at `REPORT_TIME` in local time as the logged-in user. If the Mac sleeps
through the time, the job runs on wake; if it is off, that day is skipped.

```bash
launchctl kickstart -k gui/$(id -u)/com.amani.jarvis    # run now
launchctl print gui/$(id -u)/com.amani.jarvis | head     # status
launchctl bootout gui/$(id -u)/com.amani.jarvis          # unload
```

### Linux (cron)

`setup.sh` prints the line; `./setup.sh --install-cron` installs it (idempotent, tagged `# amani-jarvis`):

```
30 7 * * * cd "/home/you/Amani/jarvis" && /bin/bash ./run-daily.sh >> "/home/you/Amani/jarvis/logs/cron.log" 2>&1 # amani-jarvis
```

### Windows

Use WSL2 (https://learn.microsoft.com/en-us/windows/wsl/install), install the tools inside Ubuntu, clone the repo
there and run `./setup.sh --no-schedule`. Then create a daily task in Task Scheduler
(https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page), for example from an
elevated PowerShell:

```powershell
schtasks /Create /SC DAILY /ST 07:30 /TN "Amani Jarvis" /TR "wsl.exe -d Ubuntu -- bash -lc '~/Amani/jarvis/run-daily.sh'"
```

The PC must be on and the user logged in (or configure the task to run whether logged in or not).

## MCP servers

`.mcp.json` wires official remote MCP servers (verified against each vendor's docs, Oct 2026):

| Server | URL | Auth | Read-only control |
|---|---|---|---|
| PostHog | `https://mcp.posthog.com/mcp` | `Bearer ${POSTHOG_PERSONAL_API_KEY}` (MCP Server preset key) | header `x-posthog-read-only: true`, pinned with `x-posthog-project-id` |
| GitHub | `https://api.githubcopilot.com/mcp/readonly` | `Bearer ${GITHUB_MCP_PAT}` | `/readonly` endpoint + read-only fine-grained PAT |
| Stripe | `https://mcp.stripe.com` | `Bearer ${STRIPE_RESTRICTED_KEY}` | restricted key permissions |
| RevenueCat | `https://mcp.revenuecat.ai/mcp` | `Bearer ${REVENUECAT_API_V2_KEY}` | key permissions |
| Supabase (opt-in) | `https://mcp.supabase.com/mcp?project_ref=…&read_only=true&features=database,docs` | `Bearer ${SUPABASE_ACCESS_TOKEN}` | `read_only=true`; off unless `JARVIS_ENABLE_SUPABASE_MCP=true` because the PAT is account-wide and SQL can read row-level health data |

Official servers that exist but are **not** wired into the daily run because they are write-oriented and not
needed for reporting: Netlify (`npx -y @netlify/mcp`), Resend (`https://mcp.resend.com/mcp`).
TODO: Meta, TikTok, YouTube, Pinterest, X, LinkedIn, Reddit, Google Ads, GA4, Search Console, App Store Connect
and Google Play are covered by collectors; no official MCP server was verified for them, so none is configured.

Claude Code does not expand certain well-known credential variable names into remote MCP headers (it reads
them as empty). That is why GitHub uses `GITHUB_MCP_PAT` rather than `GH_TOKEN`. If a server reports 401, copy
the value into a differently named variable.

Interactive use: `cd jarvis && claude` loads `.mcp.json` as a project config (approve the servers when asked);
for PostHog you can also use OAuth instead of a key (`claude mcp add --transport http posthog https://mcp.posthog.com/mcp`).

## Troubleshooting

- `./run-daily.sh --collect-only` shows each collector's status without calling Claude.
- `JARVIS_COLLECTORS=posthog node collectors/run-all.mjs /tmp/x` runs one collector.
- `logs/claude-<date>.err`, `logs/launchd.*.log`, `logs/cron.log`.
- Funnel shows zeros: the event names in `.env` don't match the app's events; the report lists the real top events.
