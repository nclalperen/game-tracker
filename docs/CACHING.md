# Caching, TTLs, and Budgets

## RAWG Client (apps/web/src/apis/rawg.ts)
- In‑memory Map cache per bucket (search/detail/screenshots/movies/list/suggested)
- Default TTL: 30 minutes
- List TTL: 1 hour
- Suggested TTL: 7 days
- Rate budget: 1 request/second (queued)

## Detail Caching (Dexie)
- rawgGames detail TTL: ~30 days (refreshed on use)
- Media TTL (screenshots/movies): ~7 days
- In‑memory LRU: most‑recent 20 details for 5 minutes (avoid Dexie round‑trips while browsing)

## Enrichment Runner (apps/web/src/state/enrichmentRunner.ts)
Pipeline priority:
- Price: Steam cached → Steam live
- TTB: HLTB local → HLTB live (desktop) → RAWG average
- Scores: Metacritic vendor → OpenCritic

Budgets between attempts:
- Steam: 600 ms
- HLTB: 900 ms
- OpenCritic: 900 ms

Fallback queue:
- Rows that miss vendor sources are re‑queued to the end for fallbacks (keeps fast rows first)

## Vendor Flags
- RAWG/HLTB/Metacritic can be toggled in Settings (persisted in Dexie + localStorage)

