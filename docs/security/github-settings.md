# GitHub security settings (owner actions)

Repository settings belong to the repository owner (Adell, `adoghaim`). The
factory adds configuration files and CI checks only. It never changes repository
settings, enables paid features, or creates repository variables or secrets.
Each step below is something only the owner does, in the GitHub UI, when he
decides to.

The repository is **private**. On a private repository, secret scanning, push
protection and CodeQL code scanning come with **GitHub Secret Protection** and
**GitHub Code Security**. Those are paid add-ons for organisations, and on a
personal account their availability depends on the plan. Check
**Settings → Advanced Security** (named "Code security" on some accounts) to
see what the account offers before planning on any of this.

## 1. Secret scanning and push protection

Secret scanning finds credentials committed to the repository. Push protection
blocks a push that contains a recognised secret before it lands.

1. Open the repository on GitHub, then **Settings → Advanced Security**.
2. Turn on **Secret Protection** if the account requires it as a separate step.
3. Under **Secret scanning**, select **Enable**.
4. Under **Push protection**, select **Enable**.
5. Optional: enable **Non-provider patterns** and **Validity checks** if they
   are offered.

Afterwards, alerts show under **Security → Secret scanning**. A push that a
contributor, or a factory agent, believes is a false positive is blocked until
someone bypasses it with a stated reason. The owner can see those bypasses in the
alert list. Agents must not bypass push protection. They stop and report.

If an alert ever names a real credential, treat it as compromised: rotate it at
the provider (Supabase, Stripe, OpenAI and so on) first, then clean up the
history. Removing the commit does not un-leak the credential.

## 2. Code scanning with CodeQL

`.github/workflows/codeql.yml` analyses `javascript-typescript` (the web app
and the edge functions under `supabase/functions`) with the
`security-extended` query suite. It runs on every PR to `main`, every Monday,
and on demand. Until the owner turns it on it stays **dormant**: the job shows
as *skipped*, never red, because CodeQL on a private repository requires
Code Security, and GitHub rejects uploaded results while code scanning is off.

To turn it on:

1. **Settings → Advanced Security**: enable **Code Security** (or GitHub
   Advanced Security, depending on the plan).
2. Under **Code scanning**, do **not** choose "Default setup". The repository
   ships an advanced-setup workflow, and default setup would run a second,
   overlapping analysis. If GitHub prompts you, choose **Advanced**. The workflow
   is already committed.
3. **Settings → Secrets and variables → Actions → Variables → New repository
   variable**: name `CODE_SCANNING_ENABLED`, value `true`.
4. **Actions → CodeQL → Run workflow** on `main` once, so the Security tab has a
   baseline before the next PR.

Results appear under **Security → Code scanning**, and as annotations on PRs.
To make high-severity alerts block a merge, add a code scanning rule under
**Settings → Rules → Rulesets**: target `main`, then **Require code scanning
results** with CodeQL at the "High or higher" threshold. That is a separate
owner decision.

To pause it again, delete the variable or set it to anything other than `true`.

## 3. Dependabot

`.github/dependabot.yml` opens update PRs:

- **npm**, weekly on Mondays. All minor and patch bumps arrive grouped in one
  PR. Major bumps arrive as separate PRs so each breaking change is reviewed on
  its own.
- **GitHub Actions**, monthly.

Version updates need no setting. For vulnerability alerts and security update
PRs, go to **Settings → Advanced Security** and enable **Dependabot alerts** and
**Dependabot security updates**. Both are available on private repositories
without a paid add-on.

Dependabot PRs go through the same CI and owner review as any other PR. Nothing
auto-merges.

Dependabot does **not** read the `npm:` and `jsr:` specifiers inside
`supabase/functions`. Those are covered by section 4.

## 4. Pinned edge-function imports (already enforced, no owner action)

Supabase resolves an edge function's remote imports when the function is
deployed. A specifier such as `npm:@supabase/supabase-js@2` or `npm:zod@^3.25.76`
therefore lets production code change on the next deploy, with no commit. Every
`npm:`, `jsr:` and `https:` import under `supabase/functions` must name one exact
`MAJOR.MINOR.PATCH` version. If a Deno import map (`deno.json`, `deno.jsonc` or
`import_map.json`) is ever added, its entries must be pinned the same way.

- Check: `npm run check:pinned-imports`
  (`tools/supply-chain/check-pinned-imports.mjs`). It fails on a range, a bare
  major, a tag, a missing version, `http:`, or a computed dynamic import.
- Tests for the checker: `npm run test:supply-chain`.
- CI: the **Edge function typecheck** job runs both before the Deno check.

To upgrade a package, edit the version in every file that imports it, run
`npm run check:functions` and the tests, and redeploy the affected functions. A
redeploy is an owner action.

An exact version pins the package itself. On deploy, Deno still resolves that
package's own dependencies from the registry, because the functions have no
`deno.lock`. Committing a lockfile per function is a possible later step. It is
not part of PK-SUPPLY-01.
