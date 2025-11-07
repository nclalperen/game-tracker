# Game Tracker

Open-source desktop + web app for tracking your PC game library, wishlist deals, and play sessions.

## Downloads
- **Latest release (Windows / macOS / Linux):** https://github.com/nclalperen/game-tracker/releases/latest
  - Windows MSI asset: Game Tracker_<version>_x64_en-US.msi (unsigned; SmartScreen will require "More info" ? "Run anyway").
  - macOS (.dmg/.app) and Linux (.AppImage/.tar.gz) artifacts are uploaded automatically for each tag.
- Prefer to build locally? Follow docs/RELEASE.md for platform-specific commands.

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

Note: For RAWG-powered media in dev, create `apps/web/.env.local` with:

```
VITE_RAWG_KEY=your_rawg_api_key_here
```

## QA
See `docs/QA_SMOKE_0.1.0.md` for the smoke test matrix used for this release.

# Roadmap

## Short Term (0.1.x)
- **macOS & Linux bundles** – Add CI jobs (or manual scripts) to produce `.dmg` / `.AppImage` alongside the Windows MSI. Update release automation to upload all three.
- **Optional code signing** – Evaluate purchasing an org code-sign cert. Integrate signing step (signtool + notarisation) into release script when available.
- **Install/onboarding improvements**
  - Warn first-run users about unsigned installer & how to bypass SmartScreen.
  - Offer direct download instructions for LLM/Ally models if the bundle is trimmed.
- **AI tuning**
  - Add caching to strict JSON retries to reduce repeated network calls.
  - Surface Ally transcript excerpts directly on the Suggestions page.
- **Wishlist UX**
  - Provide link to Steam privacy settings when import fails.
  - Add “Retry” button on the wishlist HUD.

## Mid Term (0.2)
- **Cloud sync options** – Research integration with Google Drive/Dropbox or a simple WebDAV exporter for session data and enrichment caches.
- **Session analytics** – Desktop overlay (or mini dashboard) showing recent play sessions and completion status.
- **Deal alerts** – Background notifications when wishlist items fall below a target price.
- **AI suggestions**
  - Allow prompt templates per mode (coach/deals/QA) configurable in Settings.
  - Experiment with local LLM fallback when offline.
- **Chunk size reduction** – Split heavy bundles (RAWG, Dexie) into lazy chunks to shrink initial app load.

## Later (0.3+)
- **Cross-store integrations** – Investigate Epic/GOG/PlayStation importers.
- **Mobile companion** – Concepts for a lightweight React Native client consuming a shared Dexie/exported database.
- **Plugin system** – Define API for community enrichment providers.
- **Telemetry opt-in** – If we gather anonymous usage stats, ensure strict opt-in and privacy compliance.

Roadmap items are aspirational; adjust priorities based on community feedback and contributor availability.

