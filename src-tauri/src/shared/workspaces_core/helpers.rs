use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::types::{WorkspaceEntry, WorkspaceInfo};
use crate::utils::normalize_windows_namespace_path;

pub(crate) const WORKTREE_SETUP_MARKERS_DIR: &str = "worktree-setup";
pub(crate) const WORKTREE_SETUP_MARKER_EXT: &str = "ran";
pub(super) const AGENTS_MD_FILE_NAME: &str = "AGENTS.md";

pub(super) fn copy_agents_md_from_parent_to_worktree(
    parent_repo_root: &PathBuf,
    worktree_root: &PathBuf,
) -> Result<(), String> {
    let source_path = parent_repo_root.join(AGENTS_MD_FILE_NAME);
    if !source_path.is_file() {
        return Ok(());
    }

    let destination_path = worktree_root.join(AGENTS_MD_FILE_NAME);
    if destination_path.is_file() {
        return Ok(());
    }

    let temp_path = worktree_root.join(format!("{AGENTS_MD_FILE_NAME}.tmp"));

    std::fs::copy(&source_path, &temp_path).map_err(|err| {
        format!(
            "Failed to copy {} from {} to {}: {err}",
            AGENTS_MD_FILE_NAME,
            source_path.display(),
            temp_path.display()
        )
    })?;

    std::fs::rename(&temp_path, &destination_path).map_err(|err| {
        let _ = std::fs::remove_file(&temp_path);
        format!(
            "Failed to finalize {} copy to {}: {err}",
            AGENTS_MD_FILE_NAME,
            destination_path.display()
        )
    })?;

    Ok(())
}

pub(crate) fn normalize_setup_script(script: Option<String>) -> Option<String> {
    match script {
        Some(value) if value.trim().is_empty() => None,
        Some(value) => Some(value),
        None => None,
    }
}

pub(crate) fn worktree_setup_marker_path(data_dir: &PathBuf, workspace_id: &str) -> PathBuf {
    data_dir
        .join(WORKTREE_SETUP_MARKERS_DIR)
        .join(format!("{workspace_id}.{WORKTREE_SETUP_MARKER_EXT}"))
}

pub(crate) fn is_workspace_path_dir_core(path: &str) -> bool {
    normalize_workspace_path_input(path).is_dir()
}

pub(crate) fn normalize_workspace_path_input(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = crate::codex::home::resolve_home_dir() {
            return home.join(rest);
        }
    }
    if trimmed == "~" {
        if let Some(home) = crate::codex::home::resolve_home_dir() {
            return home;
        }
    }
    PathBuf::from(trimmed)
}

pub(crate) fn workspace_path_to_string(path: &PathBuf) -> String {
    normalize_windows_namespace_path(&path.to_string_lossy())
}

pub(crate) async fn list_workspaces_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
) -> Vec<WorkspaceInfo> {
    let workspaces = workspaces.lock().await;
    let sessions = sessions.lock().await;
    let mut result = Vec::new();
    for entry in workspaces.values() {
        result.push(WorkspaceInfo {
            id: entry.id.clone(),
            name: entry.name.clone(),
            path: entry.path.clone(),
            source: entry.source.clone(),
            connected: entry.source == "claude_code" || sessions.contains_key(&entry.id),
            kind: entry.kind.clone(),
            parent_id: entry.parent_id.clone(),
            worktree: entry.worktree.clone(),
            settings: entry.settings.clone(),
        });
    }
    sort_workspaces(&mut result);
    result
}

pub(super) async fn resolve_entry_and_parent(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<(WorkspaceEntry, Option<WorkspaceEntry>), String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not found".to_string())?;
    let parent_entry = entry
        .parent_id
        .as_ref()
        .and_then(|parent_id| workspaces.get(parent_id))
        .cloned();
    Ok((entry, parent_entry))
}

pub(super) async fn resolve_workspace_root(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not found".to_string())?;
    Ok(PathBuf::from(entry.path))
}

pub(super) fn sort_workspaces(workspaces: &mut [WorkspaceInfo]) {
    workspaces.sort_by(|a, b| {
        let a_order = a.settings.sort_order.unwrap_or(u32::MAX);
        let b_order = b.settings.sort_order.unwrap_or(u32::MAX);
        if a_order != b_order {
            return a_order.cmp(&b_order);
        }
        a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id))
    });
}
