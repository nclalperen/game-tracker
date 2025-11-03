# Game Tracker

Open-source desktop + web app for tracking your PC game library, wishlist deals, and play sessions.

## Downloads
- Latest Windows installer: `apps/desktop/src-tauri/target/release/bundle/msi/Game Tracker_0.1.0_x64_en-US.msi`
  - **Note:** The MSI is unsigned in the open-source release. Windows SmartScreen will show “Unknown publisher.” Click “More info” → “Run anyway” to install.
- macOS / Linux builds: run `pnpm tauri build --target …` on the respective platforms (see `docs/RELEASE.md`).

## Key Features
- Steam library enrichment (covers, metadata, HLTB, RAWG).
- Wishlist sync with error handling for private/sign-in/HTML responses.
- Deal scoring with wishlist toggles and owned-title filtering.
- AI-backed suggestions with strict JSON pipeline and offline heuristics.
- Dark/light theme toggle.

## Building from Source
```bash
pnpm -w install
pnpm -C apps/web build
# Windows desktop bundle
pnpm tauri build
```
More detail in `docs/RELEASE.md`.

## QA
See `docs/QA_SMOKE_0.1.0.md` for the smoke test matrix used for this release.

