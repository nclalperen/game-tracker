use std::{env, fs, io::Write, path::{Path, PathBuf}, process::{Command, Stdio}, time::{Duration, Instant}};

use dirs;
use tauri::Manager;

fn ally_mode() -> String {
  env::var("ALLY_MODE").unwrap_or_else(|_| "cli".into())
}

fn ally_bin_env() -> Option<String> {
  env::var("ALLY_BIN").ok().filter(|s| !s.is_empty())
}

fn ally_data_dir() -> PathBuf {
  if let Ok(p) = env::var("ALLY_DATA_DIR") {
    if !p.is_empty() {
      return PathBuf::from(p);
    }
  }
  dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    .join("GameTracker")
    .join("ally-data")
}

fn bundled_ally_dir(app: &tauri::AppHandle) -> PathBuf {
  app
    .path()
    .resource_dir()
    .expect("no resource dir")
    .join("bin")
    .join("ally")
}

fn bundled_main_path(app: &tauri::AppHandle) -> PathBuf {
  bundled_ally_dir(app).join("main.py")
}

#[cfg(target_os = "windows")]
const PYTHON_CANDIDATES: &[&str] = &["python", "py"];

#[cfg(not(target_os = "windows"))]
const PYTHON_CANDIDATES: &[&str] = &["python3", "python"];

fn run_python(main_script: &Path, args: &[&str]) -> Result<std::process::Output, String> {
  let workdir = main_script.parent().unwrap_or_else(|| Path::new("."));
  let mut last_err = None;

  for candidate in PYTHON_CANDIDATES {
    match Command::new(candidate)
      .arg(main_script)
      .args(args)
      .current_dir(workdir)
      .output()
    {
      Ok(output) => return Ok(output),
      Err(err) => last_err = Some(err),
    }
  }

  Err(format!(
    "Unable to launch Python interpreter (tried: {}). {}",
    PYTHON_CANDIDATES.join(", "),
    last_err
      .map(|e| e.to_string())
      .unwrap_or_else(|| "No interpreter found".into())
  ))
}

fn run_configured_binary(bin: &str, args: &[&str]) -> Result<std::process::Output, String> {
  let bin_path = PathBuf::from(bin);
  let mut command = if bin_path.exists() {
    let mut cmd = Command::new(&bin_path);
    if let Some(parent) = bin_path.parent() {
      if !parent.as_os_str().is_empty() {
        cmd.current_dir(parent);
      }
    }
    cmd
  } else {
    Command::new(bin)
  };

  command.args(args);
  command.output().map_err(|e| e.to_string())
}

fn build_base_command(app: &tauri::AppHandle, args: &[&str]) -> Result<Command, String> {
  let mode = ally_mode();
  if mode.eq_ignore_ascii_case("docker") {
    let name = env::var("ALLY_DOCKER_NAME").unwrap_or_else(|_| "ally".into());
    let mut cmd = Command::new("docker");
    cmd.args(["exec", &name, "ally"]).args(args);
    return Ok(cmd);
  }

  if let Some(bin) = ally_bin_env() {
    let bin_path = PathBuf::from(&bin);
    let mut cmd = if bin_path.exists() {
      let mut c = Command::new(&bin_path);
      if let Some(parent) = bin_path.parent() {
        if !parent.as_os_str().is_empty() {
          c.current_dir(parent);
        }
      }
      c
    } else {
      Command::new(&bin)
    };
    cmd.args(args);
    return Ok(cmd);
  }

  let main_script = bundled_main_path(app);
  let workdir = main_script.parent().unwrap_or_else(|| Path::new("."));
  for candidate in PYTHON_CANDIDATES {
    let mut cmd = Command::new(candidate);
    cmd.arg(&main_script);
    cmd.args(args);
    cmd.current_dir(workdir);
    return Ok(cmd);
  }

  Err(format!(
    "No Python interpreter found (tried: {})",
    PYTHON_CANDIDATES.join(", ")
  ))
}

fn exec_with_stdin(
  app: &tauri::AppHandle,
  args: &[&str],
  stdin_payload: Option<&str>,
  timeout: Duration,
) -> Result<String, String> {
  let mut cmd = build_base_command(app, args)?;

  if stdin_payload.is_some() {
    cmd.stdin(Stdio::piped());
  }
  cmd.stdout(Stdio::piped());
  cmd.stderr(Stdio::piped());

  let mut child = cmd.spawn().map_err(|e| e.to_string())?;

  if let Some(body) = stdin_payload {
    if let Some(mut stdin) = child.stdin.take() {
      stdin.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    } else {
      return Err("ally command missing stdin".into());
    }
  }

  let start = Instant::now();
  loop {
    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
      let output = child.wait_with_output().map_err(|e| e.to_string())?;
      if status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
      } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return if stderr.is_empty() {
          Err("ally command failed".into())
        } else {
          Err(stderr)
        };
      }
    }

    if start.elapsed() > timeout {
      let _ = child.kill();
      let _ = child.wait();
      return Err("ally command timeout".into());
    }

    std::thread::sleep(Duration::from_millis(50));
  }
}

pub fn ally_exec(app: &tauri::AppHandle, args: &[&str]) -> Result<String, String> {
  let mode = ally_mode();
  let output = if mode.eq_ignore_ascii_case("docker") {
    let name = env::var("ALLY_DOCKER_NAME").unwrap_or_else(|_| "ally".into());
    Command::new("docker")
      .args(["exec", &name, "ally"])
      .args(args)
      .output()
      .map_err(|e| e.to_string())?
  } else if let Some(bin) = ally_bin_env() {
    run_configured_binary(&bin, args)?
  } else {
    let main_script = bundled_main_path(app);
    run_python(&main_script, args)?
  };

  if output.status.success() {
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
      Err("Ally command exited with a non-zero status".into())
    } else {
      Err(stderr)
    }
  }
}

pub fn ally_version(app: &tauri::AppHandle) -> Result<String, String> {
  let mut version = ally_exec(app, &["--version"])?;
  if version.is_empty() {
    version = "ally".into();
  }
  Ok(version)
}

pub fn ally_data_dir_path() -> PathBuf {
  ally_data_dir()
}

pub fn ally_write_file(label: &str, filename: &str, contents: &str) -> Result<usize, String> {
  let dir = ally_data_dir().join(label);
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let path = dir.join(filename);
  let mut f = fs::File::create(&path).map_err(|e| e.to_string())?;
  f.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
  Ok(contents.len())
}

pub fn ally_embed(app: &tauri::AppHandle, label: &str) -> Result<String, String> {
  let dir = ally_data_dir().join(label);
  let dir_str = dir.to_string_lossy().to_string();
  exec_with_stdin(app, &["embed", &dir_str, label], None, Duration::from_secs(60))
}

pub fn ally_start_rag(app: &tauri::AppHandle, label: &str) -> Result<String, String> {
  exec_with_stdin(app, &["start_rag", label], None, Duration::from_secs(30))
}

pub fn ally_chat(
  app: &tauri::AppHandle,
  session: &str,
  message: &str,
  allow_web: bool,
) -> Result<String, String> {
  let mut args = vec!["chat", "--session", session];
  if allow_web {
    args.push("--allow-web");
  }
  args.push("--stdin");
  exec_with_stdin(app, &args, Some(message), Duration::from_secs(60))
}
