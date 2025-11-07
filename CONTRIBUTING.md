## Contributing to Game Tracker

Thanks for your interest in contributing! This document explains how to set up the repo, run builds/tests, and make effective pull requests.

### Quick Setup
- Requirements: Node 20+, pnpm 10+, Rust (for desktop), Git LFS
- Install deps: `pnpm -w install`
- Web dev: `pnpm -C apps/web dev`
- Desktop dev: `pnpm -C apps/desktop tauri dev`
- Unit tests: `pnpm -w test`
- E2E tests (local):
  - `pnpm -C apps/web exec playwright install --with-deps`
  - `pnpm -C apps/web test:e2e`

### Code Style & Commits
- TypeScript strict mode; prefer explicit types on public exports
- Keep changes focused; avoid large refactors in feature PRs
- Conventional Commits (e.g., `feat: …`, `fix(web): …`, `docs: …`)

### PR Checklist
- [ ] Builds locally (`pnpm -w build`)
- [ ] Unit tests pass (`pnpm -w test`)
- [ ] E2E (optional, run locally): `pnpm -C apps/web test:e2e`
- [ ] Updated docs when user‑visible changes occur

### Where Things Live
- `apps/web` — React + Vite frontend (Dexie, Playwright tests)
- `apps/desktop` — Tauri v2 (Rust) desktop shell
- `packages/core` — Shared modules (CSV, normalizers, scoring, types)
- `docs` — Release notes, roadmap, QA, release guide

### Security & Privacy
- Don’t commit private API keys; use `.env.local`
- Respect third‑party API terms (RAWG/HLTB/Steam/OpenCritic/Metacritic)

### Reporting Issues
- Include repro steps, logs, and platform
- For security reports, see `SECURITY.md`
