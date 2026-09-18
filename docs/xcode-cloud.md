# Xcode Cloud bootstrap

`ios/App/ci_scripts/ci_post_clone.sh` sits next to `App.xcodeproj` in the
`ci_scripts` directory so Xcode Cloud runs it after cloning, before resolving
Swift packages. The SPM manifest references plugins in `node_modules`, which
are absent from a fresh clone.

The script prints the repository, project, and workflow context, checks required
build variables, installs Node 22 with Homebrew, and prints Node/npm versions.
If the versioned formula is unavailable, it installs Homebrew's default Node;
Node must still be **22 or newer** for Capacitor. It installs locked dependencies
with Husky disabled, builds with `BUILD_TARGET=native`, runs `npx cap sync ios`,
and lists the generated web entry point and Capacitor App package manifest.
Any failed step stops the build.

## Workflow environment variables

Configure these in the Xcode Cloud workflow's environment-variable settings.
Vite embeds these variables at build time; changes require a new build.

Required (the script rejects missing or empty values):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional or behavioral; follow `.env.example` and the intended release settings:

- `VITE_REVENUECAT_IOS_KEY` — RevenueCat iOS SDK configuration.
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

Xcode Cloud manages build numbers only when the workflow is configured to do so.
Per the Lead's TASK-019 brief, this workflow keeps `CURRENT_PROJECT_VERSION` from
the project. **OWNER DECISION:** keep “manage build number” OFF, or explicitly
accept Xcode Cloud numbering. This bootstrap does not change project versions.

Per the Lead-verified TASK-019 release facts, the frozen 1.0.5 RC is based on
`02e9251019d710ef73d778ea38b34bc273f68b76`. This separate-branch CI addition does
not change that release.

Offline checks cover shell syntax and executable permissions (plus ShellCheck
when installed). A script-body dry-run is not possible without network access;
the Homebrew/npm bootstrap and archive need verification in Xcode Cloud.
