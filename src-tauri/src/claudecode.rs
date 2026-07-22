use std::process::Stdio;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::time::Duration;

use crate::shared::process_core::tokio_command;
use crate::state::AppState;

const CLAUDE_CODE_EVENT: &str = "claude-code-event";
const LOCAL_COMMAND_CAVEAT_START: &str = "<local-command-caveat>";
const LOCAL_COMMAND_CAVEAT_END: &str = "</local-command-caveat>";
const COMMAND_NAME_TAG: &str = "<command-name>";
const COMMAND_MESSAGE_TAG: &str = "<command-message>";

fn strip_enclosed_block(value: &str, start_tag: &str, end_tag: &str) -> String {
    strip_enclosed_block_inner(value, start_tag, end_tag)
        .trim()
        .to_string()
}

fn strip_enclosed_block_preserve_whitespace(value: &str, start_tag: &str, end_tag: &str) -> String {
    strip_enclosed_block_inner(value, start_tag, end_tag)
}

fn strip_enclosed_block_inner(value: &str, start_tag: &str, end_tag: &str) -> String {
    let mut output = value.to_string();
    while let Some(start_index) = output.find(start_tag) {
        let search_start = start_index + start_tag.len();
        let Some(relative_end) = output[search_start..].find(end_tag) else {
            break;
        };
        let end_index = search_start + relative_end + end_tag.len();
        output.replace_range(start_index..end_index, "");
    }
    output
}

fn strip_local_command_caveat(value: &str) -> String {
    strip_enclosed_block(value, LOCAL_COMMAND_CAVEAT_START, LOCAL_COMMAND_CAVEAT_END)
}

fn strip_local_command_caveat_preserve_whitespace(value: &str) -> String {
    strip_enclosed_block_preserve_whitespace(
        value,
        LOCAL_COMMAND_CAVEAT_START,
        LOCAL_COMMAND_CAVEAT_END,
    )
}

fn contains_command_markup(value: &str) -> bool {
    value.contains(COMMAND_NAME_TAG) && value.contains(COMMAND_MESSAGE_TAG)
}

fn is_local_command_record(value: &Value) -> bool {
    if value.get("type").and_then(Value::as_str) != Some("user") {
        return false;
    }
    let Some(message) = value.get("message") else {
        return false;
    };
    let Some(content) = message.get("content") else {
        return false;
    };
    match content {
        Value::String(text) => contains_command_markup(text),
        Value::Array(items) => items.iter().any(|item| {
            item.as_str().is_some_and(contains_command_markup)
                || item
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(contains_command_markup)
                || item
                    .get("content")
                    .and_then(Value::as_str)
                    .is_some_and(contains_command_markup)
        }),
        _ => false,
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct ClaudeCodePromptResponse {
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
struct ClaudeCodeStreamEvent {
    #[serde(rename = "chatId")]
    chat_id: String,
    #[serde(rename = "workspaceId")]
    workspace_id: String,
    #[serde(rename = "event")]
    event: Value,
    #[serde(rename = "deltaText")]
    delta_text: Option<String>,
    #[serde(rename = "deltaThinking")]
    delta_thinking: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeCodeStoredChatMessage {
    id: String,
    role: String,
    text: String,
    raw_json: Option<Value>,
    events: Vec<Value>,
    result_event: Option<Value>,
    stderr: Option<String>,
    session_id: Option<String>,
    created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeCodeStoredChatSession {
    id: String,
    workspace_id: String,
    title: String,
    created_at: i64,
    updated_at: i64,
    session_id: Option<String>,
    file_path: String,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeCodeStoredChats {
    sessions_by_workspace: std::collections::HashMap<String, Vec<ClaudeCodeStoredChatSession>>,
    messages_by_session: std::collections::HashMap<String, Vec<ClaudeCodeStoredChatMessage>>,
    claude_session_id_by_chat: std::collections::HashMap<String, String>,
}

struct ParsedClaudeStoredChat {
    session: ClaudeCodeStoredChatSession,
    messages: Vec<ClaudeCodeStoredChatMessage>,
}

fn extract_content_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        let trimmed = strip_local_command_caveat(text);
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    if let Some(items) = content.as_array() {
        let parts: Vec<String> = items
            .iter()
            .filter_map(|item| {
                item.as_str()
                    .or_else(|| item.get("text").and_then(Value::as_str))
                    .or_else(|| item.get("content").and_then(Value::as_str))
                    .map(strip_local_command_caveat)
                    .filter(|text| !text.is_empty())
            })
            .collect();
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

fn extract_claude_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("result").and_then(Value::as_str) {
        let trimmed = strip_local_command_caveat(text);
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }

    if let Some(message) = value.get("message") {
        if let Some(text) = message.get("content").and_then(extract_content_text) {
            return Some(text);
        }
    }

    for key in ["result", "response", "text", "message", "content"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            let trimmed = strip_local_command_caveat(text);
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }

    if let Some(text) = value.get("content").and_then(extract_content_text) {
        return Some(text);
    }

    None
}

fn extract_stream_text_delta(value: &Value) -> Option<String> {
    let value = if value.get("type").and_then(Value::as_str) == Some("stream_event") {
        value.get("event")?
    } else {
        value
    };
    let event_type = value.get("type").and_then(Value::as_str)?;
    match event_type {
        "content_block_start" => {
            let content_block = value.get("content_block")?;
            if content_block.get("type").and_then(Value::as_str) == Some("text") {
                return content_block
                    .get("text")
                    .and_then(Value::as_str)
                    .map(strip_local_command_caveat_preserve_whitespace)
                    .filter(|text| !text.trim().is_empty());
            }
            None
        }
        "content_block_delta" => {
            let delta = value.get("delta")?;
            if delta.get("type").and_then(Value::as_str) == Some("text_delta") {
                return delta
                    .get("text")
                    .and_then(Value::as_str)
                    .map(strip_local_command_caveat_preserve_whitespace)
                    .filter(|text| !text.trim().is_empty());
            }
            None
        }
        _ => None,
    }
}

fn extract_stream_thinking_delta(value: &Value) -> Option<String> {
    let value = if value.get("type").and_then(Value::as_str) == Some("stream_event") {
        value.get("event")?
    } else {
        value
    };
    let event_type = value.get("type").and_then(Value::as_str)?;
    match event_type {
        "content_block_start" => {
            let content_block = value.get("content_block")?;
            if content_block.get("type").and_then(Value::as_str) == Some("thinking") {
                return content_block
                    .get("thinking")
                    .and_then(Value::as_str)
                    .filter(|text| !text.trim().is_empty())
                    .map(ToOwned::to_owned);
            }
            None
        }
        "content_block_delta" => {
            let delta = value.get("delta")?;
            if delta.get("type").and_then(Value::as_str) == Some("thinking_delta") {
                return delta
                    .get("thinking")
                    .and_then(Value::as_str)
                    .filter(|text| !text.trim().is_empty())
                    .map(ToOwned::to_owned);
            }
            None
        }
        _ => None,
    }
}

fn response_text(stdout: &str, json: Option<&Value>, events: &[Value]) -> String {
    for event in events.iter().rev() {
        if let Some(value) = extract_claude_text(event) {
            return value;
        }
    }
    if let Some(value) = json.and_then(extract_claude_text) {
        return value;
    }
    let trimmed = strip_local_command_caveat(stdout);
    if !trimmed.is_empty() {
        return trimmed;
    }
    String::new()
}

fn extract_session_id(events: &[Value]) -> Option<String> {
    events.iter().find_map(|event| {
        event
            .get("session_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

#[cfg(test)]
mod tests {
    use super::{
        claude_code_full_access_dirs, delete_matching_stored_chat_files, extract_stream_text_delta,
        extract_stream_thinking_delta,
    };
    use crate::types::{WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
    use serde_json::json;
    use std::collections::HashMap;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn extracts_text_delta_from_nested_stream_event() {
        let event = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": {
                    "type": "text_delta",
                    "text": "hello"
                }
            }
        });

        assert_eq!(extract_stream_text_delta(&event), Some("hello".to_string()));
        assert_eq!(extract_stream_thinking_delta(&event), None);
    }

    #[test]
    fn preserves_markdown_spacing_in_text_delta() {
        let event = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": {
                    "type": "text_delta",
                    "text": "# "
                }
            }
        });

        assert_eq!(extract_stream_text_delta(&event), Some("# ".to_string()));
        assert_eq!(extract_stream_thinking_delta(&event), None);
    }

    #[test]
    fn extracts_thinking_delta_from_nested_stream_event() {
        let event = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": {
                    "type": "thinking_delta",
                    "thinking": "working"
                }
            }
        });

        assert_eq!(extract_stream_text_delta(&event), None);
        assert_eq!(
            extract_stream_thinking_delta(&event),
            Some("working".to_string())
        );
    }

    #[test]
    fn full_access_dirs_include_workspace_and_root() {
        let workspace = if cfg!(windows) {
            std::path::Path::new(r"C:\Users\admin\Desktop\Ladonx")
        } else {
            std::path::Path::new("/Users/admin/Desktop/Ladonx")
        };
        let dirs = claude_code_full_access_dirs(workspace);

        assert_eq!(dirs.first().map(std::path::PathBuf::as_path), Some(workspace));
        assert!(dirs.len() >= 2);
        assert!(dirs.iter().any(|dir| dir.parent().is_none()));
    }

    #[test]
    fn delete_matching_stored_chat_files_respects_requested_workspace() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ladonx-claude-delete-test-{unique}"));
        let projects_dir = root.join("projects");
        let workspace_a = root.join("workspace-a");
        let workspace_b = root.join("workspace-b");
        fs::create_dir_all(&projects_dir).expect("create projects");
        fs::create_dir_all(&workspace_a).expect("create workspace a");
        fs::create_dir_all(&workspace_b).expect("create workspace b");

        let session_id = "shared-session";
        let file_a = projects_dir.join("a.jsonl");
        let file_b = projects_dir.join("b.jsonl");
        fs::write(
            &file_a,
            format!(
                r#"{{"type":"user","sessionId":"{session_id}","uuid":"a","cwd":"{}","timestamp":"2026-07-12T00:00:00Z","message":{{"content":"hello a"}}}}"#,
                workspace_a.display()
            ),
        )
        .expect("write a");
        fs::write(
            &file_b,
            format!(
                r#"{{"type":"user","sessionId":"{session_id}","uuid":"b","cwd":"{}","timestamp":"2026-07-12T00:00:00Z","message":{{"content":"hello b"}}}}"#,
                workspace_b.display()
            ),
        )
        .expect("write b");

        let mut workspaces = HashMap::new();
        workspaces.insert(
            "workspace-a".to_string(),
            WorkspaceEntry {
                id: "workspace-a".to_string(),
                name: "workspace-a".to_string(),
                path: workspace_a.to_string_lossy().to_string(),
                source: "claude_code".to_string(),
                kind: WorkspaceKind::Main,
                parent_id: None,
                worktree: None,
                settings: WorkspaceSettings::default(),
            },
        );
        workspaces.insert(
            "workspace-b".to_string(),
            WorkspaceEntry {
                id: "workspace-b".to_string(),
                name: "workspace-b".to_string(),
                path: workspace_b.to_string_lossy().to_string(),
                source: "claude_code".to_string(),
                kind: WorkspaceKind::Main,
                parent_id: None,
                worktree: None,
                settings: WorkspaceSettings::default(),
            },
        );

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let deleted = runtime
            .block_on(delete_matching_stored_chat_files(
                &projects_dir,
                &workspaces,
                session_id,
                Some("workspace-a"),
            ))
            .expect("delete");

        assert!(deleted);
        assert!(!file_a.exists());
        assert!(file_b.exists());

        let _ = fs::remove_dir_all(root);
    }
}

fn parse_timestamp_millis(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.timestamp_millis())
        .unwrap_or(0)
}

fn extract_user_text(value: &Value) -> Option<String> {
    let message = value.get("message")?;
    let content = message.get("content")?;
    if let Some(text) = content.as_str() {
        let trimmed = strip_local_command_caveat(text);
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    extract_content_text(content).map(|text| strip_local_command_caveat(&text))
}

fn extract_stderr_text(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(Value::as_str)
        .map(strip_local_command_caveat)
        .filter(|text| !text.is_empty())
        .map(|text| text.to_string())
}

fn has_message_content(value: &Value) -> bool {
    value
        .get("message")
        .and_then(|message| message.get("content"))
        .map(|content| match content {
            Value::Array(items) => !items.is_empty(),
            Value::String(text) => !text.trim().is_empty(),
            _ => false,
        })
        .unwrap_or(false)
}

fn extract_tool_result_id(value: &Value) -> Option<&str> {
    value
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                (item.get("type").and_then(Value::as_str) == Some("tool_result"))
                    .then(|| item.get("tool_use_id").and_then(Value::as_str))
                    .flatten()
            })
        })
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

fn encode_claude_project_key(path: &std::path::Path) -> String {
    path.to_string_lossy()
        .replace(['/', '\\', ':', '.'], "-")
        .trim_end_matches('-')
        .to_string()
}

fn workspace_id_for_project_path(
    projects_dir: &std::path::Path,
    project_file_path: &std::path::Path,
    workspaces: &std::collections::HashMap<String, crate::types::WorkspaceEntry>,
) -> Option<String> {
    let relative = project_file_path.strip_prefix(projects_dir).ok()?;
    let project_key = relative.components().next()?.as_os_str().to_string_lossy();

    workspaces
        .values()
        .filter_map(|entry| {
            let encoded = encode_claude_project_key(std::path::Path::new(&entry.path));
            project_key
                .starts_with(&encoded)
                .then_some((entry.id.clone(), encoded.len()))
        })
        .max_by_key(|(_, len)| *len)
        .map(|(id, _)| id)
}

fn workspace_id_for_cwd(
    cwd: &str,
    workspaces: &std::collections::HashMap<String, crate::types::WorkspaceEntry>,
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

fn parse_stored_chat_file(
    path: &std::path::Path,
    projects_dir: &std::path::Path,
    workspaces_snapshot: &std::collections::HashMap<String, crate::types::WorkspaceEntry>,
    content: &str,
) -> Option<ParsedClaudeStoredChat> {
    let mut session_id: Option<String> = None;
    let mut workspace_id: Option<String> = None;
    let mut title: Option<String> = None;
    let mut created_at = 0i64;
    let mut updated_at = 0i64;
    let mut messages: Vec<ClaudeCodeStoredChatMessage> = Vec::new();
    let mut pending_assistant: Option<ClaudeCodeStoredChatMessage> = None;

    let flush_pending_assistant =
        |messages: &mut Vec<ClaudeCodeStoredChatMessage>,
         pending: &mut Option<ClaudeCodeStoredChatMessage>| {
            if let Some(message) = pending.take() {
                messages.push(message);
            }
        };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        let Some(entry_type) = value.get("type").and_then(Value::as_str) else {
            continue;
        };
        match entry_type {
            "user" => {
                if is_local_command_record(&value) {
                    continue;
                }
                flush_pending_assistant(&mut messages, &mut pending_assistant);
                let tool_result_id = extract_tool_result_id(&value);
                if let Some(tool_result_id) = tool_result_id {
                    let timestamp = value
                        .get("timestamp")
                        .and_then(Value::as_str)
                        .map(parse_timestamp_millis)
                        .unwrap_or(0);
                    updated_at = timestamp.max(updated_at);
                    messages.push(ClaudeCodeStoredChatMessage {
                        id: tool_result_id.to_string(),
                        role: "tool".to_string(),
                        text: String::new(),
                        raw_json: Some(value.clone()),
                        events: vec![value.clone()],
                        result_event: None,
                        stderr: None,
                        session_id: value
                            .get("sessionId")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned),
                        created_at: timestamp,
                    });
                    continue;
                }
                let Some(text) = extract_user_text(&value) else {
                    continue;
                };
                let timestamp = value
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .map(parse_timestamp_millis)
                    .unwrap_or(0);
                let current_session_id = value
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                if session_id.is_none() {
                    session_id = current_session_id.clone();
                }
                if workspace_id.is_none() {
                    workspace_id = value
                        .get("cwd")
                        .and_then(Value::as_str)
                        .and_then(|cwd| workspace_id_for_cwd(cwd, workspaces_snapshot))
                        .or_else(|| {
                            workspace_id_for_project_path(projects_dir, path, workspaces_snapshot)
                        });
                }
                if title.is_none() {
                    title = Some(text.chars().take(80).collect());
                }
                if created_at == 0 {
                    created_at = timestamp;
                }
                updated_at = timestamp.max(updated_at);
                messages.push(ClaudeCodeStoredChatMessage {
                    id: value
                        .get("uuid")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    role: "user".to_string(),
                    text,
                    raw_json: Some(value.clone()),
                    events: vec![value.clone()],
                    result_event: None,
                    stderr: None,
                    session_id: current_session_id,
                    created_at: timestamp,
                });
            }
            "assistant" => {
                let Some(message) = value.get("message") else {
                    continue;
                };
                let text = extract_claude_text(message)
                    .or_else(|| extract_claude_text(&value))
                    .unwrap_or_default();
                if text.trim().is_empty() && !has_message_content(&value) {
                    continue;
                }
                let timestamp = value
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .map(parse_timestamp_millis)
                    .unwrap_or(0);
                let current_session_id = value
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                if session_id.is_none() {
                    session_id = current_session_id.clone();
                }
                if created_at == 0 {
                    created_at = timestamp;
                }
                updated_at = timestamp.max(updated_at);
                let assistant_id = value
                    .get("uuid")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let event = value.clone();
                let stderr = extract_stderr_text(&value);

                if let Some(existing) = pending_assistant.as_mut() {
                    if !existing.text.is_empty() && !text.is_empty() {
                        existing.text.push_str("\n\n");
                    }
                    existing.text.push_str(&text);
                    existing.events.push(event.clone());
                    existing.raw_json = Some(event.clone());
                    existing.result_event = Some(event.clone());
                    if existing.stderr.is_none() {
                        existing.stderr = stderr;
                    }
                    if existing.session_id.is_none() {
                        existing.session_id = current_session_id.clone();
                    }
                    if existing.created_at == 0 {
                        existing.created_at = timestamp;
                    }
                } else {
                    pending_assistant = Some(ClaudeCodeStoredChatMessage {
                        id: assistant_id,
                        role: "assistant".to_string(),
                        text,
                        raw_json: Some(event.clone()),
                        events: vec![event.clone()],
                        result_event: Some(event),
                        stderr,
                        session_id: current_session_id,
                        created_at: timestamp,
                    });
                }
            }
            _ => {}
        }
    }

    flush_pending_assistant(&mut messages, &mut pending_assistant);

    let session_id = session_id?;
    let workspace_id = workspace_id
        .or_else(|| workspace_id_for_project_path(projects_dir, path, workspaces_snapshot))?;
    if messages.is_empty() {
        return None;
    }

    Some(ParsedClaudeStoredChat {
        session: ClaudeCodeStoredChatSession {
            id: session_id.clone(),
            workspace_id,
            title: title.unwrap_or_else(|| "Claude Code".to_string()),
            created_at,
            updated_at,
            session_id: Some(session_id),
            file_path: path.to_string_lossy().to_string(),
        },
        messages,
    })
}

async fn delete_matching_stored_chat_files(
    projects_dir: &std::path::Path,
    workspaces_snapshot: &std::collections::HashMap<String, crate::types::WorkspaceEntry>,
    chat_id: &str,
    requested_workspace_id: Option<&str>,
) -> Result<bool, String> {
    let mut stack = vec![projects_dir.to_path_buf()];
    let mut deleted = false;

    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir)
            .await
            .map_err(|error| format!("Failed to read Claude projects directory: {error}"))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| format!("Failed to read Claude projects directory: {error}"))?
        {
            let path = entry.path();
            let file_type = entry
                .file_type()
                .await
                .map_err(|error| format!("Failed to inspect Claude project entry: {error}"))?;
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                continue;
            }

            let content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|error| format!("Failed to read Claude project log: {error}"))?;
            let Some(parsed) =
                parse_stored_chat_file(&path, projects_dir, workspaces_snapshot, &content)
            else {
                continue;
            };
            if parsed.session.id != chat_id {
                continue;
            }
            if requested_workspace_id
                .is_some_and(|workspace_id| parsed.session.workspace_id != workspace_id)
            {
                continue;
            }

            tokio::fs::remove_file(&path)
                .await
                .map_err(|error| format!("Failed to delete Claude project log: {error}"))?;
            crate::startup_log::write(format!(
                "claude_code_delete_stored_chat: chat_id={}, requested_workspace_id={}, matched_workspace_id={}, path={}",
                parsed.session.id,
                requested_workspace_id.unwrap_or(""),
                parsed.session.workspace_id,
                path.display()
            ));
            deleted = true;
        }
    }

    Ok(deleted)
}

async fn upsert_claude_session_index(
    claude_home: &std::path::Path,
    session: &ClaudeCodeStoredChatSession,
    workspaces: &std::collections::HashMap<String, crate::types::WorkspaceEntry>,
) {
    let Some(workspace) = workspaces.get(&session.workspace_id) else {
        return;
    };
    let _ = crate::shared::codex_core::upsert_session_index_entry(
        claude_home,
        &session.id,
        &workspace.path,
        Some(&session.title),
        "claude_code",
        Some(&session.file_path),
    )
    .await;
}

#[derive(Serialize)]
pub(crate) struct ClaudeCodePaths {
    pub home: Option<String>,
    pub bin: Option<String>,
}

#[tauri::command]
pub(crate) async fn claude_code_paths() -> Result<ClaudeCodePaths, String> {
    let home =
        crate::bundled_cli::bundled_claude_home().map(|path| path.to_string_lossy().to_string());
    let bin =
        crate::bundled_cli::bundled_claude_path().map(|path| path.to_string_lossy().to_string());
    Ok(ClaudeCodePaths { home, bin })
}

#[tauri::command]
pub(crate) async fn claude_code_list_stored_chats(
    state: State<'_, AppState>,
) -> Result<ClaudeCodeStoredChats, String> {
    let Some(claude_home) = crate::bundled_cli::bundled_claude_home() else {
        return Ok(ClaudeCodeStoredChats::default());
    };
    let projects_dir = claude_home.join("projects");
    if !projects_dir.exists() {
        return Ok(ClaudeCodeStoredChats::default());
    }

    let workspaces_snapshot = state
        .workspaces
        .lock()
        .await
        .iter()
        .filter(|(_, entry)| entry.source == "claude_code")
        .map(|(id, entry)| (id.clone(), entry.clone()))
        .collect();
    let mut result = ClaudeCodeStoredChats::default();
    let mut stack = vec![projects_dir.clone()];

    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir)
            .await
            .map_err(|error| format!("Failed to read Claude projects directory: {error}"))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| format!("Failed to read Claude projects directory: {error}"))?
        {
            let path = entry.path();
            let file_type = entry
                .file_type()
                .await
                .map_err(|error| format!("Failed to inspect Claude project entry: {error}"))?;
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                continue;
            }

            let content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|error| format!("Failed to read Claude project log: {error}"))?;
            let Some(parsed) =
                parse_stored_chat_file(&path, &projects_dir, &workspaces_snapshot, &content)
            else {
                continue;
            };
            let chat_id = parsed.session.id.clone();
            let workspace_id = parsed.session.workspace_id.clone();
            let session_id = parsed
                .session
                .session_id
                .clone()
                .unwrap_or_else(|| chat_id.clone());
            upsert_claude_session_index(&claude_home, &parsed.session, &workspaces_snapshot).await;
            result
                .claude_session_id_by_chat
                .insert(chat_id.clone(), session_id);
            result
                .sessions_by_workspace
                .entry(workspace_id.clone())
                .or_default()
                .push(parsed.session);
        }
    }

    for sessions in result.sessions_by_workspace.values_mut() {
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    }

    let session_counts: Vec<String> = result
        .sessions_by_workspace
        .iter()
        .map(|(workspace_id, sessions)| format!("{workspace_id}:{}", sessions.len()))
        .collect();
    crate::startup_log::write(format!(
        "claude_code_list_stored_chats: project_dirs={}, workspaces={}, imported_sessions={}, counts=[{}]",
        projects_dir.display(),
        workspaces_snapshot.len(),
        result
            .sessions_by_workspace
            .values()
            .map(|sessions| sessions.len())
            .sum::<usize>(),
        session_counts.join(", ")
    ));

    Ok(result)
}

#[tauri::command]
pub(crate) async fn claude_code_read_stored_chat(
    chat_id: String,
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ClaudeCodeStoredChatMessage>, String> {
    let Some(claude_home) = crate::bundled_cli::bundled_claude_home() else {
        return Ok(Vec::new());
    };
    let projects_dir = claude_home.join("projects");
    if !projects_dir.exists() {
        return Ok(Vec::new());
    }

    let workspaces_snapshot = state
        .workspaces
        .lock()
        .await
        .iter()
        .filter(|(_, entry)| entry.source == "claude_code")
        .map(|(id, entry)| (id.clone(), entry.clone()))
        .collect();
    let mut stack = vec![projects_dir.clone()];

    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir)
            .await
            .map_err(|error| format!("Failed to read Claude projects directory: {error}"))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| format!("Failed to read Claude projects directory: {error}"))?
        {
            let path = entry.path();
            let file_type = entry
                .file_type()
                .await
                .map_err(|error| format!("Failed to inspect Claude project entry: {error}"))?;
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                continue;
            }

            let content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|error| format!("Failed to read Claude project log: {error}"))?;
            let Some(parsed) =
                parse_stored_chat_file(&path, &projects_dir, &workspaces_snapshot, &content)
            else {
                continue;
            };
            if parsed.session.id != chat_id {
                continue;
            }
            if workspace_id
                .as_deref()
                .is_some_and(|id| parsed.session.workspace_id != id)
            {
                continue;
            }
            crate::startup_log::write(format!(
                "claude_code_read_stored_chat: chat_id={}, workspace_id={}, messages={}",
                parsed.session.id,
                parsed.session.workspace_id,
                parsed.messages.len()
            ));
            return Ok(parsed.messages);
        }
    }

    Ok(Vec::new())
}

#[tauri::command]
pub(crate) async fn claude_code_delete_stored_chat(
    chat_id: String,
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let Some(claude_home) = crate::bundled_cli::bundled_claude_home() else {
        return Ok(false);
    };
    let projects_dir = claude_home.join("projects");
    if !projects_dir.exists() {
        crate::shared::codex_core::remove_session_index_entry(
            &claude_home,
            &chat_id,
            Some("claude_code"),
        )
        .await?;
        return Ok(true);
    }

    let workspaces_snapshot = state
        .workspaces
        .lock()
        .await
        .iter()
        .filter(|(_, entry)| entry.source == "claude_code")
        .map(|(id, entry)| (id.clone(), entry.clone()))
        .collect();
    let project_deleted = delete_matching_stored_chat_files(
        &projects_dir,
        &workspaces_snapshot,
        &chat_id,
        workspace_id.as_deref(),
    )
    .await?;
    crate::shared::codex_core::remove_session_index_entry(
        &claude_home,
        &chat_id,
        Some("claude_code"),
    )
    .await?;

    Ok(project_deleted)
}

#[tauri::command]
pub(crate) async fn claude_code_set_stored_chat_title(
    chat_id: String,
    workspace_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let Some(claude_home) = crate::bundled_cli::bundled_claude_home() else {
        return Ok(());
    };
    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return Ok(());
    }
    let workspace_path = state
        .workspaces
        .lock()
        .await
        .get(&workspace_id)
        .filter(|entry| entry.source == "claude_code")
        .map(|entry| entry.path.clone())
        .unwrap_or_default();
    if workspace_path.trim().is_empty() {
        return Ok(());
    }
    crate::shared::codex_core::upsert_session_index_entry(
        &claude_home,
        &chat_id,
        &workspace_path,
        Some(trimmed_title),
        "claude_code",
        None,
    )
    .await
}

#[cfg(unix)]
fn is_pid_running(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as i32, 0) };
    if result == 0 {
        return true;
    }
    match std::io::Error::last_os_error().raw_os_error() {
        Some(code) => code != libc::ESRCH,
        None => false,
    }
}

#[cfg(unix)]
async fn kill_pid_gracefully(pid: u32) -> Result<(), String> {
    let term_result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
    if term_result != 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() != Some(libc::ESRCH) {
            return Err(format!("Failed to stop Claude Code process {pid}: {err}"));
        }
        return Ok(());
    }

    for _ in 0..12 {
        if !is_pid_running(pid) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let kill_result = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
    if kill_result != 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() != Some(libc::ESRCH) {
            return Err(format!(
                "Failed to force-stop Claude Code process {pid}: {err}"
            ));
        }
    }

    for _ in 0..8 {
        if !is_pid_running(pid) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    Err(format!("Claude Code process {pid} is still running."))
}

#[cfg(windows)]
async fn kill_pid_gracefully(pid: u32) -> Result<(), String> {
    let status = tokio_command("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|error| format!("Failed to stop Claude Code process {pid}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to stop Claude Code process {pid}."))
    }
}

fn emit_stream_event(
    app: &AppHandle,
    chat_id: &str,
    workspace_id: &str,
    event: &Value,
    delta_text: Option<String>,
    delta_thinking: Option<String>,
    session_id: Option<String>,
) {
    let _ = app.emit(
        CLAUDE_CODE_EVENT,
        ClaudeCodeStreamEvent {
            chat_id: chat_id.to_string(),
            workspace_id: workspace_id.to_string(),
            event: event.clone(),
            delta_text,
            delta_thinking,
            session_id,
        },
    );
}

fn claude_code_locale_for_language(language: &str) -> &'static str {
    if language.trim().eq_ignore_ascii_case("zh") {
        "zh_CN.UTF-8"
    } else {
        "en_US.UTF-8"
    }
}

fn claude_code_full_access_dirs(workspace_cwd: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    dirs.push(workspace_cwd.to_path_buf());
    if let Some(ancestor) = workspace_cwd.ancestors().last() {
        if !dirs.iter().any(|dir| dir == ancestor) {
            dirs.push(ancestor.to_path_buf());
        }
    }
    dirs
}

#[tauri::command]
pub(crate) async fn claude_code_prompt(
    chat_id: String,
    workspace_id: String,
    prompt: String,
    session_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ClaudeCodePromptResponse, String> {
    let trimmed_prompt = prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err("Prompt is required".to_string());
    }

    let workspace_cwd = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get(&workspace_id)
            .ok_or_else(|| "Unknown workspace".to_string())?;
        if entry.source != "claude_code" {
            return Err("Claude Code prompts require a Claude Code workspace".to_string());
        }
        std::path::PathBuf::from(&entry.path)
    };
    let app_language = {
        let app_settings = state.app_settings.lock().await;
        app_settings.language.clone()
    };
    let locale = claude_code_locale_for_language(&app_language);

    let claude_bin = crate::bundled_cli::ensure_bundled_claude()
        .unwrap_or_else(|| std::path::PathBuf::from("claude"));
    let mut command = tokio_command(claude_bin);
    let claude_home = crate::bundled_cli::bundled_claude_home();
    command
        .current_dir(&workspace_cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .arg("--print")
        .arg(trimmed_prompt)
        .arg("--verbose")
        .arg("--include-partial-messages")
        .arg("--output-format")
        .arg("stream-json");
    if let Some(session_id) = session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("--resume").arg(session_id);
    } else {
        command.arg("--session-id").arg(&chat_id);
    }
    if let Some(model) = model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("--model").arg(model);
    }
    let requested_permission_mode = permission_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default");
    if requested_permission_mode != "bypassPermissions" {
        crate::startup_log::write(format!(
            "claude_code_prompt: forcing bypassPermissions for non-interactive Claude Code run (requested={requested_permission_mode})"
        ));
    }
    command
        .arg("--allow-dangerously-skip-permissions")
        .arg("--permission-mode")
        .arg("bypassPermissions");
    if let Some(claude_home) = &claude_home {
        command.env(crate::settings::CLAUDE_HOME_ENV, &claude_home);
        command.env(crate::settings::CLAUDE_CONFIG_DIR_ENV, &claude_home);
    }
    if let Some(api_key) = crate::settings::anthropic_api_key_from_env() {
        command.env(crate::settings::ANTHROPIC_API_KEY_ENV, &api_key);
    }
    let anthropic_base_url = crate::settings::anthropic_base_url_from_env()
        .unwrap_or_else(|| crate::settings::ANTHROPIC_BASE_URL.to_string());
    command.env(crate::settings::ANTHROPIC_BASE_URL_ENV, anthropic_base_url);
    command.env("LANG", locale);
    command.env("LC_ALL", locale);
    command.env("LC_CTYPE", locale);
    for dir in claude_code_full_access_dirs(&workspace_cwd) {
        command.arg("--add-dir").arg(dir);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run Claude Code: {error}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "Failed to resolve Claude Code process id.".to_string())?;
    {
        let mut processes = state.claude_code_processes.lock().await;
        processes.insert(chat_id.clone(), pid);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture Claude Code stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture Claude Code stderr.".to_string())?;

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
            .map_err(|error| format!("Failed to read Claude Code output: {error}"))?
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
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned);
                }
                let delta_text = extract_stream_text_delta(&event);
                let delta_thinking = extract_stream_thinking_delta(&event);
                if let Some(delta) = delta_text.as_deref() {
                    streamed_text.push_str(delta);
                }
                emit_stream_event(
                    &app,
                    &stream_chat_id,
                    &stream_workspace_id,
                    &event,
                    delta_text,
                    delta_thinking,
                    latest_session_id.clone(),
                );
                events.push(event);
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|error| format!("Failed to wait for Claude Code: {error}"))?;
        let stderr = stderr_task
            .await
            .map_err(|error| format!("Failed to collect Claude Code stderr: {error}"))?
            .map_err(|error| format!("Failed to read Claude Code stderr: {error}"))?;
        let json = serde_json::from_str::<Value>(stdout_buffer.trim()).ok();
        let result_event = events
            .iter()
            .rev()
            .find(|event| event.get("type").and_then(Value::as_str) == Some("result"))
            .cloned();
        let session_id = latest_session_id.or_else(|| extract_session_id(&events));
        let text = if streamed_text.is_empty() {
            response_text(&stdout_buffer, json.as_ref(), &events)
        } else {
            streamed_text
        };

        if !status.success() {
            let message = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else if !stdout_buffer.trim().is_empty() {
                stdout_buffer.trim().to_string()
            } else {
                "Claude Code exited with a non-zero status.".to_string()
            };
            return Err(message);
        }

        Ok(ClaudeCodePromptResponse {
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

    // No automatic timeout: the turn runs until Claude Code finishes on its own
    // or the user manually stops it via `claude_code_stop`. The frontend thread
    // stays alive for as long as the backend process is running.
    let response_result = runtime.await;

    {
        let mut processes = state.claude_code_processes.lock().await;
        processes.remove(&chat_id);
    }

    let response = response_result?;
    if let (Some(claude_home), Some(session_id)) = (
        claude_home.as_ref(),
        response
            .session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    ) {
        let _ = crate::shared::codex_core::upsert_session_index_entry(
            claude_home,
            session_id,
            &workspace_cwd.to_string_lossy(),
            None,
            "claude_code",
            None,
        )
        .await;
    }

    Ok(response)
}

#[tauri::command]
pub(crate) async fn claude_code_stop(
    chat_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let pid = {
        let mut processes = state.claude_code_processes.lock().await;
        processes.remove(&chat_id)
    };

    let Some(pid) = pid else {
        return Ok(false);
    };

    kill_pid_gracefully(pid).await?;
    Ok(true)
}
