use std::fs;
use std::path::{Path, PathBuf};

use crate::shared::config_toml_core;
use crate::shared::plugins_marketplace_core::{
    cache_plugin_source_path, copy_plugin_dir, detect_plugin_version, plugin_cache_dir, plugin_key,
    remove_plugin_dir,
};

pub(crate) async fn install_plugin_core(plugin_name: &str) -> Result<(), String> {
    let Some(codex_home) = crate::settings::resolve_effective_codex_home() else {
        return Err("Unable to resolve CODEX_HOME".to_string());
    };
    let marketplace = find_marketplace_for_plugin(&codex_home, plugin_name)?;
    let source_dir = cache_plugin_source_path(&codex_home, plugin_name);
    if !source_dir.exists() {
        return Err(format!(
            "Plugin source directory not found: {}",
            source_dir.display()
        ));
    }
    let cache_root = codex_home.join("plugins").join("cache");
    let target_dir = install_target_dir(&cache_root, &marketplace, plugin_name, &source_dir);
    copy_plugin_dir(&source_dir, &target_dir)?;
    let (_, mut document) = config_toml_core::load_global_config_document(&codex_home)?;
    config_toml_core::set_plugin_enabled(
        &mut document,
        &plugin_key(&marketplace, plugin_name),
        true,
    )?;
    config_toml_core::persist_global_config_document(&codex_home, &document)?;
    Ok(())
}

pub(crate) async fn uninstall_plugin_core(plugin_name: &str) -> Result<(), String> {
    let Some(codex_home) = crate::settings::resolve_effective_codex_home() else {
        return Err("Unable to resolve CODEX_HOME".to_string());
    };
    let marketplace = find_marketplace_for_plugin(&codex_home, plugin_name)?;
    let cache_root = codex_home.join("plugins").join("cache");
    let target_dir = find_installed_plugin_dir(&cache_root, &marketplace, plugin_name)
        .ok_or_else(|| format!("Installed plugin not found: {plugin_name}"))?;
    remove_plugin_dir(&target_dir)?;
    let (_, mut document) = config_toml_core::load_global_config_document(&codex_home)?;
    config_toml_core::set_plugin_enabled(
        &mut document,
        &plugin_key(&marketplace, plugin_name),
        false,
    )?;
    config_toml_core::persist_global_config_document(&codex_home, &document)?;
    Ok(())
}

fn find_marketplace_for_plugin(codex_home: &Path, plugin_name: &str) -> Result<String, String> {
    let marketplace_root = codex_home.join(".tmp").join("plugins");
    let marketplace_json = marketplace_root
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    let raw = fs::read_to_string(&marketplace_json)
        .map_err(|err| format!("Failed to read marketplace.json: {err}"))?;
    let manifest: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|err| format!("Failed to parse marketplace.json: {err}"))?;
    let marketplace = manifest
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("marketplace")
        .to_string();
    let Some(plugins) = manifest.get("plugins").and_then(|value| value.as_array()) else {
        return Err("marketplace.json does not contain plugins".to_string());
    };
    let found = plugins
        .iter()
        .any(|item| item.get("name").and_then(|value| value.as_str()) == Some(plugin_name));
    if !found {
        return Err(format!(
            "Plugin not found in marketplace.json: {plugin_name}"
        ));
    }
    Ok(marketplace)
}

fn install_target_dir(
    cache_root: &Path,
    marketplace: &str,
    plugin_name: &str,
    source_dir: &Path,
) -> PathBuf {
    let version = detect_plugin_version(source_dir).unwrap_or_else(|| "latest".to_string());
    plugin_cache_dir(cache_root, marketplace, plugin_name).join(version)
}

fn find_installed_plugin_dir(
    cache_root: &Path,
    marketplace: &str,
    plugin_name: &str,
) -> Option<PathBuf> {
    let plugin_root = plugin_cache_dir(cache_root, marketplace, plugin_name);
    if !plugin_root.is_dir() {
        return None;
    }
    let entries = fs::read_dir(&plugin_root).ok()?;
    for entry in entries {
        let entry = entry.ok()?;
        if entry.file_type().ok()?.is_dir() {
            return Some(entry.path());
        }
    }
    Some(plugin_root)
}
