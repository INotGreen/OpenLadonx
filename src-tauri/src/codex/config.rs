use std::path::PathBuf;

use crate::shared::config_toml_core;

pub(crate) fn read_steer_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("steer")
}

pub(crate) fn read_collaboration_modes_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("collaboration_modes")
}

pub(crate) fn read_unified_exec_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("unified_exec")
}

pub(crate) fn read_apps_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("apps")
}

pub(crate) fn read_personality() -> Result<Option<String>, String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(None);
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    Ok(read_personality_from_document(&document))
}

pub(crate) fn read_base_url() -> Result<Option<String>, String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(None);
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    Ok(config_toml_core::read_top_level_string(
        &document, "base_url",
    ))
}

pub(crate) fn write_base_url(base_url: Option<&str>) -> Result<(), String> {
    write_base_url_with_wire_api(base_url, None)
}

pub(crate) fn write_base_url_with_wire_api(
    base_url: Option<&str>,
    wire_api: Option<&str>,
) -> Result<(), String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(());
    };
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;

    // Set top-level base_url
    config_toml_core::set_top_level_string(&mut document, "base_url", base_url);

    // Also set [model_providers.custom.base_url]
    if let Some(url) = base_url {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            // Ensure model_providers table exists
            let model_providers = config_toml_core::ensure_table(&mut document, "model_providers")?;
            // Ensure custom table exists within model_providers
            if model_providers.get("custom").is_none() {
                model_providers["custom"] = toml_edit::Item::Table(toml_edit::Table::new());
            }
            let custom = model_providers["custom"]
                .as_table_mut()
                .ok_or_else(|| "custom must be a table".to_string())?;
            custom["base_url"] = toml_edit::value(trimmed);
            if let Some(wire_api) = normalize_wire_api(wire_api)? {
                custom["wire_api"] = toml_edit::value(wire_api);
            }
        }
    } else {
        // Remove base_url from custom if it exists
        if let Some(model_providers) = document
            .get_mut("model_providers")
            .and_then(toml_edit::Item::as_table_mut)
        {
            if let Some(custom) = model_providers
                .get_mut("custom")
                .and_then(toml_edit::Item::as_table_mut)
            {
                let _ = custom.remove("base_url");
            }
        }
    }

    config_toml_core::persist_global_config_document(&root, &document)
}

fn normalize_wire_api(value: Option<&str>) -> Result<Option<&'static str>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    match value.to_ascii_lowercase().as_str() {
        "response" | "responses" => Ok(Some("responses")),
        other => Err(format!("Unsupported Codex wire_api `{other}`")),
    }
}

pub(crate) fn clear_base_url_values() -> Result<(), String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(());
    };
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;

    document["base_url"] = toml_edit::value("");
    let model_providers = config_toml_core::ensure_table(&mut document, "model_providers")?;
    if model_providers.get("custom").is_none() {
        model_providers["custom"] = toml_edit::Item::Table(toml_edit::Table::new());
    }
    let custom = model_providers["custom"]
        .as_table_mut()
        .ok_or_else(|| "custom must be a table".to_string())?;
    custom["base_url"] = toml_edit::value("");

    config_toml_core::persist_global_config_document(&root, &document)
}

pub(crate) fn write_steer_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("steer", enabled)
}

pub(crate) fn write_collaboration_modes_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("collaboration_modes", enabled)
}

pub(crate) fn write_unified_exec_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("unified_exec", enabled)
}

pub(crate) fn write_apps_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("apps", enabled)
}

pub(crate) fn write_feature_enabled(feature_key: &str, enabled: bool) -> Result<(), String> {
    let key = feature_key.trim();
    if key.is_empty() {
        return Err("feature key is empty".to_string());
    }
    if key.eq_ignore_ascii_case("collab") {
        return Err("feature key `collab` is no longer supported; use `multi_agent`".to_string());
    }
    write_feature_flag(key, enabled)
}

pub(crate) fn write_personality(personality: &str) -> Result<(), String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(());
    };
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    let normalized = normalize_personality_value(personality);
    config_toml_core::set_top_level_string(&mut document, "personality", normalized);
    config_toml_core::persist_global_config_document(&root, &document)
}

fn read_feature_flag(key: &str) -> Result<Option<bool>, String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(None);
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    Ok(config_toml_core::read_feature_flag(&document, key))
}

fn write_feature_flag(key: &str, enabled: bool) -> Result<(), String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(());
    };
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    config_toml_core::set_feature_flag(&mut document, key, enabled)?;
    config_toml_core::persist_global_config_document(&root, &document)
}

pub(crate) fn config_toml_path() -> Option<PathBuf> {
    resolve_default_codex_home().map(|home| home.join("config.toml"))
}

pub(crate) fn read_config_model(codex_home: Option<PathBuf>) -> Result<Option<String>, String> {
    let root = codex_home.or_else(resolve_default_codex_home);
    let Some(root) = root else {
        return Err("Unable to resolve CODEX_HOME".to_string());
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    Ok(config_toml_core::read_top_level_string(&document, "model"))
}

fn resolve_default_codex_home() -> Option<PathBuf> {
    crate::codex::home::resolve_default_codex_home()
}

fn read_personality_from_document(document: &toml_edit::Document) -> Option<String> {
    config_toml_core::read_top_level_string(document, "personality")
        .as_deref()
        .and_then(normalize_personality_value)
        .map(|value| value.to_string())
}

fn normalize_personality_value(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "friendly" => Some("friendly"),
        "pragmatic" => Some("pragmatic"),
        _ => None,
    }
}
