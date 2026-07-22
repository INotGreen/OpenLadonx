use base64::Engine;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::Mutex;

use crate::codex::home as codex_home;
use crate::files::io::TextFileResponse;
use crate::files::ops::{read_with_policy, write_with_policy};
use crate::files::policy::{policy_for, FileKind, FileScope};
use crate::shared::codex_core;
use crate::types::WorkspaceEntry;

fn resolve_default_codex_home() -> Result<PathBuf, String> {
    codex_home::resolve_default_codex_home()
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
}

async fn resolve_workspace_root(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    Ok(PathBuf::from(&entry.path))
}

pub(crate) async fn resolve_root_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    scope: FileScope,
    workspace_id: Option<&str>,
) -> Result<PathBuf, String> {
    match scope {
        FileScope::Global => resolve_default_codex_home(),
        FileScope::Workspace => {
            let workspace_id = workspace_id.ok_or_else(|| "workspaceId is required".to_string())?;
            resolve_workspace_root(workspaces, workspace_id).await
        }
    }
}

pub(crate) async fn file_read_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    scope: FileScope,
    kind: FileKind,
    workspace_id: Option<String>,
) -> Result<TextFileResponse, String> {
    let policy = policy_for(scope, kind)?;
    let root = resolve_root_core(workspaces, scope, workspace_id.as_deref()).await?;
    read_with_policy(&root, policy)
}

pub(crate) async fn file_write_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    scope: FileScope,
    kind: FileKind,
    workspace_id: Option<String>,
    content: String,
) -> Result<(), String> {
    let policy = policy_for(scope, kind)?;
    let root = resolve_root_core(workspaces, scope, workspace_id.as_deref()).await?;
    write_with_policy(&root, policy, &content)
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct BinaryFileResponse {
    pub base64: String,
    pub mime_type: String,
}

fn binary_file_response_for_path(path: &std::path::Path) -> Result<BinaryFileResponse, String> {
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {e} (path: {})", path.display()))?;
    let metadata = std::fs::metadata(&canonical_path).map_err(|e| {
        format!(
            "Failed to stat file: {e} (path: {})",
            canonical_path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!("Path is not a file: {}", canonical_path.display()));
    }

    let bytes = std::fs::read(&canonical_path).map_err(|e| {
        format!(
            "Failed to read file: {e} (path: {})",
            canonical_path.display()
        )
    })?;

    let base64_data = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let mime_type = mime_guess::from_path(&canonical_path)
        .first_or_octet_stream()
        .to_string();

    Ok(BinaryFileResponse {
        base64: base64_data,
        mime_type,
    })
}

#[allow(dead_code)]
pub(crate) fn read_binary_file_path_core(path: &str) -> Result<BinaryFileResponse, String> {
    let normalized = codex_core::normalize_file_path(path);
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!("Path must be absolute: {}", path.display()));
    }
    binary_file_response_for_path(&path)
}

pub(crate) async fn read_binary_file_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    relative_path: &str,
) -> Result<BinaryFileResponse, String> {
    let root = resolve_workspace_root(workspaces, workspace_id).await?;

    // Normalize path separators for Windows compatibility
    let normalized_path = relative_path.replace('\\', "/");
    let full_path = root.join(&normalized_path);

    if !full_path.exists() {
        return Err(format!(
            "File not found: {} (workspace: {}, full path: {})",
            relative_path,
            workspace_id,
            full_path.display()
        ));
    }

    // Canonicalize both paths for proper comparison (handles symlinks)
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve workspace root: {e}"))?;

    let canonical_path = full_path.canonicalize().map_err(|e| {
        format!(
            "Failed to resolve path: {e} (path: {})",
            full_path.display()
        )
    })?;

    // Check if the file is within workspace using prefix match
    let canonical_root_str = canonical_root.to_string_lossy().to_string();
    let canonical_path_str = canonical_path.to_string_lossy().to_string();

    // Add trailing slash for proper prefix matching
    let root_prefix = if canonical_root_str.ends_with('/') {
        canonical_root_str
    } else {
        format!("{}/", canonical_root_str)
    };

    if !canonical_path_str.starts_with(&root_prefix) {
        return Err(format!(
            "Path is outside workspace: {} (workspace root: {})",
            canonical_path.display(),
            root.display()
        ));
    }

    binary_file_response_for_path(&canonical_path)
}
