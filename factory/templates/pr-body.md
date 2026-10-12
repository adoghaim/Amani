## Packet
PK-___ — tickets: ___

## What already existed
<!-- inventory before changes -->

## What changed

## Acceptance criteria → proof
| Criterion | Test / artifact | Result |
|---|---|---|

## Gates
- [ ] G0 core CI (lint, typecheck, contrast, test, build, check:functions, migration harness)
- [ ] G1 web e2e: Chromium / WebKit / Firefox
- [ ] G2 native: cap:sync, Android assembleDebug, (iOS sim build if labeled `factory:ios`)
- [ ] G3 database: fixtures, privileges, triggers ENABLE ALWAYS
- [ ] G4 clinical authority (reviewer sign-off)
- [ ] G5 owner approval (Mohammed merges)

Pending (could not run, and why):

## Deploy notes — each needs owner GO
- Migrations to push:
- Edge functions to deploy:
- Secrets (names only):
- `npm run cap:sync` / native rebuild needed:

Note: the red `Vercel` check is expected and not a blocker.

## Brain update
- Done:
- Decisions:
- New [Pending]:
