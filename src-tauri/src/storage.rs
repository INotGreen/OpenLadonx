use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use crate::types::{AppSettings, WorkspaceEntry, WorkspaceSettings};
use serde_json::{Map, Value};
use sha2::Digest;

fn normalize_windows_namespace_path(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }

    fn strip_prefix_ascii_case<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
        value
            .get(..prefix.len())
            .filter(|candidate| candidate.eq_ignore_ascii_case(prefix))
            .map(|_| &value[prefix.len()..])
    }

    fn starts_with_drive_path(value: &str) -> bool {
        let bytes = value.as_bytes();
        bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
    }

    if let Some(rest) = strip_prefix_ascii_case(path, r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = strip_prefix_ascii_case(path, "//?/UNC/") {
        return format!("//{rest}");
    }
    if let Some(rest) =
        strip_prefix_ascii_case(path, r"\\?\").filter(|rest| starts_with_drive_path(rest))
    {
        return rest.to_string();
    }
    if let Some(rest) =
        strip_prefix_ascii_case(path, "//?/").filter(|rest| starts_with_drive_path(rest))
    {
        return rest.to_string();
    }
    if let Some(rest) =
        strip_prefix_ascii_case(path, r"\\.\").filter(|rest| starts_with_drive_path(rest))
    {
        return rest.to_string();
    }
    if let Some(rest) =
        strip_prefix_ascii_case(path, "//./").filter(|rest| starts_with_drive_path(rest))
    {
        return rest.to_string();
    }

    path.to_string()
}

fn normalize_optional_windows_namespace_path(path: Option<String>) -> (Option<String>, bool) {
    match path {
        Some(path) => {
            let normalized = normalize_windows_namespace_path(&path);
            let changed = normalized != path;
            (Some(normalized), changed)
        }
        None => (None, false),
    }
}

fn normalize_workspace_settings(settings: WorkspaceSettings) -> (WorkspaceSettings, bool) {
    let (worktrees_folder, changed) =
        normalize_optional_windows_namespace_path(settings.worktrees_folder.clone());
    (
        WorkspaceSettings {
            worktrees_folder,
            ..settings
        },
        changed,
    )
}

fn normalize_workspace_entry(entry: WorkspaceEntry) -> (WorkspaceEntry, bool) {
    let normalized_path = normalize_windows_namespace_path(&entry.path);
    let (mut settings, settings_changed) = normalize_workspace_settings(entry.settings.clone());
    let source = match entry.settings.surface.as_deref() {
        Some("claude_code") => "claude_code".to_string(),
        _ if entry.source == "claude_code" => "claude_code".to_string(),
        _ => "codex".to_string(),
    };
    settings.surface = None;
    let changed = normalized_path != entry.path
        || settings_changed
        || source != entry.source
        || entry.settings.surface.is_some();
    (
        WorkspaceEntry {
            path: normalized_path,
            source,
            settings,
            ..entry
        },
        changed,
    )
}

fn normalize_workspace_entries<I>(entries: I) -> (Vec<WorkspaceEntry>, bool)
where
    I: IntoIterator<Item = WorkspaceEntry>,
{
    let mut changed = false;
    let normalized = entries
        .into_iter()
        .map(|entry| {
            let (entry, entry_changed) = normalize_workspace_entry(entry);
            changed |= entry_changed;
            entry
        })
        .collect();
    (normalized, changed)
}

fn legacy_workspaces_paths(path: &PathBuf) -> Vec<PathBuf> {
    let path = resolve_workspaces_storage_path(path);
    let mut paths = vec![path.with_file_name("workspaces.json")];
    if let Some(codex_home) = path.parent() {
        if let Some(ladonx_home) = codex_home.parent() {
            paths.push(ladonx_home.join("workspaces.json"));
        }
    }
    paths
}

fn resolve_workspaces_storage_path(path: &PathBuf) -> PathBuf {
    if path.is_dir() {
        return path.join("workspaces.json");
    }
    if path.file_name().and_then(|value| value.to_str()) == Some("config.toml") {
        return path.with_file_name("workspaces.json");
    }
    path.clone()
}

fn normalize_project_path(path: &str) -> String {
    normalize_windows_namespace_path(path.trim())
}

pub(crate) fn workspace_id_for_path(path: &str) -> String {
    let normalized = normalize_project_path(path);
    let digest = sha2::Sha256::digest(normalized.as_bytes());
    let bytes = digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!(
        "{}-{}-{}-{}-{}",
        &bytes[0..8],
        &bytes[8..12],
        &bytes[12..16],
        &bytes[16..20],
        &bytes[20..32]
    )
}

pub(crate) fn workspace_id_for_path_and_surface(path: &str, surface: &str) -> String {
    if surface == "codex" {
        return workspace_id_for_path(path);
    }
    workspace_id_for_path(&format!("{surface}\0{}", normalize_project_path(path)))
}

fn session_index_path() -> PathBuf {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return PathBuf::new();
    };
    home.join(".ladonx").join("session_index.jsonl")
}

fn legacy_history_index_path() -> PathBuf {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return PathBuf::new();
    };
    home.join(".ladonx").join("history.jsonl")
}

fn timestamp_millis_to_rfc3339(value: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(value)
        .map(|timestamp| timestamp.to_rfc3339())
        .unwrap_or_else(|| value.to_string())
}

fn session_index_source(row: &Value) -> String {
    row.get("source")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("codex")
        .to_string()
}

fn session_index_workspace_path(row: &Value) -> Option<String> {
    row.get("workspace_path")
        .or_else(|| row.get("cwd"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(normalize_project_path)
}

fn push_session_index_workspace(
    entries: &mut Vec<WorkspaceEntry>,
    source: String,
    path: String,
) -> bool {
    let exists = entries
        .iter()
        .any(|entry| normalize_project_path(&entry.path) == path && entry.source == source);
    if exists {
        return false;
    }
    let name = PathBuf::from(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Workspace")
        .to_string();
    entries.push(WorkspaceEntry {
        id: workspace_id_for_path_and_surface(&path, &source),
        name,
        path,
        source,
        kind: Default::default(),
        parent_id: None,
        worktree: None,
        settings: WorkspaceSettings::default(),
    });
    true
}

fn merge_history_workspaces_from_paths(
    entries: &mut Vec<WorkspaceEntry>,
    index_path: &PathBuf,
) -> bool {
    let Ok(content) = fs::read_to_string(index_path) else {
        return false;
    };
    let mut changed = false;
    for line in content.lines() {
        let Ok(row) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(path) = session_index_workspace_path(&row) else {
            continue;
        };
        changed |= push_session_index_workspace(entries, session_index_source(&row), path);
    }
    changed
}

fn merge_session_index_rows(rows: Vec<Map<String, Value>>) -> Vec<Map<String, Value>> {
    let mut merged = Vec::new();
    let mut index_by_key: HashMap<String, usize> = HashMap::new();
    for row in rows {
        let source = row
            .get("source")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("codex");
        let Some(id) = row
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            merged.push(row);
            continue;
        };
        let key = format!("{source}:{id}");
        if let Some(index) = index_by_key.get(&key).copied() {
            let existing_created_at = merged[index].get("created_at").cloned();
            for (key, value) in row {
                if key == "created_at" && existing_created_at.is_some() {
                    continue;
                }
                if !value.is_null() {
                    merged[index].insert(key, value);
                }
            }
        } else {
            index_by_key.insert(key, merged.len());
            merged.push(row);
        }
    }
    merged
}

fn migrate_legacy_history_index_to_session_index() -> Result<bool, String> {
    let history_path = legacy_history_index_path();
    let index_path = session_index_path();
    migrate_legacy_history_index_paths(&history_path, &index_path)
}

fn migrate_legacy_history_index_paths(
    history_path: &PathBuf,
    index_path: &PathBuf,
) -> Result<bool, String> {
    if !history_path.is_file() {
        return Ok(false);
    }
    let existing = match fs::read_to_string(&index_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Failed to read session index: {error}")),
    };
    let history = fs::read_to_string(&history_path)
        .map_err(|error| format!("Failed to read legacy Claude history: {error}"))?;
    let mut rows = existing
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|value| value.as_object().cloned())
        .collect::<Vec<_>>();
    let mut imported = 0usize;
    for line in history.lines() {
        let Ok(row) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(session_id) = row
            .get("sessionId")
            .or_else(|| row.get("session_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(workspace_path) = row
            .get("project")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(normalize_project_path)
        else {
            continue;
        };
        let title = row
            .get("display")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.chars().take(80).collect::<String>());
        let updated_at = row
            .get("timestamp")
            .and_then(Value::as_i64)
            .map(timestamp_millis_to_rfc3339)
            .unwrap_or_default();
        let mut migrated = Map::new();
        migrated.insert("id".to_string(), Value::String(session_id.to_string()));
        migrated.insert(
            "source".to_string(),
            Value::String("claude_code".to_string()),
        );
        migrated.insert("cwd".to_string(), Value::String(workspace_path.clone()));
        migrated.insert("workspace_path".to_string(), Value::String(workspace_path));
        if !updated_at.is_empty() {
            migrated.insert("created_at".to_string(), Value::String(updated_at.clone()));
            migrated.insert("updated_at".to_string(), Value::String(updated_at));
        }
        if let Some(title) = title {
            migrated.insert("thread_name".to_string(), Value::String(title.clone()));
            migrated.insert("title".to_string(), Value::String(title));
        }
        rows.push(migrated);
        imported += 1;
    }
    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut serialized = merge_session_index_rows(rows)
        .into_iter()
        .map(|row| serde_json::to_string(&Value::Object(row)).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?
        .join("\n");
    if !serialized.is_empty() {
        serialized.push('\n');
    }
    fs::write(&index_path, serialized)
        .map_err(|error| format!("Failed to write session index: {error}"))?;
    fs::remove_file(&history_path)
        .map_err(|error| format!("Failed to delete legacy Claude history: {error}"))?;
    Ok(imported > 0)
}

fn migrate_legacy_history_if_needed() {
    if let Err(error) = migrate_legacy_history_index_to_session_index() {
        eprintln!("failed to migrate legacy Claude history index: {error}");
    }
}

fn merge_history_workspaces(entries: &mut Vec<WorkspaceEntry>) -> bool {
    merge_history_workspaces_from_paths(entries, &session_index_path())
}

fn read_workspace_entries_from_json(path: &PathBuf) -> Result<Vec<WorkspaceEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if data.trim().is_empty() {
        return Ok(Vec::new());
    }
    let list: Vec<WorkspaceEntry> = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let (list, changed) = normalize_workspace_entries(list);
    if changed {
        let _ = write_workspace_entries_to_json(path, &list);
    }
    Ok(list)
}

fn write_workspace_entries_to_json(
    path: &PathBuf,
    entries: &[WorkspaceEntry],
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let (entries, _) = normalize_workspace_entries(entries.iter().cloned());
    let data = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

fn normalize_app_settings(settings: AppSettings) -> (AppSettings, bool) {
    let (global_worktrees_folder, changed) =
        normalize_optional_windows_namespace_path(settings.global_worktrees_folder.clone());
    let codex_api_key = settings
        .codex_api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let api_key_changed = codex_api_key != settings.codex_api_key;
    (
        AppSettings {
            codex_api_key,
            global_worktrees_folder,
            ..settings
        },
        changed || api_key_changed,
    )
}

pub(crate) fn apply_codex_api_key_env() {
    let api_key = crate::settings::read_openai_api_key_from_auth_json();
    crate::settings::apply_openai_api_key_env(api_key.as_deref());
}

fn try_rewrite_settings_with_normalized_paths(path: &PathBuf, settings: &AppSettings) {
    if let Err(error) = write_settings(path, settings) {
        eprintln!(
            "read_settings: failed to persist normalized settings paths to {}: {}",
            path.display(),
            error
        );
    }
}

pub(crate) fn read_workspaces(path: &PathBuf) -> Result<HashMap<String, WorkspaceEntry>, String> {
    let path = resolve_workspaces_storage_path(path);
    if path.exists() {
        let list = read_workspace_entries_from_json(&path)?;
        return Ok(list
            .into_iter()
            .map(|entry| (entry.id.clone(), entry))
            .collect::<HashMap<_, _>>());
    }
    for legacy_path in legacy_workspaces_paths(&path) {
        if legacy_path == path || !legacy_path.exists() {
            continue;
        }
        let list = read_workspace_entries_from_json(&legacy_path)?;
        if list.is_empty() {
            continue;
        }
        write_workspace_entries_to_json(&path, &list)?;
        return Ok(list
            .into_iter()
            .map(|entry| (entry.id.clone(), entry))
            .collect::<HashMap<_, _>>());
    }
    Ok(HashMap::new())
}

pub(crate) fn read_workspaces_with_history(
    path: &PathBuf,
) -> Result<HashMap<String, WorkspaceEntry>, String> {
    migrate_legacy_history_if_needed();
    let storage_path = resolve_workspaces_storage_path(path);
    let is_initial_import = !storage_path.exists();
    let mut entries = read_workspaces(&storage_path)?
        .into_values()
        .collect::<Vec<_>>();
    if is_initial_import && merge_history_workspaces(&mut entries) {
        write_workspace_entries_to_json(&storage_path, &entries)?;
    }
    Ok(entries
        .into_iter()
        .map(|entry| (entry.id.clone(), entry))
        .collect())
}

pub(crate) fn write_workspaces(path: &PathBuf, entries: &[WorkspaceEntry]) -> Result<(), String> {
    let path = resolve_workspaces_storage_path(path);
    write_workspace_entries_to_json(&path, entries)
}

pub(crate) fn read_settings(path: &PathBuf) -> Result<AppSettings, String> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut value: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    migrate_follow_up_message_behavior(&mut value);
    match serde_json::from_value(value.clone()) {
        Ok(settings) => Ok(finalize_loaded_settings(path, settings)),
        Err(_) => {
            sanitize_remote_settings_for_tcp_only(&mut value);
            migrate_follow_up_message_behavior(&mut value);
            serde_json::from_value(value)
                .map(|settings| finalize_loaded_settings(path, settings))
                .map_err(|e| e.to_string())
        }
    }
}

pub(crate) fn write_settings(path: &PathBuf, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let (settings, _) = normalize_app_settings(settings.clone());
    apply_codex_api_key_env();
    let data = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

fn finalize_loaded_settings(path: &PathBuf, settings: AppSettings) -> AppSettings {
    let (settings, changed) = normalize_app_settings(settings);
    if changed {
        try_rewrite_settings_with_normalized_paths(path, &settings);
    }
    apply_codex_api_key_env();
    settings
}

fn sanitize_remote_settings_for_tcp_only(value: &mut Value) {
    let Value::Object(root) = value else {
        return;
    };
    root.insert(
        "remoteBackendProvider".to_string(),
        Value::String("tcp".to_string()),
    );
    if let Some(Value::Array(remote_backends)) = root.get_mut("remoteBackends") {
        for entry in remote_backends {
            let Value::Object(entry_obj) = entry else {
                continue;
            };
            entry_obj.insert("provider".to_string(), Value::String("tcp".to_string()));
            entry_obj.retain(|key, _| {
                matches!(
                    key.as_str(),
                    "id" | "name" | "provider" | "host" | "token" | "lastConnectedAtMs"
                )
            });
        }
    }
    root.retain(|key, _| !key.to_ascii_lowercase().starts_with("orb"));
}

fn migrate_follow_up_message_behavior(value: &mut Value) {
    let Value::Object(root) = value else {
        return;
    };
    if root.contains_key("followUpMessageBehavior") {
        return;
    }
    let steer_enabled = root
        .get("steerEnabled")
        .or_else(|| root.get("experimentalSteerEnabled"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    root.insert(
        "followUpMessageBehavior".to_string(),
        Value::String(if steer_enabled { "steer" } else { "queue" }.to_string()),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{name}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn test_workspace(path: &str) -> WorkspaceEntry {
        WorkspaceEntry {
            id: workspace_id_for_path(path),
            name: "video".to_string(),
            path: path.to_string(),
            source: "codex".to_string(),
            kind: crate::types::WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    #[test]
    fn write_workspaces_uses_json_and_leaves_config_toml_untouched() {
        let dir = unique_temp_dir("ladonx-storage-config");
        let config_path = dir.join("config.toml");
        let config = r#"model_provider = "custom"
base_url = "https://old.example/v1"

[model_providers.custom]
base_url = "https://old.example/v1"
wire_api = "responses"

[features]
multi_agent = true
"#;
        fs::write(&config_path, config).expect("write config");

        let entry = test_workspace("/Users/apple/Desktop/video");
        write_workspaces(&config_path, &[entry.clone()]).expect("write workspaces");

        assert_eq!(
            fs::read_to_string(&config_path).expect("read config"),
            config
        );
        let workspaces_path = dir.join("workspaces.json");
        let list: Vec<WorkspaceEntry> =
            serde_json::from_str(&fs::read_to_string(&workspaces_path).expect("read workspaces"))
                .expect("parse workspaces");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, "/Users/apple/Desktop/video");

        let loaded = read_workspaces(&config_path).expect("read workspaces");
        assert!(loaded.contains_key(&entry.id));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_workspaces_ignores_projects_in_config_toml() {
        let dir = unique_temp_dir("ladonx-storage-config-projects");
        let config_path = dir.join("config.toml");
        fs::write(
            &config_path,
            r#"[projects]

[projects."/Users/apple/Desktop/video"]
trust_level = "trusted"
"#,
        )
        .expect("write config");

        let loaded = read_workspaces(&config_path).expect("read workspaces");
        assert!(loaded.is_empty());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn history_indexes_create_distinct_codex_and_claude_workspaces() {
        let dir = unique_temp_dir("ladonx-storage-history");
        let session_index = dir.join("session_index.jsonl");
        let project = "/Users/apple/Desktop/video";
        fs::write(
            &session_index,
            format!(
                concat!(
                    r#"{{"id":"codex-1","source":"codex","workspace_path":"{}"}}"#,
                    "\n",
                    r#"{{"id":"claude-1","source":"claude_code","workspace_path":"{}"}}"#,
                    "\n"
                ),
                project, project
            ),
        )
        .expect("write session index");

        let mut entries = Vec::new();
        assert!(merge_history_workspaces_from_paths(
            &mut entries,
            &session_index
        ));
        assert_eq!(entries.len(), 2);
        assert_ne!(entries[0].id, entries[1].id);
        assert!(entries.iter().any(|entry| entry.source == "codex"));
        assert!(entries.iter().any(|entry| entry.source == "claude_code"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn migrates_legacy_claude_history_into_session_index_and_deletes_history() {
        let dir = unique_temp_dir("ladonx-storage-history-migration");
        let session_index = dir.join("session_index.jsonl");
        let history = dir.join("history.jsonl");
        fs::write(
            &session_index,
            r#"{"id":"codex-1","source":"codex","workspace_path":"/tmp/codex"}"#,
        )
        .expect("write existing session index");
        fs::write(
            &history,
            r#"{"display":"hello","timestamp":1783517303580,"project":"/tmp/claude","sessionId":"claude-1"}"#,
        )
        .expect("write legacy history");

        assert!(
            migrate_legacy_history_index_paths(&history, &session_index).expect("migrate history")
        );
        let migrated = fs::read_to_string(&session_index).expect("read migrated index");

        assert!(!history.exists());
        assert!(migrated.contains(r#""id":"codex-1""#));
        assert!(migrated.contains(r#""id":"claude-1""#));
        assert!(migrated.contains(r#""source":"claude_code""#));
        assert!(migrated.contains(r#""workspace_path":"/tmp/claude""#));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn existing_workspaces_file_is_not_repopulated_from_history() {
        let dir = unique_temp_dir("ladonx-storage-existing-history");
        let workspaces_path = dir.join("workspaces.json");
        fs::write(&workspaces_path, "[]").expect("write empty workspaces");

        let loaded = read_workspaces_with_history(&workspaces_path).expect("read workspaces");

        assert!(loaded.is_empty());
        assert_eq!(
            fs::read_to_string(&workspaces_path).expect("read workspaces json"),
            "[]"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_surface_is_migrated_to_top_level_source() {
        let dir = unique_temp_dir("ladonx-storage-source-migration");
        let workspaces_path = dir.join("workspaces.json");
        fs::write(
            &workspaces_path,
            r#"[{"id":"claude-1","name":"video","path":"/tmp/video","settings":{"sidebarCollapsed":false,"surface":"claude_code"}}]"#,
        )
        .expect("write legacy workspaces");

        let loaded = read_workspaces(&workspaces_path).expect("read migrated workspaces");
        let workspace = loaded.get("claude-1").expect("claude workspace");
        assert_eq!(workspace.source, "claude_code");
        assert!(workspace.settings.surface.is_none());

        let persisted: Value = serde_json::from_str(
            &fs::read_to_string(&workspaces_path).expect("read migrated json"),
        )
        .expect("parse migrated json");
        assert_eq!(persisted[0]["source"], "claude_code");
        assert!(persisted[0]["settings"]["surface"].is_null());

        let _ = fs::remove_dir_all(dir);
    }
}
