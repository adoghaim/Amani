# Native minimum-version gate (PK-MINVER-01)

Owner decisions: EXP-8 (revision 3), R1 (runtime config), D8 (hard block plus soft banner),
D23 (accessibility), D24 (FullScreenGate). Stacked on PK-CFG-01, which serves the four keys.

## What it does

At native launch, `UpdateGate` (`src/components/UpdateGate.tsx`, mounted in `src/App.tsx` around
every route) compares the installed version from `App.getInfo()` with `app_public_config`:

| Installed version | What she sees |
|---|---|
| below `min_version_<platform>` | the update block in place of the whole app: "Please update Amani", one sentence, one store button |
| the same, with no connection | "Connect to the internet to update" with Retry; a failed Retry adds a calm notice |
| at or above the minimum, below `latest_version_<platform>` | a dismissible banner above the app ("Update", "Not now"); "Not now" hides it for that version on this phone |
| anything else | nothing |

- **Web is never gated.** On web the gate renders the app and calls nothing.
- **Fails open.** Until the launch read and `App.getInfo()` have both answered, and whenever either
  fails, returns nothing or returns a malformed version, the app renders normally. A failed read
  is not replaced by last launch's cached copy (PK-CFG-01).
- **Versions** are compared part by part as numbers (`1.0.10` is newer than `1.0.9`; `2` equals
  `2.0.0`). A build number breaks a tie only when both sides carry one; the runtime config holds
  versions only, so today a build number never decides (`src/lib/appVersion.ts`).
- **Gate order at launch:** the update block, then the biometric lock if she turned it on, then
  consent, then the rest of onboarding. A later lock gate mounts inside `UpdateGate`.
- **Back (D23):** on Android the back button closes the app while the block is up. iOS has no
  back gesture out of a full-screen gate.
- **Store links** (`src/lib/storeListing.ts`): Android opens
  `https://play.google.com/store/apps/details?id=com.amani.health`. iOS opens
  `https://apps.apple.com/app/id<APP_STORE_ID>` once `APP_STORE_ID` is set; it is not recorded in
  the repository ([Pending]), so until then the button opens the App Store app
  (`itms-apps://apps.apple.com/`).
- **The block is cleared only by an update.** The config is read once per launch; lowering the
  minimum takes effect at her next launch.

## Store builds (D7.4)

Store builds are cut from an approved, pinned SHA, never "from main" (factory/gates.md). The
first public-launch store build must contain this gate (EXP-8), or future breaking backend
changes cannot be gated.

## On-device test plan (pending: no device run by the factory)

Run on a real iPhone and a real Android phone, each with a build containing this packet, against
a **non-production** Supabase project. Never set a minimum on production to test.

1. **No gate (seed).** All four keys `null`. Launch: the app opens normally, no banner.
2. **Block.** Set `min_version_<platform>` above the installed version (Settings > About, or
   `App.getInfo()`). Force-quit and relaunch: "Please update Amani" covers the app; VoiceOver /
   TalkBack lands on the heading; nothing behind it is reachable by swipe or by a deep link.
3. **Store button.** Tap it: iOS opens the App Store app (Amani's listing once `APP_STORE_ID`
   is set); Android opens Amani's Play listing in the Play Store app, not a web page.
4. **Offline.** With the block up, turn on airplane mode: the screen becomes "Connect to the
   internet to update". Tap Retry: "Still no connection." is announced. Turn airplane mode off:
   the block returns (with or without Retry).
5. **Android back.** With the block up, press back: the app closes.
6. **Fail open.** Set a minimum above the installed version, enable airplane mode, force-quit
   and relaunch: the app opens (the read failed, so there is no gate).
7. **Banner.** Minimum `null` (or at the installed version), `latest_version_<platform>` above
   it. Relaunch: the banner shows above the app and is announced. "Update" opens the store;
   "Not now" hides it, and it stays hidden on relaunch. Raise `latest_version_<platform>` again:
   the banner returns.
8. **Accessibility.** At 200% text size and on a 375pt-wide screen the block and the banner
   reflow without clipping, inside the safe areas; every control is at least 44x44.
9. **Reset.** Set all four keys back to `null`.

Record the device, OS version, app version and build, and the result of each step in the PR.
