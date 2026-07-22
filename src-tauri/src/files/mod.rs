use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use uuid::Uuid;

use self::io::TextFileResponse;
use self::policy::{FileKind, FileScope};
use crate::remote_backend;
use crate::shared::codex_core;
use crate::shared::files_core::{
    file_read_core, file_write_core, read_binary_file_path_core, BinaryFileResponse,
};
use crate::state::AppState;

pub(crate) mod io;
pub(crate) mod ops;
pub(crate) mod policy;

async fn file_read_impl(
    scope: FileScope,
    kind: FileKind,
    workspace_id: Option<String>,
    state: &AppState,
    app: &AppHandle,
) -> Result<TextFileResponse, String> {
    if remote_backend::is_remote_mode(state).await {
        let response = remote_backend::call_remote(
            state,
            app.clone(),
            "file_read",
            json!({ "scope": scope, "kind": kind, "workspaceId": workspace_id }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    file_read_core(&state.workspaces, scope, kind, workspace_id).await
}

async fn file_write_impl(
    scope: FileScope,
    kind: FileKind,
    workspace_id: Option<String>,
    content: String,
    state: &AppState,
    app: &AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(state).await {
        remote_backend::call_remote(
            state,
            app.clone(),
            "file_write",
            json!({
                "scope": scope,
                "kind": kind,
                "workspaceId": workspace_id,
                "content": content,
            }),
        )
        .await?;
        return Ok(());
    }

    file_write_core(&state.workspaces, scope, kind, workspace_id, content).await
}

#[tauri::command]
pub(crate) async fn file_read(
    scope: FileScope,
    kind: FileKind,
    workspace_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<TextFileResponse, String> {
    file_read_impl(scope, kind, workspace_id, &*state, &app).await
}

#[tauri::command]
pub(crate) async fn file_write(
    scope: FileScope,
    kind: FileKind,
    workspace_id: Option<String>,
    content: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    file_write_impl(scope, kind, workspace_id, content, &*state, &app).await
}

#[tauri::command]
pub(crate) async fn read_image_as_data_url(
    path: String,
    _state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<String, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Image path is required".to_string());
    }

    let normalized = codex_core::normalize_file_path(trimmed_path);
    if normalized.is_empty() {
        return Err("Image path is required".to_string());
    }

    codex_core::read_image_as_data_url_core(&normalized)
}

#[tauri::command]
pub(crate) fn save_clipboard_image_data_url(data_url: String) -> Result<String, String> {
    let trimmed = data_url.trim();
    let comma = trimmed
        .find(',')
        .ok_or_else(|| "Clipboard image data URL is invalid.".to_string())?;
    let header = &trimmed[..comma];
    if !header.starts_with("data:image/") || !header.contains(";base64") {
        return Err("Clipboard image must be a base64 image data URL.".to_string());
    }

    let mime = header
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .ok_or_else(|| "Clipboard image MIME type is missing.".to_string())?;
    let extension = match mime {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        _ => "png",
    };
    let bytes = STANDARD
        .decode(&trimmed[(comma + 1)..])
        .map_err(|err| format!("Failed to decode clipboard image: {err}"))?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set.".to_string())?;
    let dir = home.join(".ladonx").join("pasted-images");
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Failed to create pasted image directory: {err}"))?;
    let path = dir.join(format!("pasted-image-{}.{}", Uuid::new_v4(), extension));
    std::fs::write(&path, bytes).map_err(|err| format!("Failed to write pasted image: {err}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn write_text_file(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(path.trim());
    if target.as_os_str().is_empty() {
        return Err("Path is required".to_string());
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create export directory: {err}"))?;
        }
    }
    std::fs::write(&target, content).map_err(|err| format!("Failed to write export file: {err}"))
}

#[tauri::command]
pub(crate) async fn read_binary_file(
    workspace_id: String,
    relative_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<BinaryFileResponse, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "read_binary_file",
            json!({ "workspaceId": workspace_id, "relativePath": relative_path }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    let normalized_path = relative_path.replace('\\', "/");
    crate::shared::files_core::read_binary_file_core(
        &state.workspaces,
        &workspace_id,
        &normalized_path,
    )
    .await
}

#[tauri::command]
pub(crate) fn read_binary_file_path(path: String) -> Result<BinaryFileResponse, String> {
    read_binary_file_path_core(&path)
}

#[tauri::command]
pub(crate) fn read_text_file_path(path: String) -> Result<String, String> {
    let target = PathBuf::from(path.trim());
    if target.as_os_str().is_empty() {
        return Err("Path is required".to_string());
    }
    if !target.exists() {
        return Err("File not found".to_string());
    }
    std::fs::read_to_string(&target).map_err(|err| format!("Failed to read text file: {err}"))
}
