#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${SOURCE_DIR:?}" "${RELEASE_PRIVATE:?}" "${RELEASE_OUT:?}" "${ASC_KEY_PATH:?}"
[[ "$APPLE_TEAM_ID" == 954V925LL8 ]] || exit 1
cd "$SOURCE_DIR"
# No local signing certificate is imported. Xcode must obtain authorized cloud signing.
python3 "$TOOLS_DIR/setup.py" keychain
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$APPLE_ASC_KEY_ID" -authenticationKeyIssuerID "$APPLE_ASC_ISSUER_ID")
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$RELEASE_PRIVATE/App.xcarchive" \
  archive "${AUTH[@]}" >"$RELEASE_PRIVATE/archive.log" 2>&1
xcodebuild -exportArchive -archivePath "$RELEASE_PRIVATE/App.xcarchive" \
  -exportOptionsPlist "$RELEASE_PRIVATE/ExportOptions.plist" \
  -exportPath "$RELEASE_PRIVATE/export" "${AUTH[@]}" >"$RELEASE_PRIVATE/export.log" 2>&1
python3 "$TOOLS_DIR/verify_build.py" ios
