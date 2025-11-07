# Game Tracker 0.1.1 (patch)

## Highlights
- RAWG key UX: Settings shows a gentle warning when `VITE_RAWG_KEY` is not configured; missing‑key console spam reduced to a single warning.
- CI reliability: Playwright runs against `vite preview` in CI for faster, more stable E2E startup. Tauri cross‑platform release builds via GitHub Actions matrix (Windows/macOS/Linux) with uploaded artifacts.

## Changes
- web
  - Show RAWG missing‑key hint: `apps/web/src/pages/SettingsPage.tsx`
  - Suppress repeated RAWG errors: `apps/web/src/data/rawgCache.ts`
  - CI-friendly E2E server: `apps/web/playwright.config.ts` uses preview in CI
- ci/release
  - Replace single Ubuntu bundle with `tauri-apps/tauri-action` matrix: `.github/workflows/ci.yml`
  - Add LFS note to release docs for large `.gguf` model files.

## Notes
- Functionality is unchanged from 0.1.0; this release improves developer and CI ergonomics.
- Windows MSI remains unsigned (open‑source). See `docs/RELEASE.md` and `docs/CODE_SIGNING.md`.

## Upgrade
- No action required. Optionally add `apps/web/.env.local` with your RAWG key to enable online media:
  - `VITE_RAWG_KEY=YOUR_KEY`

