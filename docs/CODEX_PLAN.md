# Codex Plan

## Completed
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
  - GameCover order: Steam capsule → RAWG background → IGDB cover → placeholder.
  - Library cards & Editor surface RAWG genres/stores; Settings documents HLTB/OC/RAWG precedence.

## Next
1. **HLTB live fallback refresh** - Owner: Desktop team - Target: 2025-03-05
   - Restore token discovery + payload updates for `hltb_search`; fall back to HTML scrape when API unavailable.
   - Runner uses vendor (Dexie) → live desktop → RAWG playtime sequence; log `ttbSource` "rawg" in cache.
   - Manual QA: three sample titles succeed across vendor/live; retries honour throttle/backoff.
2. **RAWG gallery & media card** - Owner: Web - Target: 2025-03-08
   - Library editor/right drawer show RAWG screenshots & trailers (lazy-loaded, cached in Dexie).
   - Hover/tap reveals store logos sourced from RAWG detail with fallbacks for heuristics.
   - Ensure GameCover re-renders when new RAWG art arrives without layout shift.
3. **Data-source toggles & cache management** - Owner: Web/Desktop - Target: 2025-03-12
   - Settings exposes switches for HLTB (desktop live) and RAWG lookups, plus "Clear RAWG cache"/"Clear MC index".
   - Turning off vendor disables buttons/tooltips gracefully; clearing cache purges Dexie rows + HUD references.
   - Regression: enrichment runner respects toggles; vendor fetches stop until re-enabled.
