use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::codex::args::resolve_workspace_codex_args;
use crate::codex::home::resolve_workspace_codex_home;
use crate::shared::process_core::kill_child_process_tree;
use crate::types::{AppSettings, WorkspaceEntry};

use super::connect::workspace_session_spawn_lock;
use super::helpers::resolve_entry_and_parent;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceRuntimeCodexArgsResult {
    pub(crate) applied_codex_args: Option<String>,
    pub(crate) respawned: bool,
}

pub(crate) async fn set_workspace_runtime_codex_args_core<F, Fut>(
    workspace_id: String,
    codex_args_override: Option<String>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    spawn_session: F,
) -> Result<WorkspaceRuntimeCodexArgsResult, String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    let (entry, parent_entry) = resolve_entry_and_parent(workspaces, &workspace_id).await?;
    let _spawn_guard = workspace_session_spawn_lock().lock().await;

    let (default_bin, resolved_args) = {
        let settings = app_settings.lock().await;
        (
            settings.codex_bin.clone(),
            resolve_workspace_codex_args(&entry, parent_entry.as_ref(), Some(&settings)),
        )
    };

    let target_args = codex_args_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(resolved_args);

    // If we are not connected, we can't respawn. Treat this as a no-op success; callers
    // should call again after connecting.
    let (workspace_connected, current_session) = {
        let sessions = sessions.lock().await;
        (
            sessions.contains_key(&entry.id),
            sessions.values().next().cloned(),
        )
    };
    if !workspace_connected {
        return Ok(WorkspaceRuntimeCodexArgsResult {
            applied_codex_args: target_args,
            respawned: false,
        });
    }

    let Some(current_session) = current_session else {
        return Ok(WorkspaceRuntimeCodexArgsResult {
            applied_codex_args: target_args,
            respawned: false,
        });
    };

    if current_session.codex_args == target_args {
        return Ok(WorkspaceRuntimeCodexArgsResult {
            applied_codex_args: target_args,
            respawned: false,
        });
    }

    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref());
    let new_session =
        spawn_session(entry.clone(), default_bin, target_args.clone(), codex_home).await?;
    let workspace_ids = {
        let mut sessions = sessions.lock().await;
        let keys: Vec<String> = sessions.keys().cloned().collect();
        for key in &keys {
            sessions.insert(key.clone(), Arc::clone(&new_session));
        }
        keys
    };
    let workspace_paths = {
        let workspaces = workspaces.lock().await;
        workspace_ids
            .iter()
            .map(|workspace_id| {
                let path = workspaces
                    .get(workspace_id)
                    .map(|entry| entry.path.clone())
                    .unwrap_or_default();
                (workspace_id.clone(), path)
            })
            .collect::<Vec<_>>()
    };
    for (workspace_id, workspace_path) in &workspace_paths {
        let path = if workspace_path.is_empty() {
            None
        } else {
            Some(workspace_path.as_str())
        };
        new_session
            .register_workspace_with_path(workspace_id, path)
            .await;
    }
    let mut child = current_session.child.lock().await;
    kill_child_process_tree(&mut child).await;

    Ok(WorkspaceRuntimeCodexArgsResult {
        applied_codex_args: target_args,
        respawned: true,
    })
}
