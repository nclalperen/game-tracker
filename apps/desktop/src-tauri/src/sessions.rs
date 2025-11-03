use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use chrono::{SecondsFormat, Utc};
use tauri::Emitter;

#[cfg(target_os = "windows")]
use windows::{
    Win32::{
        Foundation::{CloseHandle, HMODULE, HWND},
        System::{
            ProcessStatus::K32GetModuleBaseNameW,
            Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ},
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId},
    },
};

static ENABLED: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Default)]
struct NowPlaying {
    exe: String,
    title: Option<String>,
}

static NOW_PLAYING: once_cell::sync::Lazy<Mutex<Option<NowPlaying>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(target_os = "windows")]
unsafe fn get_active_window() -> Option<HWND> {
    let hwnd = GetForegroundWindow();
    if hwnd.0 == 0 {
        None
    } else {
        Some(hwnd)
    }
}

#[cfg(target_os = "windows")]
unsafe fn get_window_title(hwnd: HWND) -> Option<String> {
    let mut buf: Vec<u16> = vec![0u16; 512];
    let len = GetWindowTextW(hwnd, buf.as_mut_slice());
    if len == 0 {
        return None;
    }
    String::from_utf16(&buf[..len as usize]).ok()
}

#[cfg(target_os = "windows")]
unsafe fn get_exe_name_for_window(hwnd: HWND) -> Option<String> {
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        return None;
    }

    let process = match OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
        false,
        pid,
    ) {
        Ok(handle) => handle,
        Err(_) => return None,
    };

    let mut buffer = vec![0u16; 260];
    let len = K32GetModuleBaseNameW(process, HMODULE::default(), buffer.as_mut_slice());
    let _ = CloseHandle(process);
    if len == 0 {
        return None;
    }

    String::from_utf16(&buffer[..len as usize]).ok()
}

#[cfg(not(target_os = "windows"))]
fn get_active_window_info() -> Option<(String, Option<String>)> {
    None
}

#[cfg(target_os = "windows")]
fn get_active_window_info() -> Option<(String, Option<String>)> {
    unsafe {
        let hwnd = get_active_window()?;
        let title = get_window_title(hwnd);
        let exe = get_exe_name_for_window(hwnd)
            .or_else(|| title.clone())
            .unwrap_or_else(|| "unknown".to_owned());
        Some((exe, title))
    }
}

pub fn sessions_now_playing() -> Option<String> {
    NOW_PLAYING
        .lock()
        .ok()
        .and_then(|guard| guard.clone().map(|entry| entry.exe))
}

pub fn sessions_enable(app: tauri::AppHandle, enable: bool) -> Result<(), String> {
    ENABLED.store(enable, Ordering::SeqCst);
    if enable && !STARTED.load(Ordering::SeqCst) {
        STARTED.store(true, Ordering::SeqCst);
        let handle = app.clone();
        thread::spawn(move || {
            run_loop(handle);
        });
    }
    Ok(())
}

fn run_loop(app: tauri::AppHandle) {
    #[derive(Clone)]
    struct Pending {
        exe: String,
        title: Option<String>,
        started_instant: Instant,
        started_iso: String,
        started_emitted: bool,
    }

    let poll_interval = Duration::from_millis(1000);
    let min_duration = Duration::from_secs(5);
    let mut current: Option<Pending> = None;

    loop {
        if !ENABLED.load(Ordering::SeqCst) {
            if current.is_some() {
                current = None;
                let _ = NOW_PLAYING.lock().map(|mut guard| *guard = None);
            }
            thread::sleep(poll_interval);
            continue;
        }

        let info = get_active_window_info();
        match (&mut current, info) {
            (None, Some((exe, title))) => {
                current = Some(Pending {
                    exe: exe.clone(),
                    title: title.clone(),
                    started_instant: Instant::now(),
                    started_iso: now_iso(),
                    started_emitted: false,
                });
                let _ = NOW_PLAYING
                    .lock()
                    .map(|mut guard| *guard = Some(NowPlaying { exe, title }));
            }
            (Some(pending), Some((exe, title))) => {
                if pending.exe.eq_ignore_ascii_case(&exe) {
                    if !pending.started_emitted && pending.started_instant.elapsed() >= min_duration {
                        let _ = app.emit(
                            "session_started",
                            serde_json::json!({
                                "exe": pending.exe,
                                "title": pending.title,
                                "startedAtISO": pending.started_iso,
                            }),
                        );
                        pending.started_emitted = true;
                    }
                    let _ = NOW_PLAYING.lock().map(|mut guard| {
                        *guard = Some(NowPlaying {
                            exe: exe.clone(),
                            title: title.clone(),
                        })
                    });
                    if pending.title != title {
                        pending.title = title;
                    }
                } else {
                    if pending.started_emitted {
                        let ended_iso = now_iso();
                        let duration_ms = pending.started_instant.elapsed().as_millis() as u64;
                        if duration_ms >= min_duration.as_millis() as u64 {
                            let _ = app.emit(
                                "session_stopped",
                                serde_json::json!({
                                    "exe": pending.exe,
                                    "endedAtISO": ended_iso,
                                    "durationMs": duration_ms,
                                }),
                            );
                        }
                    }
                    current = Some(Pending {
                        exe: exe.clone(),
                        title: title.clone(),
                        started_instant: Instant::now(),
                        started_iso: now_iso(),
                        started_emitted: false,
                    });
                    let _ = NOW_PLAYING
                        .lock()
                        .map(|mut guard| *guard = Some(NowPlaying { exe, title }));
                }
            }
            (Some(pending), None) => {
                if pending.started_emitted {
                    let ended_iso = now_iso();
                    let duration_ms = pending.started_instant.elapsed().as_millis() as u64;
                    if duration_ms >= min_duration.as_millis() as u64 {
                        let _ = app.emit(
                            "session_stopped",
                            serde_json::json!({
                                "exe": pending.exe,
                                "endedAtISO": ended_iso,
                                "durationMs": duration_ms,
                            }),
                        );
                    }
                }
                current = None;
                let _ = NOW_PLAYING.lock().map(|mut guard| *guard = None);
            }
            (None, None) => {}
        }

        thread::sleep(poll_interval);
    }
}
