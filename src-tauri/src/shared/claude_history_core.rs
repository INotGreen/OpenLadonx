use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::types::WorkspaceEntry;

fn parse_timestamp_millis(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.timestamp_millis())
        .unwrap_or(0)
}

fn parse_timestamp_value(value: &Value) -> i64 {
    if let Some(timestamp) = value.as_i64() {
        return timestamp;
    }
    value
        .as_str()
        .map(|timestamp| {
            timestamp
                .parse::<i64>()
                .unwrap_or_else(|_| parse_timestamp_millis(timestamp))
        })
        .unwrap_or(0)
}

fn history_timestamp(row: &Value) -> i64 {
    row.get("timestamp")
        .or_else(|| row.get("updatedAt"))
        .or_else(|| row.get("updated_at"))
        .or_else(|| row.get("createdAt"))
        .or_else(|| row.get("created_at"))
        .map(parse_timestamp_value)
        .unwrap_or(0)
}

fn normalize_path_text(path: &str) -> &str {
    path.trim().trim_end_matches(['/', '\\'])
}

fn title_from_display(display: &str) -> Option<String> {
    let title = display.trim();
    (!title.is_empty()).then(|| title.chars().take(80).collect())
}

// Mirrors Claude Code's project directory encoding (claudecode.rs has the same
// logic); duplicated here so this shared core stays self-contained when
// compiled into the daemon binary (which does not include claudecode.rs).
fn encode_claude_project_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace(['/', '\\', ':', '.'], "-")
        .trim_end_matches('-')
        .to_string()
}

fn parse_session_index_threads(
    claude_projects_dir: &Path,
    workspace: &WorkspaceEntry,
    content: &str,
) -> Vec<Value> {
    let workspace_path = normalize_path_text(&workspace.path);
    let mut sessions: HashMap<String, Value> = HashMap::new();

    for line in content.lines() {
        let Ok(row) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if row.get("source").and_then(Value::as_str).map(str::trim) != Some("claude_code") {
            continue;
        }
        let matches_workspace = row
            .get("workspace_path")
            .or_else(|| row.get("cwd"))
            .and_then(Value::as_str)
            .map(normalize_path_text)
            .is_some_and(|path| path == workspace_path);
        if !matches_workspace {
            continue;
        }
        let Some(session_id) = row
            .get("id")
            .or_else(|| row.get("sessionId"))
            .or_else(|| row.get("session_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|session_id| !session_id.is_empty())
        else {
            continue;
        };
        let candidate_updated_at = history_timestamp(&row);
        let should_replace = sessions
            .get(session_id)
            .map(history_timestamp)
            .unwrap_or_default()
            <= candidate_updated_at;
        if should_replace {
            sessions.insert(session_id.to_string(), row);
        }
    }

    sessions.into_iter().map(|(session_id, row)| {
        let title = row
            .get("thread_name")
            .or_else(|| row.get("title"))
            .or_else(|| row.get("display"))
            .and_then(Value::as_str)
            .and_then(title_from_display)
            .unwrap_or_else(|| "Claude Code".to_string());
        // session_index rows for claude_code don't store the chat-log path, so
        // derive it deterministically: <claude_home>/projects/<encoded cwd>/<session>.jsonl
        let file_path_value = row
            .get("filePath")
            .or_else(|| row.get("path"))
            .cloned()
            .filter(|value| !value.is_null())
            .unwrap_or_else(|| {
                let encoded = encode_claude_project_key(Path::new(&workspace.path));
                json!(claude_projects_dir
                    .join(encoded)
                    .join(format!("{session_id}.jsonl"))
                    .to_string_lossy())
            });
        json!({
            "id": session_id,
            "title": title,
            "threadName": title,
            "cwd": row.get("cwd").or_else(|| row.get("workspace_path")).cloned().unwrap_or_else(|| json!(workspace.path)),
            "workspace_path": row.get("workspace_path").or_else(|| row.get("cwd")).cloned().unwrap_or_else(|| json!(workspace.path)),
            "created_at": row.get("created_at").or_else(|| row.get("createdAt")).cloned().unwrap_or(Value::Null),
            "updated_at": row.get("updated_at").or_else(|| row.get("updatedAt")).cloned().unwrap_or(Value::Null),
            "filePath": file_path_value.clone(),
            "path": file_path_value,
            "source": "claude_code"
        })
    }).collect()
}

pub(crate) async fn list_claude_history_threads_core(
    workspace: &WorkspaceEntry,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Ok(json!({ "result": { "data": [], "nextCursor": null } }));
    };
    let index_path = home.join(".ladonx").join("session_index.jsonl");
    if !index_path.is_file() {
        return Ok(json!({ "result": { "data": [], "nextCursor": null } }));
    }

    let content = tokio::fs::read_to_string(&index_path)
        .await
        .map_err(|error| format!("Failed to read session index: {error}"))?;
    let claude_projects_dir = home.join(".ladonx").join("projects");
    let mut rows = parse_session_index_threads(&claude_projects_dir, workspace, &content);

    rows.sort_by_key(|row| {
        std::cmp::Reverse(
            row.get("updated_at")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
        )
    });
    let offset = cursor
        .as_deref()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let page_size = limit.unwrap_or(100).max(1) as usize;
    let data = rows
        .iter()
        .skip(offset)
        .take(page_size)
        .cloned()
        .collect::<Vec<_>>();
    let next_cursor = (offset + data.len() < rows.len()).then(|| (offset + data.len()).to_string());
    Ok(json!({ "result": { "data": data, "nextCursor": next_cursor } }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{WorkspaceKind, WorkspaceSettings};

    #[test]
    fn parses_session_index_threads_and_ignores_other_projects() {
        let workspace = WorkspaceEntry {
            id: "claude-workspace".to_string(),
            name: ".ladonx".to_string(),
            path: "/Users/admin/.ladonx".to_string(),
            source: "claude_code".to_string(),
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        };
        let projects_dir = PathBuf::from("/Users/admin/.ladonx/projects");
        let content = r#"{"id":"session-1","source":"claude_code","thread_name":"hello","workspace_path":"/Users/admin/.ladonx","created_at":1783517303580,"updated_at":1783517303580}
{"id":"session-1","source":"claude_code","thread_name":"follow up","workspace_path":"/Users/admin/.ladonx","created_at":1783517303580,"updated_at":1783517304580}
{"id":"session-2","source":"claude_code","thread_name":"other","workspace_path":"/Users/admin/Desktop/Ladonx","created_at":1783517305580,"updated_at":1783517305580}"#;
        let rows = parse_session_index_threads(&projects_dir, &workspace, content);

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], "session-1");
        assert_eq!(rows[0]["threadName"], "follow up");
        assert_eq!(rows[0]["created_at"], 1783517303580i64);
        assert_eq!(rows[0]["updated_at"], 1783517304580i64);
        // cwd "/Users/admin/.ladonx" encodes to "-Users-admin--ladonx"
        let expected_path = projects_dir
            .join("-Users-admin--ladonx")
            .join("session-1.jsonl");
        assert_eq!(rows[0]["filePath"], expected_path.to_string_lossy().as_ref());
        assert_eq!(rows[0]["path"], expected_path.to_string_lossy().as_ref());
        assert_eq!(rows[0]["source"], "claude_code");
    }
}
