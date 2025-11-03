# Game Tracker - Working Log

## Project Overview
Local-first desktop and web app that ingests personal game libraries, enriches metadata, and helps manage a private backlog. Monorepo managed with PNPM.

## Architecture Snapshot
- Stack: React 18 + TypeScript + Vite + TailwindCSS, Dexie (IndexedDB), Tauri v2 + Rust.
- Key modules: `apps/web/src/pages/LibraryPage.tsx`, `apps/web/src/state/enrichmentRunner.ts`, `apps/web/src/components/details/GameDetails.tsx`, `apps/desktop/src-tauri/src/commands.rs`, `packages/core/src/*`.
- Data flow: Web UI talks to Dexie and the Tauri bridge for desktop tasks (Steam, HLTB, OpenCritic). Core package provides shared normalizers and CSV tooling.

## Current Status
- Inline card expansion with RAWG-powered detail drawer (lazy loaded, sanitized HTML, request budgeting, memoized caches).
- Vendor-first enrichment runner with pause/resume/halt, persistence across reloads, and source precedence (MC > OC > RAWG, HLTB vendor > live > RAWG).
- Desktop session logger (Windows) feeding Dexie `sessions`, powering re-onboarding card and finish planner.
- Outstanding polish: improve Explore views, configurable data-source toggles, reduce main bundle size further, expand automated tests.

## Command Cheatsheet
- Install: `pnpm install`
- Web dev: `pnpm dev:web`
- Vendor index: `pnpm build:vendor`
- Web typecheck/build: `pnpm -C apps/web typecheck` / `pnpm -C apps/web build`
- Desktop dev: `pnpm -C apps/desktop tauri dev`
- Desktop build sanity: `cargo check` inside `apps/desktop/src-tauri`

## 2025-02-26 - RAWG Detail Drawer & Enrichment Improvements
### Card Detail Drawer (RAWG-powered)
- Component: `apps/web/src/components/details/GameDetails.tsx` (lazy loaded via `LibraryPage`).
- Data pipeline:
  - Dexie caches `rawgGames` with 30-day TTL for details, 7-day TTL for screenshots/movies.
  - RAWG client (`apps/web/src/apis/rawg.ts`) enforces 1 req/sec budget with in-memory Map cache (30 min TTL) and queueing.
  - Sanitization handled by `apps/web/src/utils/sanitizeHtml.ts` (DOMPurify with conservative allow list, `target="_blank"` links plus `rel="noopener noreferrer"`).
- UI summary:
  - Header shows prioritized score badge (Metacritic vendor -> OpenCritic -> RAWG) and TTB chip (HLTB vendor -> HLTB live -> RAWG average) with source labels.
  - Tabs: Media (hero image, screenshot rail, trailers), Overview (description, genres, developers, publishers, release date, ESRB), Stores (buttons from `storeMap` mapping RAWG store IDs).
  - Finish planner surfaces 3-5 sessions based on Dexie session median and remaining hours; collapsible detail.
- Accessibility: Drawer is portalized with `role="dialog"`, ESC/overlay close, focus trap, restore focus to originating card. Buttons support keyboard navigation with `tabIndex`, `role="button"`, Enter/Space handlers.

### Enrichment Runner Enhancements
- Dexie `settings` stores session payload (`getEnrichSession`, `setEnrichSession`), allowing resume after reload. Dexie schema bumped to v11 adding `Identity.enrichmentSessionId` and `enrichmentPartial` flags.
- Runner enforces vendor-first pipeline (Steam price, HLTB local, Metacritic) before fallback queue (HLTB live via desktop bridge, RAWG playtime/score).
- Rate budgets: Steam 600 ms, HLTB 900 ms, OpenCritic 900 ms between attempts; request queue resets on success/failure.
- In-memory caches: 20 entries (5 min TTL) for quick toggling between cards; negative caching for OpenCritic to avoid repeated misses.
- Prefetch guard: hover prefetch debounced 200 ms, single active RAWG detail per second, skip when drawer opened for same id in last 3 seconds.

### Vendor Index Refresh
- Command: `pnpm build:vendor` (runs `scripts/build-mc-index.ts` using `scripts/csv/smartCsv.ts` parser).
- Sniff result: delimiter `,`, BOM `false`, record delimiter `\n`.
- Processed 20,022 CSV rows; produced 16,396 index entries (`apps/web/public/hookdata/metacritic.index.json`, size 1.22 MB).
- Steam rows enforce rule: if `store.steampowered.com` present, title trimmed two chars before `http`; manual non-store rows skipped.

### Chunking
- Vite manual chunks isolate Dexie (`vendor_db`) and DOMPurify (`vendor_html`). Lazy chunks: Settings 7.17 kB (gz 2.42), ImportWizard 15.34 kB (gz 5.38), GameDetails 46.18 kB (gz 15.76). Main bundle ~735 kB (gz 214 kB).

### QA / Acceptance
- Cards expand inline with keyboard + pointer activation; ESC collapses.
- Drawer shows single score badge + source chips, sanitized description, tabs working with focus indicators.
- RAWG prefetch stays within budget; repeated opens hit Dexie/in-memory cache.
- Stores buttons open vendor URLs in new tabs (`rel="noopener"`).
- Accessibility: Drawer announces title/description, badges have `aria-labels`, tabs use `role="tablist"` semantics.

## 2025-02-27 - Halt Flow, Session Flags, Hook Fixes
### Enrichment Halt Workflow
- Runner exposes `halt()`; sets `halted` flag, pauses active workers, and marks touched identities with `enrichmentPartial` until session completes.
- UI reactions:
  - HUD hides automatically on halt and fires `gt:hide-enrichment`. Resumes via Settings dispatch `gt:show-enrichment`; inline state tracks visibility per session id.
  - Import Wizard closes immediately when halt pressed and warns about halted state; Settings page shows status, progress, and resume/halt buttons.
  - Library page listens to both show/hide events to keep wizard visibility in sync.
- Persistence: Dexie session payload includes `halted` boolean; rehydration sets message "Enrichment halted. Resume from Settings when you're ready."

### Game Details Hook Stability
- Fixed "Rendered more hooks than during the previous render" by computing finish-plan `useMemo` before branching on `state.status` and guarding with `data` presence. Loading/error skeletons now run without altering hook order.

### Desktop Session Logger
- Validated via `cargo check` (Windows). Foreground window polling (`GetForegroundWindow`, `GetWindowTextW`, `QueryFullProcessImageNameW`) with safe handle management and event emission via `tauri::Emitter::emit`. Sessions stored in Dexie table `sessions`.

## 2025-02-28 - Steam Integration Touch-Ups
### Dexie + Settings
- Bumped Dexie to v11 adding `sessions` table plus helpers (`addSessionEntry`, `updateSessionEntry`, `recentSessions`) with 400-row prune.
- Persisted library sort and re-onboarding snooze via `getLibrarySort` / `setLibrarySort` and `getReonboardingSnooze` / `setReonboardingSnooze`.
- Session hydrate path now restores `halted` flag and runner phase; snapshot ids carry `halted` for Settings resume flow.

### Web Surface Updates
- Library cards display a compact "Now Playing" pill when the Steam profile reports the current `gameid`.
- Import wizard Steam step merges owned games and manifests, tracks install metadata, and stores `steam.lastSyncAt`.
- GameDetails cleaned to ASCII, uses `computeCover` (Steam art > RAWG > IGDB), and relies on Dexie session median for finish planner hints.

### Runner Mechanics
- `requestActiveTransition` ensures init state lasts at least 600 ms before transitioning to `active`, with timers cleared on pause/halt.
- `finalizeIfDone` flips sessions to `done`, clears timers, and emits a completion message once all workers stop.
- Runner subscriptions now use `useSyncExternalStore`; halt state is persisted in Dexie payloads.

## Metrics Snapshot (2025-02-28)
- `pnpm build:vendor`: 16,396 entries, 1.22 MB artifact (unchanged).
- `pnpm -C apps/web typecheck`: pass.
- `pnpm -C apps/web build`: pass; main chunk 744.00 kB (gz 216.86 kB), GameDetails chunk 54.50 kB (gz 17.88 kB), Settings chunk 11.75 kB (gz 3.64 kB). Warning noted for main bundle >500 kB.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`: pass (unused variable warning, `nom` future-incompat warning).

## Follow-up Ideas
- Shard Metacritic index when file exceeds 8 MB (lazy-load per letter).
- macOS session logger via Accessibility API (needs permission gating).
- Travel Mode profile for offline-friendly filters.
- Settings toggles to disable vendor sources and clear caches on demand.

## 2025-03-01 - Steam ID Normalization & Halt UX
### Steam Import & Settings polish
- Centralized Steam ID parsing in `apps/web/src/desktop/steamBridge.ts` with `ensureSteamId`, trimming vanity URLs and resolving via desktop bridge.
- Settings page now reuses the helper, surfaces friendlier errors for missing API keys or private profiles, and keeps the saved ID normalized to SteamID64.
- Import wizard validates the stored ID before hitting the bridge, persists the normalized ID back to Dexie, and shows actionable copy if Steam returns "player not found".

### Enrichment HUD auto-hide
- Runner `halt()` now emits `gt:hide-enrichment` so popups close no matter which surface triggers the halt.
- Import wizard forces the HUD closed after halt, keeping resume flow gated to Settings.

### Steam action shortcuts
- Drawer header surfaces Play/Install (steam://run/install) and Open Store buttons when a Steam app id exists, preserving focus by stopping propagation.
- Library cards mirror those controls beside the Edit button so inline expansions stay open while launching Steam.

### Steam recent-play insights
- Game details now hydrate Steam's "recently played" cache, refreshing on demand via Tauri when stale.
- Overview tab fuses owned + recent stats to show total hours, last two weeks, and last played date even when the owned cache is missing.

## 2025-03-02 - Ally Sidecar Scaffold
### Ally sidecar smoke
- CLI location: `apps/desktop/src-tauri/bin/ally/main.py`; Python fallback prints `ally (embedded)` via `py main.py --version`.
- Tauri bridge executes the same entrypoint through `ally_version_cmd`; no GUI smoke in this headless session (`pnpm tauri dev` started but timed out waiting for window interaction).
- Raw `ALLY_*` defaults captured in `.env.local`; Vite loads them via repo-root `envDir`.

## 2025-03-03 - Ally Export v1
- Shared schemas (`packages/core/src/ally/schemas.ts`) define `schemaVersion=1` payloads for library, achievements, prices, and profile JSON dumps.
- Desktop bridge gained `ally_get_data_dir` and `ally_write_export` so the web front-end can persist JSON bundles into `%APPDATA%/GameTracker/ally-data/<label>/`.
- Web utilities (`apps/web/src/ally/export.ts`) read from Dexie – identities + library rows for `library.json`, Steam achievements/prices caches for the others – and invoke the new Tauri writers. Empty fields stay `null`/omitted; critic/TTB fallbacks follow the existing precedence (MC>OC>RAWG, HLTB vendor>live>RAWG).
- Settings → AI / Ally now shows the resolved data directory (desktop only) and provides a "Export data now" button, surfacing filenames + bytes written after the operation. Non-desktop builds keep the previous "requires desktop" note.
- Nightly background export scheduled for desktop (`maybeNightlyExport`) via `requestIdleCallback`/`setTimeout` shim so the bundle stays fresh without blocking first paint. Background failures log to console only.
- Manual smoke: headless CI can't click the button, so JSON exports weren't captured here. Local run should yield `library.json`, `achievements.json`, `prices.json`, and `profile.json` under `ally-data/my_library/`; each file begins with `{ "schemaVersion": 1, "generatedAtISO": "..." }`.

## 2025-03-03 - Ally commands wired (Batch 3)
- Added stdin-aware wrappers in `ally.rs`: `embed` (60s timeout), `start_rag` (30s), and `chat` (60s) reusing Docker/CLI/Python fallbacks. `exec_with_stdin` streams payloads and kills the process on timeout.
- Desktop commands now expose `ally_embed_cmd`, `ally_start_rag_cmd`, and `ally_chat_cmd`; the web bridge wires `allyEmbed`, `allyStartRag`, `allyChat` alongside the existing export helpers.
- Settings → AI / Ally gained a "Run all (Export → Embed → Start)" bootstrap plus individual buttons. Each step shows a status pill, stores its output, and persists timestamps in Dexie (`ally.lastExportISO`, `.lastEmbedISO`, `.lastStartISO`). Data dir still resolves to `%APPDATA%/GameTracker/ally-data/` via the Tauri getter.
- Desktop-only chat smoke UI issues requests through `allyChat`, using session ids shaped like `sess_<8 hex>` and defaulting to `allowWeb = false`. Replies render as pretty JSON when possible.
- Headless run note: the CLI/UI smoke (Run all + chat prompt) still needs manual confirmation on a desktop instance; expect the embed/start commands to report "done" and the chat prompt to return a short textual recommendation.
- Install heuristics consider recent activity so the Play button stays available after an import-only sync.
- Added a dedicated "Your data" section near the top of the drawer showcasing library status, price/value, and Steam play history (total, 2-week minutes, last played) for quicker scanning.
- Library card editor gained a "Fetch Steam personal data" action so users can refresh playtime/install flags for a single game without rerunning the enrichment pipeline.

### Local LLM mode + permissions + bundling (finalization)
- Capability `event-listen` (`apps/desktop/src-tauri/capabilities/event-listen.json`) grants `core:event:default` + `core:event:allow-listen`, automatically included because the `capabilities/` folder is scanned by default.
- Models: `models/**/*` added to bundle resources so `.gguf` files under `apps/desktop/src-tauri/models/` ship with desktop builds. Resolver also checks `exe_dir/models` and `exe_dir/resources/models` at runtime.
- Local LLM runtime: `apps/desktop/src-tauri/src/local_llm.rs` (feature `local-llm`) discovers chat & embed models (env overrides `LLM_CHAT_MODEL_PATH`, `LLM_EMBED_MODEL_PATH`) and shells out to bundled `llama.cpp` binaries for real chat + embedding inference. Falls back to deterministic stubs only if binaries are unavailable.
- Build glue: `apps/desktop/src-tauri/build.rs` auto-downloads prebuilt llama.cpp sidecar binaries (default tag `b3538`) for Windows/macOS/Linux at compile time unless `bin/llama/main*` already exists. Queries the GitHub release API to resolve the correct asset per platform. Override via `LLAMA_REPO`, `LLAMA_RELEASE_TAG`, or `LLAMA_SIDECAR_URL`.
- Web UI: `apps/web/src/pages/SettingsPage.tsx` switches chat to local provider when selected and keeps Ally flow available as an alternative. One‑click bootstrap now works with Local: writes `vectors.json` and `kb.json` to Ally data dir.

Acceptance checklist
- Settings → AI / Ally shows Provider toggle (Local/Ally) and lists detected `.gguf` files (Local).
- Run all (Export → Embed → Start) succeeds with Local provider and writes JSON under `%APPDATA%/GameTracker/ally-data/my_library/`.
- Chat sends via Local when selected; Ally remains available for Python sidecar users.

### Validation
- `cargo check` (apps/desktop/src-tauri) — pass with existing warnings.
- `pnpm -C apps/web typecheck` — pass.
- `pnpm -C apps/web build` — pass (main chunk 748.71 kB gz 217.69 kB; Vite chunk-size warning acknowledged).

## 2025-03-02 - HLTB session refresh & Steam editor hook
- Desktop HLTB client now bootstraps a session (cookie store + CSRF token discovery) and retries the JSON search endpoint before falling back to HTML scraping; avoids the frequent 403s introduced by the new HowLongToBeat front-end.
- Updated reqwest dependency to enable cookie persistence and added a lightweight regex helper for token capture.
- Library editor's "Fetch Steam personal data" action normalizes/saves the Steam ID, refreshes owned + recent Dexie caches, invalidates the drawer cache, and automatically prefetches details so the "Your data" panel reflects new playtime immediately.
- Helper exports `resetSteamUserIdCache`/`invalidateGameDetails` to keep drawer memoization aligned with newly fetched desktop data.
- Overview tab follows the latest mock: critic chips now headline the detail grid and the editor shows RAWG screenshot/trailer previews with enhanced store badges so hover states feel more visual.
- Explore page lists now hydrate from the Dexie `rawgExplore` cache, detect existing library entries, and support inline "View details" + "Add to library" actions that reuse the drawer/prefetch flow.
- Library cards surface Steam playtime chips (total hours, last two weeks, last played date) once personal data is fetched; a `gt:library-reload` custom event keeps grids in sync after desktop syncs.
- Drawer "Your data" card highlights library status, price/value, and Steam history ahead of the tabset so personal metrics are visible without scrolling.
- Validation (2025-03-03): `pnpm -C apps/web typecheck` (pass), `pnpm -C apps/web build` (pass; main chunk 769.69 kB gz 223.60 kB, warning acknowledged), `cargo check` (apps/desktop/src-tauri, pass with existing warnings on `_threshold_high` and `PlayerStatsRaw.error`).

## 2025-10-29 - AI suggestions panel & drawer hook
### AI Suggestions (Batch 4)
- Added Ally client helpers (`apps/web/src/ally/aiClient.ts`, `apps/web/src/ally/buildCandidates.ts`) to package heuristically ranked Library rows into `AICandidate[]`, enforce a 50-candidate cap, and fall back to heuristics when Ally returns non-JSON.
- `apps/web/src/pages/SuggestionsPage.tsx` now exposes a desktop-only AI panel: quick chips, custom prompt box, and local-only toggle (default). Knobs persist to Dexie (`suggest.aiMode`, `suggest.aiAllowWeb`, `suggest.aiTimebox`, `suggest.aiQuery`) with a 300 ms debounce.
- Rank requests respect the existing 1 request/second Ally bridge guard and reuse heuristic data; `sessionStorage` hand-off (`suggest.pendingAsk`) primes prompts from other screens.
- Game drawer footer (`apps/web/src/components/details/GameDetails.tsx`) includes an "Ask AI about this game" action that stashes a coach-mode prompt and routes to the Suggestions page without collapsing the card (click/key events stop propagation).
- Default behaviour keeps Ally offline (local-only). Web fallback must be explicitly toggled. Candidate payload remains capped to 50 entries per request to keep latency predictable.

### Acceptance checklist
- Desktop Suggestions page shows AI panel with chips, toggles, persisted values, and guard text when Ally sidecar is missing.
- Quick chips ("Under 30 min", "Co-op tonight", "Deals > 50%") populate fields and trigger Ally; ranked list renders with `#rank`, AI badge, reason tooltip, and heuristic tags.
- Drawer footer button opens Suggestions view, pre-fills "Should I play <game> next? Explain briefly." prompt, and immediately triggers the AI panel.
- When Ally returns malformed JSON or no results, the UI surfaces an inline error block or empty-state card without breaking the heuristics tab.

### Validation
- `pnpm -C apps/web typecheck`
- `pnpm -C apps/web build` (Vite main chunk warning acknowledged)

## 2025-10-30 - Ally automations (Batch 5)
### Nightly export/embed/start + daily digest
- Introduced Ally runbook helpers (`apps/web/src/ally/runbook.ts`) so web code can trigger the full Export -> Embed -> Start pipeline or a chat digest with consistent logging.
- Dexie v15 adds `allyDigests`, `allyLogs`, and a canonical `ally-automation` settings record (defaults: export at 22:30, digest at 09:00, disabled). Helpers `getAutomationSettings`/`saveAutomationSettings` provide normalized access, while `addDigest`, `getRecentDigests`, and `appendAllyLog` manage capped history (50 digests, 500 logs).
- New automation loop (`apps/web/src/ally/automation.ts`) runs on desktop only, respecting per-day guards, 1 req/s budgeting, and logging success/failure. It queues Export -> Embed -> Start when the nightly time passes and emits Markdown digests (coach/deals/both) each morning, persisting status to Dexie.
- Settings → AI / Ally gains an Automations panel: master toggle, HH:mm pickers, digest scope/allow-web controls, "Run Export->Embed->Start now" button, and a collapsible log viewer with refresh/clear actions.
- Added `AllyDigestCard` component (desktop-only) that shows the last 7 digests, surfaces Markdown (stored as pre text for now), and lets users run a digest on demand. Manual runs update automation timestamps and append log entries.
- `apps/web/src/ally/log.ts` funnels structured log entries into Dexie and re-exports convenience getters for UI.
- Replaced the old `maybeNightlyExport` shim by wiring `startAllyAutomationLoop()` in `App.tsx` (idle-started). Removed the legacy `ally/scheduler.ts`.

### Desktop bridge hardening
- `apps/desktop/src-tauri/src/ally.rs` now prints command previews when launch fails (path + args + io::Error) and annotates file-system errors with the data dir/file path, easing troubleshooting when the Python binary is missing.

### Acceptance checklist
- Enable automations in Settings, set export/digest times a minute out, and observe that Export -> Embed -> Start runs once per local day with log entries and updated timestamps.
- Manually run a digest; confirm a new row appears with status pill, content expands, and logs include a success or failure entry. Toggle "Digest can use web" to verify the loop handles allow-web safely.
- Log viewer shows most recent entries first, allows refresh/clear, and remains desktop-only.

### Validation
- `cargo check` (apps/desktop/src-tauri)
- `pnpm -C apps/web typecheck`
- `pnpm -C apps/web build`

## 2025-10-30 - AI reliability & insights (Batch 6)
- Core package now exports Ally helpers (`packages/core/src/ally/prompts.ts`, `schema.ts`, `repair.ts`, `features.ts`) wrapped with zod validation so callers get strict JSON (single critic score + single TTB) and a safe `extractJsonBlock` fallback.
- Web AI client (`apps/web/src/ally/aiClient.ts`) consumes those helpers: 50-candidate cap, JSON repair warnings, charts/notes handling, and optional transcript writes (`saveTranscript`). Candidate builder adds derived features via `computeFeatures`.
- Added presentation components for Ally insights: `ChartsBlock` + lazy `LineChart` SVG renderer, dev-only `TranscriptPanel`, and `AllyDigestCard` for manual digest runs.
- AI panel now surfaces a warning banner when JSON repair kicks in, gates the dev transcript panel behind `VITE_DEV_INSPECTOR`, and reacts immediately to the Settings toggle via the `ally:transcripts-toggle` event.
- Dexie schema (`apps/web/src/db.ts`) gains `allyTranscripts`, `allyLogs`, and helpers (`appendAllyLog`, `getTranscripts`, `saveTranscript`). Settings AI/Ally section now exposes digest card, automation toggles, log viewer, transcript toggle/clear, and data-dir/timestamp badges (`apps/web/src/pages/SettingsPage.tsx`).
- Suggestions page (`apps/web/src/pages/SuggestionsPage.tsx`) anchors the AI panel (`#ai`), prefetches on hover, and renders optional charts behind "View insights".
- Automation loop rebuilt in `apps/web/src/ally/automation.ts` with ASCII-safe prompts, digest persistence, log hooks, and idle start from `apps/web/src/ui/App.tsx`.
- Added local declarations for `unidecode` (`packages/core/src/types/unidecode.d.ts`, `apps/web/src/types/unidecode.d.ts`) so both core and web builds type-check without ambient anys.

### Acceptance
- Ally replies that pass schema render ranked rows, optional notes, and lazy chart insight blocks; malformed replies surface a warning and deterministic fallback list.
- Settings -> AI / Ally shows digest history, automation scheduler (time pickers, scope/allow-web toggle, run buttons), transcript switch, and structured log viewer with refresh/clear.
- Dev transcript panel reflects the toggle immediately; `sessionStorage` hand-off from GameDetails opens Suggestions at `#ai` and triggers the queued prompt.

### Validation
- `pnpm -C packages/core build`
- `pnpm -C apps/web typecheck`
- `pnpm -C apps/web build` (Vite large chunk warning acknowledged)

## 2025-10-31 - Dexie caches & planner wiring (Batch 7)
- Dexie bumped to v15: dropped legacy `rawgExplore` in favour of `rawgLists`, added `wishlists`, `allyDigests`, `allyLogs`, `allyTranscripts`, and `plans` tables, plus compound indexes for `steamPrices` (`[appid+lastFetchedISO]`) and `sessions` (`[identityId+startedAt]`). Added capped helpers for wishlist upserts, digest/log history, transcripts, automation settings, and session exe-map toggles; perf logging switch now respects the persisted `dev.logPerf` flag.
- RAWG list helpers exposed via `getRawgListRow`/`upsertRawgListRow`/`pruneRawgLists` (30‑day TTL). Explore page maps RAWG genres/platforms/stores into `RawgListItem`, prefetches details, and honours cached rows before issuing API requests.
- Finish planner persistence: new Dexie `plans` table with `savePlan`, `getPlanForIdentity`, and `updatePlan` ensures inline planner UI can build/refresh/toggle steps while tracking `doneCount` and timestamps.
- Session bridge stores both session id and resolved `identityId`, updating subscribers whenever the active window changes; exe cache persists via Dexie settings.
- Ally automation/logging APIs restored for downstream callers (`getAutomationSettings`, `appendAllyLog`, `getRecentDigests`, `saveTranscript`) so Settings/Ally UI and automation loops compile again. Steam wishlist import now lands in Dexie via `upsertWishlist`.

### Validation
- `pnpm -C packages/core build`
- `pnpm -C packages/core test`
- `pnpm -C apps/web typecheck`
- `pnpm -C apps/web build` (Vite main chunk warning noted)
- `cargo check` (apps/desktop/src-tauri, warnings only)

## 2025-11-01 - Desktop updater & diagnostics
- Switched to the Tauri updater plugin: added placeholder endpoint/pubkey in `tauri.conf.json`, bundle now exposes platform Ally binaries, and the CLI auto-checks for updates once a week on desktop startup (persisting status in Dexie settings).
- Settings page gains an “Updates” card (manual check + install via plugin-updater) and a desktop-only “Export diagnostics (zip)” action that zips Ally logs/digests/settings + 50-line console buffer through the new `pack_diagnostics_cmd`.
- Added lightweight console proxy (`utils/consoleBuffer`) to retain recent log output and wired Pack Diagnostics bridge; backend command writes archives under the cache directory with bundle/platform metadata.
- Ally runtime now resolves per-platform binaries (`bin/ally/win|mac|linux`) with fallback to the legacy Python entry point if a bundled binary is missing; `.env` overrides remain supported.

### Validation
- `pnpm -C apps/web typecheck`
- `pnpm -C apps/web build` (Vite chunk warning acknowledged)
- `cargo check` (desktop target; existing warnings for unused `steam.rs`/`sessions.rs` fields)

## 2025-11-01 - Test automation & CI
- Added Playwright smoke suite (`apps/web/tests/smoke.spec.ts`) with Chromium config and webserver bootstrapping (`apps/web/playwright.config.ts`); navigation covers Library/Explore/Deals/Suggestions with a mocked desktop bridge.
- Root scripts now expose `pnpm test` (workspace tests + Playwright) and `pnpm test:unit`, enabling the new GitHub Actions workflow (`.github/workflows/ci.yml`) that runs install/build/test and uploads the Vite dist; tags trigger a Tauri build job.
- Core package gains targeted vitest coverage for planner math, deal scoring, and Ally JSON parsing (`packages/core/src/__tests__/*`).
- Stubbed `/deals` page to keep navigation intact and added the nav link in `App.tsx`.
- Introduced console buffer helper + diagnostics bridge wiring leveraged by the Settings diagnostics exporter.

### Validation
- `pnpm -C packages/core test`
- `pnpm -C apps/web typecheck`
- `pnpm -C apps/web build`
- `pnpm -C apps/web test:e2e`
- `cargo check`
