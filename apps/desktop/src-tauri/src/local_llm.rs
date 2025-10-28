#[cfg(feature = "local-llm")]
mod impls {
  use once_cell::sync::OnceCell;
  use serde::Serialize;
  use serde_json::Value;
  use std::path::{Path, PathBuf};
  use std::process::{Command, Stdio};
  use std::time::{Duration, Instant};
  use std::io::Write;

  // Placeholder types; wire your llama_cpp contexts here.
  struct ChatCtx;
  struct EmbedCtx;

  static CHAT: OnceCell<ChatCtx> = OnceCell::new();
  static EMBED: OnceCell<EmbedCtx> = OnceCell::new();

  fn models_root() -> PathBuf {
    // 1) Next to the executable (portable dev builds)
    if let Ok(exe) = std::env::current_exe() {
      if let Some(dir) = exe.parent() {
        let p = dir.join("models");
        if p.exists() { return p; }
        // 1b) Tauri bundle resources folder alongside the exe
        let r = dir.join("resources").join("models");
        if r.exists() { return r; }
      }
    }
    // 2) The crate's models directory (useful in `tauri dev`)
    let manifest_models = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models");
    if manifest_models.exists() {
      return manifest_models;
    }
    // 3) Current working directory /models (fallback)
    let cwd = std::env::current_dir().unwrap_or_default();
    let cwd_models = cwd.join("models");
    if cwd_models.exists() {
      return cwd_models;
    }
    manifest_models
  }

  fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf()))
  }

  fn resource_dir_guess() -> Option<PathBuf> {
    // Tauri bundle flattens resources under <exe>/resources on Windows by default
    exe_dir().map(|d| d.join("resources"))
  }

  fn llama_bin_chat() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("LLM_BIN_CHAT") { if !p.trim().is_empty() { let path = PathBuf::from(p); if path.exists() { return Some(path); } } }
    // Search bundled locations
    let names = if cfg!(target_os = "windows") { ["main.exe", "llama.exe"] } else { ["main", "llama"] };
    let roots = [resource_dir_guess(), exe_dir(), Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")))];
    for root in roots.into_iter().flatten() {
      for name in names { let p = root.join("bin").join("llama").join(name); if p.exists() { return Some(p); } }
    }
    None
  }

  fn llama_bin_embed() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("LLM_BIN_EMBED") { if !p.trim().is_empty() { let path = PathBuf::from(p); if path.exists() { return Some(path); } } }
    let names = if cfg!(target_os = "windows") { ["embedding.exe"] } else { ["embedding"] };
    let roots = [resource_dir_guess(), exe_dir(), Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")))];
    for root in roots.into_iter().flatten() {
      for name in names { let p = root.join("bin").join("llama").join(name); if p.exists() { return Some(p); } }
    }
    None
  }

  fn decode_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
      return String::new();
    }

    let mut try_utf16 = false;
    if bytes.len() >= 2 {
      let bom = (bytes[0], bytes[1]);
      if bom == (0xFF, 0xFE) || bom == (0xFE, 0xFF) {
        try_utf16 = true;
      }
    }

    if !try_utf16 && bytes.len() % 2 == 0 {
      let zero_count = bytes.iter().filter(|&&b| b == 0).count();
      if zero_count * 2 >= bytes.len() {
        try_utf16 = true;
      }
    }

    if try_utf16 {
      let mut u16_buf = Vec::with_capacity(bytes.len() / 2);
      let mut idx = 0;
      while idx + 1 < bytes.len() {
        let pair = [bytes[idx], bytes[idx + 1]];
        u16_buf.push(u16::from_le_bytes(pair));
        idx += 2;
      }
      let mut s = String::from_utf16_lossy(&u16_buf);
      if let Some(stripped) = s.strip_prefix('\u{FEFF}') {
        s = stripped.to_string();
      }
      s.retain(|c| c != '\0');
      return s;
    }

    match String::from_utf8(bytes.to_vec()) {
      Ok(mut s) => {
        if let Some(stripped) = s.strip_prefix('\u{FEFF}') {
          s = stripped.to_string();
        }
        s.retain(|c| c != '\0');
        s
      }
      Err(_) => {
        let mut u16_buf = Vec::with_capacity(bytes.len() / 2);
        let mut idx = 0;
        while idx + 1 < bytes.len() {
          let pair = [bytes[idx], bytes[idx + 1]];
          u16_buf.push(u16::from_le_bytes(pair));
          idx += 2;
        }
        let mut s = String::from_utf16_lossy(&u16_buf);
        if let Some(stripped) = s.strip_prefix('\u{FEFF}') {
          s = stripped.to_string();
        }
        s.retain(|c| c != '\0');
        s
      }
    }
  }

  fn run_with_timeout(mut cmd: Command, stdin_payload: Option<&str>, timeout: Duration) -> Result<String, String> {
    if stdin_payload.is_some() { cmd.stdin(Stdio::piped()); }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    if let Some(body) = stdin_payload {
      if let Some(mut stdin) = child.stdin.take() { stdin.write_all(body.as_bytes()).map_err(|e| e.to_string())?; }
    }
    let start = Instant::now();
    loop {
      if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let stdout_str = decode_bytes(&out.stdout);
        let stderr_str = decode_bytes(&out.stderr);
        if status.success() {
          return Ok(stdout_str);
        } else {
          let err = stderr_str.trim().to_string();
          let so = stdout_str.trim().to_string();
          let mut msg = String::new();
          if !err.is_empty() { msg.push_str(&err); }
          if !so.is_empty() {
            if !msg.is_empty() { msg.push_str("\n"); }
            msg.push_str("stdout: ");
            msg.push_str(&so);
          }
          if msg.is_empty() { msg = format!("llama sidecar failed (code {:?})", status.code()); }
          return Err(msg);
        }
      }
      if start.elapsed() > timeout {
        let _ = child.kill(); let _ = child.wait();
        return Err("llama sidecar timeout".into());
      }
      std::thread::sleep(Duration::from_millis(30));
    }
  }

  fn configure_command(mut cmd: Command, bin: &Path) -> Command {
    if let Some(parent) = bin.parent() {
      cmd.current_dir(parent);
      #[cfg(target_os = "windows")]
      {
        if let Ok(path) = std::env::var("PATH") {
          let combined = format!("{};{}", parent.to_string_lossy(), path);
          cmd.env("PATH", combined);
        } else {
          cmd.env("PATH", parent.to_string_lossy().to_string());
        }
      }
    }
    cmd
  }

  fn chat_via_sidecar(prompt: &str, model: &Path) -> Result<String, String> {
    let bin = llama_bin_chat().ok_or("chat sidecar not found (bin/llama/main)")?;
    let mut cmd = Command::new(&bin);
    cmd = configure_command(cmd, &bin);
    // conservative defaults; no GPU assumptions
    cmd.arg("--log-disable");
    cmd.arg("--simple-io");
    cmd.arg("-m").arg(model);
    cmd.arg("-p").arg(prompt);
    cmd.args(["-n", "256", "-c", "2048", "--temp", "0.7", "--repeat_penalty", "1.1"]);
    run_with_timeout(cmd, None, Duration::from_secs(60))
  }

  fn embed_via_sidecar(text: &str, model: &Path) -> Result<Vec<f32>, String> {
    let bin = llama_bin_embed().ok_or("embedding sidecar not found (bin/llama/embedding)")?;
    let mut cmd = Command::new(&bin);
    cmd = configure_command(cmd, &bin);
    cmd.arg("--log-disable");
    cmd.arg("--simple-io");
    cmd.args(["--embd-output-format", "array"]);
    cmd.arg("-m").arg(model);
    cmd.arg("-p").arg(text);
    cmd.args(["-c", "2048"]);
    let out = run_with_timeout(cmd, None, Duration::from_secs(30))?;
    // Attempt to parse JSON embedding output
    let canonical = out.trim_matches(|c: char| c == '\u{FEFF}' || c.is_whitespace());
    if !canonical.is_empty() {
      if let Some(end_brace) = canonical.rfind('}') {
        let json_slice = &canonical[..=end_brace];
        if let Ok(value) = serde_json::from_str::<Value>(json_slice) {
          if let Some(array) = value.get("data").and_then(|d| d.as_array()) {
            for item in array {
              if let Some(emb) = item.get("embedding").and_then(|e| e.as_array()) {
                let mut vec = Vec::with_capacity(emb.len());
                for entry in emb {
                  let num = entry
                    .as_f64()
                    .ok_or_else(|| "embedding JSON contains non-numeric values".to_string())?;
                  vec.push(num as f32);
                }
                if !vec.is_empty() {
                  return Ok(vec);
                }
              }
            }
          }
        }
      }

      if let Some(start_bracket) = canonical.find('[') {
        let slice = &canonical[start_bracket..];
        let end = slice.rfind(']').map(|i| i + 1).unwrap_or(slice.len());
        let trimmed = slice[..end].trim_end_matches(|c: char| c.is_whitespace());
        if let Ok(arrays) = serde_json::from_str::<Vec<Vec<f64>>>(trimmed) {
          if let Some(first) = arrays.first() {
            let mut vec = Vec::with_capacity(first.len());
            for &num in first {
              vec.push(num as f32);
            }
            if !vec.is_empty() {
              return Ok(vec);
            }
          }
        }
        match serde_json::from_str::<Vec<f64>>(trimmed) {
          Ok(values) => {
            if !values.is_empty() {
              return Ok(values.into_iter().map(|v| v as f32).collect());
            }
          }
          Err(err) => {
            return Err(format!("failed to parse embedding JSON: {}\nraw={}", err, trimmed));
          }
        }
      }
    }
    // Fallback: parse floats from stdout lines that include embedding values
    let mut vec = Vec::new();
    for line in out.lines() {
      if line.trim_start().starts_with("embedding") {
        let parts = line.split(':').nth(1).unwrap_or("");
        for tok in parts.split_whitespace() {
          if let Ok(v) = tok.parse::<f32>() { vec.push(v); }
        }
      }
    }
    if vec.is_empty() {
      let preview = if out.len() > 400 { &out[..400] } else { &out };
      return Err(format!("no embedding values parsed; raw preview: {}", preview.replace('\n', "\\n")));
    }
    Ok(vec)
  }

  fn sanitize_prompt(input: &str) -> String {
    let normalized = input.trim();
    if normalized.is_empty() {
      return String::new();
    }
    let mut cleaned = String::with_capacity(normalized.len());
    let mut prev_space = false;
    for ch in normalized.chars() {
      let out_ch = if ch.is_ascii() && !ch.is_control() {
        ch
      } else {
        match ch {
          '\u{2122}' => ' ', // ™
          '\u{00AE}' => ' ', // ®
          '\u{00A9}' => ' ', // ©
          _ => ' ',
        }
      };
      if out_ch.is_whitespace() {
        if prev_space {
          continue;
        }
        cleaned.push(' ');
        prev_space = true;
      } else {
        cleaned.push(out_ch);
        prev_space = false;
      }
    }
    cleaned.trim().to_string()
  }

  fn truncate_preview(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.len() <= 32 {
      trimmed.to_string()
    } else {
      let mut preview = trimmed[..32].to_string();
      preview.push_str("…");
      preview
    }
  }

  fn list_model_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(root) {
      for entry in rd.flatten() {
        let p = entry.path();
        if let Some(ext) = p.extension() {
          if ext.to_string_lossy().to_ascii_lowercase() == "gguf" { out.push(p); }
        }
      }
    }
    out
  }

  fn pick_chat_model(root: &Path) -> Option<PathBuf> {
    if let Ok(env_path) = std::env::var("LLM_CHAT_MODEL_PATH") { let p = PathBuf::from(env_path); if p.exists() { return Some(p);} }
    let files = list_model_files(root);
    let mut candidates: Vec<(usize, PathBuf)> = files.into_iter().map(|p| {
      let name = p.file_name().unwrap_or_default().to_string_lossy().to_ascii_lowercase();
      let mut score = 0usize;
      if name.contains("llama-3.2") { score += 3; }
      if name.contains("instruct") { score += 2; }
      if name.contains("tinyllama") { score += 2; }
      if name.contains("qwen") { score += 1; }
      (score, p)
    }).collect();
    candidates.sort_by(|a,b| b.0.cmp(&a.0));
    candidates.into_iter().find(|(s,_)| *s > 0).map(|(_,p)| p)
      .or_else(|| None)
  }

  fn pick_embed_model(root: &Path) -> Option<PathBuf> {
    if let Ok(env_path) = std::env::var("LLM_EMBED_MODEL_PATH") { let p = PathBuf::from(env_path); if p.exists() { return Some(p);} }
    let files = list_model_files(root);
    let mut candidates: Vec<(usize, PathBuf)> = files.into_iter().map(|p| {
      let name = p.file_name().unwrap_or_default().to_string_lossy().to_ascii_lowercase();
      let mut score = 0usize;
      if name.contains("bge") { score += 3; }
      if name.contains("embed") { score += 2; }
      if name.contains("mini") || name.contains("gte") { score += 1; }
      (score, p)
    }).collect();
    candidates.sort_by(|a,b| b.0.cmp(&a.0));
    candidates.into_iter().find(|(s,_)| *s > 0).map(|(_,p)| p)
  }

  fn ensure_loaded() -> Result<(), String> {
    CHAT.get_or_try_init(|| {
      let root = models_root();
      let chat = pick_chat_model(&root)
        .or_else(|| Some(root.join("Llama-3.2-1B-Instruct-Q4_K_M.gguf")))
        .ok_or_else(|| format!("No chat model detected in {}", root.display()))?;
      if !chat.exists() {
        return Err(format!("Chat model not found at {}", chat.display()));
      }
      // If llama sidecar present, we treat as ready; otherwise we still allow stub fallback.
      let _ = llama_bin_chat();
      Ok(ChatCtx)
    })?;
    EMBED.get_or_try_init(|| {
      let root = models_root();
      let emb = pick_embed_model(&root)
        .or_else(|| Some(root.join("bge-base-en-v1.5.Q4_K_M.gguf")))
        .ok_or_else(|| format!("No embedding model detected in {}", root.display()))?;
      if !emb.exists() {
        return Err(format!("Embedding model not found at {}", emb.display()));
      }
      let _ = llama_bin_embed();
      Ok(EmbedCtx)
    })?;
    Ok(())
  }

  pub async fn chat(prompt: &str) -> Result<String, String> {
    ensure_loaded()?;
    let _ctx = CHAT.get().ok_or("chat context not loaded")?;
    let model = {
      let root = models_root();
      pick_chat_model(&root).unwrap_or_else(|| root.join("Llama-3.2-1B-Instruct-Q4_K_M.gguf"))
    };
    if let Some(bin) = llama_bin_chat() {
      let _ = bin; // presence check only; actual path used in helper
      let out = chat_via_sidecar(prompt, &model)?;
      let trimmed = out.trim();
      if trimmed.is_empty() { return Ok("".into()); }
      // main emits the full transcript sometimes; try to keep last line
      let last = trimmed.rsplit_once('\n').map(|(_, r)| r).unwrap_or(trimmed);
      Ok(last.to_string())
    } else {
      // Fallback stub
      Ok(format!("(local) {}", prompt))
    }
  }

  pub async fn embed(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    ensure_loaded()?;
    let _ctx = EMBED.get().ok_or("embed context not loaded")?;
    let model = {
      let root = models_root();
      pick_embed_model(&root).unwrap_or_else(|| root.join("bge-base-en-v1.5.Q4_K_M.gguf"))
    };
    if llama_bin_embed().is_some() {
      let mut out = Vec::with_capacity(texts.len());
      for (idx, t) in texts.iter().enumerate() {
        let sanitized = sanitize_prompt(t);
        if sanitized.is_empty() {
          out.push(hashed_vector(t));
          continue;
        }
        let v = embed_via_sidecar(sanitized.as_str(), &model)
          .map_err(|e| format!("embedding failed for text #{idx} ('{}'): {}", truncate_preview(t), e))?;
        if v.is_empty() {
          return Err(format!("embedding returned empty vector for text #{idx} ('{}')", truncate_preview(t)));
        }
        out.push(v);
      }
      Ok(out)
    } else {
      let mut out = Vec::with_capacity(texts.len());
      for t in texts {
        out.push(hashed_vector(t));
      }
      Ok(out)
    }
  }

  fn hashed_vector(text: &str) -> Vec<f32> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
      return vec![0.0, 0.0, 0.0];
    }
    let h = trimmed.bytes().fold(0u32, |acc, b| acc.wrapping_mul(33).wrapping_add(b as u32)) as f32;
    vec![h % 1.0, (h / 3.0) % 1.0, (h / 7.0) % 1.0]
  }

  #[derive(Serialize)]
  pub struct DetectInfo {
    pub chat_path: String,
    pub embed_path: String,
    pub chat_exists: bool,
    pub embed_exists: bool,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub found: Vec<String>,
  }

  pub fn detect() -> DetectInfo {
    let root = models_root();
    let all = list_model_files(&root);
    let chat = pick_chat_model(&root).unwrap_or_else(|| root.join("Llama-3.2-1B-Instruct-Q4_K_M.gguf"));
    let emb = pick_embed_model(&root).unwrap_or_else(|| root.join("bge-base-en-v1.5.Q4_K_M.gguf"));
    DetectInfo {
      chat_path: chat.to_string_lossy().to_string(),
      embed_path: emb.to_string_lossy().to_string(),
      chat_exists: chat.exists(),
      embed_exists: emb.exists(),
      found: all.into_iter().map(|p| p.to_string_lossy().to_string()).collect(),
    }
  }
}

#[cfg(not(feature = "local-llm"))]
mod impls {
  pub async fn chat(_prompt: &str) -> Result<String, String> {
    Err("Local LLM is disabled. Rebuild with --features local-llm to enable.".into())
  }
  pub async fn embed(_texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    Err("Local LLM is disabled. Rebuild with --features local-llm to enable.".into())
  }
  #[derive(serde::Serialize)]
  pub struct DetectInfo {
    pub chat_path: String,
    pub embed_path: String,
    pub chat_exists: bool,
    pub embed_exists: bool,
  }
  pub fn detect() -> DetectInfo {
    DetectInfo {
      chat_path: "apps/desktop/src-tauri/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf".into(),
      embed_path: "apps/desktop/src-tauri/models/bge-base-en-v1.5.Q4_K_M.gguf".into(),
      chat_exists: false,
      embed_exists: false,
    }
  }
}

pub use impls::{chat, embed};
pub use impls::{detect, DetectInfo};
