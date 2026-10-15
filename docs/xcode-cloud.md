# Xcode Cloud bootstrap

`ios/App/ci_scripts/ci_post_clone.sh` sits next to `App.xcodeproj` in the
`ci_scripts` directory so Xcode Cloud runs it after cloning, before resolving
Swift packages. The SPM manifest references plugins in `node_modules`, which
are absent from a fresh clone.

The script prints the repository, project, and workflow context, checks required
build variables, installs Node 24 with Homebrew (the version the GitHub native
build uses), and prints Node/npm versions. If that formula cannot be installed,
it installs Homebrew's default Node; Node must still be **22 or newer** for
Capacitor. It installs locked dependencies with Husky disabled, builds with
`BUILD_TARGET=native` (naming the Sentry release after `CI_COMMIT`), runs
`npx cap sync ios`, and lists the generated web entry point and Capacitor App
package manifest. Any failed step stops the build.

## Workflow environment variables

Configure these in the Xcode Cloud workflow's environment-variable settings.
Vite embeds these variables at build time; changes require a new build.

Required (the script rejects missing or empty values):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Any archive that can reach TestFlight or the App Store ships with these baked
in, so they must point at the production project (`eyfvqdnczorscwveaadv`), the
only correct Supabase project. Mark the anon key as **Secret** in Xcode Cloud.

Required for store-bound archives (the script does not check it):

- `VITE_REVENUECAT_IOS_KEY` — RevenueCat iOS SDK key. Without it the app reports
  in-app purchases as unavailable. Mark it as **Secret**.

Optional or behavioral; follow `.env.example` and the intended release settings:

- `VITE_ENABLE_APPLE_OAUTH` — Apple OAuth UI setting; native visibility remains governed by the app's native gate.
- `VITE_APP_URL` — public origin for links leaving the app.
- `VITE_FREEMIUM_ACTIVE` — tiering behavior; must match server configuration.
- `VITE_SENTRY_DSN` — error monitoring; `.env.example` currently reserves it for production Netlify builds.
- `VITE_STRIPE_PUBLISHABLE_KEY` — optional Stripe configuration.

## Verify in App Store Connect

Open **App Store Connect → Xcode Cloud → Amani Biometrics → Default → Archive - iOS**.
Configure the workflow variables and select the branch containing this script
for a build. In the post-clone logs, confirm Node is at least 22, npm installation,
the native web build, and iOS sync succeed, and both final file paths are listed.
Then confirm package resolution and the archive succeed.

Before setting the variables, check the workflow's start conditions and post-
actions. If it starts on every push to `main` and has a TestFlight post-action,
every merge uploads a build.

Build numbers: Xcode Cloud archive actions stamp the build number from its own
counter (`CI_BUILD_NUMBER`), not `CURRENT_PROJECT_VERSION` (currently 11 for
1.0.6). Before this workflow distributes to TestFlight, set the next build
number in App Store Connect above the last manual upload, and confirm the
stamped number in the first archive's log. **OWNER DECISION:** use Xcode Cloud
numbering for releases, or keep distribution manual. This bootstrap does not
change project versions.

Offline checks cover shell syntax and executable permissions (plus ShellCheck
when installed). A script-body dry-run is not possible without network access;
the Homebrew/npm bootstrap and archive need verification in Xcode Cloud.
