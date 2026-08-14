#!/usr/bin/env bash
# Builds an App Store-ready IPA for DBReader.
#
# Run by the person who owns the PAID Apple Developer account:
#
#   TEAM_ID=XXXXXXXXXX ./scripts/ios-appstore.sh
#
# Env vars:
#   TEAM_ID    required - your 10-character Team ID
#              (developer.apple.com > Membership)
#   BUNDLE_ID  optional - defaults to com.vincentleong.dbreader
#              (register it first in your account, or set your own)
#   CONFIG     optional - alternate tauri config for a variant
#              (e.g. src-tauri/tauri.tablet.ios.conf.json for the iPad build)
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM_ID="${TEAM_ID:-}"
BUNDLE_ID="${BUNDLE_ID:-com.vincentleong.dbreader}"
CONFIG="${CONFIG:-}"

if [ -z "$TEAM_ID" ]; then
  echo "Usage: TEAM_ID=XXXXXXXXXX ./scripts/ios-appstore.sh"
  echo "Find your Team ID at https://developer.apple.com/membercenter/ > Membership"
  exit 1
fi

IOS_PROJ="src-tauri/gen/apple/dbreader.xcodeproj/project.pbxproj"
EXPORT_OPTS="src-tauri/gen/apple/ExportOptions.plist"

echo "==> checking prerequisites"
command -v pnpm >/dev/null || { echo "pnpm is required (npm i -g pnpm)"; exit 1; }
if [ ! -d src-tauri/gen/apple ]; then
  echo "==> generating iOS project"
  pnpm tauri ios init
fi

echo "==> patching team + bundle id into the Xcode project"
cp "$IOS_PROJ" "$IOS_PROJ.bak"
trap 'mv "$IOS_PROJ.bak" "$IOS_PROJ"' EXIT
sed -i '' "s/DEVELOPMENT_TEAM = [^;]*;/DEVELOPMENT_TEAM = $TEAM_ID;/" "$IOS_PROJ"
sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID;/" "$IOS_PROJ"

echo "==> writing App Store export options (team $TEAM_ID)"
cat > "$EXPORT_OPTS" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>teamID</key>
    <string>$TEAM_ID</string>
</dict>
</plist>
EOF

TAURI_ARGS=()
if [ -n "$CONFIG" ]; then
  TAURI_ARGS+=(--config "$CONFIG")
fi

echo "==> building release IPA (this takes a few minutes)"
pnpm tauri ios build "${TAURI_ARGS[@]}"

IPA="$(ls -t src-tauri/gen/apple/build/arm64/*.ipa 2>/dev/null | head -1)"
[ -n "$IPA" ] || { echo "no .ipa produced - build failed"; exit 1; }

echo ""
echo "App Store IPA ready: $IPA"
echo ""
echo "Next steps (in your Apple Developer account):"
echo "  1. Register bundle id '$BUNDLE_ID' under"
echo "     developer.apple.com > Certificates, Identifiers & Profiles > Identifiers"
echo "  2. Create the app at appstoreconnect.apple.com > My Apps > +  using '$BUNDLE_ID'"
echo "  3. Upload the IPA with Transporter.app, or:"
echo "     xcrun altool --upload-app -f \"$IPA\" -t ios -u YOUR_APPLE_ID -p APP_SPECIFIC_PASSWORD"
echo "  4. Fill in metadata + screenshots on App Store Connect, then Submit for Review"
