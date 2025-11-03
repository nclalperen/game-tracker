# Game Tracker 0.1.0

## Highlights
- 🔍 **Sessions tracking (Windows)** — Foreground process is sampled every second with a 5s debounce. Emits `session_started` / `session_stopped` via Tauri events and keeps an accessible “Now Playing” value for the renderer.
- 💾 **Robust Steam wishlist import** — Falls back from the Web API to the public `wishlistdata` endpoint, detects sign-in / private / HTML responses, and surfaces actionable guidance.
- 💸 **Deal list refresh** — Owned / installed titles are hidden by default, deal scoring is consistent, and wishlist toggles are debounced.
- 🤖 **AI Suggestions** — Strict JSON by default, automatic JSON-only retry, Steam-style library list repair, single-object sample parsing, and heuristic top-up with meaningful reasons when necessary.
- 🌙 **Dark mode** — Complete app-wide theming with toggle in nav + Settings.

## Notable Changes
- Sessions loop (Windows) rewritten with safe Win32 bindings (`OpenProcess`, `K32GetModuleBaseNameW`, `GetWindowTextW`).
- Wishlist importer surfaces “sign in”, “private wishlist”, “Steam blocked the request” with clear remediation tips.
- Deals page derives views from Steam prices + wishlists and filters out `inLibrary` entries before sorting by `dealScore`.
- Suggestions page adds “Strict JSON” checkbox (persisted via Dexie settings) and displays parsed raw response when conversion was necessary.
- AI heuristic fallback now produces reasoned badges (`Installed`, `Critic 91`, `≈1.5h fits timebox`, `$0.99/h`) instead of “Heuristic fallback”.
- Desktop bundle ships with Ally/LLM resources (`apps/desktop/src-tauri/bin/*`).

## Known Issues
- **macOS / Linux bundles** — Not produced in this build (Windows only). Run `pnpm tauri build --target universal-apple-darwin` / `--target x86_64-unknown-linux-gnu` on the respective platforms when ready.
- **Unsigned Windows installer** — This open-source release ships without code signing. Windows SmartScreen will mark the MSI as an unknown publisher; instruct users to select “More info” → “Run anyway.”
- **Chunk-size warnings** — Vite warns about bundle size (>500 kB). Acceptable for this release; follow-up by splitting heavy modules.
- **Future Rust warning** — `nom v1.2.4` flagged by `cargo` as future-incompatible; originates from a dependency chain and does not affect runtime.

## Breaking / Behavioural Changes
- Deals page no longer shows owned titles unless explicitly toggled back in future.
- AI Suggestions default to JSON-only responses; conversational replies now require toggling off “Strict JSON”.

## Upgrade Notes
1. Run `pnpm -w install` (ensures web + desktop deps).
2. Build web via `pnpm -C apps/web build`.
3. Produce Windows MSI `pnpm tauri build` (already done for this release).
4. (Optional) Build platform-specific bundles on macOS / Linux before publishing.
5. Sign MSI & upload to update endpoint for Tauri updater.
