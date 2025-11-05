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
