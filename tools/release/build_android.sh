#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${SOURCE_DIR:?}" "${RELEASE_PRIVATE:?}" "${RELEASE_OUT:?}"
python3 "$TOOLS_DIR/setup.py" android
cd "$SOURCE_DIR/android"
# The init script reads secrets from env; no keystore.properties enters the checkout.
./gradlew --no-daemon --init-script "$RELEASE_PRIVATE/signing.gradle" \
  bundleRelease assembleRelease >"$RELEASE_PRIVATE/gradle.log" 2>&1
cp app/build/outputs/bundle/release/app-release.aab "$RELEASE_OUT/app.aab"
cp app/build/outputs/apk/release/app-release.apk "$RELEASE_OUT/app.apk"
python3 "$TOOLS_DIR/verify_build.py" android
