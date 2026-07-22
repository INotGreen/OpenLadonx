use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::process::Child;
use tokio::sync::Mutex;

use crate::app_update::AppUpdateState;
use crate::dictation::DictationState;
use crate::shared::codex_core::CodexLoginCancelState;
use crate::storage::{read_settings, read_workspaces_with_history};
use crate::types::{AppSettings, TcpDaemonState, TcpDaemonStatus, WorkspaceEntry};

pub(crate) struct TcpDaemonRuntime {
    pub(crate) child: Option<Child>,
    pub(crate) status: TcpDaemonStatus,
}

impl Default for TcpDaemonRuntime {
    fn default() -> Self {
        Self {
            child: None,
            status: TcpDaemonStatus {
                state: TcpDaemonState::Stopped,
                pid: None,
                started_at_ms: None,
                last_error: None,
                listen_addr: None,
            },
        }
    }
}

pub(crate) struct AppState {
    pub(crate) workspaces: Mutex<HashMap<String, WorkspaceEntry>>,
    pub(crate) sessions: Mutex<HashMap<String, Arc<crate::codex::WorkspaceSession>>>,
    pub(crate) claude_code_processes: Mutex<HashMap<String, u32>>,
    pub(crate) terminal_sessions: Mutex<HashMap<String, Arc<crate::terminal::TerminalSession>>>,
    pub(crate) remote_backend: Mutex<Option<crate::remote_backend::RemoteBackend>>,
    pub(crate) program_dir: PathBuf,
    pub(crate) storage_path: PathBuf,
    pub(crate) settings_path: PathBuf,
    pub(crate) app_settings: Mutex<AppSettings>,
    pub(crate) auth_session_activated: Mutex<bool>,
    pub(crate) wechat_login_cancels: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    pub(crate) dictation: Mutex<DictationState>,
    pub(crate) app_update: Mutex<AppUpdateState>,
    pub(crate) codex_login_cancels: Mutex<HashMap<String, CodexLoginCancelState>>,
    pub(crate) tcp_daemon: Mutex<TcpDaemonRuntime>,
}

impl AppState {
    pub(crate) fn load(app: &AppHandle) -> Self {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| crate::settings::current_working_dir());
        let program_dir = crate::settings::resolve_runtime_data_dir();
        crate::startup_log::write(format!(
            "state: load data_dir={}, program_dir={}",
            data_dir.display(),
            program_dir.display(),
        ));
        let storage_path = crate::settings::resolve_workspaces_path(&program_dir, &data_dir);
        let settings_path = crate::settings::resolve_settings_path(&program_dir, &data_dir);
        let workspaces = read_workspaces_with_history(&storage_path).unwrap_or_default();
        let app_settings = read_settings(&settings_path).unwrap_or_default();
        let auth_session_activated = app_settings.ladonx_auth.as_ref().is_some_and(|auth| {
            !auth.access_token.trim().is_empty() && !auth.api_key.trim().is_empty()
        });
        Self {
            workspaces: Mutex::new(workspaces),
            sessions: Mutex::new(HashMap::new()),
            claude_code_processes: Mutex::new(HashMap::new()),
            terminal_sessions: Mutex::new(HashMap::new()),
            remote_backend: Mutex::new(None),
            program_dir,
            storage_path,
            settings_path,
            app_settings: Mutex::new(app_settings),
            auth_session_activated: Mutex::new(auth_session_activated),
            wechat_login_cancels: Mutex::new(HashMap::new()),
            dictation: Mutex::new(DictationState::default()),
            app_update: Mutex::new(AppUpdateState::default()),
            codex_login_cancels: Mutex::new(HashMap::new()),
            tcp_daemon: Mutex::new(TcpDaemonRuntime::default()),
        }
    }
}
