# HY1 — Untrack leftovers; ignore local state

- Track: **hygiene** · branch `factory/rv-hygiene` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: none — this track adds no migrations (if one is unavoidable, stop and put it under handoffs)
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests
- Files this packet owns (others may touch nearby code concurrently): .gitignore; tracked leftovers
- Findings: F080, F081, F090

## Decisions already made for you (follow them; deviations need evidence in your result)

1. F080: `git rm -r --cached supabase/.temp` and ignore supabase/.temp/ and supabase/.branches/. F081: root .gitignore gets .env.* with !.env.example, graphify-out/, **/.expo/ and logs.txt — check existing patterns first and never ignore anything tracked on purpose (.env.example, e2e/no-env/.gitkeep). F090: `git rm` logs.txt, .bolt/ and apps/mobile/.expo/ after confirming nothing references them (the Stripe appInfo rename belongs to billing-stripe).
2. Core gates still pass; `git status` clean afterwards.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F080 — Supabase CLI state (supabase/.temp/) is tracked, not ignored, and already dirtying the working tree

- Location: `supabase/.temp/cli-latest:1` · severity low · category repo-hygiene · owner_action=False

**Evidence**

What is tracked: `git ls-files supabase/.temp` lists 9 files: cli-latest, gotrue-version, linked-project.json, pooler-url, postgres-version, project-ref, rest-version, storage-migration, storage-version. They were added in b5db3d5 (2026-05-01, Bolt era) and re-committed in b17ca0d and 391ec99.

Not ignored: there is no supabase/.gitignore, and `git check-ignore --no-index supabase/.temp` matches no rule.

Already churning: `git status` shows ' M supabase/.temp/cli-latest' right now.

What it holds: linked-project.json carries the organization id. pooler-url carries the pooler host and DB user; I checked it by regex for a password segment (none) and did not print it.

Nothing uses it: `git grep supabase/.temp` finds no readers.

Why it matters: tools/release/common.py:41 raises 'Tracked tree dirty' on any modified tracked file. Any local Supabase CLI run therefore breaks preflight.py and verify_build.py on a developer machine, which is the owner's manual fallback path.

**Recommendation**

1. Run `git rm -r --cached supabase/.temp`.
2. Add `supabase/.temp/` and `supabase/.branches/` to .gitignore (the defaults that `supabase init` writes to supabase/.gitignore).

**Verifier's note**

Confirmed. git ls-files lists the 9 files. They were added in b5db3d5 and re-committed in b17ca0d and 391ec99; 391ec99 even carries a cli-latest bump, v2.115.0 to v2.116.0. There is no supabase/.gitignore, and check-ignore matches no rule. git diff shows cli-latest changed from v2.116.0 to v2.121.0, which is the CLI's update-check cache. linked-project.json holds organization_id. pooler-url has no password segment (checked by regex, not printed). No file reads or documents .temp. common.py:41 rejects any modified tracked file. I lowered it because the release-path impact is overstated. preflight.py runs in release-rc.yml on a fresh checkout. The 'Manual fallback' in tools/release/README.md:212-216 is owner console distribution, not a local preflight run. The data is not secret. It is a real hygiene problem, but low.

### F081 — .gitignore misses Vite mode env files and the 5.5 MB graphify-out/ directory

- Location: `.gitignore:23` · severity low · category repo-hygiene · owner_action=False

**Evidence**

Env files: .gitignore:23 ignores only `.env`, and :12 ignores `*.local`. `git check-ignore --no-index` reports .env.production, .env.development and .env.staging as NOT ignored, and Vite loads .env.[mode] files. jarvis/.gitignore:3-4 already uses `.env.*` with `!.env.example`.

graphify-out/: 130 files, 5.5 MB (graph.json 2.2 MB, graph.html 2.3 MB, cache/). It is untracked and unignored (`git status`: '?? graphify-out/'), so one `git add -A` commits it.

Already covered (checked):
- agentdb.rvf, agentdb.rvf.lock, ruvector.db (.gitignore:49-52)
- dist (:10)
- /test-results/ and /playwright-report/ (:78-79)
- .code-review-graph/ and .gstack/ ignore themselves with an inner '*' .gitignore
- No *.db file, dist/ or .env file is tracked; the only tracked .env files are .env.example and jarvis/.env.example.

**Recommendation**

Add these to the root .gitignore: `.env.*`, `!.env.example`, `graphify-out/`, `**/.expo/` and `logs.txt`.

**Verifier's note**

The facts check out. .gitignore:23 ignores only .env and :12 ignores *.local. check-ignore reports .env.production, .env.development and .env.staging as not ignored. graphify-out is 5.5M in 130 files, untracked and unignored. The env-file half is weak. Vite's own convention is to commit .env.[mode] and ignore *.local, which line 12 already does. No such file exists, and none is referenced (git grep). VITE_* values are public bundle values anyway, and CLAUDE.md forbids server secrets in .env. graphify-out is per-machine output from a user-scope tool and has sat uncommitted since 10-11. Adding it next to the existing per-machine block at lines 45-54 is minor cleanup.

### F090 — Bolt- and Expo-era leftovers are still tracked: logs.txt, .bolt/, apps/mobile/.expo/, and Stripe clients named 'Bolt Integration'

- Location: `logs.txt:1` · severity low · category repo-hygiene · owner_action=False

**Evidence**

- logs.txt: 199 lines, committed in b5db3d5 (2026-05-01). It is a stale ESLint dump containing 24 absolute paths under the owner's home directory. Nothing references it (git grep), and .gitignore's `logs` and `*.log` rules don't match it.
- .bolt/config.json ({"template":"bolt-vite-react-ts"}) and .bolt/prompt (the Bolt template prompt) are tracked and unreferenced, although CLAUDE.md:75 says Bolt is gone.
- apps/mobile/.expo/ (README.md, devices.json, web/cache/.../favicon-48.png) is tracked from 57c6ccc 'v1 sdk'. That folder's own README says 'Should I commit the .expo folder? No', and nothing references apps/.
- Production code: the Stripe clients in supabase/functions/stripe-checkout/index.ts:22-25 and stripe-webhook/index.ts:12-15 send appInfo name 'Bolt Integration'.
- By contrast, skills-lock.json is intended. It was committed with .agents/skills/ in PR #22 'so they follow the repo across machines'. Keep it.
- jarvis/ is also intended: it is documented in README.md:39, templated (the plist uses __JARVIS_DIR__ placeholders), keeps secrets out via jarvis/.gitignore, and its tests run under Vitest.

**Recommendation**

1. `git rm` logs.txt, .bolt/ and apps/mobile/.expo/.
2. Rename the Stripe appInfo to 'Amani'. It takes effect only when the owner redeploys stripe-checkout and stripe-webhook.

**Verifier's note**

Confirmed. logs.txt is tracked: 199 lines from b5db3d5, 24 of them with /Users/ paths, no references, and no .gitignore rule matches it. .bolt/config.json and .bolt/prompt are tracked and unreferenced. apps/mobile/.expo has 3 tracked files from 57c6ccc, and its own README (:10-12) says not to commit it. appInfo name 'Bolt Integration' appears at stripe-checkout/index.ts:23 and stripe-webhook/index.ts:13; it is cosmetic Stripe User-Agent metadata. Low hygiene.

