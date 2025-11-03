# Code Signing & Updater Notes

- The desktop app now ships with the Tauri updater plugin enabled. Update metadata is fetched from `https://updates.example.com/game-tracker/{{target}}/{{current_version}}`.
- Replace the placeholder public key in `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) with the ECDSA public key that matches your signing key. Tauri expects a base64-encoded DER key created via `tauri signer generate`.
- Each published build must be signed with the matching private key (`TAURI_PRIVATE_KEY`) so the updater can verify the bundle before installing it. Unsigned builds will be rejected and logged in the desktop console.
- Windows MSI installers should continue to be Authenticode-signed; macOS DMGs require a valid Developer ID Application certificate. The updater does not bypass OS-level Gatekeeper/SmartScreen warnings.
- Update artifacts should be served with HTTPS and a consistent `target` identifier (see `tauri.conf.json`) so the client can match the channel correctly.
- During development you can disable the updater by setting `TAURI_UPDATER_DISABLED=1` or pointing the endpoint to a local server.
