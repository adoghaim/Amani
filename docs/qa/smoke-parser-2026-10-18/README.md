# Smoke parser fixes — 2026-10-18

## Root cause and scope

On base `96f636d`, the smoke fixture's Vitamin D row returns `25`, not `24`.
The numeric candidate filter skipped digits immediately preceded by a letter,
but admitted `25` in `25-OH`. With a printed min/max interval, candidate ranking
favours the number closest to its midpoint: 25 beats 24 for 30–100. PDF extraction
was not responsible. The supplied PDF visibly prints 24; the committed browser
fixture is byte-for-byte identical (`cmp`).

The fix carries the matched name's end offset into numeric extraction and range
binding, and rejects digits attached to letters, hyphenated names and ordinals.
The fallback text parser uses the same word-digit filter. Tests cover Quest and
Labcorp names, wrapped rows, comparator results, A1c, T4, B12, and spaced aliases.
Omega-3 and other uncatalogued names are covered at the window-reader level;
this change does not add them to the analyte catalog.

Confirmation and its preview now resolve names through the same catalog lookup
used to persist report display names. Unknown labels remain available. The
duplicate parenthesized slug is removed. Parse-error notices use display names.

Snapshot changes: `tsh` becomes `TSH` in a notice; a bogus ALT result from the
synthetic Hone member ID `HM-00481` disappears because its digits are no longer
numeric candidates. The range-binding and redaction tests assert that correction.
No clinical ranges, thresholds, policy, or backend implementation changed.

## Verification

| Check | Result |
| --- | --- |
| New Vitamin D regression on a disposable archive of `96f636d` | Expected failure: expected 24, received 25 |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 errors; 9 existing warnings |
| `npm test` | 158 files, 3,091 tests pass |
| `npm run build` | Pass |
| `npm run validate:contrast` | 55 checks pass |
| `npm run check:functions` | Pass: 51 checked, 8 existing baseline exclusions |
| Extraction Playwright spec | 3 pass: Chromium, WebKit, Firefox |

Browser command: `npm run test:e2e -- e2e/extraction/confirm-markers.spec.ts`.
For this local run, another worktree occupied port 4173. A temporary config,
server copy, and network-guard origin used 4183 consistently; all temporary
changes were removed after the run. The committed configuration remains 4173.
The strict network guard stayed enabled; only synthetic account/catalog reads
were mocked. PDF.js and the parser ran for real. No production backend was used.

The test verifies all 12 values, preview names and confirmation names, then stops
before saving. [Confirmation screenshot](confirm-markers.png) is diagnostic
evidence from that run; the committed assertions are the release evidence.

Manual review: inspected the supplied smoke screenshot and rendered PDF, then
the attached local screenshot. To repeat, upload the committed synthetic PDF
with the isolated fixture session, expand detected markers, and advance to
confirmation: Vitamin D must show 24 ng/mL, with readable names for all rows.

Independent review, CI/Netlify preview, and native/device QA remain pending.
No database changes require a migration harness. No functions, migrations or
secrets require deployment. Owner reviews/merges the PR and checks the Netlify
preview. A later native release needs its normal sync/build/device gates.

## Second Brain handoff (prepared only; vault not modified)

- **[Confirmed 2026-10-18]** Reproduced both smoke defects in repository evidence
  and verified the fixes with the commands above. Branch base is `96f636d`.
- Implementation decision: reuse report catalog names; keep parsing and name
  validation deterministic, with synthetic fixtures and no production access.
- **[Pending]** Owner review/merge, CI/preview and release validation. Existing
  stored incorrect results are not rewritten by this fix.
- The vault's Current State was last verified 2026-09-22 and names `02e9251` as
  main. That is historical: this task's checked repository base is `96f636d`.
  No other vault pending claims were resolved.
