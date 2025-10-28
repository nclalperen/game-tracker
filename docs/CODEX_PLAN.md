# Codex Plan

## Completed
- **HLTB live fallback & Steam personal fetch (2025-03-02)**
  - Desktop HLTB search now establishes a session (cookies + CSRF token) before hitting the API and gracefully falls back to HTML scraping.
  - Reqwest cookie store enabled; Steam editor action refreshes personal playtime and invalidates drawer caches instantly.
- **RAWG explore & media upgrades (2025-03-02)**
  - Added Dexie explore cache plus an Explore page with trending/top/upcoming tabs and platform filters backed by RAWG lists.
  - Library editor shows RAWG screenshots/trailer previews; store badges now expose initials and helpful tooltips.
- **Background enrichment runner & HUD (2025-02-24)**
  - Persist enrichment sessions in Dexie `settings` table and resume in paused state after reload.
  - Minimal top-line HUD + corner controller reflects progress, pause/resume, cancel.
  - Import Wizard decoupled from runner; users can hide modal while enrichment continues.
- **OpenCritic via RapidAPI (2025-02-24)**
  - Desktop command reads `OPENCRITIC_API_KEY`/`OPENCRITIC_HOST`, hits `/game/search` and `/game/{id}`, and caches results for 7 days under `%AppData%/GameTracker/opencritic_cache.json`.
  - 429 responses respect `Retry-After` or fall back to a 700 ms + jitter sleep.
  - Web bridge and Library/Import flows round scores and persist them on `Identity`.
- **Metacritic vendor index (2025-02-25)**
  - `scripts/build-mc-index.ts` compiles `games.csv` into `metacritic.index.json` (16k entries) with normalized title/platform keys.
  - Dexie v8 stores `mcScore`; Library cards fall back to MC badge when OpenCritic missing.
  - Runner loads vendor cache after OpenCritic retries to backfill `Identity.mcScore`.
- **RAWG metadata cache (2025-02-25)**
  - `apps/web/src/apis/rawg.ts` + `rawgGames` table cache detail responses with rate budgeting.
  - GameCover priority: Steam capsule -> RAWG background -> IGDB cover -> placeholder.
  - Library cards & Editor surface RAWG genres/stores; Settings documents HLTB/OC/RAWG precedence.

## Next
1. **Data-source toggles & cache management** - Owner: Web/Desktop - Target: 2025-03-12
   - Settings exposes switches for HLTB (desktop live) and RAWG lookups, plus "Clear RAWG cache"/"Clear MC index".
   - Turning off vendor disables buttons/tooltips gracefully; clearing cache purges Dexie rows and HUD references.
   - Regression: enrichment runner respects toggles; vendor fetches stop until re-enabled.
2. **RAWG explore polish** - Owner: Web - Target: 2025-03-13
   - Add infinite scroll / paging for RAWG lists while respecting the 1 req/sec budget.
   - Surface track/wishlist toggles and persist RAWG wishlist tags back into Dexie filters.
   - Improve skeleton/error states and share request status with the new toast system.
3. **RAWG cache TTL split** - Owner: Web - Target: 2025-03-15
   - Split RAWG Dexie caches: detail 30-day TTL, screenshots 7-day, movies 7-day; expose maintenance hooks.
   - Ensure new pages respect existing request budgeting and fall back gracefully when the API key is missing.
4. **Metacritic index sharding** - Owner: Tooling - Target: 2025-03-18
   - Split `metacritic.index.json` into a-z shards when artifact exceeds 8 MB; loader resolves manifest and streams only required shard.
   - Update `metacriticIndex.ts` to detect shard layout and memoize lookups per shard key.
5. **macOS session logger spike** - Owner: Desktop - Target: 2025-03-20
   - Prototype foreground app polling via Accessibility API (`AXUIElement`) with permission prompts and failure fallbacks.
   - Share event schema with Windows logger; gated enable switch in Settings.
6. **Travel Mode profile** - Owner: Web - Target: 2025-03-22
   - Offline-friendly filters and cached assets; disable live enrichment and show status banner.
7. **Vendor toggle & cache clear UX** - Owner: Web - Target: 2025-03-24
   - Settings switches to disable vendor sources (HLTB, Metacritic, RAWG) and buttons to clear caches (RAWG Dexie tables, Metacritic index).
   - Enrichment runner responds instantly to toggles, showing warning badges when data sources disabled.
