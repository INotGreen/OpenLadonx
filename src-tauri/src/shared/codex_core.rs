use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::oneshot::error::TryRecvError;
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;
use tokio::time::Instant;

use crate::backend::app_server::WorkspaceSession;
use crate::codex::config as codex_config;
use crate::codex::home::{resolve_default_codex_home, resolve_workspace_codex_home};
use crate::rules;
use crate::shared::account::{build_account_response, read_auth_account};
use crate::types::{AppSettings, WorkspaceEntry};

const LOGIN_START_TIMEOUT: Duration = Duration::from_secs(30);
#[allow(dead_code)]
const MAX_INLINE_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
const MODEL_LIST_TIMEOUT: Duration = Duration::from_secs(30);
static SESSION_INDEX_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

fn session_index_mutex() -> &'static Mutex<()> {
    SESSION_INDEX_MUTEX.get_or_init(|| Mutex::new(()))
}

fn current_timestamp_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn system_time_to_rfc3339(time: SystemTime) -> String {
    let datetime = chrono::DateTime::<Utc>::from(time);
    datetime.to_rfc3339()
}

fn normalize_session_path(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(std::path::MAIN_SEPARATOR)
        .to_string()
}

fn path_matches_workspace_root(path: &str, workspace_root: &str) -> bool {
    let normalized_path = normalize_session_path(path);
    let normalized_root = normalize_session_path(workspace_root);
    if normalized_path.is_empty() || normalized_root.is_empty() {
        return false;
    }
    normalized_path == normalized_root
        || (normalized_path.len() > normalized_root.len()
            && normalized_path.starts_with(&normalized_root)
            && normalized_path.as_bytes().get(normalized_root.len()) == Some(&b'/'))
}

fn extract_thread_id_from_value(value: &Value) -> Option<String> {
    value
        .get("result")
        .and_then(|result| result.get("thread"))
        .and_then(|thread| thread.get("id"))
        .or_else(|| value.get("thread").and_then(|thread| thread.get("id")))
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn session_index_path(codex_home: &Path) -> PathBuf {
    codex_home.join("session_index.jsonl")
}

fn empty_thread_list_response() -> Value {
    json!({
        "result": {
            "data": [],
            "nextCursor": null,
        }
    })
}

async fn ensure_session_index_file(codex_home: &Path) -> Result<PathBuf, String> {
    let index_path = session_index_path(codex_home);
    if index_path.is_file() {
        return Ok(index_path);
    }
    if let Some(parent) = index_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("Failed to create session index directory: {error}"))?;
    }
    tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&index_path)
        .await
        .map_err(|error| format!("Failed to create session index: {error}"))?;
    Ok(index_path)
}

fn session_index_row_source(row: &Map<String, Value>) -> String {
    row.get("source")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("codex")
        .to_string()
}

fn session_index_row_is_codex(row: &Map<String, Value>) -> bool {
    session_index_row_source(row) == "codex"
}

fn merge_session_index_row(existing: &mut Map<String, Value>, next: Map<String, Value>) {
    let existing_created_at = existing.get("created_at").cloned();
    for (key, value) in next {
        if key == "created_at" && existing_created_at.is_some() {
            continue;
        }
        if !value.is_null() {
            existing.insert(key, value);
        }
    }
}

fn dedupe_session_index_rows(rows: Vec<Map<String, Value>>) -> Vec<Map<String, Value>> {
    let mut unique_rows = Vec::new();
    let mut row_index_by_id: HashMap<String, usize> = HashMap::new();
    for row in rows {
        let source = session_index_row_source(&row);
        let Some(thread_id) = row
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
        else {
            unique_rows.push(row);
            continue;
        };
        let key = format!("{source}:{thread_id}");
        if let Some(index) = row_index_by_id.get(&key).copied() {
            merge_session_index_row(&mut unique_rows[index], row);
        } else {
            row_index_by_id.insert(key, unique_rows.len());
            unique_rows.push(row);
        }
    }
    unique_rows
}

pub(crate) async fn upsert_session_index_entry(
    codex_home: &Path,
    thread_id: &str,
    workspace_path: &str,
    thread_name: Option<&str>,
    source: &str,
    file_path: Option<&str>,
) -> Result<(), String> {
    let _guard = session_index_mutex().lock().await;
    let sessions_dir = codex_home.join("sessions");
    tokio::fs::create_dir_all(&sessions_dir)
        .await
        .map_err(|error| format!("Failed to create sessions directory: {error}"))?;
    let index_path = session_index_path(&codex_home);
    let existing = match tokio::fs::read_to_string(&index_path).await {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Failed to read session index: {error}")),
    };

    let now = current_timestamp_rfc3339();
    let source = match source.trim() {
        "claude_code" => "claude_code",
        _ => "codex",
    };
    let mut rows: Vec<Map<String, Value>> = existing
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|value| value.as_object().cloned())
        .collect();

    let mut found = false;
    for row in &mut rows {
        let matches = row.get("id").and_then(Value::as_str).map(str::trim) == Some(thread_id)
            && session_index_row_source(row) == source;
        if !matches {
            continue;
        }
        found = true;
        row.insert("source".to_string(), json!(source));
        row.insert("cwd".to_string(), json!(workspace_path));
        row.insert("workspace_path".to_string(), json!(workspace_path));
        row.insert("updated_at".to_string(), json!(now.clone()));
        if !row.contains_key("created_at") {
            row.insert("created_at".to_string(), json!(now.clone()));
        }
        if let Some(name) = thread_name.map(str::trim).filter(|value| !value.is_empty()) {
            row.insert("thread_name".to_string(), json!(name));
        }
        if let Some(path) = file_path.map(str::trim).filter(|value| !value.is_empty()) {
            row.insert("filePath".to_string(), json!(path));
            row.insert("path".to_string(), json!(path));
        }
    }

    if !found {
        let mut row = Map::new();
        row.insert("id".to_string(), json!(thread_id));
        row.insert("source".to_string(), json!(source));
        row.insert("cwd".to_string(), json!(workspace_path));
        row.insert("workspace_path".to_string(), json!(workspace_path));
        row.insert("created_at".to_string(), json!(now.clone()));
        row.insert("updated_at".to_string(), json!(now));
        if let Some(name) = thread_name.map(str::trim).filter(|value| !value.is_empty()) {
            row.insert("thread_name".to_string(), json!(name));
        }
        if let Some(path) = file_path.map(str::trim).filter(|value| !value.is_empty()) {
            row.insert("filePath".to_string(), json!(path));
            row.insert("path".to_string(), json!(path));
        }
        rows.push(row);
    }

    let mut serialized = dedupe_session_index_rows(rows)
        .into_iter()
        .map(|row| {
            serde_json::to_string(&Value::Object(row))
                .map_err(|error| format!("Failed to serialize session index entry: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?
        .join("\n");
    if !serialized.is_empty() {
        serialized.push('\n');
    }
    tokio::fs::write(index_path, serialized)
        .await
        .map_err(|error| format!("Failed to write session index: {error}"))
}

pub(crate) async fn remove_session_index_entry(
    codex_home: &Path,
    thread_id: &str,
    source: Option<&str>,
) -> Result<(), String> {
    let _guard = session_index_mutex().lock().await;
    let index_path = session_index_path(&codex_home);
    let legacy_index_path = codex_home.join("sessions").join("session_index.jsonl");
    let existing = match tokio::fs::read_to_string(&index_path).await {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match tokio::fs::read_to_string(&legacy_index_path).await {
                Ok(content) => content,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(format!("Failed to read session index: {error}")),
            }
        }
        Err(error) => return Err(format!("Failed to read session index: {error}")),
    };

    let mut serialized = String::new();
    for line in existing.lines() {
        let keep = serde_json::from_str::<Value>(line)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .map(|row| {
                let id_matches = row
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .is_some_and(|id| id == thread_id);
                let source_matches = source
                    .map(|source| session_index_row_source(&row) == source)
                    .unwrap_or(true);
                !(id_matches && source_matches)
            })
            .unwrap_or(true);
        if keep {
            serialized.push_str(line);
            serialized.push('\n');
        }
    }

    tokio::fs::write(index_path, serialized)
        .await
        .map_err(|error| format!("Failed to write session index: {error}"))
}

async fn delete_thread_session_file(codex_home: &Path, thread_id: &str) -> Result<(), String> {
    let Some(path) = find_thread_jsonl_file(codex_home, thread_id).await else {
        return Ok(());
    };
    tokio::fs::remove_file(&path)
        .await
        .map_err(|error| format!("Failed to delete thread session file: {error}"))
}

async fn list_threads_from_session_index(
    session: &Arc<WorkspaceSession>,
    workspace_id: &str,
    cursor: Option<String>,
    limit: Option<u32>,
    sort_key: Option<String>,
) -> Result<Value, String> {
    let Some(codex_home) = resolve_default_codex_home() else {
        return Err("Unable to resolve Codex home directory".to_string());
    };
    let index_path = ensure_session_index_file(&codex_home).await?;
    let workspace_root = {
        session
            .workspace_roots
            .lock()
            .await
            .get(workspace_id)
            .cloned()
    };
    let Some(workspace_root) = workspace_root else {
        return Ok(empty_thread_list_response());
    };
    let content = tokio::fs::read_to_string(&index_path)
        .await
        .map_err(|error| format!("Failed to read session index: {error}"))?;
    let mut by_id: HashMap<String, Map<String, Value>> = HashMap::new();
    for line in content.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(object) = value.as_object() else {
            continue;
        };
        if !session_index_row_is_codex(object) {
            continue;
        }
        let Some(thread_id) = object
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let cwd = object
            .get("cwd")
            .or_else(|| object.get("workspace_path"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !path_matches_workspace_root(cwd, &workspace_root) {
            continue;
        }
        let candidate_updated_at = object
            .get("updated_at")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let should_replace = by_id
            .get(thread_id)
            .and_then(|existing| existing.get("updated_at"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            <= candidate_updated_at;
        if should_replace {
            by_id.insert(thread_id.to_string(), object.clone());
        }
    }
    if by_id.is_empty() {
        return Ok(empty_thread_list_response());
    }

    let mut rows = by_id.into_values().collect::<Vec<_>>();
    let sort_by_created = sort_key.as_deref() == Some("created_at");
    rows.sort_by(|left, right| {
        let left_key = if sort_by_created {
            left.get("created_at")
                .and_then(Value::as_str)
                .unwrap_or_default()
        } else {
            left.get("updated_at")
                .and_then(Value::as_str)
                .unwrap_or_default()
        };
        let right_key = if sort_by_created {
            right
                .get("created_at")
                .and_then(Value::as_str)
                .unwrap_or_default()
        } else {
            right
                .get("updated_at")
                .and_then(Value::as_str)
                .unwrap_or_default()
        };
        right_key.cmp(left_key)
    });

    let page_size = limit.unwrap_or(100).max(1) as usize;
    let offset = cursor
        .as_deref()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let slice = rows
        .into_iter()
        .skip(offset)
        .take(page_size)
        .collect::<Vec<_>>();
    let next_cursor = if slice.len() == page_size {
        Some((offset + page_size).to_string())
    } else {
        None
    };
    let data = slice
        .into_iter()
        .map(|row| {
            let thread_id = row
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let title = row
                .get("thread_name")
                .or_else(|| row.get("title"))
                .and_then(Value::as_str)
                .unwrap_or("New Agent")
                .to_string();
            let cwd = row
                .get("cwd")
                .or_else(|| row.get("workspace_path"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let session_file_path = codex_home
                .join("sessions")
                .join(format!("{thread_id}.jsonl"))
                .to_string_lossy()
                .to_string();
            json!({
                "id": thread_id,
                "threadName": title,
                "title": title,
                "cwd": cwd,
                "workspace_path": cwd,
                "updated_at": row.get("updated_at").cloned().unwrap_or(Value::Null),
                "created_at": row.get("created_at").cloned().unwrap_or(Value::Null),
                "path": session_file_path,
                "source": "cli",
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "result": {
            "data": data,
            "nextCursor": next_cursor,
        }
    }))
}

fn thread_jsonl_file_matches(path: &Path, thread_id: &str) -> bool {
    if thread_id.trim().is_empty() {
        return false;
    }
    path.extension().and_then(|value| value.to_str()) == Some("jsonl")
        && path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.contains(thread_id))
}

async fn find_thread_jsonl_file(codex_home: &Path, thread_id: &str) -> Option<PathBuf> {
    let sessions_dir = codex_home.join("sessions");
    let direct = sessions_dir.join(format!("{thread_id}.jsonl"));
    if direct.is_file() {
        return Some(direct);
    }

    let mut stack = vec![sessions_dir];
    while let Some(dir) = stack.pop() {
        let Ok(mut entries) = tokio::fs::read_dir(&dir).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let Ok(file_type) = entry.file_type().await else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if file_type.is_file() && thread_jsonl_file_matches(&path, thread_id) {
                return Some(path);
            }
        }
    }
    None
}

async fn resolve_thread_jsonl_path(codex_home: &Path, thread_id: &str) -> String {
    if let Some(path) = find_thread_jsonl_file(codex_home, thread_id).await {
        return path.to_string_lossy().to_string();
    }
    codex_home
        .join("sessions")
        .join(format!("{thread_id}.jsonl"))
        .to_string_lossy()
        .to_string()
}

fn is_history_response_item(value: &Value) -> bool {
    matches!(
        (
            value.get("type").and_then(Value::as_str),
            value
                .get("payload")
                .and_then(|payload| payload.get("type"))
                .and_then(Value::as_str)
        ),
        (
            Some("response_item"),
            Some(
                "message"
                    | "function_call"
                    | "function_call_output"
                    | "custom_tool_call"
                    | "custom_tool_call_output"
            )
        )
    )
}

fn history_item_payload(value: &Value) -> &Value {
    if matches!(
        value.get("type").and_then(Value::as_str),
        Some("response_item" | "event_msg")
    ) {
        if let Some(payload) = value.get("payload") {
            return payload;
        }
    }
    value
}

fn history_item_key(value: &Value) -> Option<String> {
    let payload = history_item_payload(value);
    let item_type = payload.get("type").and_then(Value::as_str)?;
    let id = payload
        .get("call_id")
        .or_else(|| payload.get("callId"))
        .or_else(|| payload.get("id"))
        .and_then(Value::as_str)
        .or_else(|| value.get("timestamp").and_then(Value::as_str))?;
    Some(format!("{item_type}:{id}"))
}

fn text_from_history_content(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        let trimmed = text.trim_start();
        if trimmed.starts_with("<skill>") {
            return None;
        }
        let cleaned = strip_leading_history_skill_tokens(trimmed);
        let trimmed = cleaned.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    let items = content.as_array()?;
    let parts: Vec<String> = items
        .iter()
        .filter_map(|item| {
            item.as_str()
                .or_else(|| item.get("text").and_then(Value::as_str))
                .or_else(|| item.get("content").and_then(Value::as_str))
                .and_then(|text| {
                    let trimmed = text.trim_start();
                    if trimmed.starts_with("<skill>") {
                        None
                    } else {
                        Some(strip_leading_history_skill_tokens(trimmed))
                    }
                })
                .map(|text| text.trim())
                .filter(|text| !text.is_empty())
                .map(ToOwned::to_owned)
        })
        .collect();
    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn strip_leading_history_skill_tokens(text: &str) -> &str {
    let mut remaining = text.trim_start();
    loop {
        if let Some(rest) = strip_leading_skill_token(remaining) {
            remaining = rest.trim_start();
            continue;
        }
        if let Some(rest) = strip_leading_file_token(remaining) {
            remaining = rest.trim_start();
            continue;
        }
        break;
    }
    remaining
}

fn strip_leading_skill_token(text: &str) -> Option<&str> {
    let stripped = text.strip_prefix("[$")?;
    let name_end = stripped.find(':')?;
    if name_end == 0 {
        return None;
    }
    let stripped = &stripped[name_end + 1..];
    let alias_end = stripped.find("](")?;
    if alias_end == 0 {
        return None;
    }
    let stripped = &stripped[alias_end + 2..];
    let path_end = stripped.find(')')?;
    Some(&stripped[path_end + 1..])
}

fn strip_leading_file_token(text: &str) -> Option<&str> {
    let stripped = text.strip_prefix("@'")?;
    let path_end = stripped.find('\'')?;
    Some(&stripped[path_end + 1..])
}

fn normalized_history_message_text(text: &str) -> String {
    text.replace("\r\n", "\n").trim().to_string()
}

fn history_message_key(value: &Value) -> Option<String> {
    let payload = history_item_payload(value);
    match payload.get("type").and_then(Value::as_str)? {
        "message" => {
            let role = payload.get("role").and_then(Value::as_str)?;
            let text = payload
                .get("content")
                .and_then(text_from_history_content)
                .map(|text| normalized_history_message_text(&text))?;
            (!text.is_empty()).then(|| format!("message:{role}:{text}"))
        }
        "userMessage" => {
            let text = payload
                .get("content")
                .and_then(text_from_history_content)
                .map(|text| normalized_history_message_text(&text))?;
            (!text.is_empty()).then(|| format!("message:user:{text}"))
        }
        "agentMessage" => {
            let text = payload
                .get("text")
                .and_then(Value::as_str)
                .map(normalized_history_message_text)?;
            (!text.is_empty()).then(|| format!("message:assistant:{text}"))
        }
        _ => None,
    }
}

fn collect_existing_thread_item_keys(thread: &Value) -> HashSet<String> {
    let mut keys = HashSet::new();
    let Some(turns) = thread.get("turns").and_then(Value::as_array) else {
        return keys;
    };
    for turn in turns {
        let Some(items) = turn.get("items").and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            if let Some(key) = history_item_key(item) {
                keys.insert(key);
            }
        }
    }
    keys
}

fn collect_existing_thread_message_counts(thread: &Value) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    let Some(turns) = thread.get("turns").and_then(Value::as_array) else {
        return counts;
    };
    for turn in turns {
        let Some(items) = turn.get("items").and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            if let Some(key) = history_message_key(item) {
                *counts.entry(key).or_insert(0) += 1;
            }
        }
    }
    counts
}

async fn read_thread_history_response_items(codex_home: &Path, thread_id: &str) -> Vec<Value> {
    let Some(path) = find_thread_jsonl_file(codex_home, thread_id).await else {
        return Vec::new();
    };
    let Ok(content) = tokio::fs::read_to_string(path).await else {
        return Vec::new();
    };
    let mut items = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if is_history_response_item(&value) {
            items.push(value);
        }
    }
    items
}

fn thread_object_mut(response: &mut Value) -> Option<&mut Map<String, Value>> {
    let has_result_thread = response
        .get("result")
        .and_then(Value::as_object)
        .and_then(|result| result.get("thread"))
        .is_some();
    if has_result_thread {
        return response
            .get_mut("result")
            .and_then(Value::as_object_mut)
            .and_then(|result| result.get_mut("thread"))
            .and_then(Value::as_object_mut);
    }
    response.get_mut("thread").and_then(Value::as_object_mut)
}

fn item_is_leading_skill_message(item: &Value) -> bool {
    let payload = history_item_payload(item);
    let is_user_message = matches!(
        payload.get("type").and_then(Value::as_str),
        Some("message" | "userMessage")
    ) && matches!(
        payload.get("role").and_then(Value::as_str),
        Some("user") | None
    );
    if !is_user_message {
        return false;
    }
    let Some(text) = payload
        .get("content")
        .and_then(text_from_history_content_raw)
    else {
        return false;
    };
    text.trim_start().starts_with("<skill>")
}

fn text_from_history_content_raw(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    let items = content.as_array()?;
    let parts: Vec<String> = items
        .iter()
        .filter_map(|item| {
            item.as_str()
                .or_else(|| item.get("text").and_then(Value::as_str))
                .or_else(|| item.get("content").and_then(Value::as_str))
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(ToOwned::to_owned)
        })
        .collect();
    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn filter_thread_skill_messages(response: &mut Value) {
    let Some(thread) = thread_object_mut(response) else {
        return;
    };
    let Some(turns) = thread.get_mut("turns").and_then(Value::as_array_mut) else {
        return;
    };
    for turn in turns {
        let Some(items) = turn.get_mut("items").and_then(Value::as_array_mut) else {
            continue;
        };
        items.retain(|item| !item_is_leading_skill_message(item));
    }
}

async fn supplement_thread_history(response: &mut Value, codex_home: &Path, thread_id: &str) {
    let Some(thread) = response
        .get("result")
        .and_then(|result| result.get("thread"))
        .or_else(|| response.get("thread"))
    else {
        return;
    };
    let mut existing_keys = collect_existing_thread_item_keys(thread);
    let mut existing_message_counts = collect_existing_thread_message_counts(thread);
    let supplemental_items = read_thread_history_response_items(codex_home, thread_id).await;
    let supplemental_items: Vec<Value> = supplemental_items
        .into_iter()
        .filter(|item| {
            if let Some(key) = history_item_key(item) {
                if !existing_keys.insert(key) {
                    return false;
                }
            }
            if let Some(key) = history_message_key(item) {
                if let Some(count) = existing_message_counts.get_mut(&key) {
                    if *count > 0 {
                        *count -= 1;
                        return false;
                    }
                }
            }
            true
        })
        .collect();
    if supplemental_items.is_empty() {
        return;
    }

    let Some(thread) = thread_object_mut(response) else {
        return;
    };
    let turns = thread
        .entry("turns".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if !turns.is_array() {
        *turns = Value::Array(Vec::new());
    }
    let Some(turns) = turns.as_array_mut() else {
        return;
    };
    if turns.is_empty() {
        turns.push(json!({ "items": [] }));
    }
    let Some(last_turn) = turns.last_mut().and_then(Value::as_object_mut) else {
        return;
    };
    let items = last_turn
        .entry("items".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if !items.is_array() {
        *items = Value::Array(Vec::new());
    }
    if let Some(items) = items.as_array_mut() {
        items.extend(supplemental_items);
    }
}

async fn supplement_thread_file_path(response: &mut Value, codex_home: &Path, thread_id: &str) {
    let Some(thread) = thread_object_mut(response) else {
        return;
    };
    let path = resolve_thread_jsonl_path(codex_home, thread_id).await;
    thread.insert("path".to_string(), Value::String(path.clone()));
    thread.insert("filePath".to_string(), Value::String(path));
}

#[allow(dead_code)]
fn image_extension_for_path(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

#[allow(dead_code)]
fn image_mime_type_for_path(path: &str) -> Option<&'static str> {
    let extension = image_extension_for_path(path)?;
    match extension.as_str() {
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "ico" => Some("image/x-icon"),
        "svg" => Some("image/svg+xml"),
        "webp" => Some("image/webp"),
        "tiff" | "tif" => Some("image/tiff"),
        _ => None,
    }
}

#[allow(dead_code)]
fn should_inline_image_path_for_codex(path: &str) -> bool {
    matches!(
        image_extension_for_path(path).as_deref(),
        Some("heic") | Some("heif")
    )
}

#[cfg(target_os = "macos")]
fn temp_converted_image_path(path: &str, extension: &str) -> PathBuf {
    let stem = Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let safe_stem = stem
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("ladonx-image-{safe_stem}-{ts}.{extension}"))
}

#[cfg(target_os = "macos")]
fn convert_heif_image_to_jpeg_bytes(path: &str) -> Result<Vec<u8>, String> {
    let output_path = temp_converted_image_path(path, "jpg");
    let status = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "jpeg"])
        .arg(path)
        .arg("--out")
        .arg(&output_path)
        .status()
        .map_err(|err| format!("Failed to launch HEIC/HEIF conversion for {path}: {err}"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&output_path);
        return Err(format!(
            "Failed to convert HEIC/HEIF image into a Codex-compatible JPEG: {path}"
        ));
    }
    let bytes = std::fs::read(&output_path).map_err(|err| {
        format!(
            "Failed to read converted JPEG for {path} at {}: {err}",
            output_path.display()
        )
    })?;
    let _ = std::fs::remove_file(&output_path);
    if bytes.is_empty() {
        return Err(format!(
            "Converted JPEG is empty after HEIC/HEIF conversion: {path}"
        ));
    }
    Ok(bytes)
}

#[allow(dead_code)]
pub(crate) fn normalize_file_path(raw: &str) -> String {
    let path = raw.trim();
    let file_uri_path = path
        .strip_prefix("file://localhost")
        .or_else(|| path.strip_prefix("file://"));
    let Some(path) = file_uri_path else {
        return path.to_string();
    };

    let mut decoded = Vec::with_capacity(path.len());
    let bytes = path.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hi = bytes[index + 1];
            let lo = bytes[index + 2];
            let hi_value = match hi {
                b'0'..=b'9' => Some(hi - b'0'),
                b'a'..=b'f' => Some(hi - b'a' + 10),
                b'A'..=b'F' => Some(hi - b'A' + 10),
                _ => None,
            };
            let lo_value = match lo {
                b'0'..=b'9' => Some(lo - b'0'),
                b'a'..=b'f' => Some(lo - b'a' + 10),
                b'A'..=b'F' => Some(lo - b'A' + 10),
                _ => None,
            };
            if let (Some(hi_nibble), Some(lo_nibble)) = (hi_value, lo_value) {
                decoded.push((hi_nibble << 4) | lo_nibble);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

#[allow(dead_code)]
pub(crate) fn read_image_as_data_url_core(path: &str) -> Result<String, String> {
    let trimmed_path = normalize_file_path(path);
    if trimmed_path.is_empty() {
        return Err("Image path is required".to_string());
    }
    if should_inline_image_path_for_codex(&trimmed_path) {
        #[cfg(target_os = "macos")]
        {
            let encoded = STANDARD.encode(convert_heif_image_to_jpeg_bytes(&trimmed_path)?);
            return Ok(format!("data:image/jpeg;base64,{encoded}"));
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err(format!(
                "HEIC/HEIF images are not supported on this platform; convert to JPEG or PNG first: {trimmed_path}"
            ));
        }
    }
    let mime_type = image_mime_type_for_path(&trimmed_path).ok_or_else(|| {
        format!("Unsupported or missing image extension for path: {trimmed_path}")
    })?;
    let metadata = std::fs::symlink_metadata(&trimmed_path)
        .map_err(|err| format!("Failed to stat image file at {trimmed_path}: {err}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Image path must not be a symlink: {trimmed_path}"));
    }
    if !metadata.is_file() {
        return Err(format!("Image path is not a file: {trimmed_path}"));
    }
    if metadata.len() > MAX_INLINE_IMAGE_BYTES {
        return Err(format!(
            "Image file exceeds maximum size of {MAX_INLINE_IMAGE_BYTES} bytes: {trimmed_path}"
        ));
    }
    let bytes = std::fs::read(&trimmed_path)
        .map_err(|err| format!("Failed to read image file at {trimmed_path}: {err}"))?;
    if bytes.is_empty() {
        return Err(format!("Image file is empty: {trimmed_path}"));
    }
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

pub(crate) enum CodexLoginCancelState {
    PendingStart(oneshot::Sender<()>),
    LoginId(String),
}

async fn get_session_clone(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: &str,
) -> Result<Arc<WorkspaceSession>, String> {
    let sessions = sessions.lock().await;
    sessions
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not connected".to_string())
}

async fn resolve_workspace_and_parent(
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

async fn resolve_codex_home_for_workspace_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, workspace_id).await?;
    resolve_workspace_codex_home(&entry, parent_entry.as_ref())
        .or_else(resolve_default_codex_home)
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
}

async fn resolve_workspace_path_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<String, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    Ok(entry.path.clone())
}

pub(crate) async fn start_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    access_mode: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let workspace_path = resolve_workspace_path_core(workspaces, &workspace_id).await?;
    let access_mode = access_mode.unwrap_or_else(|| "current".to_string());
    let approval_policy = match access_mode.as_str() {
        "read-only" => "untrusted",
        "full-access" => "never",
        _ => "on-request",
    };
    let sandbox_policy = match access_mode.as_str() {
        "full-access" => json!({ "type": "dangerFullAccess" }),
        "read-only" => json!({ "type": "readOnly" }),
        _ => json!({
            "type": "workspaceWrite",
            "writableRoots": [workspace_path.clone()],
            "networkAccess": true
        }),
    };
    let params = json!({
        "cwd": workspace_path,
        "approvalPolicy": approval_policy,
        "sandboxPolicy": sandbox_policy,
    });
    let response = session
        .send_request_for_workspace(&workspace_id, "thread/start", params)
        .await?;
    if let (Some(codex_home), Some(thread_id)) = (
        resolve_default_codex_home(),
        extract_thread_id_from_value(&response),
    ) {
        let _ = upsert_session_index_entry(
            &codex_home,
            &thread_id,
            &workspace_path,
            None,
            "codex",
            None,
        )
        .await;
    }
    Ok(response)
}

pub(crate) async fn resume_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/resume", params)
        .await
}

pub(crate) async fn read_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    let mut response = session
        .send_request_for_workspace(&workspace_id, "thread/read", params)
        .await?;
    filter_thread_skill_messages(&mut response);
    if let Some(codex_home) = resolve_default_codex_home() {
        supplement_thread_file_path(&mut response, &codex_home, &thread_id).await;
        supplement_thread_history(&mut response, &codex_home, &thread_id).await;
        filter_thread_skill_messages(&mut response);
    }
    Ok(response)
}

pub(crate) async fn thread_live_subscribe_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<(), String> {
    if thread_id.trim().is_empty() {
        return Err("threadId is required".to_string());
    }
    let _ = get_session_clone(sessions, &workspace_id).await?;
    Ok(())
}

pub(crate) async fn thread_live_unsubscribe_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<(), String> {
    if thread_id.trim().is_empty() {
        return Err("threadId is required".to_string());
    }
    let _ = get_session_clone(sessions, &workspace_id).await?;
    Ok(())
}

pub(crate) async fn fork_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/fork", params)
        .await
}

pub(crate) async fn list_threads_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    sort_key: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    list_threads_from_session_index(&session, &workspace_id, cursor, limit, sort_key).await
}

pub(crate) async fn list_mcp_server_status_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "cursor": cursor, "limit": limit });
    session
        .send_request_for_workspace(&workspace_id, "mcpServerStatus/list", params)
        .await
}

pub(crate) async fn archive_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    let response = session
        .send_request_for_workspace(&workspace_id, "thread/archive", params)
        .await?;
    if let Some(codex_home) = resolve_default_codex_home() {
        remove_session_index_entry(&codex_home, &thread_id, Some("codex")).await?;
        delete_thread_session_file(&codex_home, &thread_id).await?;
    }
    Ok(response)
}

pub(crate) async fn compact_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/compact/start", params)
        .await
}

pub(crate) async fn set_thread_name_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    name: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id, "name": name });
    let response = session
        .send_request_for_workspace(&workspace_id, "thread/name/set", params)
        .await?;
    if let Some(codex_home) = resolve_default_codex_home() {
        let workspace_path = session
            .workspace_roots
            .lock()
            .await
            .get(&workspace_id)
            .cloned()
            .unwrap_or_default();
        if !workspace_path.trim().is_empty() {
            let _ = upsert_session_index_entry(
                &codex_home,
                &thread_id,
                &workspace_path,
                Some(&name),
                "codex",
                None,
            )
            .await;
        }
    }
    Ok(response)
}

fn build_turn_input_items(
    text: String,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
) -> Result<Vec<Value>, String> {
    let trimmed_text = text.trim();
    let mut input: Vec<Value> = Vec::new();
    if !trimmed_text.is_empty() {
        input.push(json!({ "type": "text", "text": trimmed_text }));
    }
    if let Some(paths) = images {
        let mut image_index = 1;
        for path in paths {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with("data:")
                || trimmed.starts_with("http://")
                || trimmed.starts_with("https://")
            {
                input.push(json!({ "type": "image", "url": trimmed }));
            } else if should_inline_image_path_for_codex(trimmed) {
                input.push(json!({ "type": "text", "text": format!("<image name=[Image #{image_index}] path=\"{}\">", trimmed.replace('"', "&quot;")) }));
                input.push(json!({
                    "type": "image",
                    "url": read_image_as_data_url_core(trimmed)?,
                }));
                input.push(json!({ "type": "text", "text": "</image>" }));
                image_index += 1;
            } else {
                input.push(json!({ "type": "text", "text": format!("<image name=[Image #{image_index}] path=\"{}\">", trimmed.replace('"', "&quot;")) }));
                input.push(json!({ "type": "localImage", "path": trimmed }));
                input.push(json!({ "type": "text", "text": "</image>" }));
                image_index += 1;
            }
        }
    }
    if let Some(mentions) = app_mentions {
        let mut seen_paths: HashSet<String> = HashSet::new();
        for mention in mentions {
            let object = mention
                .as_object()
                .ok_or_else(|| "invalid app mention payload".to_string())?;
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "invalid app mention name".to_string())?;
            let path = object
                .get("path")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "invalid app mention path".to_string())?;
            if !path.starts_with("app://") || path.len() <= "app://".len() {
                return Err("invalid app mention path".to_string());
            }
            if !seen_paths.insert(path.to_string()) {
                continue;
            }
            input.push(json!({ "type": "mention", "name": name, "path": path }));
        }
    }
    if input.is_empty() {
        return Err("empty user message".to_string());
    }
    Ok(input)
}

pub(crate) fn insert_optional_nullable_string(
    params: &mut Map<String, Value>,
    key: &str,
    value: Option<Option<String>>,
) {
    if let Some(value) = value {
        params.insert(key.to_string(), json!(value));
    }
}

pub(crate) async fn send_user_message_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    thread_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    service_tier: Option<Option<String>>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
    collaboration_mode: Option<Value>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let workspace_path = resolve_workspace_path_core(workspaces, &workspace_id).await?;
    let access_mode = access_mode.unwrap_or_else(|| "current".to_string());
    let sandbox_policy = match access_mode.as_str() {
        "full-access" => json!({ "type": "dangerFullAccess" }),
        "read-only" => json!({ "type": "readOnly" }),
        _ => json!({
            "type": "workspaceWrite",
            "writableRoots": [workspace_path.clone()],
            "networkAccess": true
        }),
    };

    let approval_policy = match access_mode.as_str() {
        "read-only" => "untrusted",
        "full-access" => "never",
        _ => "on-request",
    };

    let input = build_turn_input_items(text, images, app_mentions)?;

    let mut params = Map::new();
    params.insert("threadId".to_string(), json!(thread_id));
    params.insert("input".to_string(), json!(input));
    params.insert("cwd".to_string(), json!(workspace_path));
    params.insert("approvalPolicy".to_string(), json!(approval_policy));
    params.insert("sandboxPolicy".to_string(), json!(sandbox_policy));
    params.insert("model".to_string(), json!(model));
    params.insert("effort".to_string(), json!(effort));
    insert_optional_nullable_string(&mut params, "serviceTier", service_tier);
    if let Some(mode) = collaboration_mode {
        if !mode.is_null() {
            params.insert("collaborationMode".to_string(), mode);
        }
    }
    session
        .send_request_for_workspace(&workspace_id, "turn/start", Value::Object(params))
        .await
}

pub(crate) async fn turn_steer_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    turn_id: String,
    text: String,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
) -> Result<Value, String> {
    if turn_id.trim().is_empty() {
        return Err("missing active turn id".to_string());
    }
    let session = get_session_clone(sessions, &workspace_id).await?;
    let input = build_turn_input_items(text, images, app_mentions)?;
    let params = json!({
        "threadId": thread_id,
        "expectedTurnId": turn_id,
        "input": input
    });
    session
        .send_request_for_workspace(&workspace_id, "turn/steer", params)
        .await
}

pub(crate) async fn collaboration_mode_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session
        .send_request_for_workspace(&workspace_id, "collaborationMode/list", json!({}))
        .await
}

pub(crate) async fn turn_interrupt_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    turn_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id, "turnId": turn_id });
    session
        .send_request_for_workspace(&workspace_id, "turn/interrupt", params)
        .await
}

pub(crate) async fn start_review_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    target: Value,
    delivery: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let mut params = Map::new();
    params.insert("threadId".to_string(), json!(thread_id));
    params.insert("target".to_string(), target);
    if let Some(delivery) = delivery {
        params.insert("delivery".to_string(), json!(delivery));
    }
    session
        .send_request_for_workspace(&workspace_id, "review/start", Value::Object(params))
        .await
}

pub(crate) async fn model_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session
        .send_request_for_workspace(&workspace_id, "model/list", json!({}))
        .await
}

fn build_models_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}

fn build_provider_models_url(base_url: &str, provider: &str) -> String {
    format!("{}?provider={}", build_models_url(base_url), provider)
}

async fn fetch_model_list_url(
    client: &reqwest::Client,
    url: &str,
    label: &str,
    api_key: &str,
) -> Result<Value, String> {
    let response = client
        .get(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| format!("failed to fetch {label} model list: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("failed to read {label} model list response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "{label} model list request failed with status {status}: {body}"
        ));
    }
    serde_json::from_str(&body)
        .map_err(|error| format!("failed to parse {label} model list response as JSON: {error}"))
}

async fn fetch_provider_model_list(
    client: &reqwest::Client,
    base_url: &str,
    provider: &str,
    api_key: &str,
) -> Result<Value, String> {
    fetch_model_list_url(
        client,
        &build_provider_models_url(base_url, provider),
        provider,
        api_key,
    )
    .await
}

async fn fetch_legacy_model_list(
    client: &reqwest::Client,
    base_url: &str,
    label: &str,
    api_key: &str,
) -> Result<Value, String> {
    fetch_model_list_url(client, &build_models_url(base_url), label, api_key).await
}

async fn fetch_best_model_list_for_key(
    client: &reqwest::Client,
    base_url: &str,
    provider: &str,
    api_key: &str,
) -> Result<Value, String> {
    match fetch_legacy_model_list(client, base_url, &format!("{provider} legacy"), api_key).await {
        Ok(value) => Ok(value),
        Err(legacy_error) => {
            match fetch_provider_model_list(client, base_url, provider, api_key).await {
                Ok(value) => Ok(value),
                Err(provider_error) => Err(format!("{legacy_error} | {provider_error}")),
            }
        }
    }
}

fn extract_model_list_items(value: &Value) -> Vec<Value> {
    value
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn merge_model_list_values(values: Vec<Value>) -> Value {
    let mut seen = HashSet::new();
    let mut data = Vec::new();
    for value in values {
        for item in extract_model_list_items(&value) {
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_default();
            if id.is_empty() || !seen.insert(id) {
                continue;
            }
            data.push(item);
        }
    }
    json!({
        "data": data,
        "object": "list",
        "success": true,
    })
}

pub(crate) async fn model_list_from_openai_api_core(
    _app_settings: &Mutex<AppSettings>,
) -> Result<Option<Value>, String> {
    let base_url = crate::settings::DEFAULT_LADONX_API_BASE_URL.to_string();
    let openai_api_key = crate::settings::openai_api_key_from_env();
    let anthropic_api_key = crate::settings::anthropic_api_key_from_env();
    if openai_api_key.is_none() && anthropic_api_key.is_none() {
        return Ok(None);
    }

    let client = reqwest::Client::builder()
        .timeout(MODEL_LIST_TIMEOUT)
        .build()
        .map_err(|error| format!("failed to build model list client: {error}"))?;

    let mut results = Vec::new();
    let mut errors = Vec::new();

    if let Some(api_key) = openai_api_key {
        match fetch_best_model_list_for_key(&client, &base_url, "openai", &api_key).await {
            Ok(value) => results.push(value),
            Err(error) => errors.push(error),
        }
    }

    if let Some(api_key) = anthropic_api_key {
        match fetch_best_model_list_for_key(&client, &base_url, "anthropic", &api_key).await {
            Ok(value) => results.push(value),
            Err(error) => errors.push(error),
        }
    }

    if results.is_empty() {
        return Err(errors.join(" | "));
    }

    Ok(Some(merge_model_list_values(results)))
}

pub(crate) async fn experimental_feature_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "cursor": cursor, "limit": limit });
    session
        .send_request_for_workspace(&workspace_id, "experimentalFeature/list", params)
        .await
}

pub(crate) async fn account_rate_limits_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session
        .send_request_for_workspace(&workspace_id, "account/rateLimits/read", Value::Null)
        .await
}

pub(crate) async fn account_read_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = {
        let sessions = sessions.lock().await;
        sessions.get(&workspace_id).cloned()
    };
    let response = if let Some(session) = session {
        session
            .send_request_for_workspace(&workspace_id, "account/read", Value::Null)
            .await
            .ok()
    } else {
        None
    };

    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, &workspace_id).await?;
    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref())
        .or_else(resolve_default_codex_home);
    let fallback = read_auth_account(codex_home);

    Ok(build_account_response(response, fallback))
}

pub(crate) async fn codex_login_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    codex_login_cancels: &Mutex<HashMap<String, CodexLoginCancelState>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    {
        let mut cancels = codex_login_cancels.lock().await;
        if let Some(existing) = cancels.remove(&workspace_id) {
            match existing {
                CodexLoginCancelState::PendingStart(tx) => {
                    let _ = tx.send(());
                }
                CodexLoginCancelState::LoginId(_) => {}
            }
        }
        cancels.insert(
            workspace_id.clone(),
            CodexLoginCancelState::PendingStart(cancel_tx),
        );
    }

    let start = Instant::now();
    let mut cancel_rx = cancel_rx;
    let workspace_for_request = workspace_id.clone();
    let mut login_request: Pin<Box<_>> = Box::pin(session.send_request_for_workspace(
        &workspace_for_request,
        "account/login/start",
        json!({ "type": "chatgpt" }),
    ));

    let response = loop {
        match cancel_rx.try_recv() {
            Ok(_) => {
                let mut cancels = codex_login_cancels.lock().await;
                cancels.remove(&workspace_id);
                return Err("Codex login canceled.".to_string());
            }
            Err(TryRecvError::Closed) => {
                let mut cancels = codex_login_cancels.lock().await;
                cancels.remove(&workspace_id);
                return Err("Codex login canceled.".to_string());
            }
            Err(TryRecvError::Empty) => {}
        }

        let elapsed = start.elapsed();
        if elapsed >= LOGIN_START_TIMEOUT {
            let mut cancels = codex_login_cancels.lock().await;
            cancels.remove(&workspace_id);
            return Err("Codex login start timed out.".to_string());
        }

        let tick = Duration::from_millis(150);
        let remaining = LOGIN_START_TIMEOUT.saturating_sub(elapsed);
        let wait_for = remaining.min(tick);

        match timeout(wait_for, &mut login_request).await {
            Ok(result) => break result?,
            Err(_elapsed) => continue,
        }
    };

    let payload = response.get("result").unwrap_or(&response);
    let login_id = payload
        .get("loginId")
        .or_else(|| payload.get("login_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "missing login id in account/login/start response".to_string())?;
    let auth_url = payload
        .get("authUrl")
        .or_else(|| payload.get("auth_url"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "missing auth url in account/login/start response".to_string())?;

    {
        let mut cancels = codex_login_cancels.lock().await;
        cancels.insert(
            workspace_id,
            CodexLoginCancelState::LoginId(login_id.clone()),
        );
    }

    Ok(json!({
        "loginId": login_id,
        "authUrl": auth_url,
        "raw": response,
    }))
}

pub(crate) async fn codex_login_cancel_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    codex_login_cancels: &Mutex<HashMap<String, CodexLoginCancelState>>,
    workspace_id: String,
) -> Result<Value, String> {
    let cancel_state = {
        let mut cancels = codex_login_cancels.lock().await;
        cancels.remove(&workspace_id)
    };

    let Some(cancel_state) = cancel_state else {
        return Ok(json!({ "canceled": false }));
    };

    match cancel_state {
        CodexLoginCancelState::PendingStart(cancel_tx) => {
            let _ = cancel_tx.send(());
            return Ok(json!({
                "canceled": true,
                "status": "canceled",
            }));
        }
        CodexLoginCancelState::LoginId(login_id) => {
            let session = get_session_clone(sessions, &workspace_id).await?;
            let response = session
                .send_request_for_workspace(
                    &workspace_id,
                    "account/login/cancel",
                    json!({
                        "loginId": login_id,
                    }),
                )
                .await?;

            let payload = response.get("result").unwrap_or(&response);
            let status = payload
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let canceled = status.eq_ignore_ascii_case("canceled");

            Ok(json!({
                "canceled": canceled,
                "status": status,
                "raw": response,
            }))
        }
    }
}

pub(crate) async fn skills_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let workspace_path = resolve_workspace_path_core(workspaces, &workspace_id).await?;

    let source_paths = collect_skill_source_paths(Path::new(&workspace_path));

    let params = json!({ "cwd": workspace_path, "skillsPaths": source_paths });

    let mut response = session
        .send_request_for_workspace(&workspace_id, "skills/list", params)
        .await?;

    attach_skill_icons(&mut response, Path::new(&workspace_path));

    // Attach diagnostics for the UI (non-breaking: keep original response fields).
    if let Value::Object(ref mut obj) = response {
        obj.insert("sourcePaths".to_string(), json!(source_paths));
        obj.insert("sourceErrors".to_string(), json!([]));
    }

    Ok(response)
}

fn collect_skill_source_paths(workspace_path: &Path) -> Vec<String> {
    let mut source_paths: Vec<String> = vec![];
    let project_skills_dir = Path::new(&workspace_path).join(".agents").join("skills");
    push_skill_source_path(&mut source_paths, project_skills_dir);

    if let Some(codex_home) = resolve_default_codex_home() {
        push_skill_source_path(&mut source_paths, codex_home.join("skills"));

        if codex_home.file_name().and_then(|value| value.to_str()) != Some(".ladonx") {
            push_skill_source_path(&mut source_paths, codex_home.join("codex").join("skills"));
            if let Some(parent) = codex_home.parent() {
                push_skill_source_path(&mut source_paths, parent.join("codex").join("skills"));
            }
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    if let Some(cli_home) = crate::bundled_cli::bundled_cli_home() {
        push_skill_source_path(&mut source_paths, cli_home.join("skills"));
    }

    source_paths
}

fn push_skill_source_path(source_paths: &mut Vec<String>, path: PathBuf) {
    if !path.is_dir() {
        return;
    }
    let normalized = path.to_string_lossy().to_string();
    if source_paths.iter().any(|existing| existing == &normalized) {
        return;
    }
    source_paths.push(normalized);
}

fn attach_skill_icons(response: &mut Value, workspace_path: &Path) {
    attach_skill_metadata_in_container(response, workspace_path);
    if let Some(result) = response.get_mut("result") {
        attach_skill_metadata_in_container(result, workspace_path);
    }
}

fn attach_skill_metadata_in_container(container: &mut Value, workspace_path: &Path) {
    if let Some(skills) = container.get_mut("skills").and_then(Value::as_array_mut) {
        for skill in skills {
            attach_skill_description(skill, workspace_path);
            attach_skill_icon(skill, workspace_path);
        }
    }

    if let Some(data) = container.get_mut("data").and_then(Value::as_array_mut) {
        for bucket in data {
            if let Some(skills) = bucket.get_mut("skills").and_then(Value::as_array_mut) {
                for skill in skills {
                    attach_skill_description(skill, workspace_path);
                    attach_skill_icon(skill, workspace_path);
                }
            }
        }
    }
}

fn attach_skill_description(skill: &mut Value, workspace_path: &Path) {
    let Value::Object(skill_obj) = skill else {
        return;
    };

    let has_description = skill_obj
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    if has_description {
        return;
    }

    let raw_path = skill_obj
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(skill_dir) = skill_dir_from_path(raw_path, workspace_path) else {
        return;
    };
    let Some(description) = read_skill_description(&skill_dir) else {
        return;
    };

    skill_obj.insert("description".to_string(), Value::String(description));
}

fn attach_skill_icon(skill: &mut Value, workspace_path: &Path) {
    let Value::Object(skill_obj) = skill else {
        return;
    };
    if skill_obj.contains_key("iconDataUrl") {
        return;
    }

    let name = skill_obj
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let path = skill_obj
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(icon_data_url) = skill_icon_data_url(name, path, workspace_path) else {
        return;
    };

    skill_obj.insert("iconDataUrl".to_string(), Value::String(icon_data_url));
}

fn skill_icon_data_url(name: &str, raw_path: &str, workspace_path: &Path) -> Option<String> {
    let skill_dir = skill_dir_from_path(raw_path, workspace_path)?;
    let assets_dir = skill_dir.join("assets");
    if !assets_dir.is_dir() {
        return None;
    }

    let normalized_name = name.trim();
    let preferred = [format!("{normalized_name}.png"), "icon.png".to_string()];

    for file_name in preferred {
        let path = assets_dir.join(file_name);
        if path.is_file() {
            return image_file_data_url(&path);
        }
    }

    let mut candidates = std::fs::read_dir(&assets_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_skill_icon_asset(path))
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| {
        let a_name = a
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let b_name = b
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        a_name.cmp(b_name)
    });

    candidates
        .first()
        .and_then(|path| image_file_data_url(path))
}

fn skill_dir_from_path(raw_path: &str, workspace_path: &Path) -> Option<PathBuf> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = Path::new(trimmed);
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace_path.join(path)
    };

    if path.is_dir() {
        Some(path)
    } else {
        path.parent().map(Path::to_path_buf)
    }
}

fn is_skill_icon_asset(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("png")
    )
}

fn image_file_data_url(path: &Path) -> Option<String> {
    let mime_type = mime_guess::from_path(path).first_or_octet_stream();
    if !mime_type.type_().as_str().eq_ignore_ascii_case("image") {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let encoded = STANDARD.encode(bytes);
    Some(format!("data:{mime_type};base64,{encoded}"))
}

fn read_skill_description(skill_dir: &Path) -> Option<String> {
    let skill_md_path = skill_dir.join("SKILL.md");
    let content = std::fs::read_to_string(skill_md_path).ok()?;
    parse_skill_description(&content)
}

fn parse_skill_description(content: &str) -> Option<String> {
    let normalized = content.replace("\r\n", "\n");
    let trimmed = normalized.trim_start();

    if let Some(rest) = trimmed.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---\n") {
            let frontmatter = &rest[..end];
            for line in frontmatter.lines() {
                let line = line.trim();
                if let Some(value) = line.strip_prefix("description:") {
                    let description = value.trim().trim_matches('"').trim_matches('\'');
                    if !description.is_empty() {
                        return Some(description.to_string());
                    }
                }
            }
        }
    }

    let mut paragraph: Vec<&str> = Vec::new();
    let mut in_frontmatter = false;
    let mut frontmatter_closed = false;

    for raw_line in normalized.lines() {
        let line = raw_line.trim();
        if !frontmatter_closed && line == "---" {
            in_frontmatter = !in_frontmatter;
            if !in_frontmatter {
                frontmatter_closed = true;
            }
            continue;
        }
        if in_frontmatter || line.is_empty() {
            if !paragraph.is_empty() {
                break;
            }
            continue;
        }
        if line.starts_with('#') {
            if !paragraph.is_empty() {
                break;
            }
            continue;
        }
        paragraph.push(line);
    }

    if paragraph.is_empty() {
        return None;
    }

    Some(paragraph.join(" "))
}

pub(crate) async fn apps_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    thread_id: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "cursor": cursor, "limit": limit, "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "app/list", params)
        .await
}

pub(crate) async fn respond_to_server_request_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session.send_response(request_id, result).await
}

pub(crate) async fn remember_approval_rule_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    command: Vec<String>,
) -> Result<Value, String> {
    let command = command
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if command.is_empty() {
        return Err("empty command".to_string());
    }

    let codex_home = resolve_codex_home_for_workspace_core(workspaces, &workspace_id).await?;
    let rules_path = rules::default_rules_path(&codex_home);
    rules::append_prefix_rule(&rules_path, &command)?;

    Ok(json!({
        "ok": true,
        "rulesPath": rules_path,
    }))
}

pub(crate) async fn get_config_model_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let codex_home = resolve_codex_home_for_workspace_core(workspaces, &workspace_id).await?;
    let model = codex_config::read_config_model(Some(codex_home))?;
    Ok(json!({ "model": model }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn history_message_key_matches_wrapped_and_app_server_messages() {
        let wrapped_user = json!({
            "timestamp": "2026-06-13T14:10:18.198Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [{ "type": "input_text", "text": "介绍下毛泽东" }]
            }
        });
        let app_server_user = json!({
            "type": "userMessage",
            "id": "019ec151-b5b3-74f3-bc03-efced86cea2b",
            "content": [{ "type": "text", "text": "介绍下毛泽东" }]
        });
        let wrapped_assistant = json!({
            "timestamp": "2026-06-13T14:10:23.556Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "content": [{ "type": "output_text", "text": "毛泽东（1893年12月26日 - 1976年9月9日）" }]
            }
        });
        let app_server_assistant = json!({
            "type": "agentMessage",
            "id": "assistant-1",
            "text": "毛泽东（1893年12月26日 - 1976年9月9日）"
        });

        assert_eq!(
            history_message_key(&wrapped_user),
            history_message_key(&app_server_user)
        );
        assert_eq!(
            history_message_key(&wrapped_assistant),
            history_message_key(&app_server_assistant)
        );
    }

    #[test]
    fn collect_existing_thread_message_counts_preserves_repeated_text_counts() {
        let thread = json!({
            "turns": [
                {
                    "items": [
                        {
                            "type": "userMessage",
                            "id": "first",
                            "content": [{ "type": "text", "text": "same" }]
                        },
                        {
                            "type": "userMessage",
                            "id": "second",
                            "content": [{ "type": "text", "text": "same" }]
                        }
                    ]
                }
            ]
        });

        let counts = collect_existing_thread_message_counts(&thread);
        assert_eq!(counts.get("message:user:same"), Some(&2));
    }

    #[test]
    fn session_index_row_is_codex_treats_missing_source_as_codex_only() {
        assert!(session_index_row_is_codex(
            json!({ "id": "legacy-codex" }).as_object().expect("object")
        ));
        assert!(session_index_row_is_codex(
            json!({ "id": "codex", "source": "codex" })
                .as_object()
                .expect("object")
        ));
        assert!(!session_index_row_is_codex(
            json!({ "id": "claude", "source": "claude_code" })
                .as_object()
                .expect("object")
        ));
    }

    #[test]
    fn remove_session_index_entry_and_session_file_for_codex_thread() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let codex_home = std::env::temp_dir().join(format!("ladonx-codex-delete-test-{unique}"));
        let sessions_dir = codex_home.join("sessions");
        fs::create_dir_all(&sessions_dir).expect("create sessions");
        fs::write(
            codex_home.join("session_index.jsonl"),
            concat!(
                r#"{"id":"keep","source":"codex","cwd":"/tmp","updated_at":"2026-07-12T00:00:00Z"}"#,
                "\n",
                r#"{"id":"delete-me","source":"codex","cwd":"/tmp","updated_at":"2026-07-12T00:00:01Z"}"#,
                "\n",
                r#"{"id":"delete-me","source":"claude_code","workspace_path":"/tmp","updated_at":1783517303580}"#,
                "\n"
            ),
        )
        .expect("write index");
        let session_file = sessions_dir.join("delete-me.jsonl");
        fs::write(&session_file, "{}\n").expect("write session");

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime
            .block_on(remove_session_index_entry(
                &codex_home,
                "delete-me",
                Some("codex"),
            ))
            .expect("remove index");
        runtime
            .block_on(delete_thread_session_file(&codex_home, "delete-me"))
            .expect("delete session file");

        let index = fs::read_to_string(codex_home.join("session_index.jsonl")).expect("read index");
        assert!(index.contains(r#""id":"keep""#));
        assert!(index.contains(r#""source":"claude_code""#));
        assert!(
            !index.contains(r#""source":"codex","cwd":"/tmp","updated_at":"2026-07-12T00:00:01Z""#)
        );
        assert!(!session_file.exists());

        let _ = fs::remove_dir_all(codex_home);
    }

    #[test]
    fn strip_leading_history_skill_tokens_removes_skill_and_file_prefixes() {
        let text = "[$remotion-best-practices:remotion-best-practices](/Users/admin/.codex/skills/remotion-best-practices/SKILL.md) 给我生成一个 codex 介绍视频，音频用这个 @'/Users/admin/Desktop/Ladonx/downloads/demo.mp3'";
        assert_eq!(
            strip_leading_history_skill_tokens(text),
            "给我生成一个 codex 介绍视频，音频用这个 @'/Users/admin/Desktop/Ladonx/downloads/demo.mp3'"
        );
    }

    #[test]
    fn text_from_history_content_filters_leading_skill_tokens() {
        let content = json!([
            {
                "type": "input_text",
                "text": "[$skill:skill](/tmp/SKILL.md) 帮我处理这个问题"
            }
        ]);

        assert_eq!(
            text_from_history_content(&content),
            Some("帮我处理这个问题".to_string())
        );
    }

    #[test]
    fn text_from_history_content_discards_skill_template_messages() {
        let content = json!([
            {
                "type": "input_text",
                "text": "<skill>\n<name>remotion-best-practices</name>\n<path>/Users/admin/.codex/skills/remotion-best-practices/SKILL.md</path>\n</skill>\n帮我生成一个介绍视频"
            }
        ]);

        assert_eq!(text_from_history_content(&content), None);
    }

    #[test]
    fn filter_thread_skill_messages_removes_wrapped_user_skill_items() {
        let mut response = json!({
            "thread": {
                "turns": [
                    {
                        "items": [
                            {
                                "timestamp": "2026-06-16T11:01:32.595Z",
                                "type": "response_item",
                                "payload": {
                                    "type": "message",
                                    "role": "user",
                                    "content": [
                                        {
                                            "type": "input_text",
                                            "text": "<skill>\n<name>remotion-best-practices</name>\n<path>/Users/admin/.codex/skills/remotion-best-practices/SKILL.md</path>\n</skill>"
                                        }
                                    ]
                                }
                            },
                            {
                                "type": "agentMessage",
                                "text": "正常消息"
                            }
                        ]
                    }
                ]
            }
        });

        filter_thread_skill_messages(&mut response);

        let items = response["thread"]["turns"][0]["items"]
            .as_array()
            .expect("items should remain an array");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["type"], "agentMessage");
    }

    #[test]
    fn build_turn_input_items_wraps_local_images_with_path_text() {
        let input = build_turn_input_items(
            "describe it".to_string(),
            Some(vec![
                "/Users/admin/.ladonx/maine-coon-e74cd48e91ce.png".to_string()
            ]),
            None,
        )
        .expect("input should be built");

        assert_eq!(input[0], json!({ "type": "text", "text": "describe it" }));
        assert_eq!(
            input[1],
            json!({ "type": "text", "text": "<image name=[Image #1] path=\"/Users/admin/.ladonx/maine-coon-e74cd48e91ce.png\">" })
        );
        assert_eq!(
            input[2],
            json!({ "type": "localImage", "path": "/Users/admin/.ladonx/maine-coon-e74cd48e91ce.png" })
        );
        assert_eq!(input[3], json!({ "type": "text", "text": "</image>" }));
    }
}
