# Game Tracker

**Open-source desktop + web app to track your PC game library, enrich it with metadata, plan play sessions, and spot great deals.**

[![CI](https://github.com/nclalperen/game-tracker/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nclalperen/game-tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/nclalperen/game-tracker)](https://github.com/nclalperen/game-tracker/releases/latest)

| Library | Explore | Inline details |
| --- | --- | --- |
| ![Library](docs/images/library.png) | ![Explore](docs/images/explore.png) | ![Details](docs/images/details.png) |

**[Download the latest release](https://github.com/nclalperen/game-tracker/releases/latest)** for Windows, macOS, or Linux.
The Windows MSI is unsigned (open-source project) — if SmartScreen appears, choose "More info" → "Run anyway".

## Features

- **Library import** from Steam and CSV, plus robust wishlist sync with clear
  errors for private profiles and sign-in issues
- **Metadata enrichment** with strict source precedence:
  - Covers: Steam → RAWG → IGDB → placeholder
  - Time-to-beat: HLTB vendor dataset → HLTB live → RAWG average
  - Scores: Metacritic vendor index → OpenCritic → RAWG aggregated
- **Deals page** (owned titles hidden by default) and AI-powered suggestions,
  optionally backed by local LLM models — no cloud calls
- **Inline card details** that expand in place, fully keyboard accessible
- **Windows session logger**: now-playing detection and session history
- Dark mode, virtualized lists for large libraries, offline-first storage
  (IndexedDB via Dexie)

## Monorepo layout

```
apps/web        React + Vite + Dexie (IndexedDB) — the UI, also runs standalone in a browser
apps/desktop    Tauri v2 (Rust) shell for Windows/macOS/Linux + native bridges
packages/core   shared logic: CSV parsing, normalizers, scoring, types
docs/           architecture, release, QA, and troubleshooting docs
```

## Quick start

Requirements: Node 20+, pnpm 10+, Git LFS; Rust toolchain for desktop builds.

```bash
pnpm -w install                 # install workspace dependencies
pnpm -C apps/web dev            # web app dev server
pnpm -C apps/desktop tauri dev  # desktop app (Tauri)
pnpm -C apps/web build          # production web build
pnpm desktop:bundle             # desktop installers
```

### Environment & settings

- RAWG media requires a key: create `apps/web/.env.local` with
  `VITE_RAWG_KEY=...` (see the `.env.example` files). Never commit API keys.
- Steam region/language and per-vendor toggles are configurable in Settings.
- Optional local LLM models (Llama-3.2-1B-Instruct, bge-base-en-v1.5) are
  tracked via Git LFS — see [`docs/RELEASE.md`](docs/RELEASE.md).

## Testing

```bash
pnpm -w test                                        # unit tests
pnpm -C apps/web exec playwright install --with-deps
pnpm -C apps/web test:e2e                           # Playwright E2E
```

## Releases

Tagging `vX.Y.Z` builds cross-platform bundles in CI. See
[`docs/RELEASE.md`](docs/RELEASE.md) for the checklist,
[`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md) for signing guidance, and
`docs/RELEASE_NOTES_*.md` for per-version notes.

## Architecture & docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system diagram and data flow
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — near/mid/long-term plans
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — common issues
- [`docs/THIRD_PARTY.md`](docs/THIRD_PARTY.md) — third-party notices

## Third-party APIs & data

RAWG (covers/media), HowLongToBeat (local dataset + optional live lookup),
Metacritic (vendor index compiled from CSV, personal use), Steam Web API
(prices/news), and OpenCritic (scores via the desktop bridge). Each upstream
project and dataset is governed by its own license and terms — review them
before distribution or commercial use. This app is intended for personal
library management.

## Contributing & license

PRs and issues are welcome — please keep changes focused and documented
(see [`CONTRIBUTING.md`](CONTRIBUTING.md)). Licensed under [MIT](LICENSE).
