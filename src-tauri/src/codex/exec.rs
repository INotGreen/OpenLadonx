use std::collections::HashMap;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::time::{timeout, Duration};

use crate::bundled_cli;
use crate::claudecode;
use crate::shared::process_core::tokio_command;
use crate::state::AppState;

const CODEX_EXEC_TIMEOUT_SECS: u64 = 300;
const CODEX_EXEC_EVENT: &str = "codex-exec-event";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexExecPromptResponse {
    #[serde(rename = "stdout")]
    stdout: String,
    #[serde(rename = "stderr")]
    stderr: String,
    #[serde(rename = "exitCode")]
    exit_code: Option<i32>,
    #[serde(rename = "json")]
    json: Option<Value>,
    #[serde(rename = "events")]
    events: Vec<Value>,
    #[serde(rename = "resultEvent")]
    result_event: Option<Value>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "text")]
    text: String,
}

#[derive(Clone, Debug, Serialize)]
struct CodexExecStreamEvent {
    #[serde(rename = "chatId")]
    chat_id: String,
    #[serde(rename = "workspaceId")]
    workspace_id: String,
    #[serde(rename = "event")]
    event: Value,
    #[serde(rename = "deltaText")]
    delta_text: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexExecStoredSession {
    id: String,
    workspace_id: String,
    title: String,
    created_at: i64,
    updated_at: i64,
    session_id: String,
    file_path: String,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexExecStoredSessions {
    sessions_by_workspace: HashMap<String, Vec<CodexExecStoredSession>>,
}

fn extract_codex_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("result").and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(message) = value.get("message") {
        if let Some(text) = message.get("content").and_then(|c| c.as_str()) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        if let Some(items) = message.get("content").and_then(|c| c.as_array()) {
            let parts: Vec<String> = items
                .iter()
                .filter_map(|item| {
                    item.as_str()
                        .or_else(|| item.get("text").and_then(Value::as_str))
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                        .map(ToOwned::to_owned)
                })
                .collect();
            if !parts.is_empty() {
                return Some(parts.join("\n"));
            }
        }
    }

    for key in ["result", "response", "text", "message", "content"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    None
}

fn extract_codex_stream_text_delta(value: &Value) -> Option<String> {
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");

    match event_type {
        "content_block_start" => {
            let content_block = value.get("content_block")?;
            if content_block.get("type").and_then(Value::as_str) == Some("text") {
                return content_block
                    .get("text")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
            }
            None
        }
        "content_block_delta" => {
            let delta = value.get("delta")?;
            if delta.get("type").and_then(Value::as_str) == Some("text_delta") {
                return delta.get("text").and_then(Value::as_str).map(ToOwned::to_owned);
            }
            None
        }
        "assistant" => {
            value
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .and_then(|items| {
                    items.iter().find_map(|item| {
                        item.get("text").and_then(Value::as_str).map(ToOwned::to_owned)
                    })
                })
        }
        "event_msg" => {
            let payload = value.get("payload")?;
            if payload.get("type").and_then(Value::as_str) == Some("agent_message") {
                return payload.get("message").and_then(Value::as_str).map(ToOwned::to_owned);
            }
            None
        }
        "response_item" => {
            let payload = value.get("payload")?;
            if payload.get("type").and_then(Value::as_str) == Some("message")
                && payload.get("role").and_then(Value::as_str) == Some("assistant")
            {
                return payload
                    .get("content")
                    .and_then(|c| c.as_array())
                    .and_then(|items| {
                        items.iter().find_map(|item| {
                            item.get("text").and_then(Value::as_str).map(ToOwned::to_owned)
                        })
                    });
            }
            None
        }
        _ => None,
    }
}

fn codex_response_text(stdout: &str, json: Option<&Value>, events: &[Value]) -> String {
    for event in events.iter().rev() {
        if let Some(value) = extract_codex_text(event) {
            return value;
        }
    }
    if let Some(value) = json.and_then(extract_codex_text) {
        return value;
    }
    let trimmed = stdout.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    String::new()
}

fn extract_codex_session_id(events: &[Value]) -> Option<String> {
    events.iter().find_map(|event| {
        event
            .get("session_id")
            .or_else(|| event.get("sessionId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn parse_timestamp_millis(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.timestamp_millis())
        .unwrap_or(0)
}

fn normalize_path_string(path: &std::path::Path) -> String {
    let raw = path.to_string_lossy();
    let trimmed = raw.trim_end_matches(std::path::MAIN_SEPARATOR);
    if trimmed.is_empty() {
        raw.into_owned()
    } else {
        trimmed.to_string()
    }
}

fn canonical_path_string(path: &std::path::Path) -> Option<String> {
    std::fs::canonicalize(path)
        .ok()
        .map(|resolved| normalize_path_string(&resolved))
}

fn path_matches_workspace(cwd_path: &std::path::Path, workspace_path: &std::path::Path) -> bool {
    if cwd_path == workspace_path || cwd_path.starts_with(workspace_path) {
        return true;
    }

    let Some(cwd_canonical) = canonical_path_string(cwd_path) else {
        return false;
    };
    let Some(workspace_canonical) = canonical_path_string(workspace_path) else {
        return false;
    };

    cwd_canonical == workspace_canonical || cwd_canonical.starts_with(&(workspace_canonical + "/"))
}

fn workspace_id_for_cwd(
    cwd: &str,
    workspaces: &HashMap<String, crate::types::WorkspaceEntry>,
) -> Option<String> {
    let cwd_path = std::path::Path::new(cwd);

    workspaces
        .values()
        .filter(|entry| {
            let entry_path = std::path::Path::new(&entry.path);
            path_matches_workspace(cwd_path, entry_path)
        })
        .max_by_key(|entry| entry.path.len())
        .map(|entry| entry.id.clone())
}

fn emit_stream_event(
    app: &AppHandle,
    chat_id: &str,
    workspace_id: &str,
    event: &Value,
    delta_text: Option<String>,
    session_id: Option<String>,
) {
    let _ = app.emit(
        CODEX_EXEC_EVENT,
        CodexExecStreamEvent {
            chat_id: chat_id.to_string(),
            workspace_id: workspace_id.to_string(),
            event: event.clone(),
            delta_text,
            session_id,
        },
    );
}

#[tauri::command]
pub(crate) async fn codex_exec_prompt(
    chat_id: String,
    workspace_id: String,
    prompt: String,
    session_id: Option<String>,
    model: Option<String>,
    sandbox: Option<String>,
    ephemeral: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CodexExecPromptResponse, String> {
    let trimmed_prompt = prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err("Prompt is required".to_string());
    }

    let workspace_cwd = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get(&workspace_id)
            .ok_or_else(|| "Unknown workspace".to_string())?;
        std::path::PathBuf::from(&entry.path)
    };

    let codex_bin =
        bundled_cli::ensure_bundled_cli().unwrap_or_else(|| std::path::PathBuf::from("codex"));
    let mut command = tokio_command(&codex_bin);
    let codex_home = bundled_cli::bundled_cli_home();

    command
        .current_dir(&workspace_cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(ref resume_sid) = session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("exec").arg("resume").arg(resume_sid);
    } else {
        command.arg("exec");
    }

    command.arg("--json");

    if let Some(model) = model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("--model").arg(model);
    }
    if let Some(sandbox) = sandbox
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("--sandbox").arg(sandbox);
    }
    if ephemeral.unwrap_or(false) {
        command.arg("--ephemeral");
    }
    command.arg("--cd").arg(&workspace_cwd);
    command.arg("--add-dir").arg(&workspace_cwd);

    if let Some(home) = codex_home {
        command.env(crate::settings::CODEX_HOME_ENV, &home);
    }
    if let Some(api_key) = crate::settings::openai_api_key_from_env() {
        command.env(crate::settings::OPENAI_API_KEY_ENV, &api_key);
    }
    if let Ok(base_url) = std::env::var(crate::settings::OPENAI_BASE_URL_ENV) {
        let trimmed = base_url.trim();
        if !trimmed.is_empty() {
            command.env(crate::settings::OPENAI_BASE_URL_ENV, trimmed);
        }
    }
    if let Some(api_key) = crate::settings::anthropic_api_key_from_env() {
        command.env(crate::settings::ANTHROPIC_API_KEY_ENV, &api_key);
    }
    if let Some(base_url) = crate::settings::anthropic_base_url_from_env() {
        command.env(crate::settings::ANTHROPIC_BASE_URL_ENV, &base_url);
    }

    command.arg(trimmed_prompt);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run Codex: {error}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "Failed to resolve Codex process id.".to_string())?;
    {
        let mut processes = state.codex_exec_processes.lock().await;
        processes.insert(chat_id.clone(), pid);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture Codex stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture Codex stderr.".to_string())?;

    let stream_chat_id = chat_id.clone();
    let stream_workspace_id = workspace_id.clone();
    let runtime = async move {
        let stderr_task = tokio::spawn(async move {
            let mut stderr_reader = BufReader::new(stderr);
            let mut stderr_buffer = String::new();
            stderr_reader.read_to_string(&mut stderr_buffer).await?;
            Ok::<String, std::io::Error>(stderr_buffer)
        });

        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stdout_buffer = String::new();
        let mut events: Vec<Value> = Vec::new();
        let mut streamed_text = String::new();
        let mut latest_session_id: Option<String> = None;

        while let Some(line) = stdout_reader
            .next_line()
            .await
            .map_err(|error| format!("Failed to read Codex output: {error}"))?
        {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            stdout_buffer.push_str(trimmed);
            stdout_buffer.push('\n');

            if let Ok(event) = serde_json::from_str::<Value>(trimmed) {
                if latest_session_id.is_none() {
                    latest_session_id = event
                        .get("session_id")
                        .or_else(|| event.get("sessionId"))
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned);
                }
                let delta_text = extract_codex_stream_text_delta(&event);
                if let Some(delta) = delta_text.as_deref() {
                    streamed_text.push_str(delta);
                }
                emit_stream_event(
                    &app,
                    &stream_chat_id,
                    &stream_workspace_id,
                    &event,
                    delta_text,
                    latest_session_id.clone(),
                );
                events.push(event);
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|error| format!("Failed to wait for Codex: {error}"))?;
        let stderr = stderr_task
            .await
            .map_err(|error| format!("Failed to collect Codex stderr: {error}"))?
            .map_err(|error| format!("Failed to read Codex stderr: {error}"))?;
        let json = serde_json::from_str::<Value>(stdout_buffer.trim()).ok();
        let result_event = events
            .iter()
            .rev()
            .find(|event| {
                event
                    .get("type")
                    .and_then(Value::as_str)
                    .map(|t| t == "result" || t == "turn/completed")
                    .unwrap_or(false)
            })
            .cloned();
        let session_id = latest_session_id.or_else(|| extract_codex_session_id(&events));
        let text = if streamed_text.is_empty() {
            codex_response_text(&stdout_buffer, json.as_ref(), &events)
        } else {
            streamed_text
        };

        if !status.success() {
            let message = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else if !stdout_buffer.trim().is_empty() {
                stdout_buffer.trim().to_string()
            } else {
                "Codex exited with a non-zero status.".to_string()
            };
            return Err(message);
        }

        Ok(CodexExecPromptResponse {
            stdout: stdout_buffer,
            stderr,
            exit_code: status.code(),
            json,
            events,
            result_event,
            session_id,
            text,
        })
    };

    let result = timeout(
        Duration::from_secs(CODEX_EXEC_TIMEOUT_SECS),
        runtime,
    )
    .await
    .map_err(|_| {
        format!("Codex did not respond within {CODEX_EXEC_TIMEOUT_SECS} seconds.")
    });

    {
        let mut processes = state.codex_exec_processes.lock().await;
        processes.remove(&chat_id);
    }

    if result.is_err() {
        let _ = claudecode::kill_pid_gracefully(pid).await;
    }

    result.map_err(|error| error)?.map_err(|error| error)
}

#[tauri::command]
pub(crate) async fn codex_exec_stop(
    chat_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let pid = {
        let mut processes = state.codex_exec_processes.lock().await;
        processes.remove(&chat_id)
    };

    let Some(pid) = pid else {
        return Ok(false);
    };

    claudecode::kill_pid_gracefully(pid).await?;
    Ok(true)
}

#[tauri::command]
pub(crate) async fn codex_exec_list_sessions(
    state: State<'_, AppState>,
) -> Result<CodexExecStoredSessions, String> {
    let Some(codex_home) = crate::settings::resolve_default_codex_home() else {
        return Ok(CodexExecStoredSessions::default());
    };
    let index_path = codex_home.join("session_index.jsonl");
    if !index_path.exists() {
        return Ok(CodexExecStoredSessions::default());
    }

    let content = tokio::fs::read_to_string(&index_path)
        .await
        .map_err(|error| format!("Failed to read session index: {error}"))?;

    let workspaces_snapshot = state.workspaces.lock().await.clone();
    let mut result = CodexExecStoredSessions::default();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        let Some(session_id) = value
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
        else {
            continue;
        };

        let cwd = value
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default();

        let Some(workspace_id) = workspace_id_for_cwd(cwd, &workspaces_snapshot) else {
            continue;
        };

        let title = value
            .get("thread_name")
            .or_else(|| value.get("title"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Untitled")
            .to_string();

        let updated_at = value
            .get("updated_at")
            .and_then(Value::as_str)
            .map(parse_timestamp_millis)
            .unwrap_or(0);

        let created_at = value
            .get("created_at")
            .or_else(|| value.get("timestamp"))
            .and_then(Value::as_str)
            .map(parse_timestamp_millis)
            .unwrap_or(updated_at);

        let file_path = codex_home
            .join("sessions")
            .join(format!("{session_id}.jsonl"))
            .to_string_lossy()
            .to_string();

        result
            .sessions_by_workspace
            .entry(workspace_id.clone())
            .or_default()
            .push(CodexExecStoredSession {
                id: session_id.clone(),
                workspace_id,
                title,
                created_at,
                updated_at,
                session_id,
                file_path,
            });
    }

    for sessions in result.sessions_by_workspace.values_mut() {
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    }

    Ok(result)
}

#[tauri::command]
pub(crate) async fn codex_exec_read_session(
    session_id: String,
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Value>, String> {
    let Some(codex_home) = crate::settings::resolve_default_codex_home() else {
        return Ok(Vec::new());
    };

    let session_path = codex_home
        .join("sessions")
        .join(format!("{}.jsonl", session_id.trim()));

    if !session_path.exists() {
        return Ok(Vec::new());
    }

    let content = tokio::fs::read_to_string(&session_path)
        .await
        .map_err(|error| format!("Failed to read session file: {error}"))?;

    let workspaces_snapshot = state.workspaces.lock().await.clone();
    let mut events: Vec<Value> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        if let Some(target_ws) = workspace_id.as_deref() {
            let event_cwd = value
                .get("cwd")
                .or_else(|| value.get("payload").and_then(|p| p.get("cwd")))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !event_cwd.is_empty() {
                let mapped = workspace_id_for_cwd(event_cwd, &workspaces_snapshot);
                if mapped.as_deref() != Some(target_ws) {
                    continue;
                }
            }
        }

        events.push(value);
    }

    Ok(events)
}
