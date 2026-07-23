//! LadonX account auth and API key commands.

use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State};
use tokio::sync::oneshot;
use tokio::sync::oneshot::error::TryRecvError;
use tokio::time::{timeout, Duration};

use crate::shared::process_core::kill_child_process_tree;
use crate::state::AppState;
use crate::types::LadonxAuthState;

fn auth_log(message: impl AsRef<str>) {
    crate::startup_log::write(format!("auth: {}", message.as_ref()));
}

fn emit_auth_changed(app: &tauri::AppHandle) {
    if let Err(error) = app.emit("ladonx-auth-changed", ()) {
        auth_log(format!("emit auth changed failed: {error}"));
    }
}

fn truncate_for_log(value: &str, max_len: usize) -> String {
    let mut chars = value.chars();
    let mut out = String::new();
    for _ in 0..max_len {
        if let Some(ch) = chars.next() {
            out.push(ch);
        } else {
            return out;
        }
    }
    if chars.next().is_some() {
        out.push_str("...");
    }
    out
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn relaunch_app_after_login(app: &tauri::AppHandle, reason: &str) -> Result<(), String> {
    if cfg!(debug_assertions) {
        auth_log(format!("{reason}: skip restart in debug build"));
        return Ok(());
    }
    auth_log(format!("{reason}: relaunching app"));
    crate::relaunch_current_app(app)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LadonxAuthLoginRequest {
    account: String,
    password: String,
    #[serde(default)]
    api_base_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LadonxAuthRegisterRequest {
    email: String,
    username: String,
    #[serde(default)]
    display_name: Option<String>,
    password: String,
    #[serde(default)]
    api_base_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LadonxAuthWechatRequest {
    #[serde(default)]
    invite_code: Option<String>,
    #[serde(default)]
    api_base_url: Option<String>,
    attempt_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LadonxAuthWechatCancelRequest {
    attempt_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LadonxApiKeyTestRequest {
    base_url: String,
    api_key: String,
    /// Optional: "response" | "messages". When set with a model, the
    /// test sends a real "你是谁" request through that endpoint instead of just
    /// listing models.
    api_type: Option<String>,
    model: Option<String>,
}

fn normalize_base_url(value: Option<String>, fallback: &str) -> String {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .trim_end_matches('/')
        .to_string()
}

fn api_endpoint_url(base_url: &str, path: &str) -> String {
    let base_url = base_url.trim().trim_end_matches('/');
    let path = path.trim();
    let path_without_leading_slash = path.trim_start_matches('/');

    if base_url.ends_with(path) {
        return base_url.to_string();
    }

    if let Some(path_after_v1) = path.strip_prefix("/v1/") {
        if base_url.ends_with("/v1") {
            return format!("{base_url}/{path_after_v1}");
        }
    }

    format!("{base_url}/{}", path_without_leading_slash)
}

fn backend_message(value: &Value) -> Option<String> {
    value
        .get("message")
        .or_else(|| value.get("error"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_json_or_nested_json(body_text: &str) -> Result<Value, serde_json::Error> {
    let body: Value = serde_json::from_str(body_text)?;
    if let Some(inner) = body.as_str() {
        serde_json::from_str(inner)
    } else {
        Ok(body)
    }
}

async fn cancel_wechat_login_attempt(state: &AppState, attempt_id: &str) -> bool {
    let cancel_tx = {
        let mut cancels = state.wechat_login_cancels.lock().await;
        cancels.remove(attempt_id)
    };
    if let Some(cancel_tx) = cancel_tx {
        let _ = cancel_tx.send(());
        return true;
    }
    false
}

fn read_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn read_codex_api_key(user: &Value) -> String {
    if let Some(api_key) = user.get("apiKey") {
        if let Some(value) = api_key
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return value.to_string();
        }
        if let Some(value) = api_key
            .get("codex")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return value.to_string();
        }
    }

    let api_key = read_string(user, "apiKeycodex");
    if !api_key.is_empty() {
        return api_key;
    }

    read_string(user, "api_key")
}

fn anthropic_base_url_for_api_base_url(api_base_url: &str) -> String {
    let normalized = api_base_url.trim().trim_end_matches('/');
    let default_api_base = crate::settings::DEFAULT_LADONX_API_BASE_URL.trim_end_matches('/');
    if normalized == default_api_base {
        return crate::settings::ANTHROPIC_BASE_URL.to_string();
    }
    format!("{normalized}/anthropic")
}

fn codex_base_url_for_api_base_url(api_base_url: &str) -> String {
    let normalized = api_base_url.trim().trim_end_matches('/');
    let default_api_base = crate::settings::DEFAULT_LADONX_API_BASE_URL.trim_end_matches('/');
    if normalized == default_api_base {
        return crate::settings::CODEX_BASE_URL.to_string();
    }
    if normalized.ends_with("/v1") {
        return normalized.to_string();
    }
    format!("{normalized}/v1")
}

fn sync_ladonx_cli_credentials(
    user: &Value,
    codex_api_key: &str,
    codex_base_url: &str,
    anthropic_base_url: &str,
) -> Result<(), String> {
    let _ = user;
    let anthropic_auth_token = codex_api_key.trim();
    crate::settings::apply_openai_credentials_env(Some(codex_base_url), Some(codex_api_key));
    crate::settings::apply_anthropic_credentials_env(
        Some(anthropic_base_url),
        Some(anthropic_auth_token),
    );
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        crate::bundled_cli::sync_ladonx_cli_credentials(
            Some(codex_api_key),
            Some(anthropic_auth_token),
            codex_base_url,
            anthropic_base_url,
        )?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (user, codex_api_key, codex_base_url, anthropic_base_url);
    }
    Ok(())
}

fn sync_ladonx_auth_token_env(auth: Option<&LadonxAuthState>) {
    let token = auth
        .map(|entry| entry.api_key.trim())
        .filter(|value| !value.is_empty());
    crate::settings::apply_anthropic_api_key_env(token);
}

fn account_response(user: Value) -> Value {
    let username = read_string(&user, "username");
    json!({
        "account": {
            "type": "ladonx",
            "email": read_string(&user, "email"),
            "planType": "free",
            "displayName": username,
            "username": username,
            "headimgurl": read_string(&user, "headimgurl"),
            "user": user,
        },
        "requiresOpenaiAuth": false,
    })
}

fn build_auth_state(user: Value) -> Result<LadonxAuthState, String> {
    let access_token = read_string(&user, "accessToken");
    if access_token.is_empty() {
        return Err("登录响应缺少 accessToken".to_string());
    }

    let api_key = read_codex_api_key(&user);
    if api_key.is_empty() {
        return Err("登录响应缺少 apiKey".to_string());
    }

    Ok(LadonxAuthState {
        access_token,
        refresh_token: read_string(&user, "refreshToken"),
        api_key,
        user,
    })
}

fn current_api_base_url() -> String {
    normalize_base_url(None, crate::settings::DEFAULT_LADONX_API_BASE_URL)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn write_codex_auth_file(api_key: &str) -> Result<(), String> {
    crate::bundled_cli::write_codex_auth_json(api_key)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn write_codex_auth_file(_api_key: &str) -> Result<(), String> {
    Ok(())
}

async fn update_runtime_auth_state(
    app_state: &AppState,
    auth: Option<LadonxAuthState>,
) -> Result<(), String> {
    let next_api_key = auth
        .as_ref()
        .map(|entry| entry.api_key.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let previous_api_key = {
        let settings = app_state.app_settings.lock().await;
        settings.codex_api_key.clone()
    };

    let updated_settings = {
        let mut settings = app_state.app_settings.lock().await;
        settings.ladonx_auth = auth;
        settings.codex_api_key = next_api_key.clone();
        settings.clone()
    };

    crate::storage::write_settings(&app_state.settings_path, &updated_settings)?;

    if let Some(api_key) = next_api_key.as_deref() {
        write_codex_auth_file(api_key)?;
        crate::storage::apply_codex_api_key_env();
        sync_ladonx_auth_token_env(updated_settings.ladonx_auth.as_ref());
    } else {
        sync_ladonx_auth_token_env(None);
        crate::bundled_cli::clear_ladonx_cli_credentials()?;
        crate::storage::apply_codex_api_key_env();
    }

    if previous_api_key != next_api_key {
        let sessions = {
            let mut sessions = app_state.sessions.lock().await;
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

    Ok(())
}

async fn fetch_latest_codex_api_key(
    current_api_key: &str,
    access_token: &str,
    api_base_url: &str,
) -> Result<Option<String>, String> {
    let current_api_key = current_api_key.trim();
    let access_token = access_token.trim();
    if current_api_key.is_empty() || access_token.is_empty() {
        return Ok(None);
    }

    let client = reqwest::Client::new();
    let list_response = client
        .get(format!("{api_base_url}/v1/api/api-keys"))
        .bearer_auth(current_api_key)
        .send()
        .await
        .map_err(|error| format!("Failed to load API keys: {error}"))?;
    let list_body = parse_backend_json_response(list_response, "API keys request").await?;

    let preferred_id = list_body
        .get("data")
        .and_then(Value::as_array)
        .and_then(|entries| {
            entries
                .iter()
                .find(|entry| read_string(entry, "group").eq_ignore_ascii_case("codex"))
                .or_else(|| {
                    entries.iter().find(|entry| {
                        let group = read_string(entry, "group");
                        group.eq_ignore_ascii_case("default") || group == "默认"
                    })
                })
                .or_else(|| entries.first())
        })
        .and_then(|entry| entry.get("id"))
        .and_then(Value::as_i64);

    let Some(id) = preferred_id else {
        return Ok(None);
    };

    let reveal_response = client
        .get(format!("{api_base_url}/v1/api/api-keys/{id}/reveal"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("Failed to reveal API key: {error}"))?;
    let reveal_body =
        parse_backend_json_response(reveal_response, "Reveal API key request").await?;

    Ok(reveal_body
        .get("data")
        .and_then(|data| data.get("apiKey"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string))
}

pub(crate) async fn sync_ladonx_auth_on_startup(app_state: &AppState) -> Result<(), String> {
    let Some(mut auth) = current_auth_state(app_state).await else {
        return Ok(());
    };

    let api_base_url = current_api_base_url();
    if let Ok(Some(api_key)) =
        fetch_latest_codex_api_key(&auth.api_key, &auth.access_token, &api_base_url).await
    {
        auth.api_key = api_key;
    }

    if auth.api_key.trim().is_empty() {
        return Ok(());
    }

    sync_ladonx_cli_credentials(
        &auth.user,
        &auth.api_key,
        &codex_base_url_for_api_base_url(&api_base_url),
        &anthropic_base_url_for_api_base_url(&api_base_url),
    )?;
    update_runtime_auth_state(app_state, Some(auth)).await
}

async fn current_auth_state(app_state: &AppState) -> Option<LadonxAuthState> {
    let settings = app_state.app_settings.lock().await;
    settings.ladonx_auth.clone()
}

async fn set_auth_session_activated(app_state: &AppState, active: bool) {
    let mut activated = app_state.auth_session_activated.lock().await;
    *activated = active;
}

async fn is_auth_session_activated(app_state: &AppState) -> bool {
    let activated = app_state.auth_session_activated.lock().await;
    *activated
}

async fn require_auth_state(app_state: &AppState) -> Result<LadonxAuthState, String> {
    current_auth_state(app_state)
        .await
        .filter(|auth| !auth.access_token.trim().is_empty() && !auth.api_key.trim().is_empty())
        .ok_or_else(|| "请先登录 LadonX".to_string())
}

async fn parse_backend_json_response(
    response: reqwest::Response,
    context: &str,
) -> Result<Value, String> {
    let status = response.status();
    let body_text = response.text().await.map_err(|error| error.to_string())?;
    let body = parse_json_or_nested_json(&body_text).map_err(|error| {
        if status.is_success() {
            format!("{context} response is not valid JSON: {error}")
        } else if body_text.trim().is_empty() {
            format!("{context} failed: HTTP {status}")
        } else {
            body_text.clone()
        }
    })?;

    if !status.is_success() {
        return Err(
            backend_message(&body).unwrap_or_else(|| format!("{context} failed: HTTP {status}"))
        );
    }

    Ok(body)
}

async fn finalize_login(
    app: &tauri::AppHandle,
    state: &AppState,
    user: Value,
    api_base_url: &str,
) -> Result<Value, String> {
    let auth = build_auth_state(user.clone())?;
    sync_ladonx_cli_credentials(
        &auth.user,
        &auth.api_key,
        &codex_base_url_for_api_base_url(api_base_url),
        &anthropic_base_url_for_api_base_url(api_base_url),
    )?;
    update_runtime_auth_state(state, Some(auth)).await?;
    set_auth_session_activated(state, true).await;
    emit_auth_changed(app);
    Ok(account_response(user))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
async fn finalize_login_and_relaunch(
    app: &tauri::AppHandle,
    state: &AppState,
    user: Value,
    api_base_url: &str,
    reason: &str,
) -> Result<Value, String> {
    let response = finalize_login(app, state, user, api_base_url).await?;
    relaunch_app_after_login(app, reason)?;
    Ok(response)
}

fn extract_model_ids(body: &Value) -> Vec<String> {
    let Some(data) = body.get("data").and_then(Value::as_array) else {
        return Vec::new();
    };

    data.iter()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[tauri::command]
pub(crate) async fn ladonx_auth_login(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: LadonxAuthLoginRequest,
) -> Result<Value, String> {
    let account = request.account.trim();
    if account.is_empty() || request.password.is_empty() {
        return Err("请输入账号和密码".to_string());
    }

    let api_base_url = normalize_base_url(
        request.api_base_url,
        crate::settings::DEFAULT_LADONX_API_BASE_URL,
    );
    auth_log(format!(
        "ladonx_auth_login: start account={}, api_base_url={}",
        account, api_base_url
    ));

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{api_base_url}/v1/api/auth/login"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_string(&json!({
                "account": account,
                "password": request.password,
            }))
            .map_err(|error| error.to_string())?,
        )
        .send()
        .await
        .map_err(|error| format!("登录请求失败: {error}"))?;

    let body = parse_backend_json_response(response, "登录请求").await?;
    let user = body
        .get("data")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| "登录响应缺少 data".to_string())?;

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        return finalize_login_and_relaunch(
            &app,
            state.inner(),
            user,
            &api_base_url,
            "ladonx_auth_login",
        )
        .await;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        finalize_login(&app, state.inner(), user, &api_base_url).await
    }
}

#[tauri::command]
pub(crate) async fn ladonx_auth_register(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: LadonxAuthRegisterRequest,
) -> Result<Value, String> {
    let email = request.email.trim();
    let username = request.username.trim();
    if email.is_empty() || username.is_empty() || request.password.is_empty() {
        return Err("请输入邮箱、用户名和密码".to_string());
    }

    let api_base_url = normalize_base_url(
        request.api_base_url,
        crate::settings::DEFAULT_LADONX_API_BASE_URL,
    );
    auth_log(format!(
        "ladonx_auth_register: start email={}, username={}, api_base_url={}",
        email, username, api_base_url
    ));

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{api_base_url}/v1/api/auth/register"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_string(&json!({
                "email": email,
                "username": username,
                "displayName": request
                    .display_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(username),
                "password": request.password,
            }))
            .map_err(|error| error.to_string())?,
        )
        .send()
        .await
        .map_err(|error| format!("注册请求失败: {error}"))?;

    let body = parse_backend_json_response(response, "注册请求").await?;
    let user = body
        .get("data")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| "注册响应缺少 data".to_string())?;

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        return finalize_login_and_relaunch(
            &app,
            state.inner(),
            user,
            &api_base_url,
            "ladonx_auth_register",
        )
        .await;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        finalize_login(&app, state.inner(), user, &api_base_url).await
    }
}

#[tauri::command]
pub(crate) async fn ladonx_auth_status(
    state: State<'_, AppState>,
    _api_base_url: Option<String>,
) -> Result<Value, String> {
    if !is_auth_session_activated(state.inner()).await {
        return Ok(json!({
            "account": null,
            "requiresOpenaiAuth": true,
        }));
    }

    let Some(auth) = current_auth_state(state.inner()).await else {
        return Ok(json!({
            "account": null,
            "requiresOpenaiAuth": true,
        }));
    };

    if auth.access_token.trim().is_empty() || auth.api_key.trim().is_empty() {
        return Ok(json!({
            "account": null,
            "requiresOpenaiAuth": true,
        }));
    }

    Ok(account_response(auth.user))
}

#[tauri::command]
pub(crate) async fn ladonx_auth_wechat_login(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: LadonxAuthWechatRequest,
) -> Result<(), String> {
    let attempt_id = request.attempt_id.trim().to_string();
    if attempt_id.is_empty() {
        return Err("微信登录请求缺少 attemptId".to_string());
    }

    let api_base_url = normalize_base_url(
        request.api_base_url,
        crate::settings::DEFAULT_LADONX_API_BASE_URL,
    );
    let invite_code = request
        .invite_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();
    auth_log(format!(
        "ladonx_auth_wechat_login: start attempt_id={}, api_base_url={}, os={}, arch={}, debug={}",
        attempt_id,
        api_base_url,
        std::env::consts::OS,
        std::env::consts::ARCH,
        cfg!(debug_assertions)
    ));

    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    {
        let mut cancels = state.wechat_login_cancels.lock().await;
        if let Some(existing) = cancels.remove(&attempt_id) {
            let _ = existing.send(());
        }
        cancels.insert(attempt_id.clone(), cancel_tx);
    }

    tauri::async_runtime::spawn(async move {
        let cleanup_state = app.state::<AppState>();
        let cleanup_attempt_id = attempt_id.clone();
        let emit = |payload: Value| {
            let event_type = read_string(&payload, "type");
            match app.emit("ladonx-wechat-auth", payload) {
                Ok(()) => auth_log(format!(
                    "ladonx_auth_wechat_login: emitted event type={} attempt_id={}",
                    event_type, attempt_id
                )),
                Err(error) => auth_log(format!(
                    "ladonx_auth_wechat_login: emit failed type={} attempt_id={}, error={}",
                    event_type, attempt_id, error
                )),
            }
        };
        let run_result: Result<(), ()> = async {
            let client = reqwest::Client::new();
            let response = match client
                .post(format!("{api_base_url}/v1/api/wechat/qrcode/login"))
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .header(reqwest::header::ACCEPT_ENCODING, "identity")
                .header(reqwest::header::CACHE_CONTROL, "no-cache")
                .body(
                    serde_json::to_string(&json!({
                        "invite_code": invite_code,
                    }))
                    .unwrap_or_else(|_| "{\"invite_code\":\"\"}".to_string()),
                )
                .send()
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    emit(json!({
                        "attemptId": attempt_id,
                        "type": "error",
                        "message": format!("微信登录请求失败: {error}"),
                    }));
                    return Err(());
                }
            };

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                let message = parse_json_or_nested_json(&body_text)
                    .ok()
                    .and_then(|body| backend_message(&body))
                    .unwrap_or_else(|| {
                        if body_text.trim().is_empty() {
                            format!("微信登录失败: HTTP {status}")
                        } else {
                            body_text
                        }
                    });
                emit(json!({
                    "attemptId": attempt_id,
                    "type": "error",
                    "message": message,
                }));
                return Err(());
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut event_index: usize = 0;
            let started_at = std::time::Instant::now();
            let mut ping_count: usize = 0;
            let mut reported_waiting_diagnostic = false;

            loop {
                match cancel_rx.try_recv() {
                    Ok(_) | Err(TryRecvError::Closed) => {
                        auth_log(format!(
                            "ladonx_auth_wechat_login: canceled attempt_id={}",
                            attempt_id
                        ));
                        return Ok(());
                    }
                    Err(TryRecvError::Empty) => {}
                }

                let chunk_result = match timeout(Duration::from_millis(250), stream.next()).await {
                    Ok(chunk_result) => chunk_result,
                    Err(_) => continue,
                };

                let Some(chunk_result) = chunk_result else {
                    break;
                };

                let chunk = match chunk_result {
                    Ok(chunk) => chunk,
                    Err(error) => {
                        emit(json!({
                            "attemptId": attempt_id,
                            "type": "error",
                            "message": format!("微信登录连接中断: {error}"),
                        }));
                        return Err(());
                    }
                };

                let chunk_text = String::from_utf8_lossy(&chunk);
                if chunk_text.contains("\r\n") {
                    buffer.push_str(&chunk_text.replace("\r\n", "\n"));
                } else {
                    buffer.push_str(&chunk_text);
                }
                auth_log(format!(
                    "ladonx_auth_wechat_login: chunk received attempt_id={}, index={}, bytes={}, buffer_len={}",
                    attempt_id,
                    event_index,
                    chunk.len(),
                    buffer.len()
                ));
                while let Some(separator_index) = buffer.find("\n\n") {
                    let rest = buffer.split_off(separator_index + 2);
                    let event_block = buffer[..separator_index].trim().to_string();
                    buffer = rest;
                    if event_block.is_empty() {
                        continue;
                    }
                    event_index += 1;

                    let data = event_block
                        .lines()
                        .filter_map(|line| line.strip_prefix("data:"))
                        .map(str::trim)
                        .collect::<Vec<_>>()
                        .join("");
                    if data.is_empty() {
                        auth_log(format!(
                            "ladonx_auth_wechat_login: empty sse data attempt_id={}, index={}, block={}",
                            attempt_id,
                            event_index,
                            truncate_for_log(&event_block, 300)
                        ));
                        continue;
                    }

                    auth_log(format!(
                        "ladonx_auth_wechat_login: sse event parsed attempt_id={}, index={}, data={}",
                        attempt_id,
                        event_index,
                        truncate_for_log(&data, 800)
                    ));
                    let payload = match serde_json::from_str::<Value>(&data) {
                        Ok(payload) => payload,
                        Err(error) => {
                            emit(json!({
                                "attemptId": attempt_id,
                                "type": "error",
                                "message": format!("微信登录响应格式无效: {error}"),
                            }));
                            return Err(());
                        }
                    };

                    let payload_type = read_string(&payload, "type");
                    auth_log(format!(
                        "ladonx_auth_wechat_login: payload type={} attempt_id={}, index={}, keys={}",
                        payload_type,
                        attempt_id,
                        event_index,
                        payload
                            .as_object()
                            .map(|object| object.keys().cloned().collect::<Vec<_>>().join(","))
                            .unwrap_or_default()
                    ));

                    match payload_type.as_str() {
                        "qrcode" => {
                            let login_url = read_string(&payload, "qrImageUrl");
                            auth_log(format!(
                                "ladonx_auth_wechat_login: qrcode payload attempt_id={}, index={}, qrImageUrl_present={}",
                                attempt_id,
                                event_index,
                                !login_url.is_empty()
                            ));
                            let url = match reqwest::Url::parse(&login_url) {
                                Ok(url) => url,
                                Err(error) => {
                                    emit(json!({
                                        "attemptId": attempt_id,
                                        "type": "error",
                                        "message": format!("微信二维码地址无效: {error}"),
                                    }));
                                    return Err(());
                                }
                            };

                            let mut appid = String::new();
                            let mut redirect_uri = String::new();
                            let mut scope = String::new();
                            let mut state = String::new();
                            for (key, value) in url.query_pairs() {
                                match key.as_ref() {
                                    "appid" => appid = value.into_owned(),
                                    "redirect_uri" => redirect_uri = value.into_owned(),
                                    "scope" => scope = value.into_owned(),
                                    "state" => state = value.into_owned(),
                                    _ => {}
                                }
                            }

                            emit(json!({
                                "attemptId": attempt_id,
                                "type": "qrcode",
                                "appid": appid,
                                "redirectUri": redirect_uri,
                                "scope": scope,
                                "state": state,
                                "qrImageUrl": login_url,
                            }));
                        }
                        "login_success" => {
                            let api_key_value = payload
                                .get("apiKey")
                                .cloned()
                                .unwrap_or_else(|| Value::String(String::new()));
                            auth_log(format!(
                                "ladonx_auth_wechat_login: login_success attempt_id={}, index={}, accessToken_present={}, refreshToken_present={}, apiKey_present={}",
                                attempt_id,
                                event_index,
                                !read_string(&payload, "accessToken").is_empty(),
                                !read_string(&payload, "refreshToken").is_empty(),
                                !api_key_value.as_str().map(str::trim).unwrap_or("").is_empty(),
                            ));
                            let user = json!({
                                "accessToken": read_string(&payload, "accessToken"),
                                "refreshToken": read_string(&payload, "refreshToken"),
                                "apiKey": api_key_value,
                                "role": read_string(&payload, "role"),
                                "username": read_string(&payload, "username"),
                                "headimgurl": read_string(&payload, "headimgurl"),
                                "email": read_string(&payload, "email"),
                            });

                            let auth = match build_auth_state(user.clone()) {
                                Ok(auth) => auth,
                                Err(error) => {
                                    emit(json!({
                                        "attemptId": attempt_id,
                                        "type": "error",
                                        "message": error,
                                    }));
                                    return Err(());
                                }
                            };

                            if let Err(error) = sync_ladonx_cli_credentials(
                                &auth.user,
                                &auth.api_key,
                                &codex_base_url_for_api_base_url(&api_base_url),
                                &anthropic_base_url_for_api_base_url(&api_base_url),
                            ) {
                                emit(json!({
                                    "attemptId": attempt_id,
                                    "type": "error",
                                    "message": error,
                                }));
                                return Err(());
                            }

                            if let Err(error) =
                                update_runtime_auth_state(app.state::<AppState>().inner(), Some(auth))
                                    .await
                            {
                                emit(json!({
                                    "attemptId": attempt_id,
                                    "type": "error",
                                    "message": error,
                                }));
                                return Err(());
                            }

                            set_auth_session_activated(app.state::<AppState>().inner(), true).await;
                            emit_auth_changed(&app);

                            #[cfg(any(target_os = "windows", target_os = "macos"))]
                            if let Err(error) =
                                relaunch_app_after_login(&app, "ladonx_auth_wechat_login")
                            {
                                emit(json!({
                                    "attemptId": attempt_id,
                                    "type": "error",
                                    "message": error,
                                }));
                                return Err(());
                            }

                            emit(json!({
                                "attemptId": attempt_id,
                                "type": "success",
                                "shouldRestart": cfg!(any(target_os = "windows", target_os = "macos"))
                                    && !cfg!(debug_assertions),
                            }));
                            return Ok(());
                        }
                        "timeout" => {
                            auth_log(format!(
                                "ladonx_auth_wechat_login: timeout attempt_id={}, index={}, message={}",
                                attempt_id,
                                event_index,
                                truncate_for_log(&read_string(&payload, "message"), 300)
                            ));
                            emit(json!({
                                "attemptId": attempt_id,
                                "type": "timeout",
                                "message": read_string(&payload, "message"),
                            }));
                            return Ok(());
                        }
                        "error" => {
                            auth_log(format!(
                                "ladonx_auth_wechat_login: error attempt_id={}, index={}, message={}",
                                attempt_id,
                                event_index,
                                truncate_for_log(&read_string(&payload, "message"), 300)
                            ));
                            emit(json!({
                                "attemptId": attempt_id,
                                "type": "error",
                                "message": read_string(&payload, "message"),
                            }));
                            return Err(());
                        }
                        "ping" => {
                            ping_count += 1;
                            let elapsed_secs = started_at.elapsed().as_secs();
                            let message = read_string(&payload, "message");
                            let session_id = read_string(&payload, "sessionId");
                            auth_log(format!(
                                "ladonx_auth_wechat_login: ping attempt_id={}, index={}, count={}, elapsed_secs={}, session_id={}, message={}",
                                attempt_id,
                                event_index,
                                ping_count,
                                elapsed_secs,
                                session_id,
                                truncate_for_log(&message, 120)
                            ));
                            if !reported_waiting_diagnostic && elapsed_secs >= 15 {
                                reported_waiting_diagnostic = true;
                                auth_log(format!(
                                    "ladonx_auth_wechat_login: diagnostic waiting too long attempt_id={}, events_seen={}, ping_count={}, elapsed_secs={}",
                                    attempt_id,
                                    event_index,
                                    ping_count,
                                    elapsed_secs
                                ));
                            }
                        }
                        _ => {}
                    }
                }
            }

            auth_log(format!(
                "ladonx_auth_wechat_login: stream ended attempt_id={}, events_seen={}, ping_count={}, elapsed_secs={}",
                attempt_id,
                event_index,
                ping_count,
                started_at.elapsed().as_secs()
            ));
            emit(json!({
                "attemptId": attempt_id,
                "type": "error",
                "message": "微信登录连接已结束",
            }));
            Err(())
        }
        .await;

        let removed = {
            let mut cancels = cleanup_state.wechat_login_cancels.lock().await;
            cancels.remove(&cleanup_attempt_id)
        };
        auth_log(format!(
            "ladonx_auth_wechat_login: cleanup attempt_id={}, removed_cancel_handle={}, ok={}",
            cleanup_attempt_id,
            removed.is_some(),
            run_result.is_ok()
        ));
    });

    Ok(())
}

#[tauri::command]
pub(crate) async fn ladonx_auth_wechat_cancel(
    state: State<'_, AppState>,
    request: LadonxAuthWechatCancelRequest,
) -> Result<Value, String> {
    let canceled = cancel_wechat_login_attempt(state.inner(), &request.attempt_id).await;
    auth_log(format!(
        "ladonx_auth_wechat_cancel: attempt_id={}, canceled={}",
        request.attempt_id, canceled
    ));
    Ok(json!({ "canceled": canceled }))
}

#[tauri::command]
pub(crate) async fn ladonx_auth_logout(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    auth_log("ladonx_auth_logout: start");
    update_runtime_auth_state(state.inner(), None).await?;
    set_auth_session_activated(state.inner(), false).await;
    emit_auth_changed(&app);
    auth_log("ladonx_auth_logout: completed");
    Ok(())
}

#[tauri::command]
pub(crate) async fn sync_ladonx_auth_env(state: State<'_, AppState>) -> Result<(), String> {
    let auth = {
        let settings = state.app_settings.lock().await;
        settings.ladonx_auth.clone()
    };
    sync_ladonx_auth_token_env(auth.as_ref());
    Ok(())
}

/// 切回「默认」API 来源：用 Ladonx 默认值覆盖 config.toml / auth.json / settings.json，
/// 并设置 ANTHROPIC api key 环境变量，确保与「自定义」互斥、不残留自定义配置。
#[tauri::command]
pub(crate) async fn apply_default_api_credentials(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (codex_base_url, codex_api_key) = {
        let settings = state.app_settings.lock().await;
        let base_url = settings
            .codex_base_url
            .clone()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| crate::settings::CODEX_BASE_URL.to_string());
        let api_key = settings
            .codex_api_key
            .clone()
            .or_else(|| {
                settings
                    .ladonx_auth
                    .as_ref()
                    .map(|auth| auth.api_key.clone())
            })
            .unwrap_or_default();
        (base_url, api_key)
    };

    let trimmed_key = codex_api_key.trim();
    crate::bundled_cli::restore_default_credentials(&codex_base_url, Some(trimmed_key))?;
    crate::settings::apply_anthropic_api_key_env(if trimmed_key.is_empty() {
        None
    } else {
        Some(trimmed_key)
    });
    Ok(())
}

#[tauri::command]
pub(crate) async fn ladonx_user_usage_statistics(
    state: State<'_, AppState>,
    api_base_url: Option<String>,
    limit: Option<u16>,
) -> Result<Value, String> {
    let auth = require_auth_state(state.inner()).await?;
    let api_base_url =
        normalize_base_url(api_base_url, crate::settings::DEFAULT_LADONX_API_BASE_URL);
    let row_limit = limit.unwrap_or(50).clamp(1, 200);

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{api_base_url}/v1/api/user/usage-statistics?limit={row_limit}"
        ))
        .bearer_auth(auth.api_key)
        .send()
        .await
        .map_err(|error| format!("Failed to load usage statistics: {error}"))?;

    parse_backend_json_response(response, "Usage statistics request").await
}

#[tauri::command]
pub(crate) async fn ladonx_api_key_test(
    _state: State<'_, AppState>,
    request: LadonxApiKeyTestRequest,
) -> Result<Value, String> {
    let base_url = request.base_url.trim().trim_end_matches('/').to_string();
    let api_key = request.api_key.trim().to_string();
    if base_url.is_empty() {
        return Err("请填写 Base URL".to_string());
    }
    if api_key.is_empty() {
        return Err("请填写 API Key".to_string());
    }

    let client = reqwest::Client::new();
    let api_type = request
        .api_type
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let model = request.model.as_deref().unwrap_or("").trim().to_string();

    // If an API type and model are provided, do a real request through the
    // selected endpoint format instead of just listing models.
    if !api_type.is_empty() && !model.is_empty() {
        let (path, body) = match api_type.as_str() {
            "response" | "responses" => (
                "/v1/responses",
                json!({ "model": model, "input": "你是谁" }),
            ),
            "messages" | "message" => (
                "/v1/messages",
                json!({
                    "model": model,
                    "max_tokens": 100,
                    "messages": [{ "role": "user", "content": "你是谁" }]
                }),
            ),
            _ => return Err(format!("不支持的 API 类型: {api_type}")),
        };

        let response = match client
            .post(api_endpoint_url(&base_url, path))
            .bearer_auth(&api_key)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => return Err(error.to_string()),
        };

        let status = response.status();
        let status_code = status.as_u16();
        let text = response.text().await.unwrap_or_default();
        let parsed: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }));
        return Ok(json!({
            "ok": status.is_success(),
            "endpoint": path,
            "apiType": api_type,
            "model": model,
            "status": status_code,
            "response": parsed,
        }));
    }

    let mut last_error: Option<String> = None;
    for path in ["/v1/models", "/models"] {
        let response = match client
            .get(api_endpoint_url(&base_url, path))
            .bearer_auth(&api_key)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(error.to_string());
                continue;
            }
        };

        let body = parse_backend_json_response(response, "模型列表请求").await;
        match body {
            Ok(body) => {
                let models = extract_model_ids(&body);
                return Ok(json!({
                    "ok": true,
                    "endpoint": path,
                    "modelCount": models.len(),
                    "models": models,
                    "raw": body,
                }));
            }
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| "测试失败".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_codex_api_key_accepts_legacy_string_api_key() {
        let user = json!({
            "apiKey": " sk-legacy ",
        });
        assert_eq!(read_codex_api_key(&user), "sk-legacy");
    }

    #[test]
    fn read_codex_api_key_accepts_provider_map() {
        let user = json!({
            "apiKey": {
                "codex": " sk-codex ",
                "claudecode": "sk-claudecode",
            },
        });
        assert_eq!(read_codex_api_key(&user), "sk-codex");
    }

    #[test]
    fn read_codex_api_key_accepts_register_compat_field() {
        let user = json!({
            "apiKeycodex": " sk-register-codex ",
        });
        assert_eq!(read_codex_api_key(&user), "sk-register-codex");
    }

    #[test]
    fn read_codex_api_key_ignores_empty_values() {
        let user = json!({
            "apiKey": {
                "codex": " ",
            },
        });
        assert_eq!(read_codex_api_key(&user), "");
    }

    #[test]
    fn anthropic_base_url_uses_settings_default_for_default_api_base() {
        assert_eq!(
            anthropic_base_url_for_api_base_url(crate::settings::DEFAULT_LADONX_API_BASE_URL),
            crate::settings::ANTHROPIC_BASE_URL
        );
    }

    #[test]
    fn api_endpoint_url_accepts_root_base_url() {
        assert_eq!(
            api_endpoint_url("https://api.example.com", "/v1/responses"),
            "https://api.example.com/v1/responses"
        );
    }

    #[test]
    fn api_endpoint_url_accepts_v1_base_url() {
        assert_eq!(
            api_endpoint_url("https://api.example.com/v1", "/v1/responses"),
            "https://api.example.com/v1/responses"
        );
    }

    #[test]
    fn api_endpoint_url_accepts_exact_endpoint_url() {
        assert_eq!(
            api_endpoint_url("https://api.example.com/v1/responses", "/v1/responses"),
            "https://api.example.com/v1/responses"
        );
    }
}

#[tauri::command]
pub(crate) async fn ladonx_user_subscriptions(
    state: State<'_, AppState>,
    api_base_url: Option<String>,
) -> Result<Value, String> {
    let auth = require_auth_state(state.inner()).await?;
    let api_base_url =
        normalize_base_url(api_base_url, crate::settings::DEFAULT_LADONX_API_BASE_URL);
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{api_base_url}/v1/api/user/subscriptions"))
        .bearer_auth(auth.api_key)
        .send()
        .await
        .map_err(|error| format!("Failed to load subscriptions: {error}"))?;

    parse_backend_json_response(response, "Subscriptions request").await
}
