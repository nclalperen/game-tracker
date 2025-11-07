# Game Tracker v0.1.1

## Summary
- Adds clearer RAWG key guidance (Settings reminder + quieter console logging).
- Improves CI by running Playwright against `vite preview` and publishing cross-platform Tauri bundles (Windows/MSI, macOS/dmg, Linux/AppImage) automatically.
- No functional changes from 0.1.0; patch focuses on release ergonomics.

## Downloads
- `Game Tracker_0.1.1_x64_en-US.msi` (Windows, unsigned – SmartScreen will prompt)
- `game-tracker_0.1.1_x86_64.AppImage` (Linux)
- `Game Tracker_0.1.1_universal.dmg` (macOS)

SHA256 sums are attached alongside each asset by the CI workflow.

## Notes
- RAWG media requires `VITE_RAWG_KEY` in `apps/web/.env.local` when building locally.
- Models / `.gguf` assets remain Git LFS pointers; run `git lfs install` before cloning.
