# Release candidate distribution (1.0.7 onward)

Amani 1.0.6 remains frozen at `2fd9433bbcbed73a1e137505d2542ee58a16d9e0` and uses its
existing manual path. These workflows refuse to rebuild it. They only distribute
to internal TestFlight and Play Closed testing – Alpha. No public promotion or
activation is part of this procedure.

Before the first run, complete the protected environment, Apple and Google WIF
setup in [the tooling guide](../tools/release/README.md). Independent release and
security review remains required before enabling credentials. Native cloud signing
and real store behavior must be demonstrated by an owner-authorized 1.0.7+ run;
offline tests do not establish those capabilities.

1. Freeze a commit already on main with the intended versions committed in
   `package.json`, **both** iOS configurations, and Android Gradle. The automation
   does not edit these values. Check prior release evidence: no attempted,
   potentially consumed, or already used identity may be automatically reused.
2. From Actions on `main`, dispatch **RC distribution (1.0.7 onward)** with the full
   SHA, marketing version, iOS build number, Android versionCode, `alpha`, native
   flag `true`, the existing internal TestFlight group, and the approved WIF provider
   and service-account email. Start with **dry_run=true**. Do not run concurrent
   manual Play edits; release and status workflows serialize with each other.
3. The uncredentialed preflight verifies ancestry, clean tracked source, all
   versions and both app identifiers. Inspect the requested source and automation
   commits plus dispatch parameters before approving `rc-distribution` once.
   Approval allows all later credentials, including duplicate reads and builds.
4. For the dry run, inspect proof and handoff evidence plus the signed binaries.
   A dry run authenticates, reads store state and builds; it does not upload a
   binary, assign a tester group, or change a track. Temporary Play edits are used
   for reads. Never compare signed artifact hashes to historical 1.0.6 hashes as
   a pass/fail gate. Evidence is tied to this run's own artifact hashes.
5. After the owner approves proceeding, dispatch the live run with **dry_run=false**
   and the same unused committed identity. This creates and verifies new artifacts
   in that live run; it does not upload artifacts from the earlier dry run.
6. Both platform builds and proofs must pass before any upload. Apple uploads the
   sealed IPA and must report acceptance before Play receives the sealed AAB.
   Play updates Alpha, validates, then commits. This sequence is non-transactional:
   a later failure does not undo Apple's accepted build.
7. Read the sanitized summary and evidence artifact. Both readiness assertions may
   take time. The workflow polls for up to 25 minutes. `PROCESSING` at expiry is a
   successful pending outcome, **not** device-QA readiness. Later dispatch **RC store
   readiness** with the exact same identity. That workflow is never scheduled and
   writes a fresh `release-status.json` for its run.
8. `READY_FOR_PHASE_A_DEVICE_QA` means the exact Apple build is VALID and assigned
   to the intended internal group, and the exact Google versionCode is on Alpha
   with release status `completed`. **It does not prove installability.** Proceed
   to real installations on the intended iPhone and Android phone in Phase A A1/A2.
   Do not skip tester membership, propagation, or device checks.

If Apple becomes VALID only after polling ends and is not automatically assigned
to the intended group, the owner must assign it in App Store Connect. The status
workflow only reads; redispatching it does not perform assignment.

On an Apple upload ambiguity, stop and inspect ASC before any retry. On Play
failure before a bundle request, Apple's build number is already consumed. On
`ANDROID_IDENTITY_UNKNOWN_OR_POTENTIALLY_CONSUMED`, stop for owner disposition,
retain the recorded edit/current-state evidence, and never reuse or automatically
increment the versionCode. An abandoned edit does not prove reusability. A timeout,
cancelled run or missing evidence is not proof that no upload happened. Only status
polling is a routine recovery action; do not rerun a release job as a retry.

Raw credential/build logs are deliberately excluded from published artifacts and
removed during cleanup. Diagnose failures without weakening signing, correspondence,
manifest, identity or hash checks. Use the owner-operated manual fallback in the
tooling guide if needed. Creation of credentials, store promotion, release identity
changes and any product activation require their own owner authorization.
