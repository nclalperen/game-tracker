#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
use commands::{hltb_search, hltb_clear_cache, get_steam_price_try};

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![hltb_search, hltb_clear_cache, get_steam_price_try])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
