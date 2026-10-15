# RC distribution tooling

This tooling targets **1.0.7 onward**. It refuses the frozen 1.0.6 SHA and marketing
versions below 1.0.7, including dry runs. It never changes a version, creates store
credentials, promotes a release, or activates a feature. The scripts are not app
runtime dependencies. Two-store distribution is **non-transactional**.

## Workflow structure and trust

`release-rc.yml` has exactly two jobs: an Ubuntu preflight without credentials or an
environment, then one macOS `rc-distribution` job containing all credential use.
Both workflows accept `workflow_dispatch` only, and refuse dispatch from a ref
other than `main`. Source and automation are separate checkouts: scripts are from
the immutable dispatch commit; application source is checked against the full
input SHA and ancestry of freshly fetched `origin/main`. Approval must cover both
commits. Checkouts do not persist GitHub credentials.

Protect `rc-distribution` with the owner as required reviewer, prevent self-review,
and restrict deployment branches to `main`. Keep all listed secrets in that
environment, never repository/organization secrets accessible to normal PR jobs.
The release/status concurrency group is shared and never cancels an active run.
Do not operate Play console edits or another release system concurrently: even a
read snapshot needs a temporary Play edit, which can invalidate another edit.

WIF and ASC authentication necessarily happen **before remote duplicate reads**.
They are inside the single approved job; no build runs until the remote checks
pass. The input order in the design is not a promise that authenticated reads can
occur before authentication. A second WIF token is minted just before uploading,
so long native builds do not use an expired preflight token.

Third-party credential action: `google-github-actions/auth` at the full commit
`ba79af03959ebeac9769e648f473a284504d9193`. Google credentials files are disabled;
short-lived access tokens are passed to individual steps through environment
variables. Only those two protected jobs receive `id-token: write`.

## Owner setup (not performed by these scripts)

Google primary path: GitHub OIDC + Workload Identity Federation. Use this provider
attribute mapping:

```text
google.subject=assertion.sub
attribute.repository=assertion.repository
attribute.repository_id=assertion.repository_id
```

The provider's exact attribute condition for this repository/environment is:

```text
assertion.repository == 'adoghaim/Amani' && assertion.sub == 'repo:adoghaim/Amani:environment:rc-distribution' && assertion.ref == 'refs/heads/main'
```

Also restrict `assertion.repository_id` to the owner's verified numeric repository
ID when provisioning, to prevent trust passing to a recreated repository. That ID
must be obtained from the authoritative repository, not guessed. Bind
`roles/iam.workloadIdentityUser` on the intended service account only to the pool's
`attribute.repository/adoghaim/Amani` principal set. Do not grant that role to the
entire pool. Use GitHub's issuer `https://token.actions.githubusercontent.com` and
the provider's canonical audience. Supply the provider resource and service-account
email as `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT_EMAIL` dispatch
inputs. Review those non-secret values before approval. WIF yields an Android
Publisher scoped access token, not a service-account key.

In Play Console, grant this service account app-level access only to
`com.amani.health`, with testing-track release/read permissions. **Do not grant
production release or store-presence permissions.** The code's write allowlist
accepts only the `alpha` track. No public-store submission route is implemented.

Apple: owner creates an ASC team API key with the capability to upload and manage
the intended internal TestFlight group (default `internal test`), and confirms
cloud-managed signing access for team `954V925LL8`. The script cannot establish
those account capabilities offline. No local distribution certificate or password
is imported. If Xcode cannot archive/export with the API key on a clean GitHub
runner, the workflow fails before either store upload; resolve signing with the
owner rather than disabling verification. The temporary keychain is removed even
on step failure.

Environment secret names (values never belong in this repository):

- `APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER_ID`, `APPLE_ASC_PRIVATE_KEY_B64`, `APPLE_TEAM_ID`
- `ANDROID_UPLOAD_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL`, `VITE_STRIPE_PUBLISHABLE_KEY`
- `VITE_REVENUECAT_IOS_KEY`, `VITE_REVENUECAT_ANDROID_KEY`, `VITE_ENABLE_APPLE_OAUTH`

The `VITE_*` values are native client build inputs, including public client access
values; they are **not** backend administration credentials. They go into the
native package by design. The native freemium flag is forced to `true` only during
the flagged builds. No backend/hosting control credential is requested or used.

## Build proofs and hash handoff

`preflight.sh` requires a full commit SHA present in the fetched repository and
ancestor of main, then checks out that exact commit. It asserts tracked cleanliness
and checks package version, both iOS configurations' marketing/build/team/bundle
values, and Android versionName/versionCode/applicationId. The native build checks
repeat version and cleanliness assertions after sync and native builds.

The flagged dist must equal a fresh flag-on control build and differ from an
unset-flag control build. Compiled JavaScript must contain no raw
`VITE_FREEMIUM_ACTIVE` reference. Synced web trees, archive and IPA must correspond
byte for byte to that same dist. The only sync additions allowed are
`cordova.js` and `cordova_plugins.js`; their bytes must then survive packaging.
Android packages exclude only `*.map` and `.well-known/*` from that dist. Any
unexpected missing, added or changed asset fails the build.

IPA verification requires a valid Apple Distribution signature for team
`954V925LL8`, exact package versions, matching application/team entitlements,
associated domains from the frozen source, and no debug entitlement. APK and AAB
must verify against upload-key SHA-256:

```text
AE:45:54:E8:D7:74:C0:B6:E8:C8:BC:31:1F:C6:9C:3E:6D:D2:C9:F5:71:8A:1E:8D:51:05:DA:AE:B7:37:57:30
```

This is the **upload** key, distinct from Play's managed app-signing key. Read-back
APK badging and the AAB protobuf manifest must match all dispatched values. The
protobuf reader accepts only the manifest fields it needs and fails on ambiguity.
It uses the AAPT2 Resources.proto wire representation, not string search in a ZIP.

`handoff.json` seals SHA-256 hashes for IPA, APK, AAB and `proof.json`, bound to the
frozen identity. Its own hash is passed separately through the runner environment;
rewriting the manifest along with a modified artifact therefore fails verification.
Every upload and later release stage verifies this handoff again. Historical 1.0.6
hashes are informational only and are never a reproducibility gate.

Apple upload uses `xcrun altool --upload-app` on the **sealed IPA**. This deliberately
avoids `xcodebuild destination=upload` re-exporting and potentially re-signing the
archive into bytes different from those verified. Xcode still performs the
archive and `destination=export`. `manageAppVersionAndBuildNumber=false` prevents
export from changing the identity. Apple API visibility of the exact marketing
version and build in VALID or PROCESSING state confirms acceptance before Play
starts. A five-minute acceptance timeout stops; it never assumes the number free.

Play sequence is fixed: `edits.insert`, `bundles.upload`, `tracks.update(alpha)`
with status `completed`, `edits.validate`, `edits.commit`. The AAB is never rebuilt
or re-signed between verification and upload. No automated retries are made.

## Failure and recovery

| Point | Recorded behavior |
| --- | --- |
| Before uploads | Fail; neither store gets a binary. Read-only checks use temporary Play edits. |
| Apple attempted but acceptance unknown | Stop; Apple identity is potentially consumed. No Play upload. |
| Play fails before bundle request | `PLAY_FAILED_BEFORE_BUNDLE_UPLOAD`; Apple number already consumed. Owner decides next identity. |
| Bundle request times out or loses its response | `ANDROID_IDENTITY_UNKNOWN_OR_POTENTIALLY_CONSUMED`; conservative treatment of an ambiguous request. |
| Any failure after bundle upload succeeds | Same unknown/potentially consumed state; read existing edit and current Play state where possible, record unavailable evidence explicitly, stop for owner disposition. |
| Poll expires while legitimately processing | Successful run with `PROCESSING`; later dispatch status workflow. |
| Invalid/rejected build or wrong identity/track | Fail with `PROCESSING_FAILED` or `MISMATCH`. |

**Abandoning or deleting a Play edit does not establish that a versionCode is
reusable. Never reuse or automatically increment a potentially consumed identity.**
Current API snapshots cannot prove an unknown historical upload never consumed a
number. Before dispatch, the owner must check previous run evidence and unresolved
attempts. Duplicate checks are a conservative additional gate, not permission to
retry a burned/unknown number. Apple checks the number across marketing trains.

Intent is persisted before each upload. Post-upload exceptions record partial-state
evidence; a later failed/cancelled step also converts an attempted Play identity to
the unknown state in the always-run summary. Abrupt runner loss can prevent cleanup
and evidence publication despite `always()`; treat any such run as ambiguous and
inspect store state before owner disposition. Do not rerun the release job to
recover. The status workflow never uploads or assigns a group.

## Readiness and artifacts

The release poll is bounded at 25 minutes. It assigns a VALID Apple build to the
existing intended **internal** group, then independently reads group membership.
`READY_FOR_PHASE_A_DEVICE_QA` requires both:

1. The exact iOS marketing version/build exists, has `processingState=VALID`, and
   belongs to that internal group.
2. The exact Android versionCode is on Closed testing – Alpha with status `completed`.

**This does not prove installability. Actual installs are Phase A A1/A2.** A
missing/wrong Alpha identity or unexpected store state is a mismatch, not a reason
to print the ready token. A valid Apple build without group membership is not ready;
if it became VALID after the release poll expired, owner assignment in ASC is
needed before the read-only status workflow can report readiness.

`release-status.yml` takes the same identity, performs the same static preflight,
and writes/updates `release-status.json` in its own run evidence artifact. It is
manual only, never scheduled. Download the latest matching identity's evidence;
no status file is committed or written back into another run's artifact.

Only explicitly named signed binaries and structured JSON/Markdown evidence are
uploaded as Actions artifacts. Signing files, keychains, raw build/store logs and
unpacked archives stay under a private `RUNNER_TEMP` directory with mode 0700 and
umask 077. An `always()` cleanup restores the keychain list, deletes the temporary
keychain and removes private files. Errors avoid credential-bearing HTTP bodies.
Artifacts have limited retention; the owner should retain approved sanitized
release evidence separately.

## Offline tests and CI

```sh
bash tools/release/check.sh
npm test
npm run lint
npm run typecheck
npm run build
```

`check.sh` parses workflow YAML with the repository's installed `js-yaml`, checks
every shell script with `bash -n`, and runs standard-library Python unit tests.
Fixtures/fakes cover JWT encoding, version parsing, store responses, duplicate
checks, partial upload states, readiness, package correspondence, manifest parsing,
hash tampering, and workflow/endpoint guards. No network or credentials are needed.
The existing normal PR CI invokes these checks without adding release secrets.
macOS Xcode, Android SDK build tools, Node 22, JDK 21, system OpenSSL and Python 3
are required for an actual release. Python has no third-party dependencies.

## Manual fallback

Keep the existing owner-driven console distribution path until the first 1.0.7+
run proves cloud signing and store behavior. Preserve the same source, identity,
signing, content and hash evidence; do not relax a failed proof to get an upload.

If WIF cannot be used, service-account JSON is an **owner-operated manual fallback**,
not a workflow input or an automatic credential fallback. Restrict it to the same
app/testing permissions, store the durable copy in the owner's password manager,
record rotation/deletion dates, and materialize it only in a private temporary
directory. A separately approved local Google-authenticated upload may use a
short-lived token from that identity. `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is the
reserved secret name if the owner later authorizes a protected manual credential
path; these workflows neither read nor create it. Never paste JSON or bearer tokens
into dispatch inputs or logs. Prefer fixing WIF before another automated release.
