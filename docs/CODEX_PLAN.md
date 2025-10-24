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

## Next
1. **Abortable desktop bridge calls** — Owner: Desktop team — Target: 2025-03-05
   - Tauri commands (`hltb_search`, `get_steam_price_try`, `get_opencritic_score`) accept cancellation tokens and abort promptly.
   - Web bridge forwards `AbortSignal`; runner marks row `Paused` immediately on abort.
   - Manual QA: pause mid-request stops network call; resume restarts without duplicate writes.
2. **HUD visibility toggle** — Owner: Web — Target: 2025-03-07
   - Settings page exposes “Show enrichment HUD” switch persisted via Dexie settings.
   - HUD hides instantly when disabled and reappears when enabled without reload.
   - Regression check: import enrichment still runs when HUD hidden; users can reopen wizard from Library.
3. **Cancel & reset UX polish** — Owner: Web — Target: 2025-03-10
   - “Cancel” clears queue, Dexie session, and removes HUD within one tick.
   - Wizard surfaces confirmation with summary of partially enriched rows before reset.
   - Add smoke QA checklist covering cancel?re-import flow and ensure no residual status rows remain.
4. **Cache management UI** — Owner: Desktop team — Target: 2025-03-12
   - Settings surface “Clear OpenCritic cache” next to existing HLTB reset.
   - Action removes `%AppData%/GameTracker/opencritic_cache.json` and emits toast feedback.
5. **OpenCritic disambiguation UX** — Owner: Web — Target: 2025-03-19
   - When multiple close matches return, present a picker (title + year) before committing the score.
   - Runner logs chosen `id` to cache to avoid repeated prompts; allow “use first result” as default preference.
