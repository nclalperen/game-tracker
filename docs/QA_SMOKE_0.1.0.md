# QA Smoke Report — Game Tracker 0.1.0

| Area | Scenario | Result |
| --- | --- | --- |
| **Sessions (Windows)** | Launch desktop app, focus Notepad → wait 6s → switch to Explorer | ✅ `session_started` + `session_stopped` events logged; Now Playing updated |
|  | Disable Sessions toggle in Settings → focus other window | ✅ Loop stops, Now Playing cleared |
| **Wishlist** | Sync with public profile (no API key) | ✅ Items + prices imported; HUD progress visible |
|  | Private wishlist | ✅ Error banner: “Steam reports that the wishlist is private…” |
|  | Logged-out / sign-in page | ✅ Error banner: “Steam returned a sign-in page…” |
| **Deals** | Ensure owned titles hidden by default | ✅ In-library games filtered out |
|  | Toggle wishlist add/remove | ✅ Adds/removes row immediately; pending state prevents double taps |
| **Suggestions** | Strict JSON ON, Ask AI (Coach preset) | ✅ Parsed list with reasons (no fallback) |
|  | Strict JSON OFF → non-JSON reply | ✅ Auto-retry triggered, parsed list |
|  | Ally single-object reply | ✅ Converted example + heuristic top-up |
| **Dark Mode** | Toggle Night/Day | ✅ Theme applied across Library/Deals/Suggestions |
| **Desktop bundle** | Install MSI on clean Win11 VM | ✅ Installs & runs; Ally binaries present |
|  | Updater check (simulated 404) | ✅ Graceful failure, no crash |

Tests executed on Windows 11 23H2 (x64).

