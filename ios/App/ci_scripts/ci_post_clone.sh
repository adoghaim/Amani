#!/bin/bash
set -euo pipefail

printf 'CI_PRIMARY_REPOSITORY_PATH=%s\n' "${CI_PRIMARY_REPOSITORY_PATH:?Xcode Cloud repository path is required}"
printf 'CI_XCODE_PROJECT=%s\n' "${CI_XCODE_PROJECT:-}"
printf 'CI_WORKFLOW=%s\n' "${CI_WORKFLOW:-}"

# Check without shell tracing so environment-variable values stay out of logs.
if [ -z "${VITE_SUPABASE_URL:-}" ]; then
  echo 'Error: Set VITE_SUPABASE_URL in the Xcode Cloud workflow environment-variable settings.' >&2
  exit 1
fi
if [ -z "${VITE_SUPABASE_ANON_KEY:-}" ]; then
  echo 'Error: Set VITE_SUPABASE_ANON_KEY in the Xcode Cloud workflow environment-variable settings.' >&2
  exit 1
fi

set -x
# .nvmrc pins the Node major for every pipeline. Install exactly that major
# from Homebrew: never a fallback to Homebrew's newest Node, and a different
# major first on PATH stops the build.
NVMRC="$CI_PRIMARY_REPOSITORY_PATH/.nvmrc"
if [ ! -f "$NVMRC" ]; then
  echo 'Error: .nvmrc is missing; it pins the Node major for this build.' >&2
  exit 1
fi
NODE_PIN=$(tr -d '[:space:]' < "$NVMRC")
NODE_MAJOR=${NODE_PIN#v}
NODE_MAJOR=${NODE_MAJOR%%.*}
case "$NODE_MAJOR" in
  '' | *[!0-9]*)
    echo "Error: .nvmrc must start with a Node major version such as 22, not '$NODE_PIN'." >&2
    exit 1
    ;;
esac
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Error: Capacitor requires Node.js 22 or newer; .nvmrc pins $NODE_PIN." >&2
  exit 1
fi
if ! brew install "node@$NODE_MAJOR"; then
  echo "Error: Homebrew could not install node@$NODE_MAJOR, the major .nvmrc pins." >&2
  exit 1
fi
NODE_PREFIX=$(brew --prefix "node@$NODE_MAJOR")
export PATH="$NODE_PREFIX/bin:$PATH"

NODE_VERSION=$(node -v)
npm -v
if [ "${NODE_VERSION%%.*}" != "v$NODE_MAJOR" ]; then
  echo "Error: Node $NODE_VERSION is first on PATH, but .nvmrc pins Node $NODE_MAJOR." >&2
  exit 1
fi

cd "$CI_PRIMARY_REPOSITORY_PATH"
# The device-lock JS gate reads package.json's version and the native privacy
# cover reads MARKETING_VERSION, so an archive where they differ turns one on
# without the other. Every MARKETING_VERSION must equal package.json's.
node --input-type=commonjs - <<'JS'
const fs = require('fs');
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const pbxproj = fs.readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
const marketing = [...pbxproj.matchAll(/\bMARKETING_VERSION = "?([^";\s]*)"?;/g)].map(match => match[1]);
if (marketing.length === 0 || marketing.some(value => value !== version)) {
  console.error(`Error: package.json version ${version} must equal every iOS MARKETING_VERSION (found: ${marketing.join(', ') || 'none'}).`);
  process.exit(1);
}
console.log(`package.json version ${version} matches ${marketing.length} iOS MARKETING_VERSION entries.`);
JS
HUSKY=0 npm ci --no-audit --no-fund
# Name the Sentry release after the commit, as Netlify (COMMIT_REF) and GitHub
# (GITHUB_SHA) builds do; vite.config.ts reads COMMIT_REF.
if [ -n "${CI_COMMIT:-}" ]; then export COMMIT_REF="$CI_COMMIT"; fi
BUILD_TARGET=native npm run build
npx cap sync ios
ls -l ios/App/App/public/index.html node_modules/@capacitor/app/Package.swift
