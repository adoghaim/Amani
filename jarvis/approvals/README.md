# Approvals (approve-by-editing)

Jarvis never executes write actions on its own. Every proposed action from the daily report becomes one file:

```
approvals/
  pending/    new proposals (one .md per action) — written by run-daily.sh
  approved/   optional: move approved files here (or just edit status in place)
  rejected/   optional: move rejected files here for the record
  executed/   moved here after an attended execution; logged in logs/executed.tsv
```

## Approve

Open the file, read the **Exact change (payload)** and **Claims lint** sections, then edit the front matter:

```yaml
status: approved
approved_by: "Mohammed Awad"
approved_at: "2026-10-12"
```

You may edit the payload before approving (e.g. reword a caption). The executor re-lints the payload as it stands.

To reject: `status: rejected` (optionally add a reason line below the front matter and move it to `rejected/`).
Jarvis reads pending/rejected items so it does not re-propose them.

## Execute

```bash
./jarvis/execute-approved.sh --list   # see what is approved and eligible
./jarvis/execute-approved.sh          # one attended Claude Code session per item
```

An item is eligible only if: `status: approved`, `approved_by` filled, today ≤ `expires`, and the claims lint of
the title + payload has no blocking findings — or `claims_override_reason` is filled because a clinical reviewer
cleared it. `OWNER_APPROVAL_REQUIRED` must be `true` and the script must run in an interactive terminal.

Execution opens an **interactive** Claude Code session in default permission mode, so every post, API write or
email shows up as a tool call that you approve or deny. There is no headless write path. Publishing credentials
(e.g. Instagram content publishing, TikTok Content Posting, Google Ads mutate) are added to `.env` only when you
decide to enable that capability.

## Git

Approval files contain drafts and metrics, so they are git-ignored by default. To keep an audit trail in the repo,
remove the `approvals/*` lines from `jarvis/.gitignore` (decision for the owner).
