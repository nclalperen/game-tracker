# Architecture Overview

```
┌──────────────────┐        HTTP (keyed)        ┌─────────────┐
│  Web (React/Vite)├───────────────────────────►│    RAWG     │
│  apps/web        │                            └─────────────┘
│  Dexie (IndexedDB)◄───────┐
└──────────┬─────────┘       │   in-memory LRU
           │                 │
           │                 ▼
           │         Cache / TTL (search/detail/screenshots/movies)
           │
           ▼
┌──────────────────┐  IPC (Tauri)   ┌─────────────────────────────────────┐
│ Desktop (Tauri)  ├───────────────►│ Steam / HLTB / OpenCritic Bridges   │
│ apps/desktop     │                └─────────────────────────────────────┘
│ Rust commands    │                Steam Web API (prices/news/profile)
└──────────────────┘
```

## Data Flow (high level)
- Cards render from Dexie; inline details lazy‑fetch RAWG (1 req/s budget) and cache results.
- Enrichment runner (desktop‑aware) prioritizes vendor sources, then falls back.
- Settings toggles vendors; Dexie stores preferences and partial results.

See `docs/CACHING.md` for TTLs and budgets.

