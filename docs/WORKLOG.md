# Game Tracker - Working Log

## Project Overview
Local-first desktop and web app to ingest personal game libraries, enrich metadata, and manage a private backlog.

## Current State
- Implemented: PNPM monorepo (`apps/web`, `apps/desktop`, `packages/core`), Dexie schema, import/export flows, basic metadata fetch.
- Partial: Desktop fetch commands need reliability; styling regressions under investigation.
- Gaps: Search/filter enhancements, store badge UX, enrichment pipeline polish.

## Architecture
- Stack: React 18 + TypeScript + Vite + TailwindCSS; Dexie (IndexedDB); Tauri v2 + Rust; PNPM workspaces.
- Key modules/files: `apps/web/src/pages/LibraryPage.tsx`, `apps/web/src/db.ts`, `packages/core/src/*.ts`, `apps/desktop/src-tauri/src/commands.rs`.
- Data flow: Web UI + desktop bridge (`apps/web/src/desktop/bridge.ts`) + Tauri commands + remote APIs; imports use core normalizers then Dexie persistence.

## Decisions & Rationale
- Manual per-item metadata fetch with caching/backoff to respect API rate limits.
- Fixed-width library cards (responsive column count only) for visual consistency.
- Local caches under `%AppData%/GameTracker/` for HLTB/OpenCritic/Steam metadata.

## Open Tasks
- Now: Restore Tailwind styling, enforce fixed card layout, add title search, add store badges.
- Next: Dexie migration for new fields, row-by-row importer enrichment with throttling.
- Later: Ship SVG badges, explore Steam Web API integration.

## Known Issues
- UI currently unstyled due to missing Tailwind directives.
- Desktop fetch commands may fail (OpenCritic 429, HLTB misses, Steam currency mismatches).
- Settings page occasionally triggers "Invalid hook call".

## Commands
- Install deps: `pnpm install`
- Web dev: `pnpm dev:web`
- Desktop dev: `pnpm tauri dev`
- Core tests: `pnpm -C packages/core test`

## Notes
- 2025-02-14: Initialized Git, removed redundant `game-tracker/` copy, added worklog template.
- 2025-02-14: Restored Tailwind styling/cards, added debounced title search, and surfaced store badges in library view.
- 2025-02-14: Removed legacy `old*` web pages and re-enabled full TypeScript coverage.
- 2025-02-14: Added Dexie v5 migration (`currencyCode`), moved TTB source tracking onto identities, and refreshed editor/bulk fetch flows.
- 2025-02-23: Added Dexie v6 `settings` key/value store for enrichment state and introduced background enrichment with pause/resume and a floating status bar.
- 2025-02-24: Implemented a singleton enrichment runner with persisted sessions, minimal HUD overlay, and a hideable Import Wizard. Updated `ImportWizard.tsx`, `state/enrichmentRunner.ts`, `overlays/EnrichmentHUD.tsx`, and styling/Library hooks; verified via `pnpm build` (web) — noted existing Vite dynamic import warning. Known limitation: Tauri bridge calls still lack abort support, so pause waits for the current request to settle.
- 2025-02-24: Added runner `phase` lifecycle (`idle/init/active/paused/done`) with a 600ms minimum init window, shader-style init line (`gt-hud__init`) that swaps to progress fill (`gt-hud__prog`), and reduced-motion guard. `EnrichmentHUD` now reads `snapshot.phase` to switch lines while keeping popover controls unchanged.
- 2025-02-24: Wired OpenCritic via RapidAPI: desktop command reads `OPENCRITIC_API_KEY`/`OPENCRITIC_HOST`, hits `/game/search` and `/game/{id}`, caches scores in `%AppData%/GameTracker/opencritic_cache.json` for 7 days, and backs off on 429 using `Retry-After` or a 700ms+jitter fallback.
- 2025-02-25: Updated HLTB enrichment to use Next.js data endpoint with build-id cache and fuzzy matching fallback (apps/desktop/src-tauri/src/commands.rs:208).
## HLTB � current state
- Endpoint: POST https://howlongtobeat.com/api/search (fallback: HTML parse).
- Payload: searchType=1, searchTerms tokens, page/size, options for games/users/filter (apps/desktop/src-tauri/src/commands.rs:223).
- HTML fallback: GET https://howlongtobeat.com/?q=... and regex parse gameplayMain (apps/desktop/src-tauri/src/commands.rs:273).
- Cache: %AppData%/GameTracker/hltb_cache.json, TTL: 30d for positive, 24h for negative (apps/desktop/src-tauri/src/commands.rs:17,19,324).
- Returns: Ok(Some(hours)) on success; Ok(None) when not found; Err(String) on HTTP/parse errors.

