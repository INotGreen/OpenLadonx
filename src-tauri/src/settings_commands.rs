use serde::Serialize;
use tauri::{State, Window};

use crate::codex::config;
use crate::shared::process_core::kill_child_process_tree;
use crate::shared::settings_core::{
    get_app_settings_core, get_codex_config_path_core, update_app_settings_core,
};
use crate::state::AppState;
use crate::types::{AppSettings, BackendMode};
use crate::window;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppRuntimeDefaults {
    ladonx_api_base_url: &'static str,
    codex_base_url: &'static str,
    update_api_base_url: &'static str,
    relay_host_url: &'static str,
    remote_backend_host: &'static str,
}

#[tauri::command]
pub(crate) async fn get_app_runtime_defaults() -> Result<AppRuntimeDefaults, String> {
    Ok(AppRuntimeDefaults {
        ladonx_api_base_url: crate::settings::DEFAULT_LADONX_API_BASE_URL,
        codex_base_url: crate::settings::CODEX_BASE_URL,
        update_api_base_url: crate::settings::DEFAULT_LADONX_API_BASE_URL,
        relay_host_url: crate::settings::DEFAULT_RELAY_HOST_URL,
        remote_backend_host: crate::settings::DEFAULT_REMOTE_BACKEND_HOST,
    })
}

#[tauri::command]
pub(crate) async fn get_app_settings(
    state: State<'_, AppState>,
    window: Window,
) -> Result<AppSettings, String> {
    let settings = get_app_settings_core(&state.app_settings).await;
    let _ = window::apply_window_appearance(&window, settings.theme.as_str());
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn update_app_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
    window: Window,
) -> Result<AppSettings, String> {
    let previous = state.app_settings.lock().await.clone();
    let updated =
        update_app_settings_core(settings, &state.app_settings, &state.settings_path).await?;
    if previous.codex_api_key != updated.codex_api_key {
        let sessions = {
            let mut sessions = state.sessions.lock().await;
            sessions
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<_>>()
        };
        for session in sessions {
            let mut child = session.child.lock().await;
            kill_child_process_tree(&mut child).await;
        }
    }
    if should_reset_remote_backend(&previous, &updated) {
        *state.remote_backend.lock().await = None;
    }
    ensure_remote_runtime_for_settings(&updated, state).await;
    let _ = window::apply_window_appearance(&window, updated.theme.as_str());
    Ok(updated)
}

#[tauri::command]
pub(crate) async fn get_codex_config_path() -> Result<String, String> {
    get_codex_config_path_core()
}

#[tauri::command]
pub(crate) async fn write_codex_base_url(base_url: Option<String>) -> Result<(), String> {
    config::write_base_url(base_url.as_deref())
}

#[tauri::command]
pub(crate) async fn apply_custom_response_api(
    base_url: String,
    api_key: String,
) -> Result<(), String> {
    crate::bundled_cli::apply_custom_response_credentials(&base_url, &api_key)
}

#[tauri::command]
pub(crate) async fn apply_custom_messages_api(
    base_url: String,
    api_key: String,
) -> Result<(), String> {
    crate::bundled_cli::apply_custom_messages_credentials(&base_url, &api_key)
}

#[tauri::command]
pub(crate) async fn reveal_codex_config() -> Result<String, String> {
    get_codex_config_path_core()
}

#[tauri::command]
pub(crate) async fn read_codex_base_url() -> Result<Option<String>, String> {
    config::read_base_url()
}

#[tauri::command]
pub(crate) async fn read_openai_api_key_env() -> Result<Option<String>, String> {
    Ok(crate::settings::openai_api_key_from_env())
}

#[tauri::command]
pub(crate) async fn read_anthropic_api_key_env() -> Result<Option<String>, String> {
    Ok(crate::settings::anthropic_api_key_from_env())
}

fn should_reset_remote_backend(previous: &AppSettings, updated: &AppSettings) -> bool {
    let backend_mode_changed = !matches!(
        (&previous.backend_mode, &updated.backend_mode),
        (
            crate::types::BackendMode::Local,
            crate::types::BackendMode::Local
        ) | (
            crate::types::BackendMode::Remote,
            crate::types::BackendMode::Remote
        )
    );
    backend_mode_changed
        || previous.remote_backend_provider != updated.remote_backend_provider
        || previous.remote_backend_host != updated.remote_backend_host
        || previous.remote_backend_token != updated.remote_backend_token
}

async fn ensure_remote_runtime_for_settings(settings: &AppSettings, state: State<'_, AppState>) {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return;
    }
    if !matches!(settings.backend_mode, BackendMode::Remote) {
        return;
    }

    let _ = crate::tailscale::tailscale_daemon_start(state).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_reset_remote_backend_when_transport_settings_change() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.remote_backend_provider = crate::types::RemoteBackendProvider::Tcp;
        updated.remote_backend_host = "remote.example:4732".to_string();
        assert!(should_reset_remote_backend(&previous, &updated));

        let mut updated = previous.clone();
        updated.remote_backend_token = Some("token-1".to_string());
        assert!(should_reset_remote_backend(&previous, &updated));
    }

    #[test]
    fn should_not_reset_remote_backend_for_non_transport_setting_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.theme = "dark".to_string();
        updated.backend_mode = BackendMode::Local;
        assert!(!should_reset_remote_backend(&previous, &updated));
    }
}
