# Release Checklist

## 1. Prerequisites
- Node 18+, pnpm 9+
- Rust stable (matching `rust-toolchain`)
- Tauri prerequisites per platform (Xcode on macOS, GTK/WebKit on Linux, Visual Studio Build Tools on Windows)
- Optional: code-signing cert (Windows) and Apple Developer IDs (macOS)

## 2. Build Commands
```
pnpm -w install
pnpm -C apps/web build
# Windows bundle (MSI)
pnpm tauri build
# macOS bundle (run on macOS host)
pnpm tauri build --target universal-apple-darwin
# Linux bundle (run on Linux host)
pnpm tauri build --target x86_64-unknown-linux-gnu
```
Artifacts: `apps/desktop/src-tauri/target/release/bundle/`.

## 3. Code Signing — Windows (optional)
If you have a code-signing certificate, sign the MSI to avoid SmartScreen warnings. If you’re distributing unsigned (as in the open-source release), skip this section but communicate to users that Windows will flag the installer as an unknown publisher.

1. Import your `.pfx` or keep it accessible on disk.
2. Sign the MSI:
   ```powershell
   signtool sign /f path\to\cert.pfx /p YOUR_PASSWORD /tr "http://timestamp.digicert.com" /td sha256 /fd sha256 "Game Tracker_0.1.0_x64_en-US.msi"
   ```
3. (Optional) Sign `tracker-desktop.exe` similarly.

## 4. macOS Notarization (run on macOS)
1. Codesign `.app` with Developer ID + hardened runtime.
2. Build `.dmg`/`.pkg` and notarize via `xcrun notarytool submit`.
3. Staple ticket: `xcrun stapler staple Game\ Tracker.app`.

## 5. Updater Endpoint
- Update `tauri.conf.json` → `plugins.updater.endpoints` with production URL.
- Upload signed bundles + manifest to that endpoint.
- Update `pubkey` if you rotate updater signing keys.

## 6. Documentation
- Publish `docs/RELEASE_NOTES_0.1.0.md` (or merge into CHANGELOG).
- Attach `docs/QA_SMOKE_0.1.0.md` to the release announcement.

## 7. Final QA
- Execute QA scenarios on each platform (sessions, wishlist, deals, suggestions, updater).
- Verify Strict JSON ON/OFF behaviour and dark-mode UI.

## 8. Tag & Publish
```
git tag v0.1.0
git push origin v0.1.0
```
