use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;

use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::codex::args::resolve_workspace_codex_args;
use crate::codex::home::resolve_workspace_codex_home;
use crate::shared::process_core::kill_child_process_tree;
use crate::types::{AppSettings, WorkspaceEntry};

use super::helpers::resolve_entry_and_parent;

static CONNECT_WORKSPACE_SPAWN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(super) fn workspace_session_spawn_lock() -> &'static Mutex<()> {
    CONNECT_WORKSPACE_SPAWN_LOCK.get_or_init(|| Mutex::new(()))
}

async fn session_process_is_alive(session: &Arc<WorkspaceSession>) -> bool {
    let mut child = session.child.lock().await;
    matches!(child.try_wait(), Ok(None))
}

async fn remove_session_references(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    session: &Arc<WorkspaceSession>,
) {
    let mut sessions = sessions.lock().await;
    sessions.retain(|_, candidate| !Arc::ptr_eq(candidate, session));
}

pub(super) async fn take_live_shared_session(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
) -> Option<Arc<WorkspaceSession>> {
    loop {
        let existing_session = {
            let sessions = sessions.lock().await;
            sessions.values().next().cloned()
        };
        let Some(existing_session) = existing_session else {
            return None;
        };
        if session_process_is_alive(&existing_session).await {
            return Some(existing_session);
        }
        remove_session_references(sessions, &existing_session).await;
    }
}

pub(crate) async fn connect_workspace_core<F, Fut>(
    workspace_id: String,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    spawn_session: F,
) -> Result<(), String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    let (entry, parent_entry) = resolve_entry_and_parent(workspaces, &workspace_id).await?;
    let _spawn_guard = workspace_session_spawn_lock().lock().await;
    if let Some(existing_for_entry) = {
        let sessions = sessions.lock().await;
        sessions.get(&entry.id).cloned()
    } {
        if session_process_is_alive(&existing_for_entry).await {
            return Ok(());
        }
        remove_session_references(sessions, &existing_for_entry).await;
    }
    if let Some(existing_session) = take_live_shared_session(sessions).await {
        existing_session
            .register_workspace_with_path(&entry.id, Some(&entry.path))
            .await;
        sessions
            .lock()
            .await
            .insert(entry.id.clone(), existing_session);
        return Ok(());
    }
    let (default_bin, codex_args) = {
        let settings = app_settings.lock().await;
        (
            settings.codex_bin.clone(),
            resolve_workspace_codex_args(&entry, parent_entry.as_ref(), Some(&settings)),
        )
    };
    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref());
    let session = spawn_session(entry.clone(), default_bin, codex_args, codex_home).await?;
    session
        .register_workspace_with_path(&entry.id, Some(&entry.path))
        .await;
    sessions.lock().await.insert(entry.id, session);
    Ok(())
}

pub(super) async fn kill_session_by_id(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    id: &str,
) {
    let (removed, still_referenced) = {
        let mut sessions = sessions.lock().await;
        let removed = sessions.remove(id);
        let still_referenced = removed.as_ref().is_some_and(|session| {
            sessions
                .values()
                .any(|candidate| Arc::ptr_eq(candidate, session))
        });
        (removed, still_referenced)
    };
    if let Some(session) = removed {
        session.unregister_workspace(id).await;
        if still_referenced {
            return;
        }
        let mut child = session.child.lock().await;
        kill_child_process_tree(&mut child).await;
    }
}
