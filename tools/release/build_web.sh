#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${RELEASE_PRIVATE:?}" "${RELEASE_OUT:?}" "${SOURCE_DIR:?}" "${FROZEN_SHA:?}"
cd "$SOURCE_DIR"
export COMMIT_REF="$FROZEN_SHA" BUILD_TARGET=native
# Build logs stay private: native client values must not reach the summary.
npm ci --no-audit --no-fund >"$RELEASE_PRIVATE/npm.log" 2>&1
VITE_FREEMIUM_ACTIVE=true ./node_modules/.bin/vite build >"$RELEASE_PRIVATE/vite.log" 2>&1
cp -R dist "$RELEASE_PRIVATE/dist-original"
VITE_FREEMIUM_ACTIVE=true ./node_modules/.bin/vite build >"$RELEASE_PRIVATE/control-on.log" 2>&1
cp -R dist "$RELEASE_PRIVATE/dist-on"
env -u VITE_FREEMIUM_ACTIVE ./node_modules/.bin/vite build >"$RELEASE_PRIVATE/control-off.log" 2>&1
cp -R dist "$RELEASE_PRIVATE/dist-off"
rm -rf dist
cp -R "$RELEASE_PRIVATE/dist-original" dist
./node_modules/.bin/cap sync ios >"$RELEASE_PRIVATE/sync-ios.log" 2>&1
./node_modules/.bin/cap sync android >"$RELEASE_PRIVATE/sync-android.log" 2>&1
python3 "$TOOLS_DIR/verify_build.py" web
