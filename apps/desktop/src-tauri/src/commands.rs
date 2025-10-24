use regex::Regex;
use reqwest::{header, StatusCode};
use once_cell::sync::Lazy;
use deunicode::deunicode;
use strsim::jaro_winkler;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{
  collections::HashMap,
  fs,
  path::{Path, PathBuf},
  sync::OnceLock,
  thread,
  time::{Duration, SystemTime, UNIX_EPOCH},
};

const HLTB_CACHE_FILE: &str = "hltb_cache.json";
const OPENCRITIC_CACHE_FILE: &str = "opencritic_cache.json";
const HLTB_CACHE_TTL_SECS: i64 = 30 * 24 * 60 * 60;
const HLTB_NEGATIVE_TTL_SECS: i64 = 24 * 60 * 60;
const HLTB_BUILD_TTL_SECS: i64 = 24 * 60 * 60;
const HLTB_BUILD_FILE: &str = "hltb_build.json";
const OPENCRITIC_CACHE_TTL_SECS: i64 = 7 * 24 * 60 * 60;
const OPENCRITIC_MAX_RETRIES: usize = 5;
const OPENCRITIC_BACKOFF_FALLBACK_MS: u64 = 700;
const OPENCRITIC_NEGATIVE_TTL_SECS: i64 = 24 * 60 * 60; // 24h for not-found
const DEFAULT_STEAM_REGION: &str = "us";
const USER_AGENT: &str = "GameTracker/1.0 (+https://tracker.local)";
const HLTB_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36";

#[derive(Serialize)]
pub struct HLTBMeta {
  pub main_median_hours: Option<f32>,
  pub source: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct HltbCacheEntry {
  value: Option<f32>,
  ts: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct Cached {
  score: Option<f32>,
  cached_at: i64,
}

#[derive(Serialize)]
pub struct SteamPrice {
  pub price: f32,
  pub currency: String,
}

#[derive(Deserialize)]
struct SteamPriceOverview {
  #[serde(rename = "final")]
  final_price: i32,
  currency: String,
}

#[derive(Deserialize)]
struct SteamAppData {
  price_overview: Option<SteamPriceOverview>,
}

#[derive(Deserialize)]
struct SteamAppResult {
  success: bool,
  data: Option<SteamAppData>,
}

fn now_unix() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs() as i64
}

fn is_expired(ts: i64, ttl: i64) -> bool {
  now_unix().saturating_sub(ts) > ttl
}

fn data_root() -> PathBuf {
  let mut dir = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
  dir.push("GameTracker");
  let _ = fs::create_dir_all(&dir);
  dir
}

fn cache_path(name: &str) -> PathBuf {
  let mut path = data_root();
  path.push(name);
  path
}

fn data_file(name: &str) -> PathBuf {
  cache_path(name)
}

fn read_json(path: &Path) -> Value {
  if let Ok(bytes) = fs::read(path) {
    serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null)
  } else {
    Value::Null
  }
}

fn write_json(path: &Path, v: &Value) {
  if let Some(parent) = path.parent() {
    let _ = fs::create_dir_all(parent);
  }
  if let Ok(json) = serde_json::to_vec_pretty(v) {
    let _ = fs::write(path, json);
  }
}

static ACLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
  reqwest::Client::builder()
    .user_agent(HLTB_UA)
    .gzip(true)
    .build()
    .expect("hltb_client")
});

fn read_cache_map<T>(name: &str) -> HashMap<String, T>
where
  T: DeserializeOwned,
{
  let path = cache_path(name);
  if let Ok(bytes) = fs::read(path) {
    serde_json::from_slice::<HashMap<String, T>>(&bytes).unwrap_or_default()
  } else {
    HashMap::new()
  }
}

fn write_cache_map<T>(name: &str, map: &HashMap<String, T>)
where
  T: Serialize,
{
  let path = cache_path(name);
  if let Some(parent) = path.parent() {
    let _ = fs::create_dir_all(parent);
  }
  if let Ok(json) = serde_json::to_vec_pretty(map) {
    let _ = fs::write(path, json);
  }
}

fn read_cache(path: &Path) -> HashMap<String, Cached> {
  if let Ok(bytes) = fs::read(path) {
    serde_json::from_slice::<HashMap<String, Cached>>(&bytes).unwrap_or_default()
  } else {
    HashMap::new()
  }
}

fn write_cache(path: &Path, map: &HashMap<String, Cached>) {
  if let Some(parent) = path.parent() {
    let _ = fs::create_dir_all(parent);
  }
  if let Ok(json) = serde_json::to_vec_pretty(map) {
    let _ = fs::write(path, json);
  }
}

fn normalize_key(title: &str) -> String {
  let s = normalize_title(title);
  s.to_lowercase()
}

fn normalize_title(input: &str) -> String {
  let trimmed = input.trim();
  if trimmed.is_empty() {
    return String::new();
  }
  // deunicode and lower
  let mut s = deunicode(trimmed).to_lowercase();
  s = s
    .replace('\u{2122}', "")
    .replace('\u{00AE}', "")
    .replace('\u{00A9}', "");
  s = edition_paren_regex().replace_all(&s, " ").into_owned();
  s = edition_regex().replace_all(&s, " ").into_owned();
  s = year_regex().replace_all(&s, " ").into_owned();
  // collapse punctuation and brackets/quotes
  s = s.replace(":", " ");
  s = s.replace(";", " ");
  s = s.replace(",", " ");
  s = s.replace(".", " ");
  s = s.replace("\u{2014}", " "); // em dash —
  s = s.replace("\u{2013}", " "); // en dash –
  for ch in ['[', ']', '(', ')', '"', '\''] { s = s.replace(ch, " "); }
  s = whitespace_regex().replace_all(&s, " ").into_owned();
  s.trim().to_string()
}

fn edition_regex() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| {
    Regex::new(
      r"(?i)\\b(?:game of the year|goty|complete|definitive|ultimate|enhanced|deluxe|anniversary|royal|collection|remastered|remake)\\b(?:\\s+edition|\\s+collection)?",
    )
    .unwrap()
  })
}

fn edition_paren_regex() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r"(?i)\(([^)]*(edition|remaster|remake|collection)[^)]*)\)").unwrap())
}

fn year_regex() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r"\\b(19|20)\\d{2}\\b").unwrap())
}

fn whitespace_regex() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r"\\s+").unwrap())
}

fn retry_after_duration(headers: &header::HeaderMap) -> Duration {
  if let Some(value) = headers.get(header::RETRY_AFTER) {
    if let Ok(text) = value.to_str() {
      if let Ok(secs) = text.parse::<u64>() {
        return Duration::from_secs(secs.max(1));
      }
    }
  }
  fallback_backoff()
}

fn fallback_backoff() -> Duration {
  let millis = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .subsec_millis() as u64;
  let jitter = millis % 300;
  Duration::from_millis(OPENCRITIC_BACKOFF_FALLBACK_MS + jitter)
}

fn clear_cache_file(name: &str) -> Result<(), String> {
  let path = cache_path(name);
  if path.exists() {
    fs::remove_file(path).map_err(|e| e.to_string())?;
  }
  Ok(())
}

async fn hltb_fetch_build_id() -> Result<String, String> {
  let debug_h = std::env::var("DEBUG_HLTB").ok().as_deref() == Some("1");
  let path = data_file(HLTB_BUILD_FILE);
  if path.exists() {
    let v = read_json(&path);
    if let (Some(build), Some(ts)) = (v.get("build_id").and_then(|x| x.as_str()), v.get("ts").and_then(|x| x.as_i64())) {
      if !is_expired(ts, HLTB_BUILD_TTL_SECS) {
        if debug_h { eprintln!("DEBUG_HLTB: BUILD_CACHE_HIT {}", build); }
        return Ok(build.to_string());
      }
    }
  }
  if debug_h { eprintln!("DEBUG_HLTB: BUILD_FETCH_START"); }
  let html = ACLIENT
    .get("https://howlongtobeat.com/")
    .send()
    .await
    .map_err(|e| e.to_string())?
    .text()
    .await
    .map_err(|e| e.to_string())?;
  let re = Regex::new(r#"<script[^>]*id=\"__NEXT_DATA__\"[^>]*>(.*?)</script>"#).unwrap();
  if let Some(cap) = re.captures(&html) {
    if let Some(m) = cap.get(1) {
      if let Ok(json) = serde_json::from_str::<Value>(m.as_str()) {
        if let Some(build) = json.get("buildId").and_then(|x| x.as_str()) {
          let build = build.to_string();
          let v = serde_json::json!({"build_id": build, "ts": now_unix()});
          write_json(&path, &v);
          if debug_h { eprintln!("DEBUG_HLTB: BUILD_FETCH_SUCCESS {}", build); }
          return Ok(build);
        }
      }
    }
  }
  if debug_h { eprintln!("DEBUG_HLTB: BUILD_FETCH_FAIL"); }
  Err("HLTB build id not found".into())
}

async fn hltb_fetch_search_json(build_id: &str, title: &str) -> Result<Value, String> {
  let debug_h = std::env::var("DEBUG_HLTB").ok().as_deref() == Some("1");
  let query = urlencoding::encode(title);
  let url = format!("https://howlongtobeat.com/_next/data/{}/search.json?game={}&sort=popular", build_id, query);
  let mut attempt = 0;
  loop {
    attempt += 1;
    if debug_h { eprintln!("DEBUG_HLTB: API_REQ attempt={} url={}", attempt, url); }
    let res = ACLIENT
      .get(&url)
      .header("referer", format!("https://howlongtobeat.com/?q={}", query))
      .send()
      .await
      .map_err(|e| e.to_string())?;
    if res.status() == StatusCode::TOO_MANY_REQUESTS {
      if attempt >= 5 { return Err("HLTB 429 exhausted".into()); }
      let wait = retry_after_duration(res.headers());
      if debug_h { eprintln!("DEBUG_HLTB: HTTP_429 RETRY_AFTER={:?}", wait); }
      thread::sleep(wait);
      continue;
    }
    if res.status() == StatusCode::NOT_FOUND {
      if debug_h { eprintln!("DEBUG_HLTB: OTHER_HTTP {}", res.status()); }
      return Err("HLTB data 404".into());
    }
    if !res.status().is_success() {
      if debug_h { eprintln!("DEBUG_HLTB: OTHER_HTTP {}", res.status()); }
      return Err(format!("HLTB HTTP {}", res.status()));
    }
    return res.json::<Value>().await.map_err(|e| e.to_string());
  }
}

fn collect_hltb_nodes(v: &Value, out: &mut Vec<(String, f32)>) {
  match v {
    Value::Object(map) => {
      if let Some(main) = map.get("gameplayMain").and_then(|x| x.as_f64()) {
        if main > 0.0 {
          let name = map.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
          out.push((name, main as f32));
        }
      }
      for child in map.values() {
        collect_hltb_nodes(child, out);
      }
    }
    Value::Array(arr) => {
      for child in arr {
        collect_hltb_nodes(child, out);
      }
    }
    _ => {}
  }
}

fn pick_best_hours(query: &str, pairs: &[(String, f32)]) -> Option<f32> {
  let qn = normalize_title(query);
  let mut best: (usize, f64, f32) = (usize::MAX, -1.0, 0.0);
  for (i, (name, main)) in pairs.iter().enumerate() {
    let nn = normalize_title(name);
    let jw = jaro_winkler(&qn, &nn) as f64;
    let jac = jaccard_token_set(&qn, &nn);
    let score = jw.max(jac);
    if *main > 0.0 && score > best.1 { best = (i, score, *main); }
  }
  if best.0 != usize::MAX && best.1 >= 0.85 { Some(best.2) } else { None }
}

async fn hltb_try_api(_client: &reqwest::Client, title: &str) -> Result<Option<f32>, String> {
  let debug_h = std::env::var("DEBUG_HLTB").ok().as_deref() == Some("1");
  let build_id = match hltb_fetch_build_id().await {
    Ok(id) => id,
    Err(e) => {
      if debug_h { eprintln!("DEBUG_HLTB: BUILD_MISSING {}", e); }
      return Ok(None);
    }
  };
  let data = match hltb_fetch_search_json(&build_id, title).await {
    Ok(v) => v,
    Err(e) => {
      if debug_h { eprintln!("DEBUG_HLTB: DATA_FETCH_FAIL {}", e); }
      return Ok(None);
    }
  };
  let mut nodes = Vec::new();
  if let Some(games) = data
    .get("pageProps")
    .and_then(|p| p.get("data"))
    .and_then(|d| d.get("games"))
  {
    collect_hltb_nodes(games, &mut nodes);
  }
  if debug_h { eprintln!("DEBUG_HLTB: API_MATCHES {}", nodes.len()); }
  let picked = pick_best_hours(title, &nodes);
  if debug_h { eprintln!("DEBUG_HLTB: API_SELECTED -> {:?}", picked); }
  Ok(picked)
}

async fn hltb_try_html(client: &reqwest::Client, title: &str) -> Result<Option<f32>, String> {
  let debug_h = std::env::var("DEBUG_HLTB").ok().as_deref() == Some("1");
  let q = urlencoding::encode(title);
  let url = format!("https://howlongtobeat.com/?q={}", q);
  let res = client
    .get(&url)
    .header("user-agent", HLTB_UA)
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !res.status().is_success() {
    return Err(format!("HLTB HTML HTTP {}", res.status()));
  }

  let text = res.text().await.map_err(|e| e.to_string())?;
  let mut nodes = Vec::new();
  if let Ok(re) = Regex::new(r#"<script[^>]*id=\"__NEXT_DATA__\"[^>]*>(.*?)</script>"#) {
    if let Some(cap) = re.captures(&text) {
      if let Some(m) = cap.get(1) {
        if let Ok(json) = serde_json::from_str::<Value>(m.as_str()) {
          if let Some(games) = json
            .get("props")
            .and_then(|p| p.get("pageProps"))
            .and_then(|p| p.get("data"))
            .and_then(|d| d.get("games"))
          {
            collect_hltb_nodes(games, &mut nodes);
          }
        }
      }
    }
  }
  if debug_h { eprintln!("DEBUG_HLTB: HTML_JSON_MATCHES {}", nodes.len()); }
  if let Some(hours) = pick_best_hours(title, &nodes) {
    if debug_h { eprintln!("DEBUG_HLTB: HTML_SELECTED {:?}", hours); }
    return Ok(Some(hours));
  }

  if let Some(caps) = html_main_regex().captures(&text) {
    if let Some(mat) = caps.get(1) {
      if let Ok(v) = mat.as_str().parse::<f32>() {
        return Ok(Some(v));
      }
    }
  }

  if let Some(caps) = html_alt_regex().captures(&text) {
    if let Some(mat) = caps.get(1) {
      if let Ok(v) = mat.as_str().parse::<f32>() {
        return Ok(Some(v));
      }
    }
  }

  Ok(None)
}

fn html_main_regex() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r#""gameplayMain"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)"#).unwrap())
}

fn html_alt_regex() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| {
    Regex::new(
      r"(?i)Main\\s+Story</div>\\s*<span[^>]*>\\s*([0-9]+(?:\\.[0-9]+)?)",
    )
    .unwrap()
  })
}

#[tauri::command]
pub async fn hltb_search(title: String) -> Result<HLTBMeta, String> {
  let trimmed = title.trim();
  if trimmed.is_empty() {
    return Ok(HLTBMeta {
      main_median_hours: None,
      source: "hltb".into(),
    });
  }

  let key = normalize_key(trimmed);
  let mut cache = read_cache_map::<HltbCacheEntry>(HLTB_CACHE_FILE);
  let debug_h = std::env::var("DEBUG_HLTB").ok().as_deref() == Some("1");
  if let Some(entry) = cache.get(&key) {
    let ttl = if entry.value.is_some() { HLTB_CACHE_TTL_SECS } else { HLTB_NEGATIVE_TTL_SECS };
    if !is_expired(entry.ts, ttl) {
      if debug_h { eprintln!("DEBUG_HLTB: CACHE_HIT {} -> {:?}", &key, entry.value); }
      return Ok(HLTBMeta {
        main_median_hours: entry.value,
        source: "hltb-cache".into(),
      });
    }
  }

  let client = reqwest::Client::builder()
    .user_agent(HLTB_UA)
    .build()
    .map_err(|e| e.to_string())?;

  match hltb_try_api(&client, trimmed).await {
    Ok(Some(main)) => {
      cache.insert(
        key.clone(),
        HltbCacheEntry {
          value: Some(main),
          ts: now_unix(),
        },
      );
      write_cache_map(HLTB_CACHE_FILE, &cache);
      return Ok(HLTBMeta {
        main_median_hours: Some(main),
        source: "hltb".into(),
      });
    }
    Ok(None) | Err(_) => {}
  }

  let fallback = hltb_try_html(&client, trimmed).await?;
  cache.insert(
    key.clone(),
    HltbCacheEntry {
      value: fallback,
      ts: now_unix(),
    },
  );
  write_cache_map(HLTB_CACHE_FILE, &cache);

  Ok(HLTBMeta {
    main_median_hours: fallback,
    source: "html".into(),
  })
}

#[tauri::command]
pub fn hltb_clear_cache() -> Result<(), String> {
  clear_cache_file(HLTB_CACHE_FILE)
}

#[tauri::command]
pub fn opencritic_clear_cache() -> Result<(), String> {
  clear_cache_file(OPENCRITIC_CACHE_FILE)
}

#[tauri::command]
pub async fn get_steam_price_try(
  appid: u32,
  region: Option<String>,
) -> Result<Option<SteamPrice>, String> {
  let cc = region
    .as_deref()
    .unwrap_or(DEFAULT_STEAM_REGION)
    .trim()
    .to_lowercase();
  let cc = if cc.is_empty() {
    DEFAULT_STEAM_REGION.to_string()
  } else {
    cc
  };

  let url = format!(
    "https://store.steampowered.com/api/appdetails?appids={}&cc={}&filters=price_overview",
    appid, cc
  );

  let client = reqwest::Client::builder()
    .user_agent(USER_AGENT)
    .build()
    .map_err(|e| e.to_string())?;

  let res = client.get(url).send().await.map_err(|e| e.to_string())?;
  if !res.status().is_success() {
    return Err(format!("Steam HTTP {}", res.status()));
  }
  let txt = res.text().await.map_err(|e| e.to_string())?;

  let v: Value = serde_json::from_str(&txt).map_err(|e| e.to_string())?;
  let key = appid.to_string();
  if let Some(entry) = v.get(&key) {
    let parsed: SteamAppResult = serde_json::from_value(entry.clone()).map_err(|e| e.to_string())?;
    if parsed.success {
      if let Some(data) = parsed.data {
        if let Some(po) = data.price_overview {
          let price = po.final_price as f32 / 100.0;
          let currency = po.currency.to_uppercase();
          return Ok(Some(SteamPrice { price, currency }));
        }
      }
    }
  }

  Ok(None)
}

static CLIENT: Lazy<reqwest::blocking::Client> = Lazy::new(|| {
  reqwest::blocking::Client::builder()
    .user_agent(USER_AGENT)
    .build()
    .expect("client")
});

fn rapid_get_json(url: &str, headers: &header::HeaderMap) -> Result<Value, String> {
  let client = &*CLIENT;
  
  let mut attempt = 0;
  loop {
    attempt += 1;
    let response = client
      .get(url)
      .headers(headers.clone())
      .send()
      .map_err(|e| e.to_string())?;

    if response.status() == StatusCode::TOO_MANY_REQUESTS {
      if attempt >= OPENCRITIC_MAX_RETRIES {
        return Err("OpenCritic: too many requests (exhausted retries)".into());
      }
      let wait = retry_after_duration(response.headers());
      thread::sleep(wait);
      continue;
    }

    if !response.status().is_success() {
      return Err(format!("OpenCritic HTTP {}", response.status()));
    }

    return response.json::<Value>().map_err(|e| e.to_string());
  }
}

#[tauri::command]
pub fn get_opencritic_score(title: String) -> Result<Option<f32>, String> {
  let trimmed = title.trim();
  if trimmed.is_empty() {
    return Ok(None);
  }

  let api_key = std::env::var("OPENCRITIC_API_KEY")
    .map_err(|_| "OPENCRITIC_API_KEY is not set".to_string())?;
  let host = std::env::var("OPENCRITIC_HOST")
    .unwrap_or_else(|_| "opencritic-api.p.rapidapi.com".to_string());
  let debug = std::env::var("DEBUG_OC").ok().as_deref() == Some("1");

  let normalized_title = {
    let norm = normalize_title(trimmed);
    if norm.is_empty() {
      trimmed.to_string()
    } else {
      norm
    }
  };
  let cache_key = normalized_title.to_lowercase();

  let cache_path = data_file(OPENCRITIC_CACHE_FILE);
  let mut cache = read_cache(&cache_path);
  if let Some(entry) = cache.get(&cache_key) {
    let ttl = if entry.score.is_some() { OPENCRITIC_CACHE_TTL_SECS } else { OPENCRITIC_NEGATIVE_TTL_SECS };
    if !is_expired(entry.cached_at, ttl) {
      if debug { eprintln!("DEBUG_OC: CACHE_HIT {} -> {:?}", &cache_key, entry.score); }
      return Ok(entry.score);
    } else if debug { eprintln!("DEBUG_OC: CACHE_EXPIRED {}", &cache_key); }
  }

  let mut headers = header::HeaderMap::new();
  headers.insert(
    header::HeaderName::from_static("x-rapidapi-key"),
    header::HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?,
  );
  headers.insert(
    header::HeaderName::from_static("x-rapidapi-host"),
    header::HeaderValue::from_str(&host).map_err(|e| e.to_string())?,
  );

  let query = urlencoding::encode(&normalized_title);
  let search_url = format!("https://{}/game/search?criteria={}", host, query);
  let search_json = rapid_get_json(&search_url, &headers)?;
  let results: Vec<Value> = match &search_json {
    Value::Array(arr) => arr.clone(),
    Value::Object(obj) => obj
      .get("results")
      .and_then(|v| v.as_array())
      .cloned()
      .unwrap_or_default(),
    _ => Vec::new(),
  };

  if results.is_empty() {
    if debug { eprintln!("DEBUG_OC: EMPTY_SEARCH for '{}': {}", trimmed, &normalized_title); }
    cache.insert(
      cache_key,
      Cached { score: None, cached_at: now_unix() }
    );
    write_cache(&cache_path, &cache);
    return Ok(None);
  }

  // Choose best result by fuzzy score
  let query_norm = normalized_title.to_lowercase();
  let mut best_idx = 0usize;
  let mut best_score = -1.0f64;
  for (i, item) in results.iter().enumerate() {
    if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
      let n_norm = normalize_title(name).to_lowercase();
      let jw = jaro_winkler(&query_norm, &n_norm) as f64;
      let jac = jaccard_token_set(&query_norm, &n_norm);
      let s = jw.max(jac);
      if s > best_score { best_score = s; best_idx = i; }
    }
  }
  let threshold_high = 0.92f64;
  let threshold_ok = 0.85f64;
  if best_score < threshold_ok {
    if debug { eprintln!("DEBUG_OC: FUZZY_LOW score={:.3} for '{}'", best_score, trimmed); }
    cache.insert(
      cache_key,
      Cached { score: None, cached_at: now_unix() }
    );
    write_cache(&cache_path, &cache);
    return Ok(None);
  }
  let chosen = results[best_idx].clone();

  let game_id = chosen
    .get("id")
    .and_then(|v| v.as_u64())
    .ok_or_else(|| "OpenCritic search result missing id".to_string())?;

  let details_url = format!("https://{}/game/{}", host, game_id);
  let details_json = rapid_get_json(&details_url, &headers)?;
  let score = details_json
    .get("topCriticScore")
    .and_then(|v| v.as_f64())
    .map(|v| v as f32);

  if let Some(value) = score {
    cache.insert(
      cache_key,
      Cached {
        score: Some(value),
        cached_at: now_unix(),
      },
    );
    write_cache(&cache_path, &cache);
    Ok(Some(value))
  } else {
    cache.insert(
      cache_key,
      Cached { score: None, cached_at: now_unix() }
    );
    write_cache(&cache_path, &cache);
    Ok(None)
  }
}

// simple token-set jaccard similarity on whitespace tokens
fn jaccard_token_set(a: &str, b: &str) -> f64 {
  use std::collections::HashSet;
  let ta: HashSet<_> = a.split_whitespace().collect();
  let tb: HashSet<_> = b.split_whitespace().collect();
  let inter = ta.intersection(&tb).count() as f64;
  let uni = ta.union(&tb).count() as f64;
  if uni == 0.0 { 0.0 } else { inter / uni }
}
