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
