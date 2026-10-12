# Amani Context7 boundaries

This project-owned companion deliberately sits alongside the vendor-generated
`context7.md` rule and `.claude/skills/find-docs/SKILL.md`. It overrides those
vendor instructions on conflict, including their blanket lookup and preference
instructions. Keep these guardrails separate so vendor setup cannot overwrite them.

## Engineering scope and precedence

Use Context7 when implementing or reviewing external library/API behaviour where
current or version-specific documentation materially affects correctness.
Repository code, installed package versions, official vendor behaviour, existing
contracts and tests outrank Context7. Verify the actual installed package version
first, before relying on version-specific documentation.

The Lead verified on 2026-10-06 that Context7's index is both behind and ahead
of us: it indexes `supabase-js` at v2.58.0 against our installed 2.105.3, and its
newest Vite is 8.x against our 5.4.8. A nearby or newest indexed version is not
proof of installed behaviour; recheck installed versions for each task.

## Privacy prohibition

Context7 must NEVER receive patient names, user identifiers, emails, report
contents, biomarker values tied to a user, symptoms, health history,
interpretations, tokens, secrets, credentials, private application data, or
screenshots containing PHI. This includes symptoms tied to a user, access tokens,
API secrets, database credentials and production credentials. Queries are generic
technical questions only.

GOOD: "Supabase JS vX: how does `auth.getUser()` behave server-side?"
GOOD: "Current Vite documentation for environment variable exposure."
BAD: "Here is patient Jane Doe's report payload. Why does this Supabase insert fail?"
BAD: "Here is our production service-role token."

## Clinical-evidence prohibition

Context7 may NEVER be used as a source for biomarker reference ranges, Amani
context bands, medical evidence, clinical guidance, pregnancy guidance,
medication guidance, supplement guidance, critical-value thresholds, or
regulatory/legal authority. The Amani Clinical Truth Layer has its own
evidence/provenance process and is the only evidence path for Amani clinical
work. Context7 belongs only to the SOFTWARE ENGINEERING knowledge path.

## Offline implementer limit

The Codex implementer sandbox has no network, so `ctx7` is unusable from it.
Do not run Context7 commands from that sandbox. Context7 is a Lead/reviewer
tool: whoever has network performs the generic documentation lookup and hands
the finding, source and applicable version to the implementer in the brief.
