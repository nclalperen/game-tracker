use serde::{Deserialize, Serialize};
use std::{
  collections::HashMap,
  fs,
  path::PathBuf,
  time::{SystemTime, UNIX_EPOCH},
};

// ----- OpenCritic integration -----
// We integrate the OpenCritic API via RapidAPI.  A valid API key is
// required.  This key is currently hard-coded; in a production
// deployment you should read it from a secure location or environment
// variable.  The host header must always be
// "opencritic-api.p.rapidapi.com" per RapidAPI documentation.
const OPENCRITIC_API_KEY: &str = "11671d009bmsh11bc462a39f6f61p1315abjsneb21d4ec4b73";
const OPENCRITIC_HOST: &str = "opencritic-api.p.rapidapi.com";

#[derive(Serialize)]
pub struct HLTBMeta {
  pub main_median_hours: Option<f32>,
  pub source: String, // "hltb" | "cache" | "html"
}

#[derive(Serialize, Deserialize, Clone)]
struct CacheEntry {
  main: Option<f32>,
  ts: i64, // unix seconds
}

const CACHE_TTL_SECS: i64 = 30 * 24 * 60 * 60; // 30 days

fn now_unix() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap()
    .as_secs() as i64
}

fn normalize_key(title: &str) -> String {
  title.trim().to_lowercase()
}

fn cache_path() -> PathBuf {
  // Store in OS user data dir: <AppData>/GameTracker/hltb_cache.json on Windows
  let mut p = dirs::data_dir().unwrap_or(std::env::temp_dir());
  p.push("GameTracker");
  let _ = fs::create_dir_all(&p);
  p.push("hltb_cache.json");
  p
}

fn read_cache() -> HashMap<String, CacheEntry> {
  let path = cache_path();
  if let Ok(bytes) = fs::read(path) {
    if let Ok(map) = serde_json::from_slice::<HashMap<String, CacheEntry>>(&bytes) {
      return map;
    }
  }
  HashMap::new()
}

fn write_cache(map: &HashMap<String, CacheEntry>) {
  let path = cache_path();
  if let Some(dir) = path.parent() {
    let _ = fs::create_dir_all(dir);
  }
  if let Ok(json) = serde_json::to_vec_pretty(map) {
    let _ = fs::write(path, json);
  }
}

async fn hltb_try_api(client: &reqwest::Client, title: &str) -> Result<Option<f32>, String> {
  let terms: Vec<&str> = title.split_whitespace().collect();
  let payload = serde_json::json!({
    "searchType": 1,
    "searchTerms": terms,
    "searchPage": 1,
    "size": 5,
    "searchOptions": {
      "games": { "userId": 0, "platform": "", "sortCategory": "popular", "rangeCategory": "main", "rangeTime": "0", "gameplay": "", "modifier": "" },
      "users": { "sortCategory": "postcount" },
      "filter": { "sort": 0 }
    }
  });

  let url = "https://howlongtobeat.com/api/search";
  let res = client
    .post(url)
    .header("origin", "https://howlongtobeat.com")
    .header("referer", "https://howlongtobeat.com/")
    .header("content-type", "application/json")
    .json(&payload)
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !res.status().is_success() {
    return Err(format!("HLTB HTTP {}", res.status()));
  }

  #[derive(Deserialize)]
  struct Item { #[serde(rename="gameplayMain")] gameplay_main: Option<f32> }
  #[derive(Deserialize)]
  struct ApiResp { data: Vec<Item> }

  let body: ApiResp = res.json().await.map_err(|e| e.to_string())?;
  Ok(body.data.get(0).and_then(|i| i.gameplay_main))
}

async fn hltb_try_html(client: &reqwest::Client, title: &str) -> Result<Option<f32>, String> {
  let q = urlencoding::encode(title);
  let url = format!("https://howlongtobeat.com/?q={}", q);
  let res = client
    .get(url)
    .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !res.status().is_success() {
    return Err(format!("HLTB HTML HTTP {}", res.status()));
  }

  let text = res.text().await.map_err(|e| e.to_string())?;
  let re = regex::Regex::new(r#""gameplayMain"\s*:\s*([0-9]+(?:\.[0-9]+)?)"#).unwrap();
  if let Some(caps) = re.captures(&text) {
    if let Some(m) = caps.get(1) {
      if let Ok(v) = m.as_str().parse::<f32>() {
        return Ok(Some(v));
      }
    }
  }
  Ok(None)
}

#[tauri::command]
pub async fn hltb_search(title: String) -> Result<HLTBMeta, String> {
  let key = normalize_key(&title);
  let mut cache = read_cache();
  if let Some(entry) = cache.get(&key) {
    if now_unix() - entry.ts <= CACHE_TTL_SECS {
      return Ok(HLTBMeta {
        main_median_hours: entry.main,
        source: "cache".into(),
      });
    }
  }

  let client = reqwest::Client::builder()
    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    .build()
    .map_err(|e| e.to_string())?;

  // Try official API first
  match hltb_try_api(&client, &title).await {
    Ok(Some(main)) => {
      cache.insert(key, CacheEntry { main: Some(main), ts: now_unix() });
      write_cache(&cache);
      return Ok(HLTBMeta { main_median_hours: Some(main), source: "hltb".into() });
    }
    Ok(None) => { /* fall through to HTML */ }
    Err(_e) => { /* fall through to HTML */ }
  }

  // Fallback: parse main time from HTML
  match hltb_try_html(&client, &title).await {
    Ok(main_opt) => {
      cache.insert(key, CacheEntry { main: main_opt, ts: now_unix() });
      write_cache(&cache);
      Ok(HLTBMeta { main_median_hours: main_opt, source: "html".into() })
    }
    Err(e) => Err(e),
  }
}

#[tauri::command]
pub fn hltb_clear_cache() -> Result<(), String> {
  let p = cache_path();
  if p.exists() {
    fs::remove_file(p).map_err(|e| e.to_string())?;
  }
  Ok(())
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

/// Steam price lookup.  Accepts an optional two-letter region code (cc) and
/// returns both the price (in the region's currency) and the ISO currency code.
/// If no region is provided, defaults to "us".  The returned value is
/// `None` if the price is unavailable for the requested region.
#[tauri::command]
pub async fn get_steam_price_try(
    appid: u32,
    region: Option<String>,
) -> Result<Option<SteamPrice>, String> {
    // Determine which region (cc) to query.  Default to "us" if none provided.
    let cc = region
        .as_deref()
        .unwrap_or("us")
        .to_lowercase();

    // Compose the Steam API URL.  We request only the price_overview data for
    // the given appid and region.  See:
    // https://partner.steamgames.com/doc/store/getappdetails
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc={}&filters=price_overview",
        appid, cc
    );

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Steam HTTP {}", res.status()));
    }
    let txt = res.text().await.map_err(|e| e.to_string())?;

    // The response is a map keyed by appid string
    let v: serde_json::Value = serde_json::from_str(&txt).map_err(|e| e.to_string())?;
    let key = appid.to_string();
    if let Some(entry) = v.get(&key) {
        let r: SteamAppResult = serde_json::from_value(entry.clone()).map_err(|e| e.to_string())?;
        if r.success {
            if let Some(data) = r.data {
                if let Some(po) = data.price_overview {
                    // Steam returns price in cents.  Convert to a float and capture the currency code.
                    let price = po.final_price as f32 / 100.0;
                    let currency = po.currency.to_uppercase();
                    return Ok(Some(SteamPrice { price, currency }));
                }
            }
        }
    }
    Ok(None)
}

/// Look up the aggregated OpenCritic score for a game title.  This will
/// search the OpenCritic API via RapidAPI, take the first match from the
/// search results, then query the game endpoint to obtain the
/// `topCriticScore` (a value between 0 and 100).  Returns `None` if no
/// match is found.  This function requires network access and a valid
/// API key.  Errors are propagated as strings.
#[tauri::command]
pub async fn get_opencritic_score(title: String) -> Result<Option<f32>, String> {
    // Construct an HTTP client.  A custom user-agent is supplied to
    // mimic a browser; RapidAPI does not require this but some
    // endpoints may be sensitive to missing user agents.
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .map_err(|e| e.to_string())?;
    // Build the search URL.  The search endpoint returns an array of
    // candidates with id and name.  We URL-encode the title to be
    // safe.
    let search_url = format!(
        "https://{host}/meta/search?criteria={query}",
        host = OPENCRITIC_HOST,
        query = urlencoding::encode(&title)
    );
    let search_res = client
        .get(&search_url)
        .header("x-rapidapi-key", OPENCRITIC_API_KEY)
        .header("x-rapidapi-host", OPENCRITIC_HOST)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !search_res.status().is_success() {
        return Err(format!("OpenCritic search HTTP {}", search_res.status()));
    }
    let search_json: serde_json::Value = search_res
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let arr = search_json.as_array().ok_or("Unexpected OpenCritic search response")?;
    if arr.is_empty() {
        return Ok(None);
    }
    let first = &arr[0];
    let game_id = first
        .get("id")
        .and_then(|v| v.as_u64())
        .ok_or("Missing id in OpenCritic search result")? as u32;
    // Now fetch the game details.  The game endpoint returns a JSON
    // structure containing `topCriticScore` among other fields.  We
    // construct the URL without additional query parameters.
    let game_url = format!("https://{host}/game/{id}", host = OPENCRITIC_HOST, id = game_id);
    let game_res = client
        .get(&game_url)
        .header("x-rapidapi-key", OPENCRITIC_API_KEY)
        .header("x-rapidapi-host", OPENCRITIC_HOST)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !game_res.status().is_success() {
        return Err(format!("OpenCritic game HTTP {}", game_res.status()));
    }
    let game_json: serde_json::Value = game_res
        .json()
        .await
        .map_err(|e| e.to_string())?;
    // Extract the score.  According to OpenCritic docs, topCriticScore is
    // expressed as a float in the [0, 100] range.  If not present, we
    // return None.
    let score = game_json
        .get("topCriticScore")
        .and_then(|v| v.as_f64())
        .map(|f| f as f32);
    Ok(score)
}

/// A simple struct representing a Steam price and its currency code.  This is
/// returned via the Tauri bridge so TypeScript can display both the value and
/// the correct symbol.
#[derive(Serialize)]
pub struct SteamPrice {
    pub price: f32,
    pub currency: String,
}
