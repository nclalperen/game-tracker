use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::io::{self, Cursor, Read};
use std::path::{Path, PathBuf};

const DEFAULT_LLAMA_RELEASE: &str = "b3538";

fn main() {
  if let Err(err) = ensure_llama_sidecar() {
    panic!("Failed to ensure llama.cpp sidecar: {}", err);
  }
  tauri_build::build();
}

fn ensure_llama_sidecar() -> Result<(), Box<dyn std::error::Error>> {
  println!("cargo:rerun-if-env-changed=LLAMA_SIDECAR_URL");
  println!("cargo:rerun-if-env-changed=LLAMA_RELEASE_TAG");
  println!("cargo:rerun-if-env-changed=LLAMA_REPO");
  println!("cargo:rerun-if-env-changed=GITHUB_TOKEN");
  let target_dir = PathBuf::from("bin").join("llama");
  let (main_name, embed_name) = expected_binary_names();
  let main_path = target_dir.join(&main_name);
  let embed_path = target_dir.join(&embed_name);
  let libs_needed: Vec<PathBuf> = expected_dynamic_libs()
    .iter()
    .map(|name| target_dir.join(name))
    .collect();

  let mut all_ok = main_path.exists() && embed_path.exists();
  if all_ok {
    for lib in &libs_needed {
      if !lib.exists() { all_ok = false; break; }
    }
  }

  if all_ok {
    return Ok(());
  }

  fs::create_dir_all(&target_dir)?;

  let url = resolve_download_url()?;
  println!("cargo:warning=Downloading llama.cpp sidecar from {}", url);
  let bytes = fetch_bytes(&url)?;
  extract_binaries(&bytes, &target_dir, &main_name, &embed_name)?;

  Ok(())
}

fn expected_binary_names() -> (&'static str, &'static str) {
  if cfg!(target_os = "windows") {
    ("main.exe", "embedding.exe")
  } else {
    ("main", "embedding")
  }
}

fn expected_dynamic_libs() -> &'static [&'static str] {
  if cfg!(target_os = "windows") {
    &["ggml.dll", "llama.dll"]
  } else if cfg!(target_os = "macos") {
    &["libggml.dylib", "libllama.dylib"]
  } else {
    &["libggml.so", "libllama.so"]
  }
}

fn resolve_download_url() -> Result<String, Box<dyn std::error::Error>> {
  if let Ok(custom) = env::var("LLAMA_SIDECAR_URL") {
    if !custom.trim().is_empty() {
      return Ok(custom);
    }
  }

  let repo = env::var("LLAMA_REPO").unwrap_or_else(|_| "ggml-org/llama.cpp".to_string());
  let tag = env::var("LLAMA_RELEASE_TAG").unwrap_or_else(|_| DEFAULT_LLAMA_RELEASE.to_string());
  let api_url = format!("https://api.github.com/repos/{repo}/releases/tags/{tag}");

  let mut request = ureq::get(&api_url)
    .set("Accept", "application/vnd.github+json")
    .set("User-Agent", "gametracker-build-script");

  if let Ok(token) = env::var("GITHUB_TOKEN") {
    if !token.trim().is_empty() {
      let header_value = format!("Bearer {}", token.trim());
      request = request.set("Authorization", &header_value);
    }
  }

  let response = request.call()?;

  if response.status() != 200 {
    return Err(format!("GitHub API returned {} for {}", response.status(), api_url).into());
  }

  let payload: serde_json::Value = response.into_json()?;
  let assets = payload
    .get("assets")
    .and_then(|v| v.as_array())
    .ok_or("GitHub release payload missing assets list")?;

  let download = pick_asset_download(assets)?;
  Ok(download)
}

fn pick_asset_download(assets: &[serde_json::Value]) -> Result<String, Box<dyn std::error::Error>> {
  let os = env::var("CARGO_CFG_TARGET_OS")?;
  let arch = env::var("CARGO_CFG_TARGET_ARCH")?;
  let candidates = candidate_suffixes(&os, &arch);

  // First pass: preferred suffixes
  for suffix in &candidates {
    if let Some((name, url)) = find_asset_with_suffix(assets, suffix) {
      println!("cargo:warning=Using llama.cpp asset {}", name);
      return Ok(url);
    }
  }

  // Second pass: any asset mentioning the OS name
  if let Some((name, url)) = find_asset_with_suffix(assets, &os) {
    println!("cargo:warning=Using llama.cpp asset {}", name);
    return Ok(url);
  }

  Err(format!("No suitable llama.cpp asset found for target {}/{}", os, arch).into())
}

fn candidate_suffixes(os: &str, arch: &str) -> Vec<&'static str> {
  match (os, arch) {
    ("windows", "x86_64") => vec![
      "win-avx2-x64",
      "win-x64",
      "win-cublas-x64",
    ],
    ("linux", "x86_64") => vec![
      "linux-x64",
      "linux-cuda",
      "linux-avx2",
    ],
    ("macos", "x86_64") | ("macos", "aarch64") => vec![
      "macos-universal2-metal",
      "macos-universal2",
    ],
    _ => Vec::new(),
  }
}

fn find_asset_with_suffix(assets: &[serde_json::Value], suffix: &str) -> Option<(String, String)> {
  for asset in assets {
    let name = asset.get("name")?.as_str()?;
    if name.to_ascii_lowercase().contains(&suffix.to_ascii_lowercase()) {
      if let Some(url) = asset.get("browser_download_url").and_then(|v| v.as_str()) {
        return Some((name.to_string(), url.to_string()));
      }
    }
  }
  None
}

fn fetch_bytes(url: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
  let resp = ureq::get(url)
    .set("User-Agent", "gametracker-build-script")
    .call()?;
  let status = resp.status();
  if !(200..300).contains(&status) {
    return Err(format!("HTTP {} while downloading {}", status, url).into());
  }
  let mut reader = resp.into_reader();
  let mut data = Vec::new();
  reader.read_to_end(&mut data)?;
  Ok(data)
}

fn extract_binaries(
  zip_bytes: &[u8],
  target_dir: &Path,
  main_name: &str,
  embed_name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
  let cursor = Cursor::new(zip_bytes);
  let mut archive = zip::ZipArchive::new(cursor)?;
  let mut main_found = false;
  let mut embed_found = false;
  let mut extra_flags: HashMap<String, bool> = expected_dynamic_libs()
    .iter()
    .map(|&name| (name.to_ascii_lowercase(), false))
    .collect();

  for i in 0..archive.len() {
    let mut file = archive.by_index(i)?;
    if file.is_dir() {
      continue;
    }
    let name = file.name().rsplit('/').next().unwrap_or(file.name());
    let lower = name.to_ascii_lowercase();
    let target_name = if matches!(
      lower.as_str(),
      "main"
        | "main.exe"
        | "llama.exe"
        | "llama"
        | "llama-main.exe"
        | "llama-cli.exe"
        | "llama-cli"
        | "llama-simple.exe"
        | "llama-simple"
    ) {
      Some(main_name)
    } else if matches!(
      lower.as_str(),
      "embedding"
        | "embedding.exe"
        | "llama-embedding"
        | "llama-embedding.exe"
    ) {
      Some(embed_name)
    } else {
      let lower_name = name.to_ascii_lowercase();
      // Copy required DLLs if they match expected list
      if let Some(flag) = extra_flags.get_mut(&lower_name) {
        let out_path = target_dir.join(name);
        let mut out_file = File::create(&out_path)?;
        io::copy(&mut file, &mut out_file)?;
        #[cfg(unix)]
        {
          use std::os::unix::fs::PermissionsExt;
          let mut perms = fs::metadata(&out_path)?.permissions();
          perms.set_mode(0o755);
          fs::set_permissions(&out_path, perms)?;
        }
        *flag = true;
      } else {
        // Copy all dynamic libraries as a best-effort safety net
        let is_dyn = if cfg!(target_os = "windows") {
          lower_name.ends_with(".dll")
        } else if cfg!(target_os = "macos") {
          lower_name.ends_with(".dylib")
        } else {
          lower_name.ends_with(".so")
        };
        if is_dyn {
          let out_path = target_dir.join(name);
          let mut out_file = File::create(&out_path)?;
          io::copy(&mut file, &mut out_file)?;
          #[cfg(unix)]
          {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&out_path)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&out_path, perms)?;
          }
        }
      }
      None
    };

    if let Some(out_name) = target_name {
      let out_path = target_dir.join(out_name);
      let mut out_file = File::create(&out_path)?;
      io::copy(&mut file, &mut out_file)?;
      #[cfg(unix)]
      {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&out_path)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&out_path, perms)?;
      }
      if out_name == main_name {
        main_found = true;
      } else {
        embed_found = true;
      }
    }
  }

  if !main_found || !embed_found {
    return Err("Downloaded archive did not contain expected llama.cpp binaries".into());
  }

  if extra_flags.values().any(|loaded| !*loaded) {
    return Err("Downloaded archive missing required llama.cpp dynamic libraries".into());
  }

  Ok(())
}
