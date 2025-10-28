use chrono::Utc;
use once_cell::sync::Lazy;
use reqwest::blocking::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{
  collections::HashMap,
  env,
  fs::{self, File},
  io::{BufReader, BufWriter},
  path::{PathBuf},
  sync::Mutex,
  thread::sleep,
  time::{Duration, Instant},
};
use thiserror::Error;

const USER_AGENT: &str = "GameTracker/Steam (+https://tracker.local)";
const API_HOST: &str = "api.steampowered.com";
const STORE_HOST: &str = "store.steampowered.com";

const TTL_PROFILE: Duration = Duration::from_secs(24 * 60 * 60);
const TTL_OWNED: Duration = Duration::from_secs(24 * 60 * 60);
const TTL_APPLIST: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const TTL_APPDETAILS: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const TTL_PRICE: Duration = Duration::from_secs(3 * 24 * 60 * 60);
const TTL_NEWS: Duration = Duration::from_secs(6 * 60 * 60);
const TTL_ACHIEVEMENTS: Duration = Duration::from_secs(24 * 60 * 60);
const TTL_SCHEMA: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const TTL_PLAYER_COUNT: Duration = Duration::from_secs(10 * 60);
const TTL_RECENT: Duration = Duration::from_secs(6 * 60 * 60);

static CLIENT: Lazy<Client> = Lazy::new(|| {
  Client::builder()
    .user_agent(USER_AGENT)
    .timeout(Duration::from_secs(20))
    .connect_timeout(Duration::from_secs(10))
    .build()
    .expect("failed to build Steam client")
});

static LAST_REQUEST: Lazy<Mutex<HashMap<&'static str, Instant>>> =
  Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Error)]
pub enum SteamError {
  #[error("STEAM_WEB_API_KEY is not configured")]
  MissingApiKey,
  #[error("HTTP error: {0}")]
  Http(String),
  #[error("Unexpected response: {0}")]
  Response(String),
  #[error("Cache error: {0}")]
  Cache(String),
  #[error("IO error: {0}")]
  Io(String),
  #[error("Parse error: {0}")]
  Parse(String),
}

impl From<reqwest::Error> for SteamError {
  fn from(err: reqwest::Error) -> Self {
    SteamError::Http(err.to_string())
  }
}

impl From<std::io::Error> for SteamError {
  fn from(err: std::io::Error) -> Self {
    SteamError::Io(err.to_string())
  }
}

type SteamResult<T> = Result<T, SteamError>;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SteamProfile {
  pub steamid: String,
  pub personaname: String,
  pub avatarfull: Option<String>,
  pub profileurl: Option<String>,
  pub loccountrycode: Option<String>,
  pub gameid: Option<String>,
  pub gameextrainfo: Option<String>,
  pub personastate: Option<i32>,
  pub communityvisibilitystate: Option<i32>,
  pub profilestate: Option<i32>,
  pub lastlogoff: Option<u64>,
  pub primaryclanid: Option<String>,
  pub timecreated: Option<u64>,
  pub last_fetched_iso: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OwnedGame {
  pub appid: u32,
  pub name: String,
  pub playtime_forever_min: u32,
  pub playtime_2weeks_min: Option<u32>,
  pub rtime_last_played: Option<u64>,
  pub has_visible_stats: bool,
  pub img_icon_url: Option<String>,
  pub img_logo_url: Option<String>,
  pub playtime_windows_forever_min: Option<u32>,
  pub playtime_mac_forever_min: Option<u32>,
  pub playtime_linux_forever_min: Option<u32>,
  pub content_descriptorids: Option<Vec<u32>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentGame {
  pub appid: u32,
  pub name: String,
  pub playtime_2weeks_min: Option<u32>,
  pub playtime_forever_min: Option<u32>,
  pub last_played: Option<u64>,
  pub img_icon_url: Option<String>,
  pub img_logo_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Price {
  pub appid: u32,
  pub currency: String,
  pub initial: i32,
  pub final_: i32,
  pub discount_percent: i32,
  pub last_fetched_iso: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PcRequirements {
  pub minimum: Option<String>,
  pub recommended: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppDetails {
  pub appid: u32,
  pub name: String,
  pub is_free: bool,
  pub header_image: Option<String>,
  pub capsule_image: Option<String>,
  pub background: Option<String>,
  pub short_description: Option<String>,
  pub genres: Vec<String>,
  pub categories: Vec<String>,
  pub release_date: Option<String>,
  pub controller_support: Option<String>,
  pub pc_requirements: Option<PcRequirements>,
  pub last_fetched_iso: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NewsItem {
  pub gid: String,
  pub title: String,
  pub url: String,
  pub author: Option<String>,
  pub contents: Option<String>,
  pub date: u64,
  pub feedlabel: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlayerAchievementItem {
  pub api_name: String,
  pub achieved: bool,
  pub unlock_time: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlayerAchievements {
  pub steamid: String,
  pub appid: u32,
  pub unlocked: u32,
  pub total: u32,
  pub items: Vec<PlayerAchievementItem>,
  pub last_fetched_iso: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SchemaAchievement {
  pub api_name: String,
  pub display_name: String,
  pub description: Option<String>,
  pub icon: Option<String>,
  pub icongray: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AchievementSchema {
  pub appid: u32,
  pub items: Vec<SchemaAchievement>,
  pub last_fetched_iso: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppIdName {
  pub appid: u32,
  pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstallInfo {
  pub appid: u32,
  pub name: Option<String>,
  pub installdir: Option<String>,
  pub install_path: Option<String>,
  pub size_on_disk: Option<u64>,
  pub last_updated: Option<u64>,
  pub manifest_path: Option<String>,
}

fn steam_api_key() -> SteamResult<String> {
  env::var("STEAM_WEB_API_KEY").map_err(|_| SteamError::MissingApiKey)
}

fn steam_cc() -> String {
  env::var("STEAM_REGION_CC").unwrap_or_else(|_| "us".to_string())
}

fn steam_lang() -> String {
  env::var("STEAM_LANG").unwrap_or_else(|_| "en".to_string())
}

fn iso_now() -> String {
  Utc::now().to_rfc3339()
}

fn data_root() -> SteamResult<PathBuf> {
  let mut dir = dirs::data_dir().ok_or_else(|| SteamError::Cache("Unable to determine data directory".into()))?;
  dir.push("GameTracker");
  fs::create_dir_all(&dir)?;
  Ok(dir)
}

fn cache_path(name: &str) -> SteamResult<PathBuf> {
  let mut path = data_root()?;
  path.push(name);
  Ok(path)
}

fn read_cache<T: DeserializeOwned>(name: &str, ttl: Duration) -> SteamResult<Option<T>> {
  let path = cache_path(name)?;
  if !path.exists() {
    return Ok(None);
  }
  if let Ok(meta) = fs::metadata(&path) {
    if let Ok(modified) = meta.modified() {
      if modified.elapsed().unwrap_or_default() > ttl {
        let _ = fs::remove_file(&path);
        return Ok(None);
      }
    }
  }
  let reader = BufReader::new(File::open(&path)?);
  let value = serde_json::from_reader(reader).map_err(|e| SteamError::Parse(e.to_string()))?;
  Ok(Some(value))
}

fn write_cache<T: Serialize>(name: &str, value: &T) -> SteamResult<()> {
  let path = cache_path(name)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  let writer = BufWriter::new(File::create(path)?);
  serde_json::to_writer_pretty(writer, value).map_err(|e| SteamError::Cache(e.to_string()))
}

fn throttle(domain: &'static str) {
  let mut guard = LAST_REQUEST.lock().expect("lock poisoned");
  if let Some(last) = guard.get(domain) {
    let elapsed = last.elapsed();
    if elapsed < Duration::from_secs(1) {
      sleep(Duration::from_secs(1) - elapsed);
    }
  }
  guard.insert(domain, Instant::now());
}

fn api_get<T: DeserializeOwned>(path: &str, query: &[(&str, String)]) -> SteamResult<T> {
  throttle(API_HOST);
  let response = CLIENT
    .get(format!("https://{API_HOST}/{path}"))
    .query(query)
    .send()?
    .error_for_status()?;
  response.json().map_err(|e| SteamError::Parse(e.to_string()))
}

fn store_get(path: &str, query: &[(&str, String)]) -> SteamResult<Value> {
  throttle(STORE_HOST);
  let response = CLIENT
    .get(format!("https://{STORE_HOST}/{path}"))
    .query(query)
    .send()?
    .error_for_status()?;
  response.json().map_err(|e| SteamError::Parse(e.to_string()))
}

pub fn resolve_vanity(vanity: &str) -> SteamResult<String> {
  #[derive(Deserialize)]
  struct VanityResp {
    response: VanityInner,
  }
  #[derive(Deserialize)]
  struct VanityInner {
    success: i32,
    steamid: Option<String>,
    message: Option<String>,
  }

  let key = steam_api_key()?;
  let resp: VanityResp = api_get(
    "ISteamUser/ResolveVanityURL/v1/",
    &[("key", key), ("vanityurl", vanity.to_string())],
  )?;

  if resp.response.success == 1 {
    resp
      .response
      .steamid
      .ok_or_else(|| SteamError::Response("SteamID missing in response".into()))
  } else {
    Err(SteamError::Response(
      resp
        .response
        .message
        .unwrap_or_else(|| "Failed to resolve vanity URL".into()),
    ))
  }
}

pub fn get_profile(steamid: &str) -> SteamResult<SteamProfile> {
  let cache_name = format!("steam_profile_{steamid}.json");
  if let Some(profile) = read_cache(&cache_name, TTL_PROFILE)? {
    return Ok(profile);
  }

  #[derive(Deserialize)]
  struct PlayersResp {
    response: PlayersInner,
  }
  #[derive(Deserialize)]
  struct PlayersInner {
    players: Vec<Player>,
  }
  #[derive(Deserialize)]
  struct Player {
    steamid: String,
    personaname: String,
    avatarfull: Option<String>,
    profileurl: Option<String>,
    loccountrycode: Option<String>,
    gameid: Option<String>,
    gameextrainfo: Option<String>,
    personastate: Option<i32>,
    communityvisibilitystate: Option<i32>,
    profilestate: Option<i32>,
    lastlogoff: Option<u64>,
    primaryclanid: Option<String>,
    timecreated: Option<u64>,
  }

  let key = steam_api_key()?;
  let resp: PlayersResp = api_get(
    "ISteamUser/GetPlayerSummaries/v2/",
    &[("key", key), ("steamids", steamid.to_string())],
  )?;
  let player = resp
    .response
    .players
    .into_iter()
    .next()
    .ok_or_else(|| SteamError::Response("Player not found".into()))?;

  let profile = SteamProfile {
    steamid: player.steamid,
    personaname: player.personaname,
    avatarfull: player.avatarfull,
    profileurl: player.profileurl,
    loccountrycode: player.loccountrycode,
    gameid: player.gameid,
    gameextrainfo: player.gameextrainfo,
    personastate: player.personastate,
    communityvisibilitystate: player.communityvisibilitystate,
    profilestate: player.profilestate,
    lastlogoff: player.lastlogoff,
    primaryclanid: player.primaryclanid,
    timecreated: player.timecreated,
    last_fetched_iso: iso_now(),
  };
  write_cache(&cache_name, &profile)?;
  Ok(profile)
}

pub fn get_owned_games(steamid: &str, include_free: bool) -> SteamResult<Vec<OwnedGame>> {
  let cache_name = format!("steam_owned_{steamid}_{include_free}.json");
  if let Some(games) = read_cache(&cache_name, TTL_OWNED)? {
    return Ok(games);
  }

  #[derive(Deserialize)]
  struct OwnedResp {
    response: OwnedInner,
  }
  #[derive(Deserialize)]
  struct OwnedInner {
    games: Option<Vec<OwnedGameRaw>>,
  }
  #[derive(Deserialize)]
  struct OwnedGameRaw {
    appid: u32,
    name: Option<String>,
    playtime_forever: Option<u32>,
    playtime_2weeks: Option<u32>,
    rtime_last_played: Option<u64>,
    has_community_visible_stats: Option<bool>,
    img_icon_url: Option<String>,
    img_logo_url: Option<String>,
    playtime_windows_forever: Option<u32>,
    playtime_mac_forever: Option<u32>,
    playtime_linux_forever: Option<u32>,
    content_descriptorids: Option<Vec<u32>>,
  }

  let key = steam_api_key()?;
  let resp: OwnedResp = api_get(
    "IPlayerService/GetOwnedGames/v1/",
    &[
      ("key", key),
      ("steamid", steamid.to_string()),
      ("include_appinfo", "1".to_string()),
      (
        "include_played_free_games",
        if include_free { "1" } else { "0" }.to_string(),
      ),
    ],
  )?;

  let games = resp
    .response
    .games
    .unwrap_or_default()
    .into_iter()
    .map(|g| OwnedGame {
      appid: g.appid,
      name: g.name.unwrap_or_else(|| "Unknown App".into()),
      playtime_forever_min: g.playtime_forever.unwrap_or(0),
      playtime_2weeks_min: g.playtime_2weeks,
      rtime_last_played: g.rtime_last_played,
      has_visible_stats: g.has_community_visible_stats.unwrap_or(false),
      img_icon_url: g.img_icon_url,
      img_logo_url: g.img_logo_url,
      playtime_windows_forever_min: g.playtime_windows_forever,
      playtime_mac_forever_min: g.playtime_mac_forever,
      playtime_linux_forever_min: g.playtime_linux_forever,
      content_descriptorids: g.content_descriptorids,
    })
    .collect::<Vec<_>>();

  write_cache(&cache_name, &games)?;
  Ok(games)
}

#[derive(Deserialize)]
struct CurrentPlayersResp {
  response: CurrentPlayersInner,
}
#[derive(Deserialize)]
struct CurrentPlayersInner {
  player_count: Option<u32>,
  result: Option<i32>,
}

pub fn get_current_players(appid: u32) -> SteamResult<Option<u32>> {
  let cache_name = format!("steam_playercount_{appid}.json");
  if let Some(count) = read_cache(&cache_name, TTL_PLAYER_COUNT)? {
    return Ok(count);
  }

  let resp: CurrentPlayersResp = api_get(
    "ISteamUserStats/GetNumberOfCurrentPlayers/v1/",
    &[("appid", appid.to_string())],
  )?;

  let count = resp.response.player_count.filter(|_| resp.response.result == Some(1));
  write_cache(&cache_name, &count)?;
  Ok(count)
}

#[derive(Deserialize)]
struct RecentResp {
  response: RecentInner,
}
#[derive(Deserialize)]
struct RecentInner {
  games: Option<Vec<RecentGameRaw>>,
}
#[derive(Deserialize)]
struct RecentGameRaw {
  appid: u32,
  name: Option<String>,
  playtime_2weeks: Option<u32>,
  playtime_forever: Option<u32>,
  rtime_last_played: Option<u64>,
  img_icon_url: Option<String>,
  img_logo_url: Option<String>,
}

pub fn get_recently_played_games(steamid: &str) -> SteamResult<Vec<RecentGame>> {
  let cache_name = format!("steam_recent_{steamid}.json");
  if let Some(games) = read_cache(&cache_name, TTL_RECENT)? {
    return Ok(games);
  }

  let key = steam_api_key()?;
  let resp: RecentResp = api_get(
    "IPlayerService/GetRecentlyPlayedGames/v1/",
    &[("key", key), ("steamid", steamid.to_string())],
  )?;

  let games = resp
    .response
    .games
    .unwrap_or_default()
    .into_iter()
    .map(|game| RecentGame {
      appid: game.appid,
      name: game.name.unwrap_or_else(|| "Unknown App".into()),
      playtime_2weeks_min: game.playtime_2weeks,
      playtime_forever_min: game.playtime_forever,
      last_played: game.rtime_last_played,
      img_icon_url: game.img_icon_url,
      img_logo_url: game.img_logo_url,
    })
    .collect::<Vec<_>>();

  write_cache(&cache_name, &games)?;
  Ok(games)
}

fn parse_store_payload(appid: u32, cc: &str, lang: &str) -> SteamResult<(Option<AppDetails>, Option<Price>)> {
  let payload = store_get(
    "api/appdetails",
    &[
      ("appids", appid.to_string()),
      ("cc", cc.to_string()),
      ("l", lang.to_string()),
    ],
  )?;

  let entry = payload
    .get(appid.to_string())
    .ok_or_else(|| SteamError::Response("App not present in store response".into()))?;
  if !entry
    .get("success")
    .and_then(|v| v.as_bool())
    .unwrap_or(false)
  {
    return Ok((None, None));
  }
  let data = entry
    .get("data")
    .and_then(|v| v.as_object())
    .ok_or_else(|| SteamError::Response("Store data missing".into()))?;

  let iso = iso_now();
  let genres = data
    .get("genres")
    .and_then(|v| v.as_array())
    .map(|arr| {
      arr
        .iter()
        .filter_map(|g| g.get("description").and_then(|d| d.as_str()).map(|s| s.to_string()))
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();

  let categories = data
    .get("categories")
    .and_then(|v| v.as_array())
    .map(|arr| {
      arr
        .iter()
        .filter_map(|g| g.get("description").and_then(|d| d.as_str()).map(|s| s.to_string()))
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();

  let pc_requirements = data
    .get("pc_requirements")
    .and_then(|v| v.as_object())
    .map(|req| PcRequirements {
      minimum: req.get("minimum").and_then(|v| v.as_str()).map(|s| s.to_string()),
      recommended: req.get("recommended").and_then(|v| v.as_str()).map(|s| s.to_string()),
    });

  let details = AppDetails {
    appid,
    name: data
      .get("name")
      .and_then(|v| v.as_str())
      .unwrap_or("Unknown App")
      .to_string(),
    is_free: data.get("is_free").and_then(|v| v.as_bool()).unwrap_or(false),
    header_image: data.get("header_image").and_then(|v| v.as_str()).map(|s| s.to_string()),
    capsule_image: data.get("capsule_image").and_then(|v| v.as_str()).map(|s| s.to_string()),
    background: data.get("background").and_then(|v| v.as_str()).map(|s| s.to_string()),
    short_description: data
      .get("short_description")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string()),
    genres,
    categories,
    release_date: data
      .get("release_date")
      .and_then(|v| v.get("date"))
      .and_then(|v| v.as_str())
      .map(|s| s.to_string()),
    controller_support: data
      .get("controller_support")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string()),
    pc_requirements,
    last_fetched_iso: iso.clone(),
  };

  let price = data.get("price_overview").and_then(|po| {
    Some(Price {
      appid,
      currency: po.get("currency")?.as_str()?.to_string(),
      initial: po.get("initial")?.as_i64()? as i32,
      final_: po.get("final")?.as_i64()? as i32,
      discount_percent: po.get("discount_percent")?.as_i64()? as i32,
      last_fetched_iso: iso,
    })
  });

  Ok((Some(details), price))
}

pub fn get_app_details(appid: u32) -> SteamResult<Option<AppDetails>> {
  let cc = steam_cc();
  let lang = steam_lang();
  let cache_name = format!("steam_app_{appid}_{cc}_{lang}.json");
  if let Some(details) = read_cache(&cache_name, TTL_APPDETAILS)? {
    return Ok(Some(details));
  }

  let (details, price) = parse_store_payload(appid, &cc, &lang)?;
  if let Some(details) = &details {
    write_cache(&cache_name, details)?;
  }
  if let Some(price) = price {
    let price_cache = format!("steam_price_{appid}_{cc}_{lang}.json");
    let _ = write_cache(&price_cache, &price);
  }
  Ok(details)
}

pub fn get_price(appid: u32) -> SteamResult<Option<Price>> {
  let cc = steam_cc();
  let lang = steam_lang();
  let cache_name = format!("steam_price_{appid}_{cc}_{lang}.json");
  if let Some(price) = read_cache(&cache_name, TTL_PRICE)? {
    return Ok(Some(price));
  }
  let (_, price) = parse_store_payload(appid, &cc, &lang)?;
  if let Some(price) = &price {
    write_cache(&cache_name, price)?;
  }
  Ok(price)
}

pub fn get_news(appid: u32, count: u8) -> SteamResult<Vec<NewsItem>> {
  let lang = steam_lang();
  let cache_name = format!("steam_news_{appid}_{lang}_{count}.json");
  if let Some(items) = read_cache(&cache_name, TTL_NEWS)? {
    return Ok(items);
  }

  #[derive(Deserialize)]
  struct NewsResp {
    appnews: AppNews,
  }
  #[derive(Deserialize)]
  struct AppNews {
    newsitems: Vec<NewsRaw>,
  }
  #[derive(Deserialize)]
  struct NewsRaw {
    gid: String,
    title: String,
    url: String,
    author: Option<String>,
    contents: Option<String>,
    feedlabel: Option<String>,
    date: u64,
  }

  let resp: NewsResp = api_get(
    "ISteamNews/GetNewsForApp/v2/",
    &[
      ("appid", appid.to_string()),
      ("count", count.to_string()),
      ("maxlength", "300".to_string()),
      ("feeds", "steam_community_announcements".to_string()),
      ("l", lang),
    ],
  )?;

  let news = resp
    .appnews
    .newsitems
    .into_iter()
    .map(|item| NewsItem {
      gid: item.gid,
      title: item.title,
      url: item.url,
      author: item.author,
      contents: item.contents,
      feedlabel: item.feedlabel,
      date: item.date,
    })
    .collect::<Vec<_>>();
  write_cache(&cache_name, &news)?;
  Ok(news)
}

pub fn get_player_achievements(steamid: &str, appid: u32) -> SteamResult<Option<PlayerAchievements>> {
  let cache_name = format!("steam_ach_{steamid}_{appid}.json");
  if let Some(ach) = read_cache(&cache_name, TTL_ACHIEVEMENTS)? {
    return Ok(Some(ach));
  }

  #[derive(Deserialize)]
  struct AchResp {
    playerstats: PlayerStatsRaw,
  }
  #[derive(Deserialize)]
  struct PlayerStatsRaw {
    #[serde(rename = "steamID")]
    steam_id: Option<String>,
    success: Option<bool>,
    achievements: Option<Vec<AchievementRaw>>,
    error: Option<String>,
  }
  #[derive(Deserialize)]
  struct AchievementRaw {
    #[serde(rename = "apiname")]
    api_name: String,
    achieved: i32,
    #[serde(rename = "unlocktime")]
    unlock_time: Option<u64>,
  }

  let key = steam_api_key()?;
  let resp: AchResp = api_get(
    "ISteamUserStats/GetPlayerAchievements/v1/",
    &[
      ("key", key),
      ("steamid", steamid.to_string()),
      ("appid", appid.to_string()),
    ],
  )?;

  let stats = resp.playerstats;
  if !stats.success.unwrap_or(false) {
    return Ok(None);
  }
  let achievements = match stats.achievements {
    Some(list) => list,
    None => return Ok(None),
  };

  let unlocked = achievements.iter().filter(|a| a.achieved == 1).count() as u32;
  let total = achievements.len() as u32;
  let items = achievements
    .into_iter()
    .map(|item| PlayerAchievementItem {
      api_name: item.api_name,
      achieved: item.achieved == 1,
      unlock_time: item.unlock_time,
    })
    .collect::<Vec<_>>();

  let result = PlayerAchievements {
    steamid: stats.steam_id.unwrap_or_else(|| steamid.to_string()),
    appid,
    unlocked,
    total,
    items,
    last_fetched_iso: iso_now(),
  };
  write_cache(&cache_name, &result)?;
  Ok(Some(result))
}

pub fn get_schema_for_game(appid: u32) -> SteamResult<Option<AchievementSchema>> {
  let cache_name = format!("steam_schema_{appid}.json");
  if let Some(schema) = read_cache(&cache_name, TTL_SCHEMA)? {
    return Ok(Some(schema));
  }

  #[derive(Deserialize)]
  struct SchemaResp {
    game: Option<GameRaw>,
  }
  #[derive(Deserialize)]
  struct GameRaw {
    availablegamestats: Option<GameStats>,
  }
  #[derive(Deserialize)]
  struct GameStats {
    achievements: Option<Vec<SchemaRaw>>,
  }
  #[derive(Deserialize)]
  struct SchemaRaw {
    #[serde(rename = "name")]
    api_name: String,
    #[serde(rename = "displayName")]
    display_name: String,
    description: Option<String>,
    icon: Option<String>,
    icongray: Option<String>,
  }

  let resp: SchemaResp = api_get(
    "ISteamUserStats/GetSchemaForGame/v2/",
    &[("appid", appid.to_string())],
  )?;
  let stats = match resp.game.and_then(|g| g.availablegamestats) {
    Some(stats) => stats,
    None => return Ok(None),
  };
  let achievements = match stats.achievements {
    Some(items) => items,
    None => return Ok(None),
  };

  let mapped = achievements
    .into_iter()
    .map(|item| SchemaAchievement {
      api_name: item.api_name,
      display_name: item.display_name,
      description: item.description,
      icon: item.icon,
      icongray: item.icongray,
    })
    .collect::<Vec<_>>();

  let schema = AchievementSchema {
    appid,
    items: mapped,
    last_fetched_iso: iso_now(),
  };
  write_cache(&cache_name, &schema)?;
  Ok(Some(schema))
}

pub fn get_applist() -> SteamResult<Vec<AppIdName>> {
  let cache_name = "steam_applist.json";
  if let Some(list) = read_cache(cache_name, TTL_APPLIST)? {
    return Ok(list);
  }

  #[derive(Deserialize)]
  struct AppListResp {
    applist: AppWrapper,
  }
  #[derive(Deserialize)]
  struct AppWrapper {
    apps: Vec<AppRaw>,
  }
  #[derive(Deserialize)]
  struct AppRaw {
    appid: u32,
    name: String,
  }

  let resp: AppListResp = api_get("ISteamApps/GetAppList/v2/", &[])?;
  let list = resp
    .applist
    .apps
    .into_iter()
    .map(|app| AppIdName {
      appid: app.appid,
      name: app.name,
    })
    .collect::<Vec<_>>();
  write_cache(cache_name, &list)?;
  Ok(list)
}

fn steam_root_candidates() -> Vec<PathBuf> {
  let mut roots = Vec::new();
  if let Ok(path) = env::var("STEAM_INSTALL_PATH") {
    roots.push(PathBuf::from(path));
  }
  if cfg!(target_os = "windows") {
    if let Ok(program_files) = env::var("PROGRAMFILES(X86)") {
      roots.push(PathBuf::from(program_files).join("Steam"));
    }
    if let Ok(program_files) = env::var("PROGRAMFILES") {
      roots.push(PathBuf::from(program_files).join("Steam"));
    }
  } else if let Some(home) = dirs::home_dir() {
    roots.push(home.join(".local/share/Steam"));
    roots.push(home.join(".steam/steam"));
  }
  roots
}

fn library_folders() -> SteamResult<Vec<PathBuf>> {
  for root in steam_root_candidates() {
    let library_file = root.join("steamapps/libraryfolders.vdf");
    if !library_file.exists() {
      continue;
    }
    let content = fs::read_to_string(&library_file)?;
    let v: Value = vdf_serde::from_str(&content).map_err(|e| SteamError::Parse(e.to_string()))?;
    if let Some(obj) = v.get("libraryfolders").and_then(|v| v.as_object()) {
      let mut paths = Vec::new();
      for value in obj.values() {
        if let Some(path) = value.get("path").and_then(|p| p.as_str()) {
          paths.push(PathBuf::from(path));
        } else if let Some(path) = value.as_str() {
          paths.push(PathBuf::from(path));
        }
      }
      if paths.is_empty() && root.exists() {
        paths.push(root.clone());
      }
      if !paths.is_empty() {
        return Ok(paths);
      }
    }
  }
  Ok(Vec::new())
}

pub fn scan_manifests() -> SteamResult<Vec<InstallInfo>> {
  let mut installs = Vec::new();
  for lib in library_folders()? {
    let steamapps = lib.join("steamapps");
    if !steamapps.exists() {
      continue;
    }
    let entries = match fs::read_dir(&steamapps) {
      Ok(entries) => entries,
      Err(_) => continue,
    };
    for entry in entries.flatten() {
      let path = entry.path();
      let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(name) => name,
        None => continue,
      };
      if !file_name.starts_with("appmanifest_") || !file_name.ends_with(".acf") {
        continue;
      }
      let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => continue,
      };
      let v: Value = match vdf_serde::from_str(&content) {
        Ok(val) => val,
        Err(_) => continue,
      };
      let app_state = match v.get("AppState").and_then(|state| state.as_object()) {
        Some(state) => state,
        None => continue,
      };
      let appid = match app_state
        .get("appid")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u32>().ok())
      {
        Some(id) => id,
        None => continue,
      };
      let name = app_state
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
      let installdir = app_state
        .get("installdir")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
      let install_path = installdir
        .as_ref()
        .map(|dir| steamapps.join("common").join(dir).to_string_lossy().to_string());
      let size_on_disk = app_state
        .get("SizeOnDisk")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| app_state.get("SizeOnDisk").and_then(|v| v.as_u64()));
      let last_updated = app_state
        .get("LastUpdated")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| app_state.get("LastUpdated").and_then(|v| v.as_u64()));

      installs.push(InstallInfo {
        appid,
        name,
        installdir,
        install_path,
        size_on_disk,
        last_updated,
        manifest_path: Some(path.to_string_lossy().to_string()),
      });
    }
  }
  Ok(installs)
}
