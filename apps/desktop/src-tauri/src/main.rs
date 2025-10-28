#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod ally;
mod steam;
mod local_llm;
use commands::{
  get_opencritic_score, get_steam_price_try, hltb_clear_cache, hltb_search, steam_get_app_details, steam_get_applist,
  steam_get_current_players, steam_get_news, steam_get_owned_games, steam_get_player_achievements, steam_get_price,
  steam_get_profile, steam_get_recently_played, steam_get_schema_for_game, steam_resolve_vanity, steam_scan_manifests,
};

fn main() {
  #[cfg(debug_assertions)]
  {
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::from_filename("../.env.local");
  }

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      hltb_search,
      hltb_clear_cache,
      get_steam_price_try,
      get_opencritic_score,
      steam_resolve_vanity,
      steam_get_profile,
      steam_get_owned_games,
      steam_get_recently_played,
      steam_get_app_details,
      steam_get_price,
      steam_get_news,
      steam_get_current_players,
      steam_get_player_achievements,
      steam_get_schema_for_game,
      steam_get_applist,
      steam_scan_manifests,
      commands::ally_version_cmd,
      commands::ally_get_data_dir,
      commands::ally_write_export,
      commands::ally_embed_cmd,
      commands::ally_start_rag_cmd,
      commands::ally_chat_cmd,
      commands::local_llm_chat_cmd,
      commands::local_llm_embed_cmd,
      commands::local_llm_detect_cmd,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}




