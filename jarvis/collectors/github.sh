#!/usr/bin/env bash
# GitHub repo activity via the gh CLI (read-only): commits (24h), PRs, CI runs.
# Auth: `gh auth login` once on the machine, or GH_TOKEN in jarvis/.env (fine-grained, read-only).
# Docs: https://cli.github.com/manual/gh_auth_login
set -uo pipefail
SRC=github
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
emit_status() { # status note
  node -e 'const [s,n,src,t]=process.argv.slice(1);console.log(JSON.stringify({source:src,generated_at:t,status:s,note:n},null,2))' "$1" "$2" "$SRC" "$(now)"
}
if ! command -v gh >/dev/null 2>&1; then emit_status skipped "gh CLI not installed"; exit 0; fi
if [ -z "${GITHUB_REPO:-}" ]; then emit_status skipped "Set GITHUB_REPO (e.g. adoghaim/Amani)"; exit 0; fi
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ]; then emit_status skipped "gh is not authenticated: run 'gh auth login' or set GH_TOKEN"; exit 0; fi

if date -u -v-1d +%Y-%m-%dT%H:%M:%SZ >/dev/null 2>&1; then
  SINCE=$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)          # macOS/BSD date
  SINCE7=$(date -u -v-7d +%Y-%m-%d)
else
  SINCE=$(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ)  # GNU date
  SINCE7=$(date -u -d '7 days ago' +%Y-%m-%d)
fi

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
gh api "repos/$GITHUB_REPO/commits?since=$SINCE&per_page=100" \
  --jq '[.[] | {sha: .sha[0:7], author: (.commit.author.name), date: .commit.author.date, message: (.commit.message | split("\n")[0])}]' \
  >"$tmp/commits.json" 2>"$tmp/commits.err" || echo '{"error":"commits query failed"}' >"$tmp/commits.json"
gh pr list -R "$GITHUB_REPO" --state open --limit 50 \
  --json number,title,author,isDraft,createdAt,updatedAt,headRefName,reviewDecision,statusCheckRollup,url \
  --jq '[.[] | {number,title,author: .author.login,isDraft,createdAt,updatedAt,headRefName,reviewDecision,url,
          checks: ([.statusCheckRollup[]? | {name: (.name // .context), state: (.conclusion // .state)}])}]' \
  >"$tmp/open_prs.json" 2>/dev/null || echo '{"error":"open PR query failed"}' >"$tmp/open_prs.json"
gh pr list -R "$GITHUB_REPO" --state merged --search "merged:>=$SINCE7" --limit 50 \
  --json number,title,mergedAt,author,url --jq '[.[] | {number,title,mergedAt,author: .author.login,url}]' \
  >"$tmp/merged_prs_7d.json" 2>/dev/null || echo '{"error":"merged PR query failed"}' >"$tmp/merged_prs_7d.json"
gh run list -R "$GITHUB_REPO" --limit 30 \
  --json databaseId,workflowName,displayTitle,headBranch,event,status,conclusion,createdAt,url \
  >"$tmp/ci_runs.json" 2>/dev/null || echo '{"error":"workflow runs query failed"}' >"$tmp/ci_runs.json"

node -e '
const fs=require("fs");const d=process.argv[1];const r=(f)=>JSON.parse(fs.readFileSync(d+"/"+f,"utf8"));
const out={source:"github",generated_at:new Date().toISOString(),status:"ok",data:{
  repo:process.env.GITHUB_REPO, commits_24h:r("commits.json"), open_prs:r("open_prs.json"),
  merged_prs_7d:r("merged_prs_7d.json"), ci_runs_recent:r("ci_runs.json"),
  notes:["The Vercel status check on PRs is expected noise (repo is hosted on Netlify). Judge PRs by Lint, typecheck, build + Netlify preview."]}};
console.log(JSON.stringify(out,null,2));' "$tmp"
