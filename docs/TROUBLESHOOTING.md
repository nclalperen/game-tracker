## Troubleshooting

### RAWG key missing
- Symptom: console warns “RAWG API key (VITE_RAWG_KEY) is not configured.”
- Fix: create `apps/web/.env.local` with `VITE_RAWG_KEY=...`, restart dev server

### Steam wishlist/library empty
- Symptom: importer reports private or sign‑in required
- Fix: set Steam library/wishlist to public temporarily, or sign in via desktop bridge

### Playwright E2E timeout
- Symptom: “Timed out waiting ... from config.webServer” in CI
- Fix: run E2E locally (`pnpm -C apps/web test:e2e`) or enable tag‑only E2E in CI; ensure Vite dev server can start on port 5173

### Git LFS errors when pushing models
- Symptom: GitHub rejects >100MB files (e.g., `.gguf`)
- Fix: `git lfs install && git lfs track "*.gguf"` and rewrite history with `git lfs migrate import` per `docs/RELEASE.md`

### Tauri prerequisites
- Symptom: desktop build fails (platform toolchain missing)
- Fix: install platform deps (see `docs/RELEASE.md`), use Rust stable, ensure Node/pnpm versions match

