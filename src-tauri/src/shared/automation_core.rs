use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutomationItem {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) owner: String,
    pub(crate) path: String,
}

pub(crate) fn list_automations_core(
    cli_home: Option<PathBuf>,
) -> Result<Vec<AutomationItem>, String> {
    let Some(cli_home) = cli_home else {
        return Ok(Vec::new());
    };
    let automations_dir = cli_home.join("automations");
    if !automations_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&automations_dir)
        .map_err(|err| format!("Failed to read automations directory: {err}"))?;
    let owner = automation_owner();
    let mut items = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read automation entry: {err}"))?;
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.is_dir() {
            items.push(automation_from_dir(&path, &owner));
        } else if metadata.is_file() {
            items.push(automation_from_file(&path, &owner));
        }
    }

    items.sort_by(|left, right| {
        left.title
            .to_ascii_lowercase()
            .cmp(&right.title.to_ascii_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(items)
}

fn automation_from_dir(path: &Path, owner: &str) -> AutomationItem {
    let title = ["automation.json", "manifest.json", "config.json"]
        .iter()
        .map(|name| path.join(name))
        .find_map(|manifest_path| title_from_json_file(&manifest_path))
        .or_else(|| title_from_markdown_file(&path.join("README.md")))
        .unwrap_or_else(|| title_from_path(path));

    automation_item(path, title, owner)
}

fn automation_from_file(path: &Path, owner: &str) -> AutomationItem {
    let title = title_from_json_file(path)
        .or_else(|| title_from_markdown_file(path))
        .unwrap_or_else(|| title_from_path(path));
    automation_item(path, title, owner)
}

fn automation_item(path: &Path, title: String, owner: &str) -> AutomationItem {
    AutomationItem {
        id: path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("automation")
            .to_string(),
        title,
        owner: owner.to_string(),
        path: path.to_string_lossy().to_string(),
    }
}

fn title_from_json_file(path: &Path) -> Option<String> {
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<Value>(&content).ok()?;
    ["title", "name", "label", "description"]
        .iter()
        .find_map(|key| value.get(key).and_then(Value::as_str))
        .map(clean_title)
}

fn title_from_markdown_file(path: &Path) -> Option<String> {
    if path.extension().and_then(|value| value.to_str()) != Some("md") {
        return None;
    }
    fs::read_to_string(path)
        .ok()?
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(clean_title))
}

fn title_from_path(path: &Path) -> String {
    clean_title(
        path.file_stem()
            .and_then(|value| value.to_str())
            .or_else(|| path.file_name().and_then(|value| value.to_str()))
            .unwrap_or("Automation"),
    )
}

fn clean_title(value: &str) -> String {
    let title = value.trim().replace(['_', '-'], " ");
    if title.is_empty() {
        "Automation".to_string()
    } else {
        title
    }
}

fn automation_owner() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "local".to_string())
}
