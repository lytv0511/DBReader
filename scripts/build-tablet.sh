#!/usr/bin/env bash
# Builds the tablet variant:
#  - iPad-only IPA (bundle id com.vincentleong.dbreader.tablet, iPad-only
#    device family) with the tablet-optimised UI baked in
#  - Android tablet APK (same application id so Tauri's Kotlin package check
#    passes; distinguished by tablet UI + launcher label)
# The generated iOS project is patched, built, then restored so the phone
# build stays untouched.
set -euo pipefail
cd "$(dirname "$0")/.."

IOS_PROJ="src-tauri/gen/apple/dbreader.xcodeproj/project.pbxproj"
SRC_PLIST="src-tauri/Info.ios.plist"
ANDROID_MANIFEST="src-tauri/gen/android/app/src/main/AndroidManifest.xml"

echo "==> backing up generated projects"
cp "$IOS_PROJ" "$IOS_PROJ.bak"
cp "$SRC_PLIST" "$SRC_PLIST.bak"
cp "$ANDROID_MANIFEST" "$ANDROID_MANIFEST.bak"

restore() {
  echo "==> restoring generated projects"
  mv "$IOS_PROJ.bak" "$IOS_PROJ"
  mv "$SRC_PLIST.bak" "$SRC_PLIST"
  mv "$ANDROID_MANIFEST.bak" "$ANDROID_MANIFEST"
}
trap restore EXIT

echo "==> patching iOS project for tablet"
sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER = com\.vincentleong\.dbreader;/PRODUCT_BUNDLE_IDENTIFIER = com.vincentleong.dbreader.tablet;/g' "$IOS_PROJ"
sed -i '' 's/TARGETED_DEVICE_FAMILY = "1,2";/TARGETED_DEVICE_FAMILY = "2";/g' "$IOS_PROJ"
cat > "$SRC_PLIST" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>DBReader Tablet</string>
</dict>
</plist>
EOF

echo "==> building tablet ipa (iPad-only)"
pnpm tauri ios build --debug --config src-tauri/tauri.tablet.ios.conf.json

echo "==> patching android launcher label"
sed -i '' 's/android:label="DBReader"/android:label="DBReader Tablet"/' "$ANDROID_MANIFEST"

echo "==> building tablet apk"
JAVA_HOME=/opt/homebrew/opt/openjdk@17 NDK_HOME=/Users/jasonleong/Library/Android/sdk/ndk/27.0.12077973 ANDROID_HOME=/Users/jasonleong/Library/Android/sdk pnpm tauri android build --debug --config src-tauri/tauri.tablet.android.conf.json

echo "==> staging tablet artifacts"
mkdir -p dist-install
IPA="$(ls -t src-tauri/gen/apple/build/arm64/*.ipa 2>/dev/null | head -1)"
[ -n "$IPA" ] || { echo "tablet ipa not found"; exit 1; }
cp "$IPA" dist-install/DBReader-Tablet.ipa
APK="$(ls -t src-tauri/gen/android/app/build/outputs/apk/universal/debug/*.apk 2>/dev/null | head -1)"
[ -n "$APK" ] || { echo "tablet apk not found"; exit 1; }
cp "$APK" dist-install/DBReader-Tablet.apk
ls -la dist-install/DBReader-Tablet.ipa dist-install/DBReader-Tablet.apk
