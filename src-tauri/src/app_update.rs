use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

use crate::state::AppState;
use crate::types::{AppUpdateDownloadState, AppUpdateDownloadStatus, AppUpdatePlatformInfo};

#[derive(Default)]
pub(crate) struct AppUpdateState {
    pub(crate) status: AppUpdateDownloadStatus,
    pub(crate) cancel_flag: Option<Arc<AtomicBool>>,
    pub(crate) download_task: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateDownloadInput {
    pub(crate) version: String,
    pub(crate) download_url: String,
    pub(crate) file_name: String,
    pub(crate) expected_sha256: Option<String>,
    pub(crate) expected_size: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateManifestResponse {
    pub(crate) body: String,
}

impl Default for AppUpdateDownloadStatus {
    fn default() -> Self {
        Self {
            state: AppUpdateDownloadState::Idle,
            version: None,
            file_name: None,
            path: None,
            download_url: None,
            downloaded_bytes: 0,
            total_bytes: None,
            error: None,
        }
    }
}

fn current_platform_info() -> AppUpdatePlatformInfo {
    let os = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    };

    let arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "unknown"
    };

    let target_key = match (os, arch) {
        ("macos", "x86_64") => "mac_amd_64",
        ("macos", "aarch64") => "mac_arm_64",
        ("windows", "x86_64") => "win_amd_64",
        ("windows", "aarch64") => "win_arm_64",
        _ => "unsupported",
    };

    AppUpdatePlatformInfo {
        os: os.to_string(),
        arch: arch.to_string(),
        target_key: target_key.to_string(),
    }
}

fn sanitize_file_name(value: &str) -> String {
    Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("ladonx-update.bin")
        .to_string()
}

fn normalize_hex(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

async fn compute_sha256(path: &Path) -> Result<String, String> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| format!("Failed to read update file for verification: {error}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

fn update_download_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .download_dir()
        .unwrap_or_else(|_| {
            app.path()
                .app_data_dir()
                .unwrap_or_else(|_| crate::settings::current_working_dir())
                .join("updates")
        })
        .join("LadonX")
}

#[cfg(target_os = "macos")]
fn current_app_bundle_path() -> Result<PathBuf, String> {
    let exe_path = crate::settings::current_exe_path()
        .ok_or_else(|| "Unable to locate current executable.".to_string())?;
    for ancestor in exe_path.ancestors() {
        if ancestor
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("app"))
            .unwrap_or(false)
        {
            return Ok(ancestor.to_path_buf());
        }
    }
    Err("Unable to locate current app bundle.".to_string())
}

fn spawn_self_update_helper(app: &AppHandle, source_path: &Path) -> Result<(), String> {
    let current_exe = crate::settings::current_exe_path()
        .ok_or_else(|| "Unable to locate current executable.".to_string())?;
    let helper_file_name = if cfg!(target_os = "windows") {
        // Avoid installer/update keywords in the helper filename.
        // Windows installer detection can treat names like `updater.exe`
        // as elevation-requiring setup programs and reject CreateProcess with
        // ERROR_ELEVATION_REQUIRED (740) from a normal user session.
        format!("ladonx_worker_{}.exe", std::process::id())
    } else {
        format!("ladonx_worker_{}", std::process::id())
    };
    let helper_path = update_download_dir(app).join(helper_file_name);

    #[cfg(target_os = "macos")]
    let target_path = current_app_bundle_path()?;
    #[cfg(target_os = "macos")]
    let restart_path = target_path.clone();

    #[cfg(not(target_os = "macos"))]
    let target_path = current_exe.clone();
    #[cfg(not(target_os = "macos"))]
    let restart_path = current_exe.clone();

    let plan = crate::self_update_helper::SelfUpdatePlan {
        wait_pid: std::process::id(),
        source_path: source_path.to_path_buf(),
        target_path,
        restart_path,
        helper_source_path: current_exe,
        helper_path,
    };
    crate::self_update_helper::spawn_helper(&plan)
}

fn emit_status(app: &AppHandle, status: &AppUpdateDownloadStatus) {
    let _ = app.emit("app-update-download", status);
}

async fn clear_download_state(state: &State<'_, AppState>) {
    let mut app_update = state.app_update.lock().await;
    app_update.cancel_flag = None;
    app_update.download_task = None;
}

async fn update_status(
    app: &AppHandle,
    state: &State<'_, AppState>,
    status: AppUpdateDownloadStatus,
) {
    {
        let mut app_update = state.app_update.lock().await;
        app_update.status = status.clone();
    }
    emit_status(app, &status);
}

#[tauri::command]
pub(crate) fn app_update_platform_info() -> AppUpdatePlatformInfo {
    current_platform_info()
}

#[tauri::command]
pub(crate) async fn app_update_fetch_manifest(
    url: String,
) -> Result<AppUpdateManifestResponse, String> {
    let manifest_url = url.trim();
    if manifest_url.is_empty() {
        return Err("Missing update manifest URL.".to_string());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed to configure update manifest request: {error}"))?;

    let response = client
        .get(manifest_url)
        .send()
        .await
        .map_err(|error| format!("Failed to load update manifest: {error}"))?;

    let response = response
        .error_for_status()
        .map_err(|error| format!("Update manifest request failed: {error}"))?;

    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read update manifest: {error}"))?;

    Ok(AppUpdateManifestResponse { body })
}

#[tauri::command]
pub(crate) async fn app_update_download_status(
    state: State<'_, AppState>,
) -> Result<AppUpdateDownloadStatus, String> {
    let app_update = state.app_update.lock().await;
    Ok(app_update.status.clone())
}

#[tauri::command]
pub(crate) async fn app_update_download(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AppUpdateDownloadInput,
) -> Result<AppUpdateDownloadStatus, String> {
    if input.version.trim().is_empty() {
        return Err("Missing update version.".to_string());
    }
    if input.download_url.trim().is_empty() {
        return Err("Missing update download URL.".to_string());
    }
    if let Some(expected_sha256) = &input.expected_sha256 {
        if expected_sha256.trim().is_empty() {
            return Err("Update checksum cannot be empty.".to_string());
        }
    }

    let file_name = sanitize_file_name(&input.file_name);
    let download_dir = update_download_dir(&app);
    let final_path = download_dir.join(&file_name);
    let temp_path = download_dir.join(format!("{file_name}.part"));

    let current = {
        let app_update = state.app_update.lock().await;
        app_update.status.clone()
    };
    if current.state == AppUpdateDownloadState::Downloading
        && current.version.as_deref() == Some(input.version.as_str())
        && current.download_url.as_deref() == Some(input.download_url.as_str())
    {
        return Ok(current);
    }
    if current.state == AppUpdateDownloadState::Downloaded
        && current.version.as_deref() == Some(input.version.as_str())
        && current.path.as_deref() == final_path.to_str()
    {
        return Ok(current);
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut app_update = state.app_update.lock().await;
        if let Some(flag) = app_update.cancel_flag.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(task) = app_update.download_task.take() {
            task.abort();
        }
        app_update.cancel_flag = Some(cancel_flag.clone());
        app_update.status = AppUpdateDownloadStatus {
            state: AppUpdateDownloadState::Downloading,
            version: Some(input.version.clone()),
            file_name: Some(file_name.clone()),
            path: Some(final_path.display().to_string()),
            download_url: Some(input.download_url.clone()),
            downloaded_bytes: 0,
            total_bytes: None,
            error: None,
        };
    }
    {
        let app_update = state.app_update.lock().await;
        emit_status(&app, &app_update.status);
    }

    let app_handle = app.clone();
    let task = tokio::spawn(async move {
        let state = app_handle.state::<AppState>();
        if let Err(error) = tokio::fs::create_dir_all(&download_dir).await {
            update_status(
                &app_handle,
                &state,
                AppUpdateDownloadStatus {
                    state: AppUpdateDownloadState::Error,
                    version: Some(input.version.clone()),
                    file_name: Some(file_name.clone()),
                    path: Some(final_path.display().to_string()),
                    download_url: Some(input.download_url.clone()),
                    downloaded_bytes: 0,
                    total_bytes: None,
                    error: Some(format!("Failed to create update directory: {error}")),
                },
            )
            .await;
            clear_download_state(&state).await;
            return;
        }

        let client = match reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60 * 60))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                update_status(
                    &app_handle,
                    &state,
                    AppUpdateDownloadStatus {
                        state: AppUpdateDownloadState::Error,
                        version: Some(input.version.clone()),
                        file_name: Some(file_name.clone()),
                        path: Some(final_path.display().to_string()),
                        download_url: Some(input.download_url.clone()),
                        downloaded_bytes: 0,
                        total_bytes: None,
                        error: Some(format!("Failed to configure update downloader: {error}")),
                    },
                )
                .await;
                clear_download_state(&state).await;
                return;
            }
        };

        let response = match client.get(&input.download_url).send().await {
            Ok(response) => response,
            Err(error) => {
                update_status(
                    &app_handle,
                    &state,
                    AppUpdateDownloadStatus {
                        state: AppUpdateDownloadState::Error,
                        version: Some(input.version.clone()),
                        file_name: Some(file_name.clone()),
                        path: Some(final_path.display().to_string()),
                        download_url: Some(input.download_url.clone()),
                        downloaded_bytes: 0,
                        total_bytes: None,
                        error: Some(format!("Failed to start update download: {error}")),
                    },
                )
                .await;
                clear_download_state(&state).await;
                return;
            }
        };

        let response = match response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                update_status(
                    &app_handle,
                    &state,
                    AppUpdateDownloadStatus {
                        state: AppUpdateDownloadState::Error,
                        version: Some(input.version.clone()),
                        file_name: Some(file_name.clone()),
                        path: Some(final_path.display().to_string()),
                        download_url: Some(input.download_url.clone()),
                        downloaded_bytes: 0,
                        total_bytes: None,
                        error: Some(format!("Update download failed: {error}")),
                    },
                )
                .await;
                clear_download_state(&state).await;
                return;
            }
        };

        let total = response.content_length();
        let mut downloaded = 0u64;
        let mut file = match tokio::fs::File::create(&temp_path).await {
            Ok(file) => file,
            Err(error) => {
                update_status(
                    &app_handle,
                    &state,
                    AppUpdateDownloadStatus {
                        state: AppUpdateDownloadState::Error,
                        version: Some(input.version.clone()),
                        file_name: Some(file_name.clone()),
                        path: Some(final_path.display().to_string()),
                        download_url: Some(input.download_url.clone()),
                        downloaded_bytes: 0,
                        total_bytes: total,
                        error: Some(format!("Failed to create update file: {error}")),
                    },
                )
                .await;
                clear_download_state(&state).await;
                return;
            }
        };

        let mut response = response;
        let mut last_progress = Instant::now();
        loop {
            let canceled = {
                let app_update = state.app_update.lock().await;
                app_update
                    .cancel_flag
                    .as_ref()
                    .map(|flag| flag.load(Ordering::Relaxed))
                    .unwrap_or(false)
            };
            if canceled {
                let _ = tokio::fs::remove_file(&temp_path).await;
                update_status(&app_handle, &state, AppUpdateDownloadStatus::default()).await;
                clear_download_state(&state).await;
                return;
            }

            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(error) => {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    update_status(
                        &app_handle,
                        &state,
                        AppUpdateDownloadStatus {
                            state: AppUpdateDownloadState::Error,
                            version: Some(input.version.clone()),
                            file_name: Some(file_name.clone()),
                            path: Some(final_path.display().to_string()),
                            download_url: Some(input.download_url.clone()),
                            downloaded_bytes: downloaded,
                            total_bytes: total,
                            error: Some(format!("Update download failed: {error}")),
                        },
                    )
                    .await;
                    clear_download_state(&state).await;
                    return;
                }
            };

            if let Err(error) = file.write_all(&chunk).await {
                let _ = tokio::fs::remove_file(&temp_path).await;
                update_status(
                    &app_handle,
                    &state,
                    AppUpdateDownloadStatus {
                        state: AppUpdateDownloadState::Error,
                        version: Some(input.version.clone()),
                        file_name: Some(file_name.clone()),
                        path: Some(final_path.display().to_string()),
                        download_url: Some(input.download_url.clone()),
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        error: Some(format!("Failed to write update file: {error}")),
                    },
                )
                .await;
                clear_download_state(&state).await;
                return;
            }

            downloaded += chunk.len() as u64;
            if last_progress.elapsed() >= Duration::from_millis(150) {
                last_progress = Instant::now();
                update_status(
                    &app_handle,
                    &state,
                    AppUpdateDownloadStatus {
                        state: AppUpdateDownloadState::Downloading,
                        version: Some(input.version.clone()),
                        file_name: Some(file_name.clone()),
                        path: Some(final_path.display().to_string()),
                        download_url: Some(input.download_url.clone()),
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        error: None,
                    },
                )
                .await;
            }
        }

        if let Err(error) = file.flush().await {
            let _ = tokio::fs::remove_file(&temp_path).await;
            update_status(
                &app_handle,
                &state,
                AppUpdateDownloadStatus {
                    state: AppUpdateDownloadState::Error,
                    version: Some(input.version.clone()),
                    file_name: Some(file_name.clone()),
                    path: Some(final_path.display().to_string()),
                    download_url: Some(input.download_url.clone()),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    error: Some(format!("Failed to finalize update file: {error}")),
                },
            )
            .await;
            clear_download_state(&state).await;
            return;
        }

        // Sync to disk and close the file handle before rename to avoid
        // ENOENT errors on macOS when the file is still open.
        let _ = file.sync_all().await;
        drop(file);

        // Try rename first; fall back to copy+remove if rename fails
        // (can happen on macOS with sandboxed download directories).
        let move_result = match tokio::fs::rename(&temp_path, &final_path).await {
            Ok(()) => Ok(()),
            Err(rename_error) => {
                match tokio::fs::copy(&temp_path, &final_path).await {
                    Ok(_) => {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        Ok(())
                    }
                    Err(copy_error) => Err(format!(
                        "Failed to move update into place: {} (copy fallback also failed: {}; temp={}, final={})",
                        rename_error,
                        copy_error,
                        temp_path.display(),
                        final_path.display()
                    )),
                }
            }
        };

        if let Err(error) = move_result {
            update_status(
                &app_handle,
                &state,
                AppUpdateDownloadStatus {
                    state: AppUpdateDownloadState::Error,
                    version: Some(input.version.clone()),
                    file_name: Some(file_name.clone()),
                    path: Some(final_path.display().to_string()),
                    download_url: Some(input.download_url.clone()),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    error: Some(error),
                },
            )
            .await;
            clear_download_state(&state).await;
            return;
        }

        if let Some(expected_size) = input.expected_size {
            match tokio::fs::metadata(&final_path).await {
                Ok(metadata) if metadata.len() != expected_size => {
                    let _ = tokio::fs::remove_file(&final_path).await;
                    update_status(
                        &app_handle,
                        &state,
                        AppUpdateDownloadStatus {
                            state: AppUpdateDownloadState::Error,
                            version: Some(input.version.clone()),
                            file_name: Some(file_name.clone()),
                            path: Some(final_path.display().to_string()),
                            download_url: Some(input.download_url.clone()),
                            downloaded_bytes: downloaded,
                            total_bytes: total,
                            error: Some(format!(
                                "Update size verification failed: expected {expected_size} bytes."
                            )),
                        },
                    )
                    .await;
                    clear_download_state(&state).await;
                    return;
                }
                Err(error) => {
                    let _ = tokio::fs::remove_file(&final_path).await;
                    update_status(
                        &app_handle,
                        &state,
                        AppUpdateDownloadStatus {
                            state: AppUpdateDownloadState::Error,
                            version: Some(input.version.clone()),
                            file_name: Some(file_name.clone()),
                            path: Some(final_path.display().to_string()),
                            download_url: Some(input.download_url.clone()),
                            downloaded_bytes: downloaded,
                            total_bytes: total,
                            error: Some(format!(
                                "Failed to read downloaded update metadata: {error}"
                            )),
                        },
                    )
                    .await;
                    clear_download_state(&state).await;
                    return;
                }
                _ => {}
            }
        }

        if let Some(expected_sha256) = &input.expected_sha256 {
            match compute_sha256(&final_path).await {
                Ok(actual_sha256) if actual_sha256 != normalize_hex(expected_sha256) => {
                    let _ = tokio::fs::remove_file(&final_path).await;
                    update_status(
                        &app_handle,
                        &state,
                        AppUpdateDownloadStatus {
                            state: AppUpdateDownloadState::Error,
                            version: Some(input.version.clone()),
                            file_name: Some(file_name.clone()),
                            path: Some(final_path.display().to_string()),
                            download_url: Some(input.download_url.clone()),
                            downloaded_bytes: downloaded,
                            total_bytes: total,
                            error: Some("Update checksum verification failed.".to_string()),
                        },
                    )
                    .await;
                    clear_download_state(&state).await;
                    return;
                }
                Err(error) => {
                    let _ = tokio::fs::remove_file(&final_path).await;
                    update_status(
                        &app_handle,
                        &state,
                        AppUpdateDownloadStatus {
                            state: AppUpdateDownloadState::Error,
                            version: Some(input.version.clone()),
                            file_name: Some(file_name.clone()),
                            path: Some(final_path.display().to_string()),
                            download_url: Some(input.download_url.clone()),
                            downloaded_bytes: downloaded,
                            total_bytes: total,
                            error: Some(error),
                        },
                    )
                    .await;
                    clear_download_state(&state).await;
                    return;
                }
                _ => {}
            }
        }

        update_status(
            &app_handle,
            &state,
            AppUpdateDownloadStatus {
                state: AppUpdateDownloadState::Downloaded,
                version: Some(input.version.clone()),
                file_name: Some(file_name.clone()),
                path: Some(final_path.display().to_string()),
                download_url: Some(input.download_url.clone()),
                downloaded_bytes: downloaded,
                total_bytes: total,
                error: None,
            },
        )
        .await;
        clear_download_state(&state).await;
    });

    {
        let mut app_update = state.app_update.lock().await;
        app_update.download_task = Some(task);
        Ok(app_update.status.clone())
    }
}

#[tauri::command]
pub(crate) async fn app_update_cancel_download(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppUpdateDownloadStatus, String> {
    let file_name = {
        let mut app_update = state.app_update.lock().await;
        if let Some(flag) = app_update.cancel_flag.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(task) = app_update.download_task.take() {
            task.abort();
        }
        let file_name = app_update.status.file_name.clone();
        app_update.status = AppUpdateDownloadStatus::default();
        file_name
    };
    if let Some(file_name) = file_name {
        let temp_path = update_download_dir(&app).join(format!("{file_name}.part"));
        let _ = tokio::fs::remove_file(temp_path).await;
    }
    let status = AppUpdateDownloadStatus::default();
    emit_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub(crate) async fn app_update_install_and_restart(
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    let installer_path = PathBuf::from(path.trim());
    crate::startup_log::write(format!(
        "app_update_install_and_restart: requested path={}",
        installer_path.display()
    ));
    if installer_path.as_os_str().is_empty() {
        return Err("Missing installer path.".to_string());
    }
    if !installer_path.exists() {
        return Err("Installer file does not exist.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        crate::startup_log::write("app_update_install_and_restart: spawning macOS helper");
        spawn_self_update_helper(&app, &installer_path)?;
        crate::startup_log::write("app_update_install_and_restart: exiting current app");
        app.exit(0);
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        crate::startup_log::write("app_update_install_and_restart: spawning Windows helper");
        spawn_self_update_helper(&app, &installer_path)?;
        crate::startup_log::write("app_update_install_and_restart: exiting current app");
        app.exit(0);
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        crate::startup_log::write("app_update_install_and_restart: spawning Unix helper");
        spawn_self_update_helper(&app, &installer_path)?;
        crate::startup_log::write("app_update_install_and_restart: exiting current app");
        app.exit(0);
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Automatic update install is not supported on this platform.".to_string())
}
