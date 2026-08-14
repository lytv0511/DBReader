# Publishing DBReader iOS to the App Store

Handoff doc for whoever owns a **paid** Apple Developer Program account
($99/yr). A free Apple ID can build/install on device, but **cannot upload to
App Store** — a paid account is required.

## Prerequisites (on the Mac doing the build)

- macOS with **Xcode** installed. Sign in with the paid Apple ID once:
  `Xcode > Settings > Accounts` (this is how Xcode creates the distribution
  certificate and signing profiles automatically).
- **Node + pnpm**: `npm i -g pnpm`, then `pnpm install`
- **Rust toolchain with the iOS target**:
  `rustup target add aarch64-apple-ios`

## One-time setup (in the Apple Developer account)

1. **Register the bundle ID** at
   https://developer.apple.com > **Certificates, Identifiers & Profiles > Identifiers**
   - Phone app: `com.vincentleong.dbreader`
   - iPad app (optional): `com.vincentleong.dbreader.tablet`
   - Bundle IDs are globally unique — if either is taken, pick your own and
     pass it via `BUNDLE_ID` below.
2. Create the app entry at https://appstoreconnect.apple.com > **My Apps > +**
   using the same bundle ID.

## Build the App Store IPA

```sh
TEAM_ID=YOUR_10_CHAR_TEAM_ID ./scripts/ios-appstore.sh
```

- `TEAM_ID` is shown at developer.apple.com > Membership.
- Output: `src-tauri/gen/apple/build/arm64/DBReader.ipa`
- The script patches the Xcode project's signing team + bundle ID, builds in
  release, and exports with the **app-store** method. It restores the project
  afterwards, so it can be re-run safely.

Optional variants:

```sh
# iPad-only tablet build (bundle id com.vincentleong.dbreader.tablet)
BUNDLE_ID=com.vincentleong.dbreader.tablet CONFIG=src-tauri/tauri.tablet.ios.conf.json TEAM_ID=YOUR_TEAM_ID ./scripts/ios-appstore.sh
```

## Upload

Two options:

1. **Transporter** (App Store's upload tool, from the Mac App Store): open it,
   drag the `.ipa`, sign in with the paid Apple ID.
2. **altool** CLI:
   ```sh
   xcrun altool --upload-app -f src-tauri/gen/apple/build/arm64/DBReader.ipa \
     -t ios -u YOUR_APPLE_ID -p APP_SPECIFIC_PASSWORD
   ```
   (Create an app-specific password at appleid.apple.com > App-Specific
   Passwords.)

The build must show "Processing complete" in App Store Connect before you can
attach it to a version.

## Submit for review

In App Store Connect > My Apps > your app > **App Store version**:

- Upload screenshots (iPhone sizes; iPad if the tablet variant).
- Fill description, keywords, privacy policy URL (required), age rating,
  export compliance, and the other required fields.
- Select the uploaded build, then **Submit for Review**.

## Notes / gotchas

- The first App Store build makes Xcode auto-create an **Apple Distribution
  certificate** and the App Store provisioning profile — this requires the
  account holder to be an **Admin/Team Agent** on the team.
- Two separate bundle IDs = two separate apps in App Store Connect.
- `scripts/build-tablet.sh` produces *debug* builds for sideloading/dev only —
  it is not for the App Store.
- If you change the bundle ID or app name, update `src-tauri/tauri.conf.json`
  (`identifier`, `productName`) and `src-tauri/Info.ios.plist`
  (`CFBundleDisplayName`) rather than relying on the script alone.
