#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::io::Write;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::sync::OnceLock;

#[cfg(any(target_os = "windows", target_os = "macos"))]
static PANIC_HOOK_INSTALLED: OnceLock<()> = OnceLock::new();

#[cfg(target_os = "windows")]
fn log_path() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("ladonx-crash.log")))
        .unwrap_or_else(|| std::path::PathBuf::from("ladonx-crash.log"))
}

#[cfg(target_os = "macos")]
fn log_path() -> std::path::PathBuf {
    let base_dir = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .map(|home| home.join("Library").join("Logs").join("LadonX"))
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(std::path::PathBuf::from)
                .map(|home| home.join("Library").join("Logs").join("LadonX"))
        })
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        })
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    base_dir.join("ladonx-startup.log")
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn write(message: impl AsRef<str>) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "unknown-time".to_string());
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "[{timestamp}] {}", message.as_ref());
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub(crate) fn write(_message: impl AsRef<str>) {}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn install_panic_hook() {
    let _ = PANIC_HOOK_INSTALLED.get_or_init(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            write(format!("panic: {info}"));
            previous(info);
        }));
    });
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub(crate) fn install_panic_hook() {}

#[tauri::command]
pub(crate) fn startup_log_write(message: String) {
    write(format!("frontend: {message}"));
}
