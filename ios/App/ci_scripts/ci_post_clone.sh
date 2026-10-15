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
# Node 24 (LTS) matches the GitHub native build. Homebrew deprecates and later
# disables versioned formulae, so fall back when the install itself fails.
if brew install node@24; then
  export PATH="$(brew --prefix node@24)/bin:$PATH"
else
  echo 'node@24 could not be installed; installing the default Homebrew Node formula.'
  brew install node
  export PATH="$(brew --prefix node)/bin:$PATH"
fi

node -v
npm -v
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Error: Capacitor requires Node.js 22 or newer."); process.exit(1); }'

cd "$CI_PRIMARY_REPOSITORY_PATH"
HUSKY=0 npm ci --no-audit --no-fund
# Name the Sentry release after the commit, as Netlify (COMMIT_REF) and GitHub
# (GITHUB_SHA) builds do; vite.config.ts reads COMMIT_REF.
if [ -n "${CI_COMMIT:-}" ]; then export COMMIT_REF="$CI_COMMIT"; fi
BUILD_TARGET=native npm run build
npx cap sync ios
ls -l ios/App/App/public/index.html node_modules/@capacitor/app/Package.swift
