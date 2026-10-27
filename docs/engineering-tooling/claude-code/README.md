# Recommended local Claude Code setup

The Claude Code setup the owner used for the 2026-10 review-fix waves, captured from the working machine on 2026-10-24 so a new computer can reproduce it. These are **local, per-developer** settings: nothing here changes the app, CI or any deploy. The checked-in `.claude/settings.json` (team permissions) is unchanged.

## Quick start (new machine)
1. Install Claude Code, `jq`, Node 22 (`nvm install 22.22.2`), Docker Desktop, the Supabase CLI and `gh`, and sign in to each (`claude`, `gh auth login`, `supabase login` — run `supabase login` in a real terminal).
2. From the repo root: `bash scripts/claude-code/apply-recommended-settings.sh --dry-run`, review, then run it without `--dry-run`. It backs up `~/.claude/settings.json` and merges `user-settings.recommended.json` into it (the template's values win for the keys it sets, such as theme, model and permission mode; your other keys stay; allow rules and hooks are unioned), installs the helper hooks and status line, and creates `.claude/settings.local.json` from the example if you have none.
3. Install the plugins and MCP servers below, then restart Claude Code.

## What the recommended settings contain (`user-settings.recommended.json`)
- **Models:** `model: opus`; env pins `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` = `claude-opus-5-5[1m]`, Sonnet `claude-sonnet-5-5`, Haiku `claude-haiku-4-5`, Fable `claude-fable-5-1`; `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; ruflo flags `CLAUDE_FLOW_HOOKS_ENABLED`, `CLAUDE_FLOW_V3_ENABLED`.
- **Permissions:** `defaultMode: bypassPermissions` (Claude runs tools without asking) plus allow rules for claude-flow / ruflo. This was the owner's explicit choice. It removes the permission prompt as a safety net, so the ecc **GateGuard** hooks (installed with the `ecc` plugin) are what still stop destructive commands. Change it to `"default"` or `"auto"` if you want prompts.
- **Workflows:** `ultracode: true`, `enableWorkflows: true` (multi-agent workflows on by default).
- **Attribution:** `commit: ""`, `pr: ""` — no Claude trailer on commits or PR bodies (matches the repo rule: no `Co-Authored-By`).
- **UI:** dark theme, fullscreen TUI, hold-to-talk voice, the status line `~/.claude/statusline/statusline-extras.cjs`.
- **Hooks:** SessionStart runs `~/.claude/hooks/check-agent-models.mjs --quiet --fix` and `~/.claude/hooks/ruflo-session-start.sh` (both in `user-files/hooks/`).
- **Plugins** (with their marketplaces in `extraKnownMarketplaces`): `ecc@ecc` (profile `standard`, hooks on — includes GateGuard), `fable-foreman@fable-foreman`, `ruflo-core`, `ruflo-swarm`, `ruflo-workflows`, `ruflo-autopilot`, `ruflo-federation` (all `@ruflo`), `engineering-skills`, `engineering-advanced-skills`, `self-improving-agent` (all `@claude-code-skills`), `ui-ux-pro-max@ui-ux-pro-max-skill`, `sales-skills@salesskills`. After the merge, open `/plugin` to install anything that is enabled but missing.

Left out on purpose: the iTerm2 status hooks (`~/.config/iterm2/cc-status`, a terminal-specific binary). If you use iTerm2 with that integration, add it back on each event in `~/.claude/settings.json`.

## Project-local settings (`.claude/settings.local.json`, gitignored)
`settings.local.example.json`: `enableAllProjectMcpServers: true`, `enabledMcpjsonServers: ["ruflo"]`.

## MCP servers used
| Server | How to add | Notes |
|---|---|---|
| ruflo | `claude mcp add --scope user ruflo -- npx -y ruflo@latest mcp start` | swarm/memory tools; see the root CLAUDE.md |
| code-review-graph | install the `code-review-graph` CLI (it lands in `~/.local/bin`), then `claude mcp add --scope user code-review-graph -- ~/.local/bin/code-review-graph serve` | always pass `detail_level="minimal"` (see `user-files/CLAUDE.md`) |
| chrome-devtools | comes with the `ecc` plugin | |
| Claude Docs | claude.ai connector | signs in with your claude.ai account |

## User-level skills and agents
`~/.claude/skills/` held, among others, gstack (`/ship`, `/review`, `/qa`, `/investigate`, …), the fable-foreman skill, graphify, the Trail of Bits security skills, superpowers (`brainstorming`, `writing-plans`, `test-driven-development`, …) and the SEO set. `~/.claude/agents/` held the fable-foreman agents (`foreman-worker`, `foreman-verifier`, `foreman-scout`, `foreman-codex-wrapper`, `foreman-grok-wrapper`) and the SEO agents. Skills are not vendored here (they are third-party, large and update on their own); install them from their sources: gstack (`/gstack-upgrade` after install), graphify (`uv tool install graphifyy && graphify install`), fable-foreman (its plugin above).

## Global instructions
`user-files/CLAUDE.md` is the owner's `~/.claude/CLAUDE.md` (code-review-graph usage, ruflo, graphify). The script installs it only if you have none.

## Secrets
No secret, token or account identifier is stored here. Sign in to each tool on the new machine; never paste tokens into a Claude session.
