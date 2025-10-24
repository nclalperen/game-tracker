#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
use commands::{get_opencritic_score, get_steam_price_try, hltb_clear_cache, hltb_search, opencritic_clear_cache};

fn main() {
  // Load env from .env.local first (if present), then .env
  let _ = dotenvy::from_filename(".env.local");
  let _ = dotenvy::dotenv();
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      hltb_search,
      hltb_clear_cache,
      get_steam_price_try,
      get_opencritic_score,
      opencritic_clear_cache
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
